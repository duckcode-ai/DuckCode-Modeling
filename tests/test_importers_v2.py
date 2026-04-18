"""Tests for importers used by local/open-source DataLex workflows."""

import json
import subprocess
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "packages" / "core_engine" / "src"))

from dm_core.importers import import_dbt_schema_yml, import_sql_ddl

FIXTURES = Path(__file__).resolve().parent / "fixtures"
DM_CLI = str(Path(__file__).resolve().parent.parent / "dm")


# ---------------------------------------------------------------------------
# Enhanced SQL DDL Importer
# ---------------------------------------------------------------------------

class TestSQLDDLEnhanced:
    def test_basic_import_still_works(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY,
            email TEXT NOT NULL UNIQUE
        );
        """
        model = import_sql_ddl(ddl)
        assert len(model["entities"]) == 1
        assert model["entities"][0]["name"] == "Customers"
        assert model["entities"][0]["type"] == "table"

    def test_default_values(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            total DECIMAL(10,2) DEFAULT 0
        );
        """
        model = import_sql_ddl(ddl)
        fields = {f["name"]: f for f in model["entities"][0]["fields"]}
        assert fields["status"].get("default") == "pending"
        assert fields["total"].get("default") == "0"

    def test_check_constraints(self):
        ddl = """
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            price DECIMAL(10,2) CHECK(price > 0),
            quantity INTEGER CHECK(quantity >= 0)
        );
        """
        model = import_sql_ddl(ddl)
        fields = {f["name"]: f for f in model["entities"][0]["fields"]}
        assert fields["price"].get("check") == "price > 0"
        assert fields["quantity"].get("check") == "quantity >= 0"

    def test_create_view(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY
        );
        CREATE VIEW customer_summary AS SELECT * FROM customers;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "CustomerSummary" in entities
        assert entities["CustomerSummary"]["type"] == "view"

    def test_create_materialized_view(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY
        );
        CREATE MATERIALIZED VIEW daily_sales AS SELECT * FROM orders;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "DailySales" in entities
        assert entities["DailySales"]["type"] == "materialized_view"

    def test_create_or_replace_view(self):
        ddl = """
        CREATE OR REPLACE VIEW my_view AS SELECT 1;
        """
        model = import_sql_ddl(ddl)
        entities = {e["name"]: e for e in model["entities"]}
        assert "MyView" in entities
        assert entities["MyView"]["type"] == "view"

    def test_create_index(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY,
            email TEXT NOT NULL
        );
        CREATE INDEX idx_customer_email ON customers (email);
        """
        model = import_sql_ddl(ddl)
        assert "indexes" in model
        assert len(model["indexes"]) == 1
        idx = model["indexes"][0]
        assert idx["name"] == "idx_customer_email"
        assert idx["entity"] == "Customers"
        assert idx["fields"] == ["email"]

    def test_create_unique_index(self):
        ddl = """
        CREATE TABLE users (
            user_id INTEGER PRIMARY KEY,
            username TEXT
        );
        CREATE UNIQUE INDEX idx_users_username ON users (username);
        """
        model = import_sql_ddl(ddl)
        assert "indexes" in model
        idx = model["indexes"][0]
        assert idx["unique"] is True

    def test_schema_qualified_table(self):
        ddl = """
        CREATE TABLE analytics.customers (
            customer_id INTEGER PRIMARY KEY
        );
        """
        model = import_sql_ddl(ddl)
        entity = model["entities"][0]
        assert entity["name"] == "Customers"
        assert entity.get("schema") == "analytics"

    def test_foreign_key_sets_fk_flag(self):
        ddl = """
        CREATE TABLE customers (
            customer_id INTEGER PRIMARY KEY
        );
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER REFERENCES customers(customer_id)
        );
        """
        model = import_sql_ddl(ddl)
        orders = next(e for e in model["entities"] if e["name"] == "Orders")
        fk_field = next(f for f in orders["fields"] if f["name"] == "customer_id")
        assert fk_field.get("foreign_key") is True

    def test_multi_column_index(self):
        ddl = """
        CREATE TABLE orders (
            order_id INTEGER PRIMARY KEY,
            customer_id INTEGER,
            order_date DATE
        );
        CREATE INDEX idx_orders_cust_date ON orders (customer_id, order_date);
        """
        model = import_sql_ddl(ddl)
        idx = model["indexes"][0]
        assert idx["fields"] == ["customer_id", "order_date"]

    def test_snowflake_style_ddl(self):
        ddl = """
        CREATE TABLE IF NOT EXISTS warehouse.analytics.customers (
            customer_id INTEGER NOT NULL,
            email VARCHAR(255) NOT NULL,
            PRIMARY KEY (customer_id)
        );
        """
        model = import_sql_ddl(ddl)
        entity = model["entities"][0]
        assert entity["name"] == "Customers"
        fields = {f["name"]: f for f in entity["fields"]}
        assert fields["customer_id"].get("primary_key") is True

    def test_table_level_check_skipped(self):
        ddl = """
        CREATE TABLE products (
            product_id INTEGER PRIMARY KEY,
            price DECIMAL(10,2),
            CHECK (price > 0)
        );
        """
        model = import_sql_ddl(ddl)
        # Should not crash, entity should have 2 fields
        assert len(model["entities"][0]["fields"]) == 2


class TestDbtSchemaImporter:
    def test_import_models_and_sources(self):
        dbt_schema = """
version: 2
sources:
  - name: raw
    schema: raw
    tables:
      - name: customers
        columns:
          - name: customer_id
            tests: [not_null, unique]
          - name: email
            tests: [not_null]
models:
  - name: stg_orders
    description: Orders staging model
    tags: [staging]
    columns:
      - name: order_id
        tests: [not_null, unique]
      - name: customer_id
        tests:
          - not_null
          - relationships:
              to: source('raw', 'customers')
              field: customer_id
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_import")
        entities = {e["name"]: e for e in model["entities"]}
        assert "Customers" in entities
        assert "StgOrders" in entities
        assert entities["Customers"]["type"] == "external_table"
        assert entities["StgOrders"]["type"] == "view"

        orders_fields = {f["name"]: f for f in entities["StgOrders"]["fields"]}
        assert orders_fields["order_id"].get("primary_key") is True
        assert orders_fields["customer_id"].get("foreign_key") is True
        assert orders_fields["customer_id"]["nullable"] is False

        rels = model.get("relationships", [])
        assert len(rels) == 1
        assert rels[0]["from"] == "Customers.customer_id"
        assert rels[0]["to"] == "StgOrders.customer_id"
        assert rels[0]["cardinality"] == "one_to_many"

    def test_import_relationships_skips_unresolved_targets(self):
        dbt_schema = """
version: 2
models:
  - name: stg_orders
    columns:
      - name: customer_id
        tests:
          - relationships:
              to: ref('missing_dim')
              field: id
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_import")
        assert len(model["entities"]) == 1
        assert model["entities"][0]["name"] == "StgOrders"
        assert model.get("relationships", []) == []

    def test_import_data_tests_and_constraints(self):
        dbt_schema = """
version: 2
models:
  - name: dim_customers
    columns:
      - name: customer_id
        data_tests: [not_null, unique]
  - name: fct_orders
    constraints:
      - type: foreign_key
        columns: [customer_id]
        expression: "references dim_customers(customer_id)"
    columns:
      - name: order_id
        constraints:
          - type: primary_key
      - name: customer_id
        data_tests: [not_null]
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_constraints")
        entities = {e["name"]: e for e in model["entities"]}
        assert "DimCustomers" in entities
        assert "FctOrders" in entities

        dim_fields = {f["name"]: f for f in entities["DimCustomers"]["fields"]}
        assert dim_fields["customer_id"].get("primary_key") is True
        assert dim_fields["customer_id"].get("nullable") is False

        fct_fields = {f["name"]: f for f in entities["FctOrders"]["fields"]}
        assert fct_fields["order_id"].get("primary_key") is True
        assert fct_fields["customer_id"].get("foreign_key") is True

        rels = model.get("relationships", [])
        assert any(r["from"] == "DimCustomers.customer_id" and r["to"] == "FctOrders.customer_id" for r in rels)

    def test_normalizes_non_snake_case_column_names(self):
        dbt_schema = """
version: 2
models:
  - name: stg_orders
    columns:
      - name: OrderID
        tests: [not_null, unique]
      - name: Customer-ID
        tests:
          - relationships:
              to: ref('dim_customers')
              field: CustomerID
  - name: dim_customers
    columns:
      - name: CustomerID
        tests: [not_null, unique]
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_normalized")
        entities = {e["name"]: e for e in model["entities"]}
        assert "StgOrders" in entities
        assert "DimCustomers" in entities

        stg_fields = {f["name"]: f for f in entities["StgOrders"]["fields"]}
        dim_fields = {f["name"]: f for f in entities["DimCustomers"]["fields"]}
        assert "order_id" in stg_fields
        assert "customer_id" in stg_fields
        assert "customer_id" in dim_fields
        assert stg_fields["order_id"].get("primary_key") is True

        rels = model.get("relationships", [])
        assert any(r["from"] == "DimCustomers.customer_id" and r["to"] == "StgOrders.customer_id" for r in rels)

    def test_sources_without_columns_get_placeholder_field(self):
        dbt_schema = """
version: 2
sources:
  - name: raw
    schema: raw
    tables:
      - name: players
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_sources_only")
        entities = {e["name"]: e for e in model["entities"]}
        assert "Players" in entities
        fields = entities["Players"]["fields"]
        assert len(fields) == 1
        assert fields[0]["name"] == "row_id"

    def test_empty_dbt_schema_gets_placeholder_entity(self):
        dbt_schema = """
version: 2
models: []
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_empty")
        assert len(model["entities"]) == 1
        ent = model["entities"][0]
        assert ent["name"] == "DbtSchemaInfo"
        assert ent["fields"][0]["name"] == "row_id"

    def test_import_semantic_models_and_metrics(self):
        dbt_schema = """
version: 2
semantic_models:
  - name: fact_orders
    description: Order-level fact.
    entities:
      - name: order
        type: primary
        expr: order_key
      - name: customer
        type: foreign
        expr: customer_key
    dimensions:
      - name: order_date
        type: time
      - name: status_code
        type: categorical
    measures:
      - name: order_count
        agg: count_distinct
        expr: order_key
      - name: net_sales
        agg: sum
        expr: net_sales_amount
metrics:
  - name: avg_order_value_net
    type: derived
    description: Net sales divided by order count.
"""
        model = import_dbt_schema_yml(dbt_schema, model_name="dbt_semantic")
        entities = {e["name"]: e for e in model["entities"]}
        assert "FactOrders" in entities
        assert "MetricCatalog" in entities

        fact_fields = {f["name"]: f for f in entities["FactOrders"]["fields"]}
        assert "order_key" in fact_fields
        assert fact_fields["order_key"].get("primary_key") is True
        assert "customer_key" in fact_fields
        assert fact_fields["customer_key"].get("foreign_key") is True
        assert "order_date" in fact_fields
        assert "net_sales_amount" in fact_fields

        metric_fields = {f["name"]: f for f in entities["MetricCatalog"]["fields"]}
        assert "avg_order_value_net" in metric_fields
