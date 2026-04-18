"""Tests for v3 modeling features: model kind, shared libraries, transforms,
standards autofix, and sync/CLI parser coverage."""

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

from datalex_core.canonical import compile_model
from datalex_core.modeling import apply_standards_fixes, normalize_model, standards_issues, transform_model
from datalex_core.schema import load_schema, schema_issues

SCHEMA_PATH = str(ROOT / "schemas" / "model.schema.json")
DM_CLI = str(ROOT / "datalex")


def _schema():
    return load_schema(SCHEMA_PATH)


def _conceptual_model() -> Dict[str, Any]:
    return {
        "model": {
            "name": "sales_domain",
            "kind": "conceptual",
            "spec_version": 3,
            "version": "1.0.0",
            "domain": "sales",
            "owners": ["data@example.com"],
            "state": "draft",
        },
        "domains": [
            {"name": "entity_id", "data_type": "integer", "description": "Reusable identifier domain"},
        ],
        "templates": [
            {
                "name": "audit_fields",
                "fields": [
                    {"name": "created_at", "type": "timestamp", "nullable": False},
                ],
            }
        ],
        "subject_areas": [
            {"name": "Sales", "description": "Sales domain"},
        ],
        "naming_rules": {
            "entity": {"style": "pascal_case"},
            "field": {"style": "snake_case"},
            "relationship": {"style": "snake_case"},
            "physical_name": {"style": "upper_snake_case"},
        },
        "entities": [
            {
                "name": "Customer",
                "type": "concept",
                "subject_area": "Sales",
                "templates": ["audit_fields"],
                "fields": [
                    {"name": "customer_id", "domain": "entity_id", "primary_key": True, "nullable": False},
                    {"name": "customer_name", "type": "string", "nullable": False},
                ],
            },
            {
                "name": "Order",
                "type": "concept",
                "subject_area": "Sales",
                "fields": [
                    {"name": "order_id", "domain": "entity_id", "primary_key": True, "nullable": False},
                    {"name": "customer_id", "domain": "entity_id", "nullable": False},
                ],
            },
        ],
        "relationships": [
            {
                "name": "order customer",
                "from": "Order.customer_id",
                "to": "Customer.customer_id",
                "cardinality": "many_to_one",
            }
        ],
    }


class TestModelingV3Schema(unittest.TestCase):
    def test_v2_models_normalize_to_physical_kind(self):
        model = {
            "model": {
                "name": "legacy_model",
                "version": "1.0.0",
                "domain": "legacy",
                "owners": ["data@example.com"],
                "state": "draft",
            },
            "entities": [
                {"name": "Customer", "type": "table", "fields": [{"name": "id", "type": "integer", "primary_key": True}]}
            ],
        }
        canonical = compile_model(model)
        self.assertEqual(canonical["model"]["kind"], "physical")

    def test_domain_only_field_validates_after_normalization(self):
        model = _conceptual_model()
        issues = schema_issues(model, _schema())
        self.assertEqual(len(issues), 0)

    def test_new_entity_types_are_accepted(self):
        model = _conceptual_model()
        model["entities"][0]["type"] = "logical_entity"
        issues = schema_issues(model, _schema())
        self.assertEqual(len(issues), 0)


class TestModelingV3Transforms(unittest.TestCase):
    def test_conceptual_to_logical(self):
        logical = transform_model(_conceptual_model(), "logical")
        self.assertEqual(logical["model"]["kind"], "logical")
        self.assertEqual(logical["entities"][0]["type"], "logical_entity")
        self.assertEqual(logical["entities"][0]["candidate_keys"], [["customer_id"]])
        self.assertEqual(logical["relationships"][0]["name"], "order customer")

    def test_logical_to_physical(self):
        logical = transform_model(_conceptual_model(), "logical")
        physical = transform_model(logical, "physical", dialect="snowflake")
        self.assertEqual(physical["model"]["kind"], "physical")
        customer = next(entity for entity in physical["entities"] if entity["name"] == "Customer")
        self.assertEqual(customer["type"], "table")
        self.assertEqual(customer["physical_name"], "CUSTOMER")
        pk_fields = {field["name"] for field in customer["fields"] if field.get("primary_key")}
        self.assertEqual(pk_fields, {"customer_id"})


class TestModelingV3Standards(unittest.TestCase):
    def test_standards_issue_for_missing_domain(self):
        model = _conceptual_model()
        model["entities"][0]["fields"][0]["domain"] = "missing_domain"
        issues = standards_issues(model)
        self.assertTrue(any(issue.code == "DOMAIN_NOT_FOUND" for issue in issues))

    def test_standards_fix_generates_subject_areas_and_physical_name(self):
        model = transform_model(_conceptual_model(), "physical")
        model.pop("subject_areas", None)
        for entity in model["entities"]:
            entity.pop("physical_name", None)
        fixed, changes = apply_standards_fixes(model)
        self.assertTrue(any("subject_areas" in change for change in changes))
        customer = next(entity for entity in fixed["entities"] if entity["name"] == "Customer")
        self.assertEqual(customer["physical_name"], "CUSTOMER")


class TestModelingV3CLI(unittest.TestCase):
    def test_parser_transform_command(self):
        from datalex_cli.main import build_parser

        parser = build_parser()
        args = parser.parse_args(["transform", "logical-to-physical", "model.yaml", "--dialect", "snowflake"])
        self.assertEqual(args.transform_command, "logical-to-physical")
        self.assertEqual(args.dialect, "snowflake")

    def test_parser_standards_and_sync_commands(self):
        from datalex_cli.main import build_parser

        parser = build_parser()
        standards_args = parser.parse_args(["standards", "check", "model.yaml"])
        sync_args = parser.parse_args(["sync", "compare", "current.yaml", "candidate.yaml"])
        self.assertEqual(standards_args.standards_command, "check")
        self.assertEqual(sync_args.sync_command, "compare")

    def test_cli_transform_runs(self):
        model = _conceptual_model()
        with tempfile.TemporaryDirectory() as tmpdir:
            source = Path(tmpdir) / "conceptual.model.yaml"
            out = Path(tmpdir) / "logical.model.yaml"
            source.write_text(yaml.safe_dump(model, sort_keys=False), encoding="utf-8")

            result = subprocess.run(
                [DM_CLI, "transform", "conceptual-to-logical", str(source), "--out", str(out)],
                cwd=ROOT,
                check=False,
                text=True,
                capture_output=True,
            )

            self.assertEqual(result.returncode, 0, msg=result.stderr or result.stdout)
            transformed = yaml.safe_load(out.read_text(encoding="utf-8"))
            self.assertEqual(transformed["model"]["kind"], "logical")


if __name__ == "__main__":
    unittest.main()
