"""Smoke tests for the `datalex readiness-gate` CLI subcommand."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import pytest

from datalex_cli.main import cmd_readiness_gate, _gate_render_pr_comment


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _project(tmp_path: Path) -> Path:
    _write(
        tmp_path / "schema.yml",
        """
models:
  - name: customers
    description: Customers.
    owner: data
    domain: crm
    columns:
      - name: customer_id
        description: id
        data_type: number
        primary_key: true
        tests: [unique, not_null]
      - name: name
        description: name
        data_type: string
""",
    )
    return tmp_path


def _args(**kwargs):
    return argparse.Namespace(
        project=kwargs.get("project", ""),
        min_score=kwargs.get("min_score"),
        max_yellow=kwargs.get("max_yellow"),
        max_red=kwargs.get("max_red", 0),
        allow_errors=kwargs.get("allow_errors", False),
        changed_only=kwargs.get("changed_only", False),
        base_ref=kwargs.get("base_ref", "origin/main"),
        sarif=kwargs.get("sarif", ""),
        pr_comment=kwargs.get("pr_comment", ""),
        output_json=kwargs.get("output_json", False),
    )


def test_clean_project_passes(tmp_path, capsys):
    project = _project(tmp_path)
    rc = cmd_readiness_gate(_args(project=str(project)))
    assert rc == 0
    out = capsys.readouterr().out
    assert "[gate]" in out


def test_min_score_threshold_fails(tmp_path, capsys):
    project = _project(tmp_path)
    rc = cmd_readiness_gate(_args(project=str(project), min_score=200))  # impossible
    assert rc == 1
    err = capsys.readouterr().err
    assert "min-score" in err


def test_red_file_fails_default(tmp_path, capsys):
    project = tmp_path
    _write(project / "broken.yml", "models:\n  - name: x\n   description: bad\n")
    rc = cmd_readiness_gate(_args(project=str(project)))
    assert rc != 0


def test_sarif_and_pr_comment_emitted(tmp_path):
    project = _project(tmp_path)
    sarif = tmp_path / "out.sarif"
    pr_md = tmp_path / "pr.md"
    rc = cmd_readiness_gate(
        _args(project=str(project), sarif=str(sarif), pr_comment=str(pr_md))
    )
    assert rc == 0
    assert sarif.exists()
    payload = json.loads(sarif.read_text(encoding="utf-8"))
    assert payload["version"] == "2.1.0"
    md = pr_md.read_text(encoding="utf-8")
    assert "DataLex readiness" in md


def test_pr_comment_uses_sticky_marker_friendly_format(tmp_path):
    review = {
        "summary": {
            "score": 92, "red": 0, "yellow": 1, "green": 4,
            "errors": 0, "warnings": 1, "infos": 3,
            "total_files": 5, "findings": 4,
        },
        "files": [
            {
                "path": "models/foo.yml",
                "status": "yellow",
                "score": 85,
                "counts": {"errors": 0, "warnings": 1, "infos": 0, "total": 1},
            }
        ],
    }
    md = _gate_render_pr_comment(review)
    assert "🟡" in md
    assert "models/foo.yml" in md
    assert "## DataLex readiness" in md


def test_missing_project_returns_error(tmp_path, capsys):
    rc = cmd_readiness_gate(_args(project=str(tmp_path / "nope")))
    assert rc == 1
    err = capsys.readouterr().err
    assert "project path not found" in err
