"""Unit tests for the readiness scoring engine.

Exercises every finding code at least once (P0.1 acceptance criterion:
≥85% finding-code coverage).
"""

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from datalex_readiness import scoring
from datalex_readiness.finding import findings_to_sarif
from datalex_readiness.scoring import review_file, review_project


FIXTURES = Path(__file__).parent / "fixtures"


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _codes(file_review):
    return {f["code"] for f in file_review["findings"]}


# ---------------------------------------------------------------------------
# Primitive helpers


def test_review_has_value():
    assert scoring.review_has_value("ok")
    assert not scoring.review_has_value("")
    assert not scoring.review_has_value("   ")
    assert scoring.review_has_value([1])
    assert not scoring.review_has_value([])
    assert scoring.review_has_value({"a": 1})
    assert not scoring.review_has_value({})
    assert not scoring.review_has_value(None)


def test_review_has_test_and_pk():
    col = {"name": "id", "primary_key": True, "tests": ["unique", {"not_null": {}}]}
    assert scoring.review_is_pk(col)
    assert scoring.review_has_test(col, "unique")
    assert scoring.review_has_test(col, "not_null")
    assert not scoring.review_has_test(col, "relationships")


def test_review_is_sensitive():
    # `\b(email)\b` — `_` is a word char so `user_email` doesn't trip; word
    # boundaries kick in for `email` alone or with non-word neighbours.
    assert scoring.review_is_sensitive({"name": "email"})
    assert scoring.review_is_sensitive({"name": "x", "tags": ["pii"]})
    assert not scoring.review_is_sensitive({"name": "amount"})


def test_review_file_kind():
    assert scoring.review_file_kind("a.yml", {"models": []}) == "dbt"
    assert scoring.review_file_kind("a.yml", {"kind": "model"}) == "dbt-imported"
    assert scoring.review_file_kind("foo.diagram.yaml", {"kind": "diagram"}) == "diagram"
    assert scoring.review_file_kind("a.yml", {"model": {"kind": "logical"}, "entities": []}) == "logical"
    assert scoring.review_file_kind("a.yml", {}) == "yaml"


# ---------------------------------------------------------------------------
# Per-file review — every finding code


def test_yaml_parse_error(tmp_path):
    f = tmp_path / "bad.yml"
    _write(f, "models:\n  - name: x\n   description: oops\n")  # bad indent
    record = {"path": "bad.yml", "fullPath": str(f), "name": "bad.yml"}
    out = review_file(record)
    assert out["status"] == "red"
    assert "DBT_READINESS_YAML_PARSE_ERROR" in _codes(out)


def test_unreadable(tmp_path):
    record = {
        "path": "missing.yml",
        "fullPath": str(tmp_path / "does-not-exist.yml"),
        "name": "missing.yml",
    }
    out = review_file(record)
    assert "DBT_READINESS_FILE_UNREADABLE" in _codes(out)


def test_unclassified_yaml(tmp_path):
    f = tmp_path / "x.yml"
    _write(f, "version: 2\nrandom: stuff\n")
    record = {"path": "x.yml", "fullPath": str(f), "name": "x.yml"}
    out = review_file(record)
    assert "DBT_READINESS_UNCLASSIFIED_YAML" in _codes(out)


def test_model_missing_metadata(tmp_path):
    f = tmp_path / "models.yml"
    _write(
        f,
        """
models:
  - name: customers
    columns:
      - name: id
      - name: email
""",
    )
    record = {"path": "models.yml", "fullPath": str(f), "name": "models.yml"}
    out = review_file(record)
    codes = _codes(out)
    # Description, owner, domain are missing
    assert "DBT_READINESS_MISSING_MODEL_DESCRIPTION" in codes
    assert "DBT_READINESS_MISSING_OWNER" in codes
    assert "DBT_READINESS_MISSING_DOMAIN" in codes
    # Coverage = 0% < 80%
    assert "DBT_READINESS_LOW_COLUMN_DESCRIPTION_COVERAGE" in codes
    # No PK marker / unique test
    assert "DBT_READINESS_NO_IDENTITY_TEST" in codes
    # Each column missing description
    assert "DBT_READINESS_MISSING_COLUMN_DESCRIPTION" in codes
    # Sensitive column unclassified (email)
    assert "DBT_READINESS_SENSITIVE_COLUMN_UNCLASSIFIED" in codes
    # Type unknown (no data_type)
    assert "DBT_READINESS_UNKNOWN_COLUMN_TYPE" in codes
    # Manifest + catalog absent
    assert "DBT_READINESS_MANIFEST_NOT_FOUND" in codes
    assert "DBT_READINESS_CATALOG_NOT_FOUND" in codes
    # Semantic-layer opportunity surfaces
    assert "DBT_READINESS_SEMANTIC_LAYER_OPPORTUNITY" in codes


def test_no_columns(tmp_path):
    f = tmp_path / "empty.yml"
    _write(f, "models:\n  - name: shell\n    description: ok\n    owner: a\n    domain: b\n")
    record = {"path": "empty.yml", "fullPath": str(f), "name": "empty.yml"}
    out = review_file(record)
    assert "DBT_READINESS_NO_COLUMNS" in _codes(out)
    assert out["status"] == "red"


def test_fact_grain_missing_and_pk_tests(tmp_path):
    f = tmp_path / "fct.yml"
    _write(
        f,
        """
models:
  - name: fct_orders
    description: Orders fact.
    owner: data
    domain: orders
    columns:
      - name: order_id
        description: id
        data_type: number
        primary_key: true
      - name: customer_id
        description: customer
        data_type: number
""",
    )
    record = {"path": "fct.yml", "fullPath": str(f), "name": "fct.yml"}
    out = review_file(record)
    codes = _codes(out)
    assert "DBT_READINESS_FACT_GRAIN_MISSING" in codes
    assert "DBT_READINESS_PK_TESTS_MISSING" in codes
    assert "DBT_READINESS_RELATIONSHIP_TEST_MISSING" in codes
    assert "DBT_READINESS_CONTRACT_REVIEW" in codes


def test_staging_materialization(tmp_path):
    f = tmp_path / "stg.yml"
    _write(
        f,
        """
models:
  - name: stg_users
    description: staging users
    owner: a
    domain: customer
    config:
      materialized: table
    columns:
      - name: user_id
        description: id
        data_type: number
        primary_key: true
        tests: [unique, not_null]
""",
    )
    record = {"path": "stg.yml", "fullPath": str(f), "name": "stg.yml"}
    out = review_file(record)
    assert "DBT_READINESS_STAGING_MATERIALIZATION_REVIEW" in _codes(out)


# ---------------------------------------------------------------------------
# Project-level


def _write_project(root: Path) -> None:
    _write(
        root / "schema.yml",
        """
models:
  - name: customers
    description: The customers model.
    owner: data
    domain: crm
    columns:
      - name: customer_id
        description: id
        data_type: number
        primary_key: true
        tests: [unique, not_null]
      - name: full_name
        description: name
        data_type: string
""",
    )
    _write(
        root / "broken.yml",
        "models:\n  - name: x\n   description: bad\n",
    )


def test_review_project_summary(tmp_path):
    _write_project(tmp_path)
    out = review_project("p1", str(tmp_path))
    assert out["ok"] is True
    assert out["projectId"] == "p1"
    assert out["modelPath"] == str(tmp_path)
    assert out["summary"]["total_files"] == 2
    by = out["byPath"]
    assert "broken.yml" in by
    assert by["broken.yml"]["status"] == "red"


def test_summary_empty(tmp_path):
    out = review_project("empty", str(tmp_path))
    assert out["summary"]["total_files"] == 0
    assert out["summary"]["score"] == 100


# ---------------------------------------------------------------------------
# Subprocess parity — the api-server invokes us as `python -m datalex_readiness review`


def test_module_subprocess(tmp_path):
    _write_project(tmp_path)
    src_dir = Path(__file__).resolve().parent.parent / "src"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(src_dir) + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [
            sys.executable,
            "-m",
            "datalex_readiness",
            "review",
            "--project",
            str(tmp_path),
            "--project-id",
            "subproc",
        ],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["ok"] is True
    assert payload["projectId"] == "subproc"
    assert payload["summary"]["total_files"] == 2


# ---------------------------------------------------------------------------
# SARIF


def test_sarif_emission(tmp_path):
    _write_project(tmp_path)
    out = review_project("sarif", str(tmp_path))
    sarif = findings_to_sarif(out["files"])
    assert sarif["version"] == "2.1.0"
    assert "results" in sarif["runs"][0]
    # broken.yml should produce at least one error-level result
    levels = {r["level"] for r in sarif["runs"][0]["results"]}
    assert "error" in levels
