"""Tests for database connectors and Spark schema importer.

Covers:
  - Spark schema importer (StructType, array, Databricks-style, type mapping)
  - Connector framework (registry, config, result)
  - Connector driver checks (all major connectors including SQL Server, Azure SQL, Fabric, Redshift)
  - CLI parser entries (pull, connectors, import spark-schema)
  - Removal verification (old importers gone)
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict
from unittest.mock import patch

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

from dm_core.importers import import_spark_schema, import_sql_ddl, import_dbml
from dm_core.connectors.base import (
    BaseConnector,
    ConnectorConfig,
    ConnectorResult,
    get_connector,
    list_connectors,
    _to_pascal,
    _default_model,
)
from dm_core.connectors.postgres import PostgresConnector
from dm_core.connectors.mysql import MySQLConnector
from dm_core.connectors.snowflake import SnowflakeConnector
from dm_core.connectors.bigquery import BigQueryConnector
from dm_core.connectors.databricks import DatabricksConnector
from dm_core.connectors.sqlserver import SQLServerConnector, AzureSQLConnector, AzureFabricConnector
from dm_core.connectors.redshift import RedshiftConnector


FIXTURES = ROOT / "tests" / "fixtures"


# ===========================================================================
# Spark schema importer
# ===========================================================================

class TestSparkSchemaImporter(unittest.TestCase):
    """Tests for import_spark_schema."""

    def test_single_struct_type(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "id", "type": "long", "nullable": False, "metadata": {}},
                {"name": "name", "type": "string", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="users")
        self.assertEqual(len(model["entities"]), 1)
        entity = model["entities"][0]
        self.assertEqual(entity["name"], "Users")
        self.assertEqual(len(entity["fields"]), 2)
        self.assertEqual(entity["fields"][0]["type"], "bigint")
        self.assertFalse(entity["fields"][0]["nullable"])

    def test_type_mapping_integer(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "a", "type": "integer", "nullable": True, "metadata": {}},
                {"name": "b", "type": "int", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        for f in model["entities"][0]["fields"]:
            self.assertEqual(f["type"], "integer")

    def test_type_mapping_float_double(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "a", "type": "float", "nullable": True, "metadata": {}},
                {"name": "b", "type": "double", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        for f in model["entities"][0]["fields"]:
            self.assertEqual(f["type"], "float")

    def test_type_mapping_boolean(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "flag", "type": "boolean", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["type"], "boolean")

    def test_type_mapping_date_timestamp(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "d", "type": "date", "nullable": True, "metadata": {}},
                {"name": "ts", "type": "timestamp", "nullable": True, "metadata": {}},
                {"name": "ts2", "type": "timestamp_ntz", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        fields = model["entities"][0]["fields"]
        self.assertEqual(fields[0]["type"], "date")
        self.assertEqual(fields[1]["type"], "timestamp")
        self.assertEqual(fields[2]["type"], "timestamp")

    def test_type_mapping_decimal(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "amount", "type": "decimal(18,2)", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["type"], "decimal(18,2)")

    def test_type_mapping_complex_types(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "arr", "type": {"type": "array", "elementType": "string"}, "nullable": True, "metadata": {}},
                {"name": "mp", "type": {"type": "map", "keyType": "string", "valueType": "int"}, "nullable": True, "metadata": {}},
                {"name": "st", "type": {"type": "struct", "fields": []}, "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        for f in model["entities"][0]["fields"]:
            self.assertEqual(f["type"], "json")

    def test_type_mapping_binary(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "data", "type": "binary", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["type"], "binary")

    def test_type_mapping_smallint_tinyint(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "s", "type": "short", "nullable": True, "metadata": {}},
                {"name": "t", "type": "byte", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["type"], "smallint")
        self.assertEqual(model["entities"][0]["fields"][1]["type"], "tinyint")

    def test_metadata_comment(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "id", "type": "long", "nullable": False, "metadata": {"comment": "Primary key"}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["description"], "Primary key")

    def test_metadata_sensitivity(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "ssn", "type": "string", "nullable": True, "metadata": {"sensitivity": "restricted"}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["sensitivity"], "restricted")

    def test_comment_field(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "id", "type": "long", "nullable": False, "metadata": {}, "comment": "Row ID"},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(model["entities"][0]["fields"][0]["description"], "Row ID")

    def test_array_of_tables(self):
        schema = json.dumps([
            {"name": "users", "schema": {"type": "struct", "fields": [
                {"name": "id", "type": "long", "nullable": False, "metadata": {}},
            ]}},
            {"name": "orders", "schema": {"type": "struct", "fields": [
                {"name": "order_id", "type": "long", "nullable": False, "metadata": {}},
            ]}},
        ])
        model = import_spark_schema(schema)
        self.assertEqual(len(model["entities"]), 2)
        names = {e["name"] for e in model["entities"]}
        self.assertIn("Users", names)
        self.assertIn("Orders", names)

    def test_databricks_columns_format(self):
        schema = json.dumps({
            "table_name": "customers",
            "columns": [
                {"name": "id", "data_type": "bigint", "nullable": False},
                {"name": "email", "data_type": "string", "nullable": True},
            ]
        })
        model = import_spark_schema(schema)
        self.assertEqual(len(model["entities"]), 1)
        self.assertEqual(model["entities"][0]["name"], "Customers")
        self.assertEqual(len(model["entities"][0]["fields"]), 2)

    def test_model_metadata(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [{"name": "id", "type": "long", "nullable": False, "metadata": {}}]
        })
        model = import_spark_schema(schema, model_name="my_model", domain="analytics", owners=["me@co.com"])
        self.assertEqual(model["model"]["name"], "my_model")
        self.assertEqual(model["model"]["domain"], "analytics")
        self.assertEqual(model["model"]["owners"], ["me@co.com"])

    def test_empty_fields(self):
        schema = json.dumps({"type": "struct", "fields": []})
        model = import_spark_schema(schema, table_name="empty")
        self.assertEqual(len(model["entities"]), 1)
        self.assertEqual(len(model["entities"][0]["fields"]), 0)

    def test_fixture_file(self):
        text = (FIXTURES / "sample_spark_schema.json").read_text()
        model = import_spark_schema(text, table_name="users")
        self.assertEqual(len(model["entities"]), 1)
        entity = model["entities"][0]
        self.assertEqual(entity["name"], "Users")
        self.assertEqual(len(entity["fields"]), 9)
        # Check specific types
        field_map = {f["name"]: f for f in entity["fields"]}
        self.assertEqual(field_map["user_id"]["type"], "bigint")
        self.assertFalse(field_map["user_id"]["nullable"])
        self.assertEqual(field_map["user_id"]["description"], "Primary user identifier")
        self.assertEqual(field_map["balance"]["type"], "decimal(18,2)")
        self.assertEqual(field_map["is_active"]["type"], "boolean")
        self.assertEqual(field_map["preferences"]["type"], "json")
        self.assertEqual(field_map["tags"]["type"], "json")
        self.assertEqual(field_map["email"]["sensitivity"], "confidential")

    def test_varchar_char_mapped_to_string(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "a", "type": "varchar(255)", "nullable": True, "metadata": {}},
                {"name": "b", "type": "char(10)", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        for f in model["entities"][0]["fields"]:
            self.assertEqual(f["type"], "string")

    def test_skip_empty_name_fields(self):
        schema = json.dumps({
            "type": "struct",
            "fields": [
                {"name": "id", "type": "long", "nullable": False, "metadata": {}},
                {"name": "", "type": "string", "nullable": True, "metadata": {}},
            ]
        })
        model = import_spark_schema(schema, table_name="test")
        self.assertEqual(len(model["entities"][0]["fields"]), 1)


# ===========================================================================
# Connector framework
# ===========================================================================

class TestConnectorFramework(unittest.TestCase):
    """Tests for the connector base framework."""

    def test_list_connectors(self):
        connectors = list_connectors()
        self.assertGreaterEqual(len(connectors), 9)
        types = {c["type"] for c in connectors}
        self.assertIn("postgres", types)
        self.assertIn("mysql", types)
        self.assertIn("snowflake", types)
        self.assertIn("bigquery", types)
        self.assertIn("databricks", types)
        self.assertIn("sqlserver", types)
        self.assertIn("azure_sql", types)
        self.assertIn("azure_fabric", types)
        self.assertIn("redshift", types)

    def test_get_connector_postgres(self):
        conn = get_connector("postgres")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "postgres")
        self.assertEqual(conn.display_name, "PostgreSQL")

    def test_get_connector_mysql(self):
        conn = get_connector("mysql")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "mysql")

    def test_get_connector_snowflake(self):
        conn = get_connector("snowflake")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "snowflake")

    def test_get_connector_bigquery(self):
        conn = get_connector("bigquery")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "bigquery")

    def test_get_connector_databricks(self):
        conn = get_connector("databricks")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "databricks")

    def test_get_connector_sqlserver(self):
        conn = get_connector("sqlserver")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "sqlserver")

    def test_get_connector_azure_sql(self):
        conn = get_connector("azure_sql")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "azure_sql")

    def test_get_connector_azure_fabric(self):
        conn = get_connector("azure_fabric")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "azure_fabric")

    def test_get_connector_redshift(self):
        conn = get_connector("redshift")
        self.assertIsNotNone(conn)
        self.assertEqual(conn.connector_type, "redshift")

    def test_get_connector_unknown(self):
        conn = get_connector("nonexistent_db")
        self.assertIsNone(conn)

    def test_connector_config(self):
        config = ConnectorConfig(
            connector_type="postgres",
            host="localhost",
            port=5432,
            database="mydb",
            user="admin",
            password="secret",
        )
        self.assertEqual(config.connector_type, "postgres")
        self.assertEqual(config.host, "localhost")
        self.assertEqual(config.port, 5432)
        self.assertEqual(config.effective_owners(), ["data-team@example.com"])

    def test_connector_config_custom_owners(self):
        config = ConnectorConfig(
            connector_type="postgres",
            owners=["me@co.com"],
        )
        self.assertEqual(config.effective_owners(), ["me@co.com"])

    def test_connector_result(self):
        model = {"model": {"name": "test"}, "entities": []}
        result = ConnectorResult(
            model=model,
            tables_found=5,
            columns_found=20,
            relationships_found=3,
            indexes_found=2,
        )
        summary = result.summary()
        self.assertIn("Tables: 5", summary)
        self.assertIn("Columns: 20", summary)
        self.assertIn("Relationships: 3", summary)
        self.assertIn("Indexes: 2", summary)

    def test_connector_result_with_warnings(self):
        result = ConnectorResult(
            model={},
            tables_found=0,
            warnings=["Could not fetch PKs"],
        )
        summary = result.summary()
        self.assertIn("Warnings: 1", summary)
        self.assertIn("Could not fetch PKs", summary)

    def test_to_pascal(self):
        self.assertEqual(_to_pascal("user_accounts"), "UserAccounts")
        self.assertEqual(_to_pascal("orders"), "Orders")
        self.assertEqual(_to_pascal("my-table"), "MyTable")

    def test_default_model(self):
        model = _default_model("test_model", "analytics", ["a@b.com"])
        self.assertEqual(model["model"]["name"], "test_model")
        self.assertEqual(model["model"]["domain"], "analytics")
        self.assertIsInstance(model["entities"], list)
        self.assertIsInstance(model["relationships"], list)

    def test_should_include_table(self):
        conn = get_connector("postgres")
        config = ConnectorConfig(connector_type="postgres", tables=["users", "orders"])
        self.assertTrue(conn._should_include_table("users", config))
        self.assertFalse(conn._should_include_table("products", config))

    def test_should_exclude_table(self):
        conn = get_connector("postgres")
        config = ConnectorConfig(connector_type="postgres", exclude_tables=["temp_data"])
        self.assertTrue(conn._should_include_table("users", config))
        self.assertFalse(conn._should_include_table("temp_data", config))

    def test_should_include_all_when_no_filter(self):
        conn = get_connector("postgres")
        config = ConnectorConfig(connector_type="postgres")
        self.assertTrue(conn._should_include_table("anything", config))


# ===========================================================================
# Driver checks
# ===========================================================================

class TestDriverChecks(unittest.TestCase):
    """Test that driver checks work for all connectors."""

    def test_postgres_driver_check(self):
        conn = get_connector("postgres")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_mysql_driver_check(self):
        conn = get_connector("mysql")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_snowflake_driver_check(self):
        conn = get_connector("snowflake")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_bigquery_driver_check(self):
        conn = get_connector("bigquery")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_databricks_driver_check(self):
        conn = get_connector("databricks")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_sqlserver_driver_check(self):
        conn = get_connector("sqlserver")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_azure_sql_driver_check(self):
        conn = get_connector("azure_sql")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_azure_fabric_driver_check(self):
        conn = get_connector("azure_fabric")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)

    def test_redshift_driver_check(self):
        conn = get_connector("redshift")
        ok, msg = conn.check_driver()
        self.assertIsInstance(ok, bool)
        self.assertIsInstance(msg, str)


# ===========================================================================
# CLI parser
# ===========================================================================

class TestCLIParser(unittest.TestCase):
    """Tests for CLI parser entries for new commands."""

    def test_pull_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "postgres", "--host", "localhost", "--database", "mydb"])
        self.assertEqual(args.connector, "postgres")
        self.assertEqual(args.host, "localhost")
        self.assertEqual(args.database, "mydb")

    def test_pull_parser_snowflake(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "snowflake", "--host", "acct.snowflakecomputing.com", "--warehouse", "WH"])
        self.assertEqual(args.connector, "snowflake")
        self.assertEqual(args.warehouse, "WH")

    def test_pull_parser_bigquery(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "bigquery", "--project", "my-project", "--dataset", "my_dataset"])
        self.assertEqual(args.project, "my-project")
        self.assertEqual(args.dataset, "my_dataset")

    def test_pull_parser_databricks(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "databricks", "--host", "host.databricks.com", "--token", "abc", "--catalog", "main"])
        self.assertEqual(args.token, "abc")
        self.assertEqual(args.catalog, "main")

    def test_pull_parser_databricks_http_path(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "pull", "databricks", "--host", "host.databricks.com", "--token", "abc",
            "--http-path", "/sql/1.0/warehouses/123",
        ])
        self.assertEqual(args.http_path, "/sql/1.0/warehouses/123")

    def test_pull_parser_sqlserver(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "sqlserver", "--host", "sql.example.com", "--database", "warehouse", "--user", "svc"])
        self.assertEqual(args.connector, "sqlserver")
        self.assertEqual(args.database, "warehouse")

    def test_pull_parser_sqlserver_odbc_options(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "pull", "sqlserver", "--host", "sql.example.com", "--database", "warehouse",
            "--odbc-driver", "ODBC Driver 17 for SQL Server", "--encrypt", "no",
            "--trust-server-certificate", "yes",
        ])
        self.assertEqual(args.odbc_driver, "ODBC Driver 17 for SQL Server")
        self.assertEqual(args.encrypt, "no")
        self.assertEqual(args.trust_server_certificate, "yes")

    def test_pull_parser_azure_sql(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "azure_sql", "--host", "srv.database.windows.net", "--database", "analytics"])
        self.assertEqual(args.connector, "azure_sql")
        self.assertEqual(args.host, "srv.database.windows.net")

    def test_pull_parser_redshift(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "redshift", "--host", "cluster.redshift.amazonaws.com", "--database", "dev"])
        self.assertEqual(args.connector, "redshift")
        self.assertEqual(args.database, "dev")

    def test_pull_parser_azure_fabric(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "azure_fabric", "--host", "workspace.fabric.microsoft.com", "--database", "SalesWarehouse"])
        self.assertEqual(args.connector, "azure_fabric")
        self.assertEqual(args.database, "SalesWarehouse")

    def test_pull_parser_test_flag(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "postgres", "--test"])
        self.assertTrue(args.test)

    def test_pull_parser_tables_filter(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "postgres", "--tables", "users", "orders"])
        self.assertEqual(args.tables, ["users", "orders"])

    def test_pull_parser_exclude_tables(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "postgres", "--exclude-tables", "temp"])
        self.assertEqual(args.exclude_tables, ["temp"])

    def test_pull_parser_out(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["pull", "mysql", "--out", "model.yaml"])
        self.assertEqual(args.out, "model.yaml")

    def test_pull_parser_project_dir(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(
            ["pull", "postgres", "--project-dir", "model-examples/new_project", "--create-project-dir"]
        )
        self.assertEqual(args.project_dir, "model-examples/new_project")
        self.assertTrue(args.create_project_dir)

    def test_normalize_host_and_port_url_input(self):
        from dm_cli.main import _normalize_host_and_port
        host, port = _normalize_host_and_port("http://127.0.0.1:5432", 0)
        self.assertEqual(host, "127.0.0.1")
        self.assertEqual(port, 5432)

    def test_resolve_pull_output_path_project_dir_default_name(self):
        from dm_cli.main import _resolve_pull_output_path
        with tempfile.TemporaryDirectory() as tmp:
            class Args:
                project_dir = tmp
                out = ""
                create_project_dir = False
            ok, value = _resolve_pull_output_path(Args(), "orders")
            self.assertTrue(ok)
            self.assertEqual(value, str(Path(tmp) / "orders.model.yaml"))

    def test_resolve_pull_output_path_creates_missing_project_dir_when_flagged(self):
        from dm_cli.main import _resolve_pull_output_path
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "new_project_dir"

            class Args:
                project_dir = str(target)
                out = ""
                create_project_dir = True

            ok, value = _resolve_pull_output_path(Args(), "orders")
            self.assertTrue(ok)
            self.assertTrue(target.exists())
            self.assertEqual(value, str(target / "orders.model.yaml"))

    def test_resolve_pull_output_path_prompts_to_create_missing_dir(self):
        from dm_cli.main import _resolve_pull_output_path
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / "prompt_project_dir"

            class Args:
                project_dir = str(target)
                out = ""
                create_project_dir = False

            with patch("dm_cli.main.sys.stdin.isatty", return_value=True), patch(
                "builtins.input", return_value="y"
            ):
                ok, value = _resolve_pull_output_path(Args(), "orders")

            self.assertTrue(ok)
            self.assertTrue(target.exists())
            self.assertEqual(value, str(target / "orders.model.yaml"))

    def test_build_connector_config_normalizes_url_host(self):
        from dm_cli.main import _build_connector_config, build_parser
        parser = build_parser()
        args = parser.parse_args(
            ["schemas", "postgres", "--host", "http://127.0.0.1:5432/", "--database", "postgres"]
        )
        config = _build_connector_config(args)
        self.assertEqual(config.host, "127.0.0.1")
        self.assertEqual(config.port, 5432)

    def test_build_connector_config_sqlserver_odbc_options(self):
        from dm_cli.main import _build_connector_config, build_parser
        parser = build_parser()
        args = parser.parse_args([
            "schemas", "sqlserver", "--host", "sql.example.com", "--database", "warehouse",
            "--odbc-driver", "ODBC Driver 17 for SQL Server", "--encrypt", "no",
            "--trust-server-certificate", "yes",
        ])
        config = _build_connector_config(args)
        self.assertEqual(config.extra.get("odbc_driver"), "ODBC Driver 17 for SQL Server")
        self.assertEqual(config.extra.get("encrypt"), "no")
        self.assertEqual(config.extra.get("trust_server_certificate"), "yes")

    def test_build_connector_config_databricks_http_path(self):
        from dm_cli.main import _build_connector_config, build_parser
        parser = build_parser()
        args = parser.parse_args([
            "schemas", "databricks", "--host", "dbc.example.com", "--token", "abc",
            "--http-path", "/sql/1.0/warehouses/123",
        ])
        config = _build_connector_config(args)
        self.assertEqual(config.extra.get("http_path"), "/sql/1.0/warehouses/123")

    def test_connectors_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["connectors"])
        self.assertFalse(args.output_json)

    def test_connectors_parser_json(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["connectors", "--output-json"])
        self.assertTrue(args.output_json)

    def test_import_spark_schema_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["import", "spark-schema", "schema.json"])
        self.assertEqual(args.input, "schema.json")

    def test_import_spark_schema_parser_table_name(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["import", "spark-schema", "schema.json", "--table-name", "users"])
        self.assertEqual(args.table_name, "users")

    def test_import_sql_still_works(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["import", "sql", "schema.sql"])
        self.assertEqual(args.input, "schema.sql")

    def test_import_dbml_still_works(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["import", "dbml", "schema.dbml"])
        self.assertEqual(args.input, "schema.dbml")


# ===========================================================================
# Removal verification
# ===========================================================================

class TestRemovedImporters(unittest.TestCase):
    """Verify old importers are removed."""

    def test_no_import_json_schema(self):
        import dm_core.importers as imp
        self.assertFalse(hasattr(imp, "import_json_schema"))

    def test_no_import_dbt_manifest(self):
        import dm_core.importers as imp
        self.assertFalse(hasattr(imp, "import_dbt_manifest"))

    def test_no_import_avro_schema(self):
        import dm_core.importers as imp
        self.assertFalse(hasattr(imp, "import_avro_schema"))

    def test_no_avro_fixture(self):
        self.assertFalse((FIXTURES / "sample_avro.avsc").exists())

    def test_no_manifest_fixture(self):
        self.assertFalse((FIXTURES / "sample_manifest.json").exists())

    def test_no_json_schema_fixture(self):
        self.assertFalse((FIXTURES / "sample_schema.json").exists())

    def test_spark_schema_fixture_exists(self):
        self.assertTrue((FIXTURES / "sample_spark_schema.json").exists())

    def test_sql_fixture_still_exists(self):
        self.assertTrue((FIXTURES / "sample_schema.sql").exists())

    def test_dbml_fixture_still_exists(self):
        self.assertTrue((FIXTURES / "sample_schema.dbml").exists())

    def test_sql_importer_still_works(self):
        ddl = "CREATE TABLE users (id INTEGER PRIMARY KEY, name VARCHAR(100));"
        model = import_sql_ddl(ddl)
        self.assertEqual(len(model["entities"]), 1)

    def test_dbml_importer_still_works(self):
        dbml = 'table users {\n  id integer [pk]\n  name varchar\n}\n'
        model = import_dbml(dbml)
        self.assertEqual(len(model["entities"]), 1)


# ===========================================================================
# CLI integration
# ===========================================================================

class TestCLIIntegration(unittest.TestCase):
    """Integration tests running actual CLI commands."""

    def test_connectors_command(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "connectors"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("postgres", result.stdout)
        self.assertIn("mysql", result.stdout)
        self.assertIn("snowflake", result.stdout)
        self.assertIn("bigquery", result.stdout)
        self.assertIn("databricks", result.stdout)
        self.assertIn("sqlserver", result.stdout)
        self.assertIn("azure_sql", result.stdout)
        self.assertIn("azure_fabric", result.stdout)
        self.assertIn("redshift", result.stdout)

    def test_connectors_json_command(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "connectors", "--output-json"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        data = json.loads(result.stdout)
        self.assertIsInstance(data, list)
        types = {c["type"] for c in data}
        self.assertIn("postgres", types)

    def test_import_spark_schema_command(self):
        import subprocess
        fixture = str(FIXTURES / "sample_spark_schema.json")
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "import", "spark-schema", fixture, "--table-name", "users"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        # May return 1 due to lint warnings (e.g. MISSING_PRIMARY_KEY), but output should contain the model
        self.assertIn("Users", result.stdout)
        self.assertIn("user_id", result.stdout)
        self.assertIn("bigint", result.stdout)

    def test_pull_unknown_connector(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "pull", "nonexistent_db"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertNotEqual(result.returncode, 0)
        self.assertIn("Unknown connector", result.stderr)


# ===========================================================================
# Module files
# ===========================================================================

class TestModuleFiles(unittest.TestCase):
    """Verify connector module files exist."""

    def test_connectors_init(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "__init__.py").exists())

    def test_connectors_base(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "base.py").exists())

    def test_connectors_postgres(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "postgres.py").exists())

    def test_connectors_mysql(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "mysql.py").exists())

    def test_connectors_snowflake(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "snowflake.py").exists())

    def test_connectors_bigquery(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "bigquery.py").exists())

    def test_connectors_databricks(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "databricks.py").exists())

    def test_connectors_sqlserver(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "sqlserver.py").exists())

    def test_connectors_redshift(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "connectors" / "redshift.py").exists())


if __name__ == "__main__":
    unittest.main()
