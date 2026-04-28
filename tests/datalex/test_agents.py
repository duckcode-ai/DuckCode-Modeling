"""Conceptualizer + canonicalizer agent tests (P2)."""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import yaml

from datalex_core.agents import propose_canonical_layer, propose_conceptual_model
from datalex_core.agents._shared import (
    is_staging_name,
    pascal_case,
    singularize,
    strip_staging_prefix,
)


# ---------------------------------------------------------------------------
# Helpers


def test_is_staging_name():
    assert is_staging_name("stg_orders")
    assert is_staging_name("staging_orders")
    assert is_staging_name("src_users")
    assert is_staging_name("raw_events")
    assert is_staging_name("models/staging/orders.sql")
    assert not is_staging_name("fct_orders")
    assert not is_staging_name("dim_customer")


def test_singularize_and_pascal_case():
    assert singularize("orders") == "order"
    assert singularize("addresses") == "address"
    assert singularize("companies") == "company"
    assert singularize("status") == "status"
    assert pascal_case("customer_email") == "CustomerEmail"
    assert pascal_case("order") == "Order"


def test_strip_staging_prefix():
    assert strip_staging_prefix("stg_orders") == "orders"
    assert strip_staging_prefix("staging_users") == "users"
    assert strip_staging_prefix("src_events") == "events"
    assert strip_staging_prefix("raw_logs") == "logs"
    assert strip_staging_prefix("fct_orders") == "fct_orders"


# ---------------------------------------------------------------------------
# Conceptualizer


def _staging_models():
    return {
        "stg_orders": {
            "kind": "model",
            "name": "stg_orders",
            "domain": "sales",
            "description": "Raw orders cleaned.",
            "columns": [
                {"name": "order_id", "type": "number", "primary_key": True, "description": "id"},
                {
                    "name": "customer_id",
                    "type": "number",
                    "foreign_key": {"entity": "stg_customers", "field": "customer_id"},
                    "description": "FK to customer.",
                },
                {"name": "order_total", "type": "number"},
            ],
        },
        "stg_customers": {
            "kind": "model",
            "name": "stg_customers",
            "domain": "crm",
            "description": "Cleaned customer dimension.",
            "columns": [
                {"name": "customer_id", "type": "number", "primary_key": True, "description": "id"},
                {"name": "email", "type": "string", "description": "Customer email", "sensitivity": "pii"},
            ],
        },
        "fct_orders": {  # excluded from staging walk
            "kind": "model",
            "name": "fct_orders",
            "columns": [],
        },
    }


def test_conceptualizer_emits_entities():
    proposal = propose_conceptual_model(_staging_models())
    names = sorted(e["name"] for e in proposal.entities)
    assert names == ["Customer", "Order"]
    by_name = {e["name"]: e for e in proposal.entities}
    assert by_name["Order"]["domain"] == "sales"
    assert by_name["Customer"]["domain"] == "crm"
    assert "from_staging" in by_name["Order"]["tags"]


def test_conceptualizer_extracts_relationships():
    proposal = propose_conceptual_model(_staging_models())
    assert len(proposal.relationships) == 1
    rel = proposal.relationships[0]
    assert rel["from"] == {"entity": "Order", "field": "customer_id"}
    assert rel["to"] == {"entity": "Customer", "field": "customer_id"}
    assert rel["cardinality"] == "many_to_one"


def test_conceptualizer_empty_project():
    proposal = propose_conceptual_model({})
    assert proposal.entities == []
    assert proposal.relationships == []
    assert any("staging" in n for n in proposal.notes)


def test_conceptualizer_notes_when_no_relationships():
    models = {
        "stg_users": {
            "kind": "model",
            "name": "stg_users",
            "columns": [{"name": "user_id", "primary_key": True, "type": "number"}],
        }
    }
    proposal = propose_conceptual_model(models)
    assert len(proposal.entities) == 1
    assert proposal.relationships == []
    assert any("FK relationships" in n for n in proposal.notes)


def test_conceptualizer_diagram_shape():
    proposal = propose_conceptual_model(_staging_models())
    diagram = proposal.to_diagram()
    assert diagram["kind"] == "diagram"
    assert diagram["layer"] == "conceptual"
    assert diagram["entities"]
    assert diagram["relationships"]


# ---------------------------------------------------------------------------
# Canonicalizer


def _staging_with_recurrence():
    """Two staging models that share the canonical noun `orders`."""
    return {
        "stg_shopify_orders": {
            "kind": "model",
            "name": "stg_shopify_orders",
            "columns": [
                {"name": "id", "type": "number", "primary_key": True, "description": "Surrogate key."},
                {"name": "amount", "type": "number", "description": "Total order amount with discounts applied (USD)."},
                {"name": "currency", "type": "varchar", "description": "ISO 4217 currency code."},
                {"name": "shopify_only_field", "type": "varchar"},
            ],
        },
        "stg_stripe_orders": {
            "kind": "model",
            "name": "stg_stripe_orders",
            "columns": [
                {"name": "id", "type": "number", "primary_key": True, "description": "Surrogate key."},
                {"name": "amount", "type": "number", "description": "Captured amount (EUR), pre-discount."},
                {"name": "currency", "type": "varchar", "description": "ISO 4217 currency code."},
                {"name": "stripe_only_field", "type": "varchar"},
            ],
        },
    }


def test_canonicalizer_groups_recurring_columns():
    proposal = propose_canonical_layer(_staging_with_recurrence())
    assert len(proposal.entities) == 1
    entity = proposal.entities[0]
    assert entity["name"] == "Order"
    columns = {c["name"]: c for c in entity["columns"]}
    assert "id" in columns
    assert "amount" in columns
    assert "currency" in columns
    assert "shopify_only_field" not in columns
    assert "stripe_only_field" not in columns
    assert sorted(entity["sources"]) == ["stg_shopify_orders", "stg_stripe_orders"]


def test_canonicalizer_emits_doc_blocks():
    proposal = propose_canonical_layer(_staging_with_recurrence())
    block_names = list(proposal.doc_blocks.keys())
    assert any("__id" in n for n in block_names)
    assert any("__currency" in n for n in block_names)


def test_canonicalizer_description_ref_emitted():
    proposal = propose_canonical_layer(_staging_with_recurrence())
    entity = proposal.entities[0]
    columns = {c["name"]: c for c in entity["columns"]}
    assert columns["id"]["description"].startswith('{{ doc("')
    assert columns["id"]["description_ref"]["doc"]


def test_canonicalizer_notes_divergent_descriptions():
    proposal = propose_canonical_layer(_staging_with_recurrence())
    # `amount` has divergent USD/EUR descriptions
    assert any("amount" in n and "divergent" in n for n in proposal.notes)


def test_canonicalizer_proposal_changes_include_md_and_yaml():
    proposal = propose_canonical_layer(_staging_with_recurrence())
    changes = proposal.to_proposal_changes()
    paths = [c["path"] for c in changes]
    assert any(p.endswith(".md") for p in paths)
    assert any(p.endswith(".model.yaml") for p in paths)
    md = next(c for c in changes if c["path"].endswith(".md"))
    assert "{% docs " in md["content"]
    assert "{% enddocs %}" in md["content"]


# ---------------------------------------------------------------------------
# Subprocess CLI bridge


def test_module_subprocess_conceptualize(tmp_path):
    project = tmp_path
    (project / "stg_orders.model.yaml").write_text(
        yaml.safe_dump(
            {
                "kind": "model",
                "name": "stg_orders",
                "columns": [
                    {"name": "order_id", "primary_key": True, "type": "number"},
                    {
                        "name": "customer_id",
                        "type": "number",
                        "foreign_key": {"entity": "stg_customers", "field": "customer_id"},
                    },
                ],
            }
        ),
        encoding="utf-8",
    )
    (project / "stg_customers.model.yaml").write_text(
        yaml.safe_dump(
            {
                "kind": "model",
                "name": "stg_customers",
                "columns": [{"name": "customer_id", "primary_key": True, "type": "number"}],
            }
        ),
        encoding="utf-8",
    )

    src = Path(__file__).resolve().parents[2] / "packages" / "core_engine" / "src"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(src) + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [sys.executable, "-m", "datalex_core.agents", "conceptualize", "--project", str(project)],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["agent"] == "conceptualizer"
    assert payload["model_count"] == 2
    assert payload["entities"]
    assert payload["relationships"]


def test_module_subprocess_canonicalize(tmp_path):
    project = tmp_path
    for source in ("shopify", "stripe"):
        (project / f"stg_{source}_orders.model.yaml").write_text(
            yaml.safe_dump(
                {
                    "kind": "model",
                    "name": f"stg_{source}_orders",
                    "columns": [
                        {"name": "id", "primary_key": True, "type": "number", "description": "Key."},
                        {"name": "amount", "type": "number", "description": "Total."},
                    ],
                }
            ),
            encoding="utf-8",
        )
    src = Path(__file__).resolve().parents[2] / "packages" / "core_engine" / "src"
    env = os.environ.copy()
    env["PYTHONPATH"] = str(src) + os.pathsep + env.get("PYTHONPATH", "")
    proc = subprocess.run(
        [sys.executable, "-m", "datalex_core.agents", "canonicalize", "--project", str(project)],
        capture_output=True,
        text=True,
        env=env,
        timeout=30,
    )
    assert proc.returncode == 0, proc.stderr
    payload = json.loads(proc.stdout)
    assert payload["agent"] == "canonicalizer"
    assert payload["entities"]
    assert payload["doc_blocks"]
    assert any(c["path"].endswith(".md") for c in payload["proposal_changes"])
