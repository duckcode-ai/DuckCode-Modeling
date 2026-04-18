"""Phase 6 — Policy Engine & Governance Maturity tests.

Covers:
  - naming_convention policy type
  - require_indexes policy type
  - require_owner policy type
  - require_sla policy type
  - deprecation_check policy type
  - custom_expression policy type (entity / field / model scopes)
  - Policy inheritance (merge_policy_packs, load_policy_pack_with_inheritance)
  - Updated policy schema validation
  - CI template file existence
  - CLI --inherit flag
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

# ---------------------------------------------------------------------------
# Imports from core engine
# ---------------------------------------------------------------------------
from dm_core.policy import (
    _naming_convention,
    _require_indexes,
    _require_owner,
    _require_sla,
    _deprecation_check,
    _custom_expression,
    merge_policy_packs,
    load_policy_pack,
    load_policy_pack_with_inheritance,
    policy_issues,
)
from dm_core.schema import load_schema, schema_issues
from dm_core.issues import Issue, has_errors


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_model(**overrides) -> Dict[str, Any]:
    """Build a minimal valid model dict, merging *overrides*."""
    base: Dict[str, Any] = {
        "model": {
            "name": "test_model",
            "version": "1.0.0",
            "domain": "test",
            "owners": ["test@example.com"],
            "state": "draft",
        },
        "entities": [
            {
                "name": "Customer",
                "type": "table",
                "description": "Customer table",
                "owner": "team@example.com",
                "tags": ["GOLD"],
                "sla": {"freshness": "24h", "quality_score": 99.5},
                "fields": [
                    {"name": "customer_id", "type": "integer", "primary_key": True, "nullable": False},
                    {"name": "email", "type": "string", "nullable": False, "description": "Email"},
                    {"name": "name", "type": "string", "nullable": False, "description": "Name"},
                    {"name": "status", "type": "string", "nullable": False, "description": "Status"},
                    {"name": "created_at", "type": "timestamp", "nullable": False, "description": "Created"},
                ],
            },
        ],
        "relationships": [],
        "indexes": [
            {"name": "idx_customer_email", "entity": "Customer", "fields": ["email"], "unique": True},
        ],
    }
    base.update(overrides)
    return base


def _issues_by_code(issues: List[Issue], code_prefix: str) -> List[Issue]:
    return [i for i in issues if i.code.startswith(code_prefix)]


# ===========================================================================
# naming_convention
# ===========================================================================

class TestNamingConvention(unittest.TestCase):
    """Tests for the naming_convention policy type."""

    def test_entity_pattern_pass(self):
        model = _make_model()
        issues = _naming_convention(model, "error", "NC", {"entity_pattern": "^[A-Z][a-zA-Z0-9]*$"})
        self.assertEqual(len(issues), 0)

    def test_entity_pattern_fail(self):
        model = _make_model(entities=[{"name": "bad_name", "type": "table", "fields": []}])
        issues = _naming_convention(model, "error", "NC", {"entity_pattern": "^[A-Z][a-zA-Z0-9]*$"})
        self.assertEqual(len(issues), 1)
        self.assertIn("bad_name", issues[0].message)

    def test_field_pattern_pass(self):
        model = _make_model()
        issues = _naming_convention(model, "error", "NC", {"field_pattern": "^[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 0)

    def test_field_pattern_fail(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [{"name": "BadField", "type": "string"}],
        }])
        issues = _naming_convention(model, "error", "NC", {"field_pattern": "^[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 1)
        self.assertIn("BadField", issues[0].message)

    def test_relationship_pattern_pass(self):
        model = _make_model(relationships=[{"name": "customer_orders", "from": "A.a", "to": "B.b", "cardinality": "one_to_many"}])
        issues = _naming_convention(model, "error", "NC", {"relationship_pattern": "^[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 0)

    def test_relationship_pattern_fail(self):
        model = _make_model(relationships=[{"name": "BadRel", "from": "A.a", "to": "B.b", "cardinality": "one_to_many"}])
        issues = _naming_convention(model, "error", "NC", {"relationship_pattern": "^[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 1)

    def test_index_pattern_pass(self):
        model = _make_model()
        issues = _naming_convention(model, "error", "NC", {"index_pattern": "^idx_[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 0)

    def test_index_pattern_fail(self):
        model = _make_model(indexes=[{"name": "BadIndex", "entity": "Customer", "fields": ["email"]}])
        issues = _naming_convention(model, "error", "NC", {"index_pattern": "^idx_[a-z][a-z0-9_]*$"})
        self.assertEqual(len(issues), 1)

    def test_invalid_regex(self):
        model = _make_model()
        issues = _naming_convention(model, "error", "NC", {"entity_pattern": "[invalid("})
        self.assertEqual(len(issues), 1)
        self.assertIn("MISCONFIGURED", issues[0].code)

    def test_no_patterns_misconfigured(self):
        model = _make_model()
        issues = _naming_convention(model, "error", "NC", {})
        self.assertEqual(len(issues), 1)
        self.assertIn("MISCONFIGURED", issues[0].code)

    def test_multiple_patterns_combined(self):
        model = _make_model(
            entities=[{"name": "Customer", "type": "table", "fields": [{"name": "customer_id", "type": "integer"}]}],
            indexes=[{"name": "idx_email", "entity": "Customer", "fields": ["email"]}],
        )
        issues = _naming_convention(model, "warn", "NC", {
            "entity_pattern": "^[A-Z][a-zA-Z0-9]*$",
            "field_pattern": "^[a-z][a-z0-9_]*$",
            "index_pattern": "^idx_[a-z][a-z0-9_]*$",
        })
        self.assertEqual(len(issues), 0)


# ===========================================================================
# require_indexes
# ===========================================================================

class TestRequireIndexes(unittest.TestCase):
    """Tests for the require_indexes policy type."""

    def test_entity_with_indexes_passes(self):
        model = _make_model()
        issues = _require_indexes(model, "error", "RI", {"min_fields": 5})
        self.assertEqual(len(issues), 0)

    def test_entity_without_indexes_fails(self):
        model = _make_model(indexes=[])
        issues = _require_indexes(model, "error", "RI", {"min_fields": 5})
        self.assertEqual(len(issues), 1)
        self.assertIn("Customer", issues[0].message)
        self.assertIn("no indexes", issues[0].message)

    def test_entity_below_threshold_passes(self):
        model = _make_model(
            entities=[{"name": "Small", "type": "table", "fields": [
                {"name": "id", "type": "integer"},
                {"name": "name", "type": "string"},
            ]}],
            indexes=[],
        )
        issues = _require_indexes(model, "error", "RI", {"min_fields": 5})
        self.assertEqual(len(issues), 0)

    def test_entity_type_filter(self):
        model = _make_model(
            entities=[{"name": "MyView", "type": "view", "fields": [
                {"name": "a", "type": "string"},
                {"name": "b", "type": "string"},
                {"name": "c", "type": "string"},
                {"name": "d", "type": "string"},
                {"name": "e", "type": "string"},
            ]}],
            indexes=[],
        )
        issues = _require_indexes(model, "error", "RI", {"min_fields": 5, "entity_types": ["table"]})
        self.assertEqual(len(issues), 0)

    def test_default_min_fields_is_5(self):
        model = _make_model(indexes=[])
        issues = _require_indexes(model, "warn", "RI", {})
        self.assertEqual(len(issues), 1)


# ===========================================================================
# require_owner
# ===========================================================================

class TestRequireOwner(unittest.TestCase):
    """Tests for the require_owner policy type."""

    def test_entity_with_owner_passes(self):
        model = _make_model()
        issues = _require_owner(model, "error", "RO", {})
        self.assertEqual(len(issues), 0)

    def test_entity_without_owner_fails(self):
        model = _make_model(entities=[{"name": "NoOwner", "type": "table", "fields": []}])
        issues = _require_owner(model, "error", "RO", {})
        self.assertEqual(len(issues), 1)
        self.assertIn("NoOwner", issues[0].message)

    def test_entity_type_filter(self):
        model = _make_model(entities=[{"name": "MyView", "type": "view", "fields": []}])
        issues = _require_owner(model, "error", "RO", {"entity_types": ["table"]})
        self.assertEqual(len(issues), 0)

    def test_require_email_valid(self):
        model = _make_model()
        issues = _require_owner(model, "error", "RO", {"require_email": True})
        self.assertEqual(len(issues), 0)

    def test_require_email_invalid(self):
        model = _make_model(entities=[{
            "name": "BadOwner",
            "type": "table",
            "owner": "not-an-email",
            "fields": [],
        }])
        issues = _require_owner(model, "error", "RO", {"require_email": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("not a valid email", issues[0].message)

    def test_empty_owner_string_fails(self):
        model = _make_model(entities=[{
            "name": "EmptyOwner",
            "type": "table",
            "owner": "  ",
            "fields": [],
        }])
        issues = _require_owner(model, "error", "RO", {})
        self.assertEqual(len(issues), 1)


# ===========================================================================
# require_sla
# ===========================================================================

class TestRequireSla(unittest.TestCase):
    """Tests for the require_sla policy type."""

    def test_entity_with_sla_passes(self):
        model = _make_model()
        issues = _require_sla(model, "error", "RS", {"entity_types": ["table"]})
        self.assertEqual(len(issues), 0)

    def test_entity_without_sla_fails(self):
        model = _make_model(entities=[{
            "name": "NoSla",
            "type": "table",
            "tags": ["GOLD"],
            "fields": [],
        }])
        issues = _require_sla(model, "error", "RS", {"entity_types": ["table"]})
        self.assertEqual(len(issues), 1)
        self.assertIn("NoSla", issues[0].message)

    def test_required_tags_filter(self):
        model = _make_model(entities=[{
            "name": "NoSla",
            "type": "table",
            "tags": ["SILVER"],
            "fields": [],
        }])
        issues = _require_sla(model, "error", "RS", {"required_tags": ["GOLD"]})
        self.assertEqual(len(issues), 0)

    def test_require_freshness(self):
        model = _make_model(entities=[{
            "name": "MissingFreshness",
            "type": "table",
            "sla": {"quality_score": 99.0},
            "fields": [],
        }])
        issues = _require_sla(model, "error", "RS", {"require_freshness": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("freshness", issues[0].message)

    def test_require_quality_score(self):
        model = _make_model(entities=[{
            "name": "MissingQS",
            "type": "table",
            "sla": {"freshness": "24h"},
            "fields": [],
        }])
        issues = _require_sla(model, "error", "RS", {"require_quality_score": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("quality_score", issues[0].message)

    def test_entity_type_filter(self):
        model = _make_model(entities=[{
            "name": "MyView",
            "type": "view",
            "fields": [],
        }])
        issues = _require_sla(model, "error", "RS", {"entity_types": ["table"]})
        self.assertEqual(len(issues), 0)


# ===========================================================================
# deprecation_check
# ===========================================================================

class TestDeprecationCheck(unittest.TestCase):
    """Tests for the deprecation_check policy type."""

    def test_no_deprecated_fields_passes(self):
        model = _make_model()
        issues = _deprecation_check(model, "warn", "DC", {"require_message": True})
        self.assertEqual(len(issues), 0)

    def test_deprecated_with_message_passes(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [{
                "name": "legacy_id",
                "type": "string",
                "deprecated": True,
                "deprecated_message": "Use external_code instead",
            }],
        }])
        issues = _deprecation_check(model, "warn", "DC", {"require_message": True})
        self.assertEqual(len(issues), 0)

    def test_deprecated_without_message_fails(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [{
                "name": "legacy_id",
                "type": "string",
                "deprecated": True,
            }],
        }])
        issues = _deprecation_check(model, "warn", "DC", {"require_message": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("deprecated_message", issues[0].message)

    def test_deprecated_field_in_relationship(self):
        model = _make_model(
            entities=[{
                "name": "Customer",
                "type": "table",
                "fields": [{
                    "name": "old_id",
                    "type": "integer",
                    "deprecated": True,
                    "deprecated_message": "Use new_id",
                }],
            }],
            relationships=[{
                "name": "cust_orders",
                "from": "Customer.old_id",
                "to": "Order.customer_id",
                "cardinality": "one_to_many",
            }],
        )
        issues = _deprecation_check(model, "warn", "DC", {"check_references": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("cust_orders", issues[0].message)
        self.assertIn("deprecated", issues[0].message)

    def test_deprecated_field_in_index(self):
        model = _make_model(
            entities=[{
                "name": "Customer",
                "type": "table",
                "fields": [{
                    "name": "old_email",
                    "type": "string",
                    "deprecated": True,
                    "deprecated_message": "Use email",
                }],
            }],
            indexes=[{"name": "idx_old_email", "entity": "Customer", "fields": ["old_email"]}],
        )
        issues = _deprecation_check(model, "warn", "DC", {"check_references": True})
        self.assertEqual(len(issues), 1)
        self.assertIn("idx_old_email", issues[0].message)

    def test_check_references_disabled(self):
        model = _make_model(
            entities=[{
                "name": "Customer",
                "type": "table",
                "fields": [{
                    "name": "old_id",
                    "type": "integer",
                    "deprecated": True,
                    "deprecated_message": "Use new_id",
                }],
            }],
            relationships=[{
                "name": "cust_orders",
                "from": "Customer.old_id",
                "to": "Order.customer_id",
                "cardinality": "one_to_many",
            }],
        )
        issues = _deprecation_check(model, "warn", "DC", {"check_references": False})
        self.assertEqual(len(issues), 0)

    def test_require_message_disabled(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [{"name": "legacy_id", "type": "string", "deprecated": True}],
        }])
        issues = _deprecation_check(model, "warn", "DC", {"require_message": False})
        self.assertEqual(len(issues), 0)


# ===========================================================================
# custom_expression
# ===========================================================================

class TestCustomExpression(unittest.TestCase):
    """Tests for the custom_expression policy type."""

    def test_entity_scope_pass(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "entity",
            "expression": "has_description",
        })
        self.assertEqual(len(issues), 0)

    def test_entity_scope_fail(self):
        model = _make_model(entities=[{"name": "NoDesc", "type": "table", "fields": []}])
        issues = _custom_expression(model, "error", "CE", {
            "scope": "entity",
            "expression": "has_description",
        })
        self.assertEqual(len(issues), 1)
        self.assertIn("NoDesc", issues[0].message)

    def test_entity_scope_custom_message(self):
        model = _make_model(entities=[{"name": "NoDesc", "type": "table", "fields": []}])
        issues = _custom_expression(model, "error", "CE", {
            "scope": "entity",
            "expression": "has_description",
            "message": "Entity '{name}' needs a description!",
        })
        self.assertEqual(len(issues), 1)
        self.assertIn("NoDesc", issues[0].message)
        self.assertIn("needs a description", issues[0].message)

    def test_field_scope_pass(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "field",
            "expression": "not deprecated",
        })
        self.assertEqual(len(issues), 0)

    def test_field_scope_fail(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [{"name": "old_id", "type": "string", "deprecated": True}],
        }])
        issues = _custom_expression(model, "warn", "CE", {
            "scope": "field",
            "expression": "not deprecated",
        })
        self.assertEqual(len(issues), 1)

    def test_model_scope_pass(self):
        model = _make_model(governance={"classification": {}})
        issues = _custom_expression(model, "error", "CE", {
            "scope": "model",
            "expression": "has_governance",
        })
        self.assertEqual(len(issues), 0)

    def test_model_scope_fail(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "model",
            "expression": "has_governance",
        })
        self.assertEqual(len(issues), 1)

    def test_model_scope_entity_count(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "model",
            "expression": "entity_count >= 1",
        })
        self.assertEqual(len(issues), 0)

    def test_invalid_expression(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "entity",
            "expression": "undefined_var + 1",
        })
        self.assertEqual(len(issues), 1)
        self.assertIn("MISCONFIGURED", issues[0].code)

    def test_missing_expression(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {"scope": "entity"})
        self.assertEqual(len(issues), 1)
        self.assertIn("MISCONFIGURED", issues[0].code)

    def test_invalid_scope(self):
        model = _make_model()
        issues = _custom_expression(model, "error", "CE", {
            "scope": "invalid",
            "expression": "True",
        })
        self.assertEqual(len(issues), 1)
        self.assertIn("invalid scope", issues[0].message)

    def test_field_scope_complex_expression(self):
        model = _make_model(entities=[{
            "name": "Customer",
            "type": "table",
            "fields": [
                {"name": "email", "type": "string", "sensitivity": "restricted", "description": "Email"},
                {"name": "name", "type": "string", "description": "Name"},
            ],
        }])
        issues = _custom_expression(model, "warn", "CE", {
            "scope": "field",
            "expression": "sensitivity == '' or has_description",
        })
        self.assertEqual(len(issues), 0)


# ===========================================================================
# merge_policy_packs
# ===========================================================================

class TestMergePolicyPacks(unittest.TestCase):
    """Tests for policy pack merging."""

    def test_merge_empty(self):
        result = merge_policy_packs()
        self.assertEqual(result["policies"], [])

    def test_merge_single_pack(self):
        pack = {
            "pack": {"name": "base", "version": "1.0.0"},
            "policies": [{"id": "P1", "type": "require_owner", "severity": "warn", "params": {}}],
        }
        result = merge_policy_packs(pack)
        self.assertEqual(len(result["policies"]), 1)
        self.assertEqual(result["pack"]["name"], "base")

    def test_merge_override_by_id(self):
        base = {
            "pack": {"name": "base", "version": "1.0.0"},
            "policies": [
                {"id": "P1", "type": "require_owner", "severity": "warn", "params": {}},
                {"id": "P2", "type": "require_sla", "severity": "warn", "params": {}},
            ],
        }
        overlay = {
            "pack": {"name": "overlay", "version": "2.0.0"},
            "policies": [
                {"id": "P1", "type": "require_owner", "severity": "error", "params": {"require_email": True}},
            ],
        }
        result = merge_policy_packs(base, overlay)
        self.assertEqual(len(result["policies"]), 2)
        self.assertEqual(result["pack"]["name"], "overlay")
        p1 = result["policies"][0]
        self.assertEqual(p1["severity"], "error")
        self.assertTrue(p1["params"]["require_email"])

    def test_merge_preserves_order(self):
        base = {
            "pack": {"name": "base", "version": "1.0.0"},
            "policies": [
                {"id": "A", "type": "require_owner", "severity": "warn", "params": {}},
                {"id": "B", "type": "require_sla", "severity": "warn", "params": {}},
            ],
        }
        overlay = {
            "pack": {"name": "overlay", "version": "1.0.0"},
            "policies": [
                {"id": "C", "type": "naming_convention", "severity": "error", "params": {"entity_pattern": "^[A-Z].*$"}},
            ],
        }
        result = merge_policy_packs(base, overlay)
        ids = [p["id"] for p in result["policies"]]
        self.assertEqual(ids, ["A", "B", "C"])

    def test_merge_three_packs(self):
        p1 = {"pack": {"name": "a", "version": "1.0.0"}, "policies": [{"id": "X", "type": "require_owner", "severity": "info", "params": {}}]}
        p2 = {"pack": {"name": "b", "version": "1.0.0"}, "policies": [{"id": "X", "type": "require_owner", "severity": "warn", "params": {}}]}
        p3 = {"pack": {"name": "c", "version": "1.0.0"}, "policies": [{"id": "X", "type": "require_owner", "severity": "error", "params": {}}]}
        result = merge_policy_packs(p1, p2, p3)
        self.assertEqual(result["policies"][0]["severity"], "error")
        self.assertEqual(result["pack"]["name"], "c")


# ===========================================================================
# load_policy_pack_with_inheritance
# ===========================================================================

class TestPolicyInheritance(unittest.TestCase):
    """Tests for policy inheritance via pack.extends."""

    def test_load_without_extends(self):
        pack = load_policy_pack_with_inheritance(str(ROOT / "policies" / "default.policy.yaml"))
        self.assertIn("policies", pack)
        self.assertGreater(len(pack["policies"]), 0)

    def test_load_with_extends(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            base_path = os.path.join(tmpdir, "base.policy.yaml")
            child_path = os.path.join(tmpdir, "child.policy.yaml")

            base = {
                "pack": {"name": "base", "version": "1.0.0"},
                "policies": [
                    {"id": "BASE_ONLY", "type": "require_owner", "severity": "warn", "params": {}},
                    {"id": "SHARED", "type": "require_sla", "severity": "warn", "params": {}},
                ],
            }
            child = {
                "pack": {"name": "child", "version": "1.0.0", "extends": "base.policy.yaml"},
                "policies": [
                    {"id": "SHARED", "type": "require_sla", "severity": "error", "params": {"require_quality_score": True}},
                    {"id": "CHILD_ONLY", "type": "naming_convention", "severity": "error", "params": {"entity_pattern": "^[A-Z].*$"}},
                ],
            }

            with open(base_path, "w") as f:
                yaml.safe_dump(base, f)
            with open(child_path, "w") as f:
                yaml.safe_dump(child, f)

            result = load_policy_pack_with_inheritance(child_path)
            ids = [p["id"] for p in result["policies"]]
            self.assertIn("BASE_ONLY", ids)
            self.assertIn("SHARED", ids)
            self.assertIn("CHILD_ONLY", ids)
            shared = [p for p in result["policies"] if p["id"] == "SHARED"][0]
            self.assertEqual(shared["severity"], "error")

    def test_transitive_extends(self):
        with tempfile.TemporaryDirectory() as tmpdir:
            grandparent = os.path.join(tmpdir, "gp.policy.yaml")
            parent = os.path.join(tmpdir, "parent.policy.yaml")
            child = os.path.join(tmpdir, "child.policy.yaml")

            with open(grandparent, "w") as f:
                yaml.safe_dump({
                    "pack": {"name": "gp", "version": "1.0.0"},
                    "policies": [{"id": "GP", "type": "require_owner", "severity": "info", "params": {}}],
                }, f)
            with open(parent, "w") as f:
                yaml.safe_dump({
                    "pack": {"name": "parent", "version": "1.0.0", "extends": "gp.policy.yaml"},
                    "policies": [{"id": "PARENT", "type": "require_sla", "severity": "warn", "params": {}}],
                }, f)
            with open(child, "w") as f:
                yaml.safe_dump({
                    "pack": {"name": "child", "version": "1.0.0", "extends": "parent.policy.yaml"},
                    "policies": [{"id": "CHILD", "type": "naming_convention", "severity": "error", "params": {"entity_pattern": "^[A-Z].*$"}}],
                }, f)

            result = load_policy_pack_with_inheritance(child)
            ids = [p["id"] for p in result["policies"]]
            self.assertIn("GP", ids)
            self.assertIn("PARENT", ids)
            self.assertIn("CHILD", ids)


# ===========================================================================
# policy_issues integration
# ===========================================================================

class TestPolicyIssuesIntegration(unittest.TestCase):
    """Integration tests for policy_issues with new policy types."""

    def test_naming_convention_via_policy_issues(self):
        model = _make_model(entities=[{"name": "bad_name", "type": "table", "fields": []}])
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{
                "id": "NC",
                "type": "naming_convention",
                "severity": "error",
                "params": {"entity_pattern": "^[A-Z][a-zA-Z0-9]*$"},
            }],
        }
        issues = policy_issues(model, pack)
        self.assertTrue(any("bad_name" in i.message for i in issues))

    def test_require_indexes_via_policy_issues(self):
        model = _make_model(indexes=[])
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{
                "id": "RI",
                "type": "require_indexes",
                "severity": "warn",
                "params": {"min_fields": 5},
            }],
        }
        issues = policy_issues(model, pack)
        self.assertTrue(any("no indexes" in i.message for i in issues))

    def test_require_owner_via_policy_issues(self):
        model = _make_model(entities=[{"name": "NoOwner", "type": "table", "fields": []}])
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{
                "id": "RO",
                "type": "require_owner",
                "severity": "error",
                "params": {},
            }],
        }
        issues = policy_issues(model, pack)
        self.assertTrue(any("NoOwner" in i.message for i in issues))

    def test_disabled_policy_skipped(self):
        model = _make_model(entities=[{"name": "NoOwner", "type": "table", "fields": []}])
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{
                "id": "RO",
                "type": "require_owner",
                "severity": "error",
                "enabled": False,
                "params": {},
            }],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)

    def test_custom_expression_via_policy_issues(self):
        model = _make_model()
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{
                "id": "CE",
                "type": "custom_expression",
                "severity": "warn",
                "params": {"scope": "model", "expression": "entity_count >= 1"},
            }],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)


# ===========================================================================
# Policy schema validation
# ===========================================================================

class TestPolicySchemaV2(unittest.TestCase):
    """Tests for the updated policy.schema.json."""

    def setUp(self):
        self.schema = load_schema(str(ROOT / "schemas" / "policy.schema.json"))

    def test_default_policy_validates(self):
        with open(ROOT / "policies" / "default.policy.yaml") as f:
            pack = yaml.safe_load(f)
        issues = schema_issues(pack, self.schema)
        self.assertEqual(len(issues), 0, f"Default policy validation failed: {issues}")

    def test_strict_policy_validates(self):
        with open(ROOT / "policies" / "strict.policy.yaml") as f:
            pack = yaml.safe_load(f)
        issues = schema_issues(pack, self.schema)
        self.assertEqual(len(issues), 0, f"Strict policy validation failed: {issues}")

    def test_new_policy_types_accepted(self):
        for ptype in [
            "naming_convention",
            "require_indexes",
            "require_owner",
            "require_sla",
            "deprecation_check",
            "custom_expression",
        ]:
            pack = {
                "pack": {"name": "test", "version": "1.0.0"},
                "policies": [{"id": "T", "type": ptype, "severity": "warn", "params": {}}],
            }
            issues = schema_issues(pack, self.schema)
            self.assertEqual(len(issues), 0, f"Policy type '{ptype}' should be valid: {issues}")

    def test_extends_string_accepted(self):
        pack = {
            "pack": {"name": "test", "version": "1.0.0", "extends": "base.policy.yaml"},
            "policies": [{"id": "T", "type": "require_owner", "severity": "warn", "params": {}}],
        }
        issues = schema_issues(pack, self.schema)
        self.assertEqual(len(issues), 0)

    def test_extends_array_accepted(self):
        pack = {
            "pack": {"name": "test", "version": "1.0.0", "extends": ["base.policy.yaml", "extra.policy.yaml"]},
            "policies": [{"id": "T", "type": "require_owner", "severity": "warn", "params": {}}],
        }
        issues = schema_issues(pack, self.schema)
        self.assertEqual(len(issues), 0)

    def test_invalid_policy_type_rejected(self):
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{"id": "T", "type": "nonexistent_type", "severity": "warn", "params": {}}],
        }
        issues = schema_issues(pack, self.schema)
        self.assertGreater(len(issues), 0)


# ===========================================================================
# CI template files
# ===========================================================================

class TestCITemplates(unittest.TestCase):
    """Tests for CI integration template files."""

    def test_github_actions_template_exists(self):
        path = ROOT / "ci-templates" / "github-actions.yml"
        self.assertTrue(path.exists(), f"Missing: {path}")
        content = path.read_text()
        self.assertIn("DataLex", content)
        self.assertIn("dm validate", content)
        self.assertIn("dm policy-check", content)
        self.assertIn("dm gate", content)

    def test_gitlab_ci_template_exists(self):
        path = ROOT / "ci-templates" / "gitlab-ci.yml"
        self.assertTrue(path.exists(), f"Missing: {path}")
        content = path.read_text()
        self.assertIn("DataLex", content)
        self.assertIn("validate-models", content)
        self.assertIn("policy-check", content)

    def test_bitbucket_pipelines_template_exists(self):
        path = ROOT / "ci-templates" / "bitbucket-pipelines.yml"
        self.assertTrue(path.exists(), f"Missing: {path}")
        content = path.read_text()
        self.assertIn("DataLex", content)
        self.assertIn("Validate Models", content)
        self.assertIn("Policy Check", content)

    def test_pr_comment_bot_template_exists(self):
        path = ROOT / "ci-templates" / "pr-comment-bot.yml"
        self.assertTrue(path.exists(), f"Missing: {path}")
        content = path.read_text()
        self.assertIn("DataLex", content)
        self.assertIn("PR Comment", content)
        self.assertIn("dm diff", content)


# ===========================================================================
# CLI integration
# ===========================================================================

class TestCLIPolicyCheck(unittest.TestCase):
    """Tests for CLI policy-check command with new features."""

    def test_cli_parser_has_inherit_flag(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "policy-check",
            "model-examples/starter-commerce.model.yaml",
            "--inherit",
        ])
        self.assertTrue(args.inherit)

    def test_cli_parser_default_no_inherit(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "policy-check",
            "model-examples/starter-commerce.model.yaml",
        ])
        self.assertFalse(args.inherit)

    def test_policy_check_with_new_types(self):
        """Verify that policy_issues handles all new types without crashing."""
        model = _make_model(
            governance={"classification": {"Customer.email": "PII"}},
            rules=[{"name": "r1", "target": "Customer.email", "expression": "True", "severity": "warn"}],
        )
        pack = {
            "pack": {"name": "full_test", "version": "1.0.0"},
            "policies": [
                {"id": "NC", "type": "naming_convention", "severity": "warn", "params": {"entity_pattern": "^[A-Z].*$"}},
                {"id": "RI", "type": "require_indexes", "severity": "warn", "params": {"min_fields": 5}},
                {"id": "RO", "type": "require_owner", "severity": "warn", "params": {}},
                {"id": "RS", "type": "require_sla", "severity": "warn", "params": {}},
                {"id": "DC", "type": "deprecation_check", "severity": "warn", "params": {}},
                {"id": "CE", "type": "custom_expression", "severity": "info", "params": {"scope": "model", "expression": "entity_count >= 0"}},
            ],
        }
        issues = policy_issues(model, pack)
        # Should not crash; may have some issues but no MISCONFIGURED errors
        misconfig = [i for i in issues if "MISCONFIGURED" in i.code]
        self.assertEqual(len(misconfig), 0, f"Unexpected misconfigured policies: {misconfig}")


# ===========================================================================
# Existing tests still pass (backward compatibility)
# ===========================================================================

class TestBackwardCompatibility(unittest.TestCase):
    """Ensure existing policy types still work."""

    def test_require_entity_tags(self):
        model = _make_model()
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{"id": "T", "type": "require_entity_tags", "severity": "warn", "params": {"tags": ["GOLD"]}}],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)

    def test_require_field_descriptions(self):
        model = _make_model()
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{"id": "T", "type": "require_field_descriptions", "severity": "warn", "params": {"exempt_primary_key": True}}],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)

    def test_classification_required_for_tags(self):
        model = _make_model(governance={"classification": {"Customer.email": "PII"}})
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{"id": "T", "type": "classification_required_for_tags", "severity": "error", "params": {"field_tags": ["PII"]}}],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)

    def test_rule_target_required(self):
        model = _make_model(rules=[
            {"name": "r1", "target": "Customer.email", "expression": "True", "severity": "warn"},
            {"name": "r2", "target": "Customer.name", "expression": "True", "severity": "warn"},
            {"name": "r3", "target": "Customer.status", "expression": "True", "severity": "warn"},
        ])
        pack = {
            "pack": {"name": "test", "version": "1.0.0"},
            "policies": [{"id": "T", "type": "rule_target_required", "severity": "warn", "params": {"field_types": ["string"]}}],
        }
        issues = policy_issues(model, pack)
        self.assertEqual(len(issues), 0)


if __name__ == "__main__":
    unittest.main()
