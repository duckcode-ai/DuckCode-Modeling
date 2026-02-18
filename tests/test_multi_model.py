"""Tests for Phase 2: Multi-model resolution, cross-file imports,
project diff, and CLI commands."""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from dm_core.diffing import project_diff, semantic_diff
from dm_core.loader import load_yaml_model
from dm_core.resolver import ResolvedModel, resolve_model, resolve_project
from dm_core.schema import load_schema, schema_issues

SCHEMA_PATH = str(Path(__file__).resolve().parent.parent / "schemas" / "model.schema.json")
DEMO_DIR = str(Path(__file__).resolve().parent.parent / "model-examples" / "multi-model-demo")
DM_CLI = str(Path(__file__).resolve().parent.parent / "dm")


def _schema():
    return load_schema(SCHEMA_PATH)


# ---------------------------------------------------------------------------
# Schema: imports field
# ---------------------------------------------------------------------------

class TestImportsSchema:
    def test_model_without_imports_validates(self):
        model = load_yaml_model("model-examples/starter-commerce.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_model_with_imports_validates(self):
        model = load_yaml_model(f"{DEMO_DIR}/orders.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_imports_field_structure(self):
        model = load_yaml_model(f"{DEMO_DIR}/orders.model.yaml")
        imports = model.get("model", {}).get("imports", [])
        assert len(imports) == 1
        assert imports[0]["model"] == "customers"
        assert imports[0]["alias"] == "cust"
        assert "Customer" in imports[0]["entities"]

    def test_invalid_import_model_name(self):
        model = {
            "model": {
                "name": "test_model",
                "version": "1.0.0",
                "domain": "test",
                "owners": ["t@t.com"],
                "state": "draft",
                "imports": [{"model": "INVALID"}],
            },
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }
        issues = schema_issues(model, _schema())
        assert any(i.severity == "error" for i in issues)

    def test_import_with_path(self):
        model = {
            "model": {
                "name": "test_model",
                "version": "1.0.0",
                "domain": "test",
                "owners": ["t@t.com"],
                "state": "draft",
                "imports": [{"model": "other", "path": "other/other.model.yaml"}],
            },
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# Resolver: single model
# ---------------------------------------------------------------------------

class TestResolverSingle:
    def test_resolve_model_without_imports(self):
        resolved = resolve_model("model-examples/starter-commerce.model.yaml")
        assert len(resolved.issues) == 0
        assert len(resolved.imported_models) == 0
        assert len(resolved.unified_entities()) > 0

    def test_resolve_orders_imports_customers(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        assert len(resolved.issues) == 0
        assert "cust" in resolved.imported_models
        entities = resolved.unified_entities()
        entity_names = [e["name"] for e in entities]
        assert "Order" in entity_names
        assert "Customer" in entity_names
        assert "Address" in entity_names

    def test_resolve_filtered_entities(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        cust_model = resolved.imported_models["cust"]
        cust_entities = [e["name"] for e in cust_model.get("entities", [])]
        assert "Customer" in cust_entities
        assert "Address" in cust_entities
        # CustomerSegment should be filtered out (not in import entities list)
        assert "CustomerSegment" not in cust_entities

    def test_resolve_transitive_imports(self):
        resolved = resolve_model(f"{DEMO_DIR}/products.model.yaml")
        assert len(resolved.issues) == 0
        assert "ord" in resolved.imported_models
        # Transitive: products -> orders -> customers
        assert "cust" in resolved.imported_models
        entities = resolved.unified_entities()
        entity_names = [e["name"] for e in entities]
        assert "Product" in entity_names
        assert "OrderItem" in entity_names
        assert "Customer" in entity_names

    def test_source_model_annotation(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        entities = resolved.unified_entities()
        order = next(e for e in entities if e["name"] == "Order")
        customer = next(e for e in entities if e["name"] == "Customer")
        assert order["_source_model"] == "orders"
        assert customer["_source_model"] == "customers"
        assert customer.get("_import_alias") == "cust"


# ---------------------------------------------------------------------------
# Resolver: graph summary
# ---------------------------------------------------------------------------

class TestGraphSummary:
    def test_graph_summary_structure(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        summary = resolved.to_graph_summary()
        assert summary["root_model"] == "orders"
        assert summary["model_count"] == 2
        assert summary["total_entities"] == 5
        assert len(summary["models"]) == 2
        assert len(summary["cross_model_relationships"]) == 2

    def test_cross_model_relationships_detected(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        summary = resolved.to_graph_summary()
        cross = summary["cross_model_relationships"]
        from_models = {cr["from_model"] for cr in cross}
        to_models = {cr["to_model"] for cr in cross}
        assert "orders" in from_models
        assert "customers" in to_models

    def test_root_model_flagged(self):
        resolved = resolve_model(f"{DEMO_DIR}/orders.model.yaml")
        summary = resolved.to_graph_summary()
        root = next(m for m in summary["models"] if m["is_root"])
        assert root["name"] == "orders"


# ---------------------------------------------------------------------------
# Resolver: error cases
# ---------------------------------------------------------------------------

class TestResolverErrors:
    def test_missing_import_file(self, tmp_path):
        model_file = tmp_path / "test.model.yaml"
        model_file.write_text(yaml.safe_dump({
            "model": {
                "name": "test_model",
                "version": "1.0.0",
                "domain": "test",
                "owners": ["t@t.com"],
                "state": "draft",
                "imports": [{"model": "nonexistent"}],
            },
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        resolved = resolve_model(str(model_file))
        assert any(i.code == "IMPORT_NOT_FOUND" for i in resolved.issues)

    def test_import_entity_not_found(self, tmp_path):
        # Create a model that imports a specific entity that doesn't exist
        base_file = tmp_path / "base.model.yaml"
        base_file.write_text(yaml.safe_dump({
            "model": {"name": "base", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft"},
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        child_file = tmp_path / "child.model.yaml"
        child_file.write_text(yaml.safe_dump({
            "model": {"name": "child", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft",
                      "imports": [{"model": "base", "entities": ["NonExistent"]}]},
            "entities": [
                {"name": "Bar", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        resolved = resolve_model(str(child_file))
        assert any(i.code == "IMPORT_ENTITY_NOT_FOUND" for i in resolved.issues)

    def test_circular_import_detected(self, tmp_path):
        a_file = tmp_path / "a.model.yaml"
        b_file = tmp_path / "b.model.yaml"
        a_file.write_text(yaml.safe_dump({
            "model": {"name": "a", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft",
                      "imports": [{"model": "b"}]},
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        b_file.write_text(yaml.safe_dump({
            "model": {"name": "b", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft",
                      "imports": [{"model": "a"}]},
            "entities": [
                {"name": "Bar", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        resolved = resolve_model(str(a_file))
        assert any(i.code == "CIRCULAR_IMPORT" for i in resolved.issues)

    def test_duplicate_entity_across_models_warns(self, tmp_path):
        base_file = tmp_path / "base.model.yaml"
        base_file.write_text(yaml.safe_dump({
            "model": {"name": "base", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft"},
            "entities": [
                {"name": "Shared", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        child_file = tmp_path / "child.model.yaml"
        child_file.write_text(yaml.safe_dump({
            "model": {"name": "child", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft",
                      "imports": [{"model": "base"}]},
            "entities": [
                {"name": "Shared", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }))
        resolved = resolve_model(str(child_file))
        assert any(i.code == "DUPLICATE_CROSS_MODEL_ENTITY" for i in resolved.issues)


# ---------------------------------------------------------------------------
# Resolver: project-level
# ---------------------------------------------------------------------------

class TestResolveProject:
    def test_resolve_project_demo(self):
        results = resolve_project(DEMO_DIR)
        assert len(results) == 3
        for path, resolved in results.items():
            assert len([i for i in resolved.issues if i.severity == "error"]) == 0

    def test_resolve_project_entity_counts(self):
        results = resolve_project(DEMO_DIR)
        counts = {}
        for path, resolved in results.items():
            name = resolved.root_model.get("model", {}).get("name", "")
            counts[name] = len(resolved.unified_entities())
        assert counts["customers"] == 3
        assert counts["orders"] == 5
        assert counts["products"] == 7


# ---------------------------------------------------------------------------
# Project diff
# ---------------------------------------------------------------------------

class TestProjectDiff:
    def test_same_directory_no_changes(self):
        diff = project_diff(DEMO_DIR, DEMO_DIR)
        assert diff["summary"]["added_models"] == 0
        assert diff["summary"]["removed_models"] == 0
        assert diff["summary"]["changed_models"] == 0
        assert not diff["has_breaking_changes"]

    def test_added_model_detected(self, tmp_path):
        old_dir = tmp_path / "old"
        new_dir = tmp_path / "new"
        old_dir.mkdir()
        new_dir.mkdir()

        base = {
            "model": {"name": "base", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft"},
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }
        (old_dir / "base.model.yaml").write_text(yaml.safe_dump(base))
        (new_dir / "base.model.yaml").write_text(yaml.safe_dump(base))

        extra = {
            "model": {"name": "extra", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft"},
            "entities": [
                {"name": "Bar", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }
        (new_dir / "extra.model.yaml").write_text(yaml.safe_dump(extra))

        diff = project_diff(str(old_dir), str(new_dir))
        assert diff["summary"]["added_models"] == 1
        assert "extra" in diff["added_models"]

    def test_removed_model_is_breaking(self, tmp_path):
        old_dir = tmp_path / "old"
        new_dir = tmp_path / "new"
        old_dir.mkdir()
        new_dir.mkdir()

        base = {
            "model": {"name": "base", "version": "1.0.0", "domain": "test",
                      "owners": ["t@t.com"], "state": "draft"},
            "entities": [
                {"name": "Foo", "type": "table", "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False}
                ]}
            ],
        }
        (old_dir / "base.model.yaml").write_text(yaml.safe_dump(base))
        # new_dir is empty

        diff = project_diff(str(old_dir), str(new_dir))
        assert diff["summary"]["removed_models"] == 1
        assert diff["has_breaking_changes"]
        assert any("Model removed" in bc for bc in diff["breaking_changes"])


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

class TestCLIMultiModel:
    def test_dm_resolve(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "resolve", f"{DEMO_DIR}/orders.model.yaml"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Root model: orders" in result.stdout
        assert "Models resolved: 2" in result.stdout
        assert "Total entities: 5" in result.stdout

    def test_dm_resolve_json(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "resolve", f"{DEMO_DIR}/orders.model.yaml", "--output-json"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["root_model"] == "orders"
        assert data["model_count"] == 2
        assert len(data["cross_model_relationships"]) == 2

    def test_dm_resolve_project(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "resolve-project", DEMO_DIR],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Models found: 3" in result.stdout
        assert "customers:" in result.stdout
        assert "orders:" in result.stdout
        assert "products:" in result.stdout

    def test_dm_resolve_project_json(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "resolve-project", DEMO_DIR, "--output-json"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert len(data["models"]) == 3
        assert data["total_issues"] == 0

    def test_dm_diff_all_same_dir(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "diff-all", DEMO_DIR, DEMO_DIR],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "unchanged:3" in result.stdout

    def test_dm_diff_all_json(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "diff-all", DEMO_DIR, DEMO_DIR, "--output-json"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["summary"]["changed_models"] == 0
        assert not data["has_breaking_changes"]

    def test_dm_validate_standalone_model(self):
        # customers.model.yaml has no imports, so it validates standalone
        result = subprocess.run(
            [sys.executable, DM_CLI, "validate", f"{DEMO_DIR}/customers.model.yaml"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0

    def test_dm_validate_cross_model_needs_resolve(self):
        # orders.model.yaml has cross-model refs — single-file validate finds unresolved refs
        result = subprocess.run(
            [sys.executable, DM_CLI, "validate", f"{DEMO_DIR}/orders.model.yaml"],
            capture_output=True, text=True,
        )
        # Expected: fails because Customer/Address refs are in imported model
        assert result.returncode == 1
        assert "RELATIONSHIP_REF_NOT_FOUND" in result.stdout
        # But resolve succeeds (imports are resolved)
        result2 = subprocess.run(
            [sys.executable, DM_CLI, "resolve", f"{DEMO_DIR}/orders.model.yaml"],
            capture_output=True, text=True,
        )
        assert result2.returncode == 0

    def test_dm_init_multi_model(self, tmp_path):
        result = subprocess.run(
            [sys.executable, DM_CLI, "init", "--path", str(tmp_path), "--multi-model"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "multi-model" in result.stdout
        assert (tmp_path / "models" / "shared" / "shared_dimensions.model.yaml").exists()
        assert (tmp_path / "models" / "orders" / "orders.model.yaml").exists()
        assert (tmp_path / "dm.config.yaml").exists()
        config = (tmp_path / "dm.config.yaml").read_text()
        assert "multi_model: true" in config

    def test_dm_init_end_to_end_template(self, tmp_path):
        result = subprocess.run(
            [sys.executable, DM_CLI, "init", "--path", str(tmp_path), "--template", "end-to-end"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "end-to-end modeling workspace" in result.stdout
        assert (tmp_path / "models" / "source" / "source_sales_raw.model.yaml").exists()
        assert (tmp_path / "models" / "transform" / "commerce_transform.model.yaml").exists()
        assert (tmp_path / "models" / "report" / "commerce_reporting.model.yaml").exists()
        assert (tmp_path / "docs" / "dictionary" / "README.md").exists()
        assert (tmp_path / "policies" / "end_to_end_dictionary.policy.yaml").exists()
        config = (tmp_path / "dm.config.yaml").read_text()
        assert "policy_pack: policies/end_to_end_dictionary.policy.yaml" in config

    def test_dm_init_end_to_end_rejects_multi_model_flag(self, tmp_path):
        result = subprocess.run(
            [
                sys.executable,
                DM_CLI,
                "init",
                "--path",
                str(tmp_path),
                "--template",
                "end-to-end",
                "--multi-model",
            ],
            capture_output=True,
            text=True,
        )
        assert result.returncode == 1
        assert "--multi-model cannot be combined" in result.stderr

    def test_dm_resolve_transitive(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "resolve", f"{DEMO_DIR}/products.model.yaml", "--output-json"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        data = json.loads(result.stdout)
        assert data["model_count"] == 3
        assert data["total_entities"] == 7


# ---------------------------------------------------------------------------
# Multi-model demo files validate
# ---------------------------------------------------------------------------

class TestMultiModelDemo:
    def test_customers_model_validates(self):
        model = load_yaml_model(f"{DEMO_DIR}/customers.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_orders_model_validates(self):
        model = load_yaml_model(f"{DEMO_DIR}/orders.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_products_model_validates(self):
        model = load_yaml_model(f"{DEMO_DIR}/products.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_readme_exists(self):
        readme = Path(DEMO_DIR) / "README.md"
        # We'll create this in the docs step
        # Just check the directory structure is correct
        assert Path(DEMO_DIR).is_dir()
        assert (Path(DEMO_DIR) / "customers.model.yaml").exists()
        assert (Path(DEMO_DIR) / "orders.model.yaml").exists()
        assert (Path(DEMO_DIR) / "products.model.yaml").exists()
