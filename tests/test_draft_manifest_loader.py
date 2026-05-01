"""Smoke tests for datalex_core.draft.manifest_loader.

The drafting pipeline's manifest condenser runs deterministically without an
Anthropic API key, so contributors can verify it with `pytest` alone. These
tests build tiny in-memory dbt manifests and assert the condenser extracts
what the prompt expects.
"""

import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from datalex_core.draft.manifest_loader import condense_manifest  # noqa: E402


def _model(name: str, *, schema: str = "marts", refs=None, columns=None, meta=None):
    return {
        "resource_type": "model",
        "name": name,
        "description": f"{name} description.",
        "schema": schema,
        "config": {"materialized": "table"},
        "tags": [],
        "meta": meta or {},
        "columns": columns or {},
        "refs": [{"name": r, "package": None, "version": None} for r in (refs or [])],
    }


def _column(name: str, dtype: str, description: str = ""):
    return {name: {"name": name, "data_type": dtype, "description": description}}


def _test(*, attached_to_model: str, project: str, column: str, test_name: str):
    return {
        "resource_type": "test",
        "name": f"{test_name}_{attached_to_model}_{column}",
        "column_name": column,
        "attached_node": f"model.{project}.{attached_to_model}",
        "test_metadata": {"name": test_name, "kwargs": {"column_name": column}},
    }


def _manifest(nodes: list[dict], sources: list[dict] | None = None) -> dict:
    return {
        "metadata": {"project_name": "tiny_shop", "adapter_type": "duckdb"},
        "nodes": {f"node.{i}": n for i, n in enumerate(nodes)},
        "sources": {f"source.{i}": s for i, s in enumerate(sources or [])},
    }


def test_condense_extracts_models_alphabetically():
    manifest = _manifest(
        [
            _model("dim_customers", columns={**_column("customer_id", "integer")}),
            _model("fct_orders", columns={**_column("order_id", "integer")}),
        ]
    )
    out = condense_manifest(manifest)
    assert [m["name"] for m in out["models"]] == ["dim_customers", "fct_orders"]
    assert out["dialect"] == "duckdb"
    assert out["project"] == "tiny_shop"


def test_condense_links_per_column_tests_via_attached_node():
    project = "tiny_shop"
    manifest = _manifest(
        [
            _model("dim_customers", columns={**_column("customer_id", "integer")}),
            _test(
                attached_to_model="dim_customers",
                project=project,
                column="customer_id",
                test_name="not_null",
            ),
            _test(
                attached_to_model="dim_customers",
                project=project,
                column="customer_id",
                test_name="unique",
            ),
        ]
    )
    out = condense_manifest(manifest)
    column = out["models"][0]["columns"][0]
    assert column["constraints"] == ["not_null", "unique"]


def test_condense_extracts_refs_as_relationship_signals():
    manifest = _manifest(
        [
            _model("dim_customers", columns={**_column("customer_id", "integer")}),
            _model(
                "fct_orders",
                refs=["dim_customers"],
                columns={**_column("customer_id", "integer")},
            ),
        ]
    )
    out = condense_manifest(manifest)
    fct = next(m for m in out["models"] if m["name"] == "fct_orders")
    assert fct["refs"] == ["dim_customers"]


def test_include_glob_filters_models():
    manifest = _manifest(
        [
            _model("dim_customers"),
            _model("fct_orders"),
            _model("stg_customers", schema="staging"),
        ]
    )
    out = condense_manifest(manifest, include_glob="dim_*")
    assert [m["name"] for m in out["models"]] == ["dim_customers"]


def test_condense_keeps_datalex_meta_block():
    manifest = _manifest(
        [
            _model(
                "dim_customers",
                meta={
                    "datalex": {"interface": {"domain": "commerce", "version": "v1"}},
                    "owner": "analytics",
                    "unrelated": "drop me",
                },
            )
        ]
    )
    out = condense_manifest(manifest)
    assert out["models"][0]["meta"]["datalex"]["interface"]["domain"] == "commerce"
    assert out["models"][0]["meta"]["owner"] == "analytics"
    assert "unrelated" not in out["models"][0]["meta"]


def test_condense_returns_empty_models_for_empty_manifest():
    out = condense_manifest(_manifest([]))
    assert out["models"] == []
    assert out["sources"] == []


def test_condense_includes_sources():
    manifest = _manifest(
        [],
        sources=[
            {
                "source_name": "raw",
                "name": "customers",
                "description": "Raw customers table.",
                "columns": {"id": {"data_type": "integer", "description": "PK"}},
            }
        ],
    )
    out = condense_manifest(manifest)
    assert len(out["sources"]) == 1
    assert out["sources"][0]["name"] == "raw.customers"
    assert out["sources"][0]["columns"][0]["name"] == "id"


@pytest.mark.skipif(
    not Path("/Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex/target/manifest.json").exists(),
    reason="jaffle-shop-DataLex manifest not present; integration check skipped.",
)
def test_condense_jaffle_shop_real_manifest():
    """End-to-end check against the real example repo manifest, when present.

    Skipped automatically if the example repo isn't sitting next to DataLex.
    """
    from datalex_core.draft.manifest_loader import load_manifest

    manifest = load_manifest(Path("/Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex"))
    out = condense_manifest(manifest)
    names = {m["name"] for m in out["models"]}
    assert "dim_customers" in names
    assert "fct_orders" in names

    dim = next(m for m in out["models"] if m["name"] == "dim_customers")
    pk = next(c for c in dim["columns"] if c["name"] == "customer_id")
    assert "not_null" in pk["constraints"]
    assert "unique" in pk["constraints"]
