"""Doc-block round-trip preservation (P0.2 acceptance test)."""

from __future__ import annotations

import json
from pathlib import Path

import yaml

from datalex_core.dbt.doc_blocks import DocBlockIndex, find_description_ref, render_description_from_ref
from datalex_core.dbt.manifest import import_manifest


def _write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def test_index_parses_docs_and_resolves(tmp_path):
    _write(
        tmp_path / "models" / "docs" / "customer.md",
        "{% docs customer_email %}\nThe customer's primary email address.\n{% enddocs %}\n"
        "{% docs customer_id %}\nUnique identifier for the customer.\n{% enddocs %}\n",
    )
    idx = DocBlockIndex.build(tmp_path)
    assert idx.resolve("customer_email").startswith("The customer's")
    assert idx.resolve("customer_id").startswith("Unique identifier")
    assert idx.reverse("The customer's primary email address.") == "customer_email"
    assert "customer_email" in idx.names()


def test_render_helpers():
    assert render_description_from_ref({"doc": "customer_email"}) == '{{ doc("customer_email") }}'
    assert render_description_from_ref({}) == ""


def test_find_description_ref_round_trip(tmp_path):
    _write(
        tmp_path / "docs.md",
        "{% docs order_total %}\nThe order total in USD, after discounts.\n{% enddocs %}\n",
    )
    idx = DocBlockIndex.build(tmp_path)
    assert find_description_ref("The order total in USD, after discounts.", idx) == {
        "doc": "order_total"
    }
    assert find_description_ref("Something else entirely.", idx) is None
    assert find_description_ref("The order total in USD, after discounts.", None) is None


def test_manifest_import_attaches_description_ref(tmp_path):
    """A column whose manifest description matches a doc block should round-trip."""
    project_root = tmp_path / "dbt_project"
    target_dir = project_root / "target"
    docs_dir = project_root / "models" / "docs"

    _write(
        docs_dir / "customer.md",
        "{% docs customer_email %}\nThe customer's primary email address.\n{% enddocs %}\n",
    )

    manifest = {
        "nodes": {
            "model.demo.customers": {
                "resource_type": "model",
                "name": "customers",
                "unique_id": "model.demo.customers",
                "database": "analytics",
                "schema": "core",
                "description": "Customer dimension.",
                "config": {"materialized": "table"},
                "depends_on": {"nodes": []},
                "columns": {
                    "email": {
                        "name": "email",
                        "data_type": "varchar",
                        "description": "The customer's primary email address.",
                    },
                    "id": {
                        "name": "id",
                        "data_type": "number",
                        "description": "An ad-hoc, non-doc-block description.",
                    },
                },
            }
        },
        "sources": {},
    }
    _write(target_dir / "manifest.json", json.dumps(manifest))

    result = import_manifest(
        manifest_path=str(target_dir / "manifest.json"),
        dbt_project_root=str(project_root),
    )
    customers = result.models["customers"]
    cols = {c["name"]: c for c in customers["columns"]}
    assert cols["email"]["description_ref"] == {"doc": "customer_email"}
    # Non-matching descriptions stay literal.
    assert "description_ref" not in cols["id"]


def test_emit_renders_description_ref(tmp_path):
    """Emit must use `{{ doc("name") }}` instead of the rendered description."""
    from datalex_core.dbt.emit import _model_column_to_dict

    col = {
        "name": "email",
        "type": "varchar",
        "description": "The customer's primary email address.",
        "description_ref": {"doc": "customer_email"},
    }
    out = _model_column_to_dict(col, contract_enforced=False)
    assert out["description"] == '{{ doc("customer_email") }}'


def test_round_trip_dbt_to_emit_preserves_doc_ref(tmp_path):
    """End-to-end: import a manifest with doc-block descriptions, then emit, and
    confirm the YAML uses `{{ doc("…") }}` not the rendered text."""
    project_root = tmp_path / "dbt_project"
    target_dir = project_root / "target"

    _write(
        project_root / "models" / "docs" / "customer.md",
        "{% docs customer_email %}\nThe customer's primary email address.\n{% enddocs %}\n",
    )

    manifest = {
        "nodes": {
            "model.demo.customers": {
                "resource_type": "model",
                "name": "customers",
                "unique_id": "model.demo.customers",
                "database": "analytics",
                "schema": "core",
                "config": {"materialized": "table"},
                "depends_on": {"nodes": []},
                "columns": {
                    "email": {
                        "name": "email",
                        "data_type": "varchar",
                        "description": "The customer's primary email address.",
                    }
                },
            }
        },
        "sources": {},
    }
    _write(target_dir / "manifest.json", json.dumps(manifest))

    result = import_manifest(
        manifest_path=str(target_dir / "manifest.json"),
        dbt_project_root=str(project_root),
    )

    # Hand the imported model into the emitter and check the YAML.
    from datalex_core.dbt.emit import _model_to_dict

    out = _model_to_dict(result.models["customers"])
    cols = {c["name"]: c for c in out["columns"]}
    assert cols["email"]["description"] == '{{ doc("customer_email") }}'
