"""P1.B: snapshot/seed/exposure/unit_test/semantic_model coverage."""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from datalex_core.dbt.manifest import import_manifest


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def _manifest_with_resources():
    return {
        "nodes": {
            "snapshot.demo.orders_snap": {
                "resource_type": "snapshot",
                "name": "orders_snap",
                "unique_id": "snapshot.demo.orders_snap",
                "database": "analytics",
                "schema": "snapshots",
                "description": "Snapshot of orders.",
                "config": {
                    "strategy": "check",
                    "unique_key": "order_id",
                    "check_cols": ["status", "total"],
                    "invalidate_hard_deletes": True,
                },
                "columns": {
                    "order_id": {"name": "order_id", "data_type": "number", "description": "id"},
                    "status": {"name": "status", "data_type": "varchar"},
                },
                "depends_on": {"nodes": []},
            },
            "seed.demo.country_codes": {
                "resource_type": "seed",
                "name": "country_codes",
                "unique_id": "seed.demo.country_codes",
                "description": "ISO country codes",
                "columns": {
                    "code": {"name": "code", "data_type": "varchar", "description": "ISO 3166"},
                    "name": {"name": "name", "data_type": "varchar"},
                },
                "depends_on": {"nodes": []},
            },
            "unit_test.demo.test_orders_total": {
                "resource_type": "unit_test",
                "name": "test_orders_total",
                "unique_id": "unit_test.demo.test_orders_total",
                "model": "fct_orders",
                "given": [{"input": "ref('stg_orders')", "rows": []}],
                "expect": {"rows": [{"order_id": 1, "total": 100}]},
            },
        },
        "sources": {},
        "exposures": {
            "exposure.demo.exec_dashboard": {
                "resource_type": "exposure",
                "name": "exec_dashboard",
                "unique_id": "exposure.demo.exec_dashboard",
                "type": "dashboard",
                "url": "https://looker.example.com/dashboards/42",
                "maturity": "medium",
                "description": "Quarterly exec dashboard.",
                "owner": {"name": "Data Team", "email": "data@example.com"},
                "depends_on": {"nodes": ["model.demo.fct_orders"]},
            }
        },
        "semantic_models": {
            "semantic_model.demo.orders": {
                "name": "orders",
                "unique_id": "semantic_model.demo.orders",
                "model": "fct_orders",
                "description": "Orders semantic model",
                "entities": [{"name": "order", "type": "primary", "expr": "order_id"}],
                "dimensions": [{"name": "ordered_at", "type": "time"}],
                "measures": [{"name": "order_total", "agg": "sum", "expr": "total"}],
            }
        },
    }


def test_import_extracts_all_resource_types(tmp_path):
    target = tmp_path / "target"
    _write(target / "manifest.json", json.dumps(_manifest_with_resources()))
    result = import_manifest(manifest_path=str(target / "manifest.json"))

    assert "orders_snap" in result.snapshots
    snap = result.snapshots["orders_snap"]
    assert snap["kind"] == "snapshot"
    assert snap["snapshot"]["strategy"] == "check"
    assert snap["snapshot"]["unique_key"] == "order_id"
    assert snap["snapshot"]["check_cols"] == ["status", "total"]
    assert snap["snapshot"]["invalidate_hard_deletes"] is True

    assert "country_codes" in result.seeds
    seed = result.seeds["country_codes"]
    assert seed["kind"] == "seed"
    assert any(c["name"] == "code" and c["type"] == "varchar" for c in seed["columns"])

    assert "exec_dashboard" in result.exposures
    exp = result.exposures["exec_dashboard"]
    assert exp["kind"] == "exposure"
    assert exp["maturity"] == "medium"
    assert exp["owner"]["email"] == "data@example.com"
    assert exp["depends_on"] == [{"ref": "fct_orders"}]

    assert "test_orders_total" in result.unit_tests
    ut = result.unit_tests["test_orders_total"]
    assert ut["model"] == "fct_orders"
    assert isinstance(ut["given"], list)

    assert "orders" in result.semantic_models
    sm = result.semantic_models["orders"]
    assert sm["entities"][0]["name"] == "order"


# --- readiness scoring picks up new resources --------------------------------

import sys

# Make readiness_engine importable for these tests.
SRC = Path(__file__).resolve().parents[2] / "packages" / "readiness_engine" / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))

from datalex_readiness.scoring import review_file  # noqa: E402


def _record(yml_path: Path):
    return {"path": yml_path.name, "fullPath": str(yml_path), "name": yml_path.name}


def _codes(out):
    return {f["code"] for f in out["findings"]}


def test_exposure_findings_flag_missing_email_and_maturity(tmp_path):
    yml = tmp_path / "exposures.yml"
    _write(
        yml,
        """
exposures:
  - name: exec_dashboard
    type: dashboard
    description: Quarterly summary
    url: https://example.com/dash
""",
    )
    out = review_file(_record(yml))
    codes = _codes(out)
    assert "DBT_READINESS_EXPOSURE_OWNER_EMAIL_MISSING" in codes
    assert "DBT_READINESS_EXPOSURE_MATURITY_MISSING" in codes


def test_exposure_clean_passes(tmp_path):
    yml = tmp_path / "exposures.yml"
    _write(
        yml,
        """
exposures:
  - name: exec_dashboard
    type: dashboard
    maturity: high
    description: Quarterly summary
    url: https://example.com/dash
    owner:
      name: Data
      email: data@example.com
""",
    )
    out = review_file(_record(yml))
    codes = _codes(out)
    assert "DBT_READINESS_EXPOSURE_OWNER_EMAIL_MISSING" not in codes


def test_unit_test_description_finding(tmp_path):
    yml = tmp_path / "unit_tests.yml"
    _write(
        yml,
        """
unit_tests:
  - name: test_orders_total
    model: fct_orders
""",
    )
    out = review_file(_record(yml))
    codes = _codes(out)
    assert "DBT_READINESS_MISSING_UNIT_TEST_DESCRIPTION" in codes


def test_source_freshness_without_loaded_at(tmp_path):
    yml = tmp_path / "sources.yml"
    _write(
        yml,
        """
sources:
  - name: raw
    tables:
      - name: orders
        freshness:
          warn_after: { count: 12, period: hour }
          error_after: { count: 24, period: hour }
""",
    )
    out = review_file(_record(yml))
    codes = _codes(out)
    assert "DBT_READINESS_FRESHNESS_WITHOUT_LOADED_AT" in codes


def test_source_freshness_with_loaded_at_passes(tmp_path):
    yml = tmp_path / "sources.yml"
    _write(
        yml,
        """
sources:
  - name: raw
    loaded_at_field: _ingested_at
    tables:
      - name: orders
        freshness:
          warn_after: { count: 12, period: hour }
""",
    )
    out = review_file(_record(yml))
    codes = _codes(out)
    assert "DBT_READINESS_FRESHNESS_WITHOUT_LOADED_AT" not in codes
