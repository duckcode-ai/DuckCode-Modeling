"""Catalog exporter tests (P1.E)."""

from __future__ import annotations

from datalex_core.exporters import available_targets, export_catalog


def _model():
    return {
        "model": {"name": "commerce", "domain": "sales"},
        "entities": [
            {
                "name": "Customer",
                "fields": [
                    {
                        "name": "email",
                        "binding": {"glossary_term": "customer_email", "status": "approved"},
                    },
                    {
                        "name": "id",
                        "terms": ["customer_id"],  # legacy form → status approved
                    },
                    {
                        "name": "loyalty_tier",
                        "meta": {"glossary_term": "loyalty_tier"},
                    },
                    {"name": "no_binding"},
                ],
            }
        ],
        "glossary": [
            {"term": "customer_email", "definition": "Primary email."},
            {"term": "customer_id", "definition": "Surrogate key for customer."},
            {"term": "loyalty_tier", "definition": "Loyalty program tier."},
        ],
    }


def test_available_targets():
    assert set(available_targets()) >= {"atlan", "datahub", "openmetadata"}


def test_atlan_export_attaches_bindings():
    payload = export_catalog("atlan", _model())
    assert payload["target"] == "atlan"
    assert payload["domain"] == "sales"
    by_term = {t["name"]: t for t in payload["terms"]}
    assert "customer_email" in by_term
    assignments = {a["qualifiedName"] for a in by_term["customer_email"]["assignedEntities"]}
    assert "Customer.email" in assignments
    # Legacy-form binding promoted
    assert "Customer.id" in {
        a["qualifiedName"] for a in by_term["customer_id"]["assignedEntities"]
    }
    # Meta-fallback binding promoted
    assert "Customer.loyalty_tier" in {
        a["qualifiedName"] for a in by_term["loyalty_tier"]["assignedEntities"]
    }


def test_datahub_export_emits_proposals():
    payload = export_catalog("datahub", _model())
    assert payload["target"] == "datahub"
    proposals = payload["proposals"]
    glossary_proposals = [p for p in proposals if p["entityType"] == "glossaryTerm"]
    field_proposals = [p for p in proposals if p["entityType"] == "schemaField"]
    assert len(glossary_proposals) == 3
    assert any("Customer.email" in p["entityUrn"] for p in field_proposals)
    assert any(
        p["aspect"]["terms"][0]["urn"] == "urn:li:glossaryTerm:customer_email"
        for p in field_proposals
    )


def test_openmetadata_export_uses_fqn():
    payload = export_catalog("openmetadata", _model())
    by_term = {t["name"]: t for t in payload["terms"]}
    assert "datalex.commerce.Customer.email" in by_term["customer_email"]["relatedEntities"]
    assert by_term["customer_email"]["fqn"].startswith("datalex.commerce")


def test_unknown_target_raises():
    import pytest

    with pytest.raises(ValueError):
        export_catalog("unknown", _model())


def test_round_trip_stable():
    """Running the exporter twice must produce identical output."""
    a = export_catalog("atlan", _model())
    b = export_catalog("atlan", _model())
    assert a == b
