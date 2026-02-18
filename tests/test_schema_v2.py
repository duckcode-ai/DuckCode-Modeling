"""Tests for v2 schema features: new entity types, indexes, glossary,
field properties (default, check, computed, sensitivity, deprecated),
SQL generation with new dialects, diff engine index tracking, and
backward compatibility with v1 models."""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any, Dict

import pytest
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from dm_core.canonical import compile_model
from dm_core.diffing import semantic_diff
from dm_core.generators import generate_sql_ddl
from dm_core.loader import load_yaml_model
from dm_core.schema import load_schema, schema_issues
from dm_core.semantic import lint_issues

SCHEMA_PATH = str(Path(__file__).resolve().parent.parent / "schemas" / "model.schema.json")
DM_CLI = str(Path(__file__).resolve().parent.parent / "dm")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _base_model(**overrides) -> Dict[str, Any]:
    model = {
        "model": {
            "name": "test_v2",
            "version": "1.0.0",
            "domain": "test",
            "owners": ["test@example.com"],
            "state": "draft",
        },
        "entities": [
            {
                "name": "Widget",
                "type": "table",
                "fields": [
                    {"name": "widget_id", "type": "integer", "primary_key": True, "nullable": False},
                    {"name": "name", "type": "string", "nullable": False},
                ],
            }
        ],
    }
    model.update(overrides)
    return model


def _schema():
    return load_schema(SCHEMA_PATH)


# ---------------------------------------------------------------------------
# Backward compatibility
# ---------------------------------------------------------------------------

class TestBackwardCompatibility:
    def test_v1_starter_model_validates(self):
        model = load_yaml_model("model-examples/starter-commerce.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_v1_fintech_model_validates(self):
        model = load_yaml_model("model-examples/real-scenarios/fintech-risk-baseline.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_v1_retail_model_validates(self):
        model = load_yaml_model("model-examples/real-scenarios/retail-analytics-baseline.model.yaml")
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# New entity types
# ---------------------------------------------------------------------------

class TestEntityTypes:
    @pytest.mark.parametrize("entity_type", ["table", "view", "materialized_view", "external_table", "snapshot"])
    def test_valid_entity_types(self, entity_type):
        model = _base_model()
        model["entities"][0]["type"] = entity_type
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_invalid_entity_type_rejected(self):
        model = _base_model()
        model["entities"][0]["type"] = "temporary"
        issues = schema_issues(model, _schema())
        assert any(i.severity == "error" for i in issues)

    def test_view_no_pk_required(self):
        model = _base_model()
        model["entities"][0]["type"] = "view"
        model["entities"][0]["fields"] = [{"name": "col_a", "type": "string"}]
        issues = lint_issues(model)
        assert not any(i.code == "MISSING_PRIMARY_KEY" for i in issues)

    def test_materialized_view_no_pk_required(self):
        model = _base_model()
        model["entities"][0]["type"] = "materialized_view"
        model["entities"][0]["fields"] = [{"name": "col_a", "type": "string"}]
        issues = lint_issues(model)
        assert not any(i.code == "MISSING_PRIMARY_KEY" for i in issues)

    def test_table_still_requires_pk(self):
        model = _base_model()
        model["entities"][0]["fields"] = [{"name": "col_a", "type": "string"}]
        issues = lint_issues(model)
        assert any(i.code == "MISSING_PRIMARY_KEY" for i in issues)


# ---------------------------------------------------------------------------
# New field properties
# ---------------------------------------------------------------------------

class TestFieldProperties:
    def test_default_value_string(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["default"] = "active"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_default_value_number(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["default"] = 0
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_default_value_null(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["default"] = None
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_check_constraint(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["check"] = "length(name) > 0"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_computed_field(self):
        model = _base_model()
        model["entities"][0]["fields"].append({
            "name": "full_name",
            "type": "string",
            "computed": True,
            "computed_expression": "first_name || ' ' || last_name",
        })
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_computed_without_expression_warns(self):
        model = _base_model()
        model["entities"][0]["fields"].append({
            "name": "full_name",
            "type": "string",
            "computed": True,
        })
        issues = lint_issues(model)
        assert any(i.code == "MISSING_COMPUTED_EXPRESSION" for i in issues)

    @pytest.mark.parametrize("sensitivity", ["public", "internal", "confidential", "restricted"])
    def test_valid_sensitivity(self, sensitivity):
        model = _base_model()
        model["entities"][0]["fields"][1]["sensitivity"] = sensitivity
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_invalid_sensitivity_rejected(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["sensitivity"] = "top_secret"
        issues = schema_issues(model, _schema())
        assert any(i.severity == "error" for i in issues)

    def test_examples_field(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["examples"] = ["foo", "bar", 42]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_deprecated_field_warns(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["deprecated"] = True
        model["entities"][0]["fields"][1]["deprecated_message"] = "Use new_name instead"
        issues = lint_issues(model)
        assert any(i.code == "DEPRECATED_FIELD" for i in issues)
        dep_issue = next(i for i in issues if i.code == "DEPRECATED_FIELD")
        assert "Use new_name instead" in dep_issue.message

    def test_foreign_key_field(self):
        model = _base_model()
        model["entities"][0]["fields"].append({
            "name": "parent_id",
            "type": "integer",
            "foreign_key": True,
        })
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# Entity properties
# ---------------------------------------------------------------------------

class TestEntityProperties:
    def test_schema_and_database(self):
        model = _base_model()
        model["entities"][0]["schema"] = "analytics"
        model["entities"][0]["database"] = "warehouse"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_subject_area(self):
        model = _base_model()
        model["entities"][0]["subject_area"] = "customer_domain"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_owner(self):
        model = _base_model()
        model["entities"][0]["owner"] = "team@example.com"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_sla(self):
        model = _base_model()
        model["entities"][0]["sla"] = {"freshness": "24h", "quality_score": 99.5}
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_model_description(self):
        model = _base_model()
        model["model"]["description"] = "Test model"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_spec_version(self):
        model = _base_model()
        model["model"]["spec_version"] = 2
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# Layer, grain, metrics
# ---------------------------------------------------------------------------

class TestLayerGrainMetrics:
    def test_valid_model_layer(self):
        model = _base_model()
        model["model"]["layer"] = "transform"
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_invalid_model_layer_rejected(self):
        model = _base_model()
        model["model"]["layer"] = "semantic"
        issues = schema_issues(model, _schema())
        assert any(i.severity == "error" for i in issues)

    def test_entity_grain_valid(self):
        model = _base_model()
        model["entities"][0]["grain"] = ["widget_id"]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0
        lint = lint_issues(model)
        assert not any(i.code == "GRAIN_FIELD_NOT_FOUND" for i in lint)

    def test_entity_grain_missing_field(self):
        model = _base_model()
        model["entities"][0]["grain"] = ["missing_col"]
        lint = lint_issues(model)
        assert any(i.code == "GRAIN_FIELD_NOT_FOUND" for i in lint)

    def test_transform_layer_requires_grain(self):
        model = _base_model()
        model["model"]["layer"] = "transform"
        lint = lint_issues(model)
        assert any(i.code == "MISSING_GRAIN" for i in lint)

    def test_report_layer_requires_metrics(self):
        model = _base_model()
        model["model"]["layer"] = "report"
        model["entities"][0]["grain"] = ["widget_id"]
        lint = lint_issues(model)
        assert any(i.code == "MISSING_METRICS" for i in lint)

    def test_metric_schema_valid(self):
        model = _base_model()
        model["model"]["layer"] = "report"
        model["entities"][0]["grain"] = ["widget_id"]
        model["metrics"] = [
            {
                "name": "widget_count",
                "entity": "Widget",
                "expression": "widget_id",
                "aggregation": "count_distinct",
                "grain": ["widget_id"],
                "dimensions": ["name"],
                "time_dimension": "widget_id",
            }
        ]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0
        lint = lint_issues(model)
        assert not any(i.severity == "error" for i in lint)

    def test_metric_entity_must_exist(self):
        model = _base_model()
        model["metrics"] = [
            {
                "name": "bad_metric",
                "entity": "Missing",
                "expression": "foo",
                "aggregation": "sum",
                "grain": ["widget_id"],
            }
        ]
        lint = lint_issues(model)
        assert any(i.code == "METRIC_ENTITY_NOT_FOUND" for i in lint)

    def test_metric_grain_field_must_exist(self):
        model = _base_model()
        model["metrics"] = [
            {
                "name": "bad_metric",
                "entity": "Widget",
                "expression": "foo",
                "aggregation": "sum",
                "grain": ["missing_col"],
            }
        ]
        lint = lint_issues(model)
        assert any(i.code == "METRIC_GRAIN_FIELD_NOT_FOUND" for i in lint)


# ---------------------------------------------------------------------------
# Indexes
# ---------------------------------------------------------------------------

class TestIndexes:
    def test_valid_index(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_widget_name", "entity": "Widget", "fields": ["name"]},
        ]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0
        lint = lint_issues(model)
        assert not any(i.code.startswith("INDEX_") for i in lint)

    def test_unique_index(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_widget_name", "entity": "Widget", "fields": ["name"], "unique": True, "type": "btree"},
        ]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_index_invalid_entity(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_missing", "entity": "Missing", "fields": ["col"]},
        ]
        lint = lint_issues(model)
        assert any(i.code == "INDEX_ENTITY_NOT_FOUND" for i in lint)

    def test_index_invalid_field(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_bad_field", "entity": "Widget", "fields": ["nonexistent"]},
        ]
        lint = lint_issues(model)
        assert any(i.code == "INDEX_FIELD_NOT_FOUND" for i in lint)

    def test_duplicate_index_name(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_dup", "entity": "Widget", "fields": ["name"]},
            {"name": "idx_dup", "entity": "Widget", "fields": ["widget_id"]},
        ]
        lint = lint_issues(model)
        assert any(i.code == "DUPLICATE_INDEX" for i in lint)


# ---------------------------------------------------------------------------
# Glossary
# ---------------------------------------------------------------------------

class TestGlossary:
    def test_valid_glossary(self):
        model = _base_model()
        model["glossary"] = [
            {
                "term": "Widget",
                "definition": "A thing that does stuff",
                "abbreviation": "WDG",
                "owner": "team@example.com",
                "related_fields": ["Widget.name"],
                "tags": ["CORE"],
            }
        ]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0
        lint = lint_issues(model)
        assert not any(i.code.startswith("GLOSSARY_") for i in lint)

    def test_glossary_invalid_ref(self):
        model = _base_model()
        model["glossary"] = [
            {"term": "Widget", "definition": "A thing", "related_fields": ["Missing.field"]},
        ]
        lint = lint_issues(model)
        assert any(i.code == "GLOSSARY_REF_NOT_FOUND" for i in lint)

    def test_duplicate_glossary_term(self):
        model = _base_model()
        model["glossary"] = [
            {"term": "Widget", "definition": "First"},
            {"term": "Widget", "definition": "Second"},
        ]
        lint = lint_issues(model)
        assert any(i.code == "DUPLICATE_GLOSSARY_TERM" for i in lint)


# ---------------------------------------------------------------------------
# Governance v2
# ---------------------------------------------------------------------------

class TestGovernanceV2:
    def test_phi_classification(self):
        model = _base_model()
        model["governance"] = {"classification": {"Widget.name": "PHI"}}
        issues = schema_issues(model, _schema())
        assert len(issues) == 0

    def test_retention(self):
        model = _base_model()
        model["governance"] = {"retention": {"period": "7y", "policy": "GDPR"}}
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# Relationship v2
# ---------------------------------------------------------------------------

class TestRelationshipV2:
    def test_on_update(self):
        model = _base_model()
        model["entities"].append({
            "name": "Order",
            "type": "table",
            "fields": [
                {"name": "order_id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "widget_id", "type": "integer", "nullable": False},
            ],
        })
        model["relationships"] = [{
            "name": "widget_orders",
            "from": "Widget.widget_id",
            "to": "Order.widget_id",
            "cardinality": "one_to_many",
            "on_delete": "cascade",
            "on_update": "no_action",
            "description": "Widget has orders",
        }]
        issues = schema_issues(model, _schema())
        assert len(issues) == 0


# ---------------------------------------------------------------------------
# Canonical compiler v2
# ---------------------------------------------------------------------------

class TestCanonicalV2:
    def test_indexes_sorted(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_z", "entity": "Widget", "fields": ["name"]},
            {"name": "idx_a", "entity": "Widget", "fields": ["widget_id"]},
        ]
        canonical = compile_model(model)
        assert canonical["indexes"][0]["name"] == "idx_a"
        assert canonical["indexes"][1]["name"] == "idx_z"

    def test_glossary_sorted(self):
        model = _base_model()
        model["glossary"] = [
            {"term": "Zebra", "definition": "Last"},
            {"term": "Alpha", "definition": "First"},
        ]
        canonical = compile_model(model)
        assert canonical["glossary"][0]["term"] == "Alpha"
        assert canonical["glossary"][1]["term"] == "Zebra"

    def test_canonical_preserves_new_fields(self):
        model = _base_model()
        model["entities"][0]["schema"] = "analytics"
        model["entities"][0]["subject_area"] = "test_domain"
        model["entities"][0]["fields"][1]["sensitivity"] = "confidential"
        model["entities"][0]["fields"][1]["default"] = "active"
        canonical = compile_model(model)
        entity = canonical["entities"][0]
        assert entity["schema"] == "analytics"
        assert entity["subject_area"] == "test_domain"
        field = next(f for f in entity["fields"] if f["name"] == "name")
        assert field["sensitivity"] == "confidential"
        assert field["default"] == "active"

    def test_metrics_sorted(self):
        model = _base_model()
        model["metrics"] = [
            {"name": "z_metric", "entity": "Widget", "expression": "name", "aggregation": "count", "grain": ["widget_id"]},
            {"name": "a_metric", "entity": "Widget", "expression": "name", "aggregation": "count", "grain": ["widget_id"]},
        ]
        canonical = compile_model(model)
        assert canonical["metrics"][0]["name"] == "a_metric"
        assert canonical["metrics"][1]["name"] == "z_metric"


# ---------------------------------------------------------------------------
# Diff engine v2
# ---------------------------------------------------------------------------

class TestDiffV2:
    def test_index_added(self):
        old = _base_model()
        new = _base_model()
        new["indexes"] = [{"name": "idx_name", "entity": "Widget", "fields": ["name"]}]
        diff = semantic_diff(old, new)
        assert "idx_name" in diff["added_indexes"]
        assert diff["summary"]["added_indexes"] == 1

    def test_index_removed_is_breaking(self):
        old = _base_model()
        old["indexes"] = [{"name": "idx_name", "entity": "Widget", "fields": ["name"]}]
        new = _base_model()
        diff = semantic_diff(old, new)
        assert "idx_name" in diff["removed_indexes"]
        assert diff["has_breaking_changes"]
        assert any("Index removed" in bc for bc in diff["breaking_changes"])

    def test_no_index_changes(self):
        old = _base_model()
        old["indexes"] = [{"name": "idx_name", "entity": "Widget", "fields": ["name"]}]
        new = _base_model()
        new["indexes"] = [{"name": "idx_name", "entity": "Widget", "fields": ["name"]}]
        diff = semantic_diff(old, new)
        assert diff["summary"]["added_indexes"] == 0
        assert diff["summary"]["removed_indexes"] == 0

    def test_metric_added(self):
        old = _base_model()
        new = _base_model()
        new["metrics"] = [
            {"name": "widget_count", "entity": "Widget", "expression": "widget_id", "aggregation": "count_distinct", "grain": ["widget_id"]},
        ]
        diff = semantic_diff(old, new)
        assert "widget_count" in diff["added_metrics"]
        assert diff["summary"]["added_metrics"] == 1

    def test_metric_removed_is_breaking(self):
        old = _base_model()
        old["metrics"] = [
            {"name": "widget_count", "entity": "Widget", "expression": "widget_id", "aggregation": "count_distinct", "grain": ["widget_id"]},
        ]
        new = _base_model()
        diff = semantic_diff(old, new)
        assert "widget_count" in diff["removed_metrics"]
        assert diff["has_breaking_changes"]
        assert any("Metric removed" in bc for bc in diff["breaking_changes"])

    def test_metric_contract_change_is_breaking(self):
        old = _base_model()
        old["metrics"] = [
            {"name": "widget_count", "entity": "Widget", "expression": "widget_id", "aggregation": "count_distinct", "grain": ["widget_id"]},
        ]
        new = _base_model()
        new["metrics"] = [
            {"name": "widget_count", "entity": "Widget", "expression": "name", "aggregation": "count_distinct", "grain": ["widget_id"]},
        ]
        diff = semantic_diff(old, new)
        assert diff["summary"]["changed_metrics"] == 1
        assert diff["has_breaking_changes"]
        assert any("Metric contract changed" in bc for bc in diff["breaking_changes"])


# ---------------------------------------------------------------------------
# SQL generation v2
# ---------------------------------------------------------------------------

class TestSQLGenerationV2:
    def test_default_clause(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["default"] = "active"
        ddl = generate_sql_ddl(model, "postgres")
        assert "DEFAULT 'active'" in ddl

    def test_check_constraint(self):
        model = _base_model()
        model["entities"][0]["fields"][1]["check"] = "length(name) > 0"
        ddl = generate_sql_ddl(model, "postgres")
        assert "CHECK (length(name) > 0)" in ddl

    def test_index_generation(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_widget_name", "entity": "Widget", "fields": ["name"]},
        ]
        ddl = generate_sql_ddl(model, "postgres")
        assert 'CREATE INDEX "idx_widget_name"' in ddl

    def test_unique_index_generation(self):
        model = _base_model()
        model["indexes"] = [
            {"name": "idx_widget_name", "entity": "Widget", "fields": ["name"], "unique": True},
        ]
        ddl = generate_sql_ddl(model, "postgres")
        assert 'CREATE UNIQUE INDEX "idx_widget_name"' in ddl

    def test_view_generates_create_view(self):
        model = _base_model()
        model["entities"][0]["type"] = "view"
        ddl = generate_sql_ddl(model, "postgres")
        assert "CREATE VIEW" in ddl

    def test_materialized_view_generates(self):
        model = _base_model()
        model["entities"][0]["type"] = "materialized_view"
        ddl = generate_sql_ddl(model, "postgres")
        assert "CREATE MATERIALIZED VIEW" in ddl

    def test_qualified_name_with_schema(self):
        model = _base_model()
        model["entities"][0]["schema"] = "analytics"
        ddl = generate_sql_ddl(model, "postgres")
        assert '"analytics"."widget"' in ddl

    def test_qualified_name_with_database_and_schema(self):
        model = _base_model()
        model["entities"][0]["schema"] = "analytics"
        model["entities"][0]["database"] = "warehouse"
        ddl = generate_sql_ddl(model, "postgres")
        assert '"warehouse"."analytics"."widget"' in ddl

    def test_computed_field_skipped(self):
        model = _base_model()
        model["entities"][0]["fields"].append({
            "name": "computed_col",
            "type": "string",
            "computed": True,
            "computed_expression": "first || last",
        })
        ddl = generate_sql_ddl(model, "postgres")
        assert "computed_col" not in ddl

    def test_bigquery_dialect(self):
        model = _base_model()
        model["entities"][0]["schema"] = "analytics"
        ddl = generate_sql_ddl(model, "bigquery")
        assert "`analytics`" in ddl
        assert "INT64" in ddl

    def test_databricks_dialect(self):
        model = _base_model()
        ddl = generate_sql_ddl(model, "databricks")
        assert "INT" in ddl
        assert "STRING" in ddl

    def test_bigquery_no_fk_or_index(self):
        model = _base_model()
        model["entities"].append({
            "name": "Order",
            "type": "table",
            "fields": [
                {"name": "order_id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "widget_id", "type": "integer", "nullable": False},
            ],
        })
        model["relationships"] = [{
            "name": "widget_orders",
            "from": "Widget.widget_id",
            "to": "Order.widget_id",
            "cardinality": "one_to_many",
        }]
        model["indexes"] = [
            {"name": "idx_name", "entity": "Widget", "fields": ["name"]},
        ]
        ddl = generate_sql_ddl(model, "bigquery")
        assert "FOREIGN KEY" not in ddl
        assert "CREATE INDEX" not in ddl
        assert "CREATE UNIQUE INDEX" not in ddl


# ---------------------------------------------------------------------------
# Enterprise example model
# ---------------------------------------------------------------------------

class TestEnterpriseModel:
    def test_enterprise_model_validates(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        schema = _schema()
        issues = schema_issues(model, schema)
        assert len(issues) == 0

    def test_enterprise_model_lint(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        issues = lint_issues(model)
        errors = [i for i in issues if i.severity == "error"]
        assert len(errors) == 0

    def test_enterprise_model_compiles(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        canonical = compile_model(model)
        assert len(canonical["entities"]) == 19
        assert len(canonical["indexes"]) == 17
        assert len(canonical["glossary"]) == 5

    def test_enterprise_model_sql_postgres(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        ddl = generate_sql_ddl(model, "postgres")
        assert "CREATE TABLE" in ddl
        assert "CREATE MATERIALIZED VIEW" in ddl
        assert "CREATE VIEW" in ddl
        assert "CREATE INDEX" in ddl
        assert "CREATE UNIQUE INDEX" in ddl

    def test_enterprise_model_sql_bigquery(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        ddl = generate_sql_ddl(model, "bigquery")
        assert "CREATE TABLE" in ddl

    def test_enterprise_model_sql_snowflake(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        ddl = generate_sql_ddl(model, "snowflake")
        assert "CREATE TABLE" in ddl

    def test_enterprise_model_sql_databricks(self):
        model = load_yaml_model("model-examples/enterprise-dwh.model.yaml")
        ddl = generate_sql_ddl(model, "databricks")
        assert "CREATE TABLE" in ddl


# ---------------------------------------------------------------------------
# CLI commands
# ---------------------------------------------------------------------------

class TestCLIV2:
    def test_dm_fmt(self, tmp_path):
        model = _base_model()
        model_path = tmp_path / "test.model.yaml"
        model_path.write_text(yaml.safe_dump(model, sort_keys=False))
        out_path = tmp_path / "formatted.yaml"
        result = subprocess.run(
            [sys.executable, DM_CLI, "fmt", str(model_path), "--out", str(out_path)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert out_path.exists()
        formatted = yaml.safe_load(out_path.read_text())
        assert formatted["entities"][0]["name"] == "Widget"

    def test_dm_stats(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "stats", "model-examples/enterprise-dwh.model.yaml"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert "Entities: 19" in result.stdout
        assert "Indexes: 17" in result.stdout

    def test_dm_stats_json(self):
        result = subprocess.run(
            [sys.executable, DM_CLI, "stats", "model-examples/enterprise-dwh.model.yaml", "--output-json"],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        stats = json.loads(result.stdout)
        assert stats["entity_count"] == 19
        assert stats["index_count"] == 17

    def test_dm_generate_sql_bigquery(self, tmp_path):
        out = tmp_path / "out.sql"
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "sql", "model-examples/enterprise-dwh.model.yaml",
             "--dialect", "bigquery", "--out", str(out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert out.exists()

    def test_dm_generate_sql_databricks(self, tmp_path):
        out = tmp_path / "out.sql"
        result = subprocess.run(
            [sys.executable, DM_CLI, "generate", "sql", "model-examples/enterprise-dwh.model.yaml",
             "--dialect", "databricks", "--out", str(out)],
            capture_output=True, text=True,
        )
        assert result.returncode == 0
        assert out.exists()
