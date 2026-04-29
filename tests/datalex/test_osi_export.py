"""OSI 0.1.1 exporter tests (Python-side mirror of the JS tests)."""

from __future__ import annotations

from datalex_core.osi import OSI_SPEC_VERSION, export_osi_bundle, validate_osi_bundle


SALES_CONCEPTUAL = """kind: diagram
name: sales_flow
layer: conceptual
description: Customer to revenue flow.
entities:
  - name: Customer
    type: concept
    domain: sales
    owner: CRM
    description: A buyer of goods.
    terms: [customer_id, email]
    visibility: shared
  - name: Order
    type: concept
    domain: sales
    description: Header for one purchase.
    fields:
      - name: order_id
        primary_key: true
      - name: customer_id
relationships:
  - name: customer_places_order
    from: { entity: Customer, field: customer_id }
    to: { entity: Order, field: customer_id }
    cardinality: one_to_many
    verb: places
"""

INTERNAL_ONLY = """kind: diagram
name: internal_concept
entities:
  - name: SecretConcept
    type: concept
    visibility: internal
"""


def test_export_produces_valid_bundle():
    bundle = export_osi_bundle(
        "test-project",
        [{"path": "sales/Conceptual/sales_flow.diagram.yaml", "content": SALES_CONCEPTUAL}],
    )
    assert bundle["version"] == OSI_SPEC_VERSION
    assert len(bundle["semantic_model"]) == 1
    sm = bundle["semantic_model"][0]
    assert sm["name"] == "sales_flow"
    names = sorted(d["name"] for d in sm["datasets"])
    assert names == ["Customer", "Order"]
    customer = next(d for d in sm["datasets"] if d["name"] == "Customer")
    assert customer["ai_context"]["synonyms"] == ["customer_id", "email"]
    order = next(d for d in sm["datasets"] if d["name"] == "Order")
    assert order["primary_key"] == ["order_id"]
    rels = sm["relationships"]
    assert len(rels) == 1
    assert rels[0]["from"] == "Customer"
    assert rels[0]["to"] == "Order"
    assert "places" in rels[0]["ai_context"]["instructions"]


def test_validator_accepts_well_formed_bundle():
    bundle = export_osi_bundle(
        "test-project",
        [{"path": "x.yml", "content": SALES_CONCEPTUAL}],
    )
    issues = validate_osi_bundle(bundle)
    assert issues == [], issues


def test_internal_visibility_is_skipped():
    bundle = export_osi_bundle(
        "secret",
        [{"path": "secret.yml", "content": INTERNAL_ONLY}],
    )
    assert bundle["semantic_model"] == []


def test_validator_catches_missing_required_fields():
    broken = {
        "version": "0.1.1",
        "semantic_model": [{"datasets": [{}]}],
    }
    issues = validate_osi_bundle(broken)
    assert any(i["path"].endswith("/name") for i in issues)
    assert any(i["path"].endswith("/source") for i in issues)


def test_malformed_yaml_skipped_not_fatal():
    docs = [
        {"path": "good.yml", "content": SALES_CONCEPTUAL},
        {"path": "broken.yml", "content": ":\n - not yaml: [\n"},
    ]
    bundle = export_osi_bundle("mixed", docs)
    assert len(bundle["semantic_model"]) == 1
