"""Databricks / Spark SQL connector — pulls schema from Unity Catalog or Hive Metastore."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import BaseConnector, ConnectorConfig, ConnectorResult, infer_primary_keys, infer_relationships


_SPARK_TYPE_MAP = {
    "string": "string",
    "int": "integer",
    "integer": "integer",
    "bigint": "bigint",
    "smallint": "smallint",
    "tinyint": "tinyint",
    "float": "float",
    "double": "float",
    "decimal": "decimal",
    "boolean": "boolean",
    "date": "date",
    "timestamp": "timestamp",
    "timestamp_ntz": "timestamp",
    "binary": "binary",
    "array": "json",
    "map": "json",
    "struct": "json",
    "void": "string",
}


class DatabricksConnector(BaseConnector):
    connector_type = "databricks"
    display_name = "Databricks (Unity Catalog / Hive)"
    required_package = "databricks.sql"

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            from databricks import sql
            conn = sql.connect(
                server_hostname=config.host,
                http_path=config.extra.get("http_path", ""),
                access_token=config.token,
            )
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "databricks-sql-connector not installed. Run: pip install databricks-sql-connector"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def _connect(self, config: ConnectorConfig):
        from databricks import sql
        return sql.connect(
            server_hostname=config.host,
            http_path=config.extra.get("http_path", ""),
            access_token=config.token,
        )

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            catalog_name = config.catalog or "main"
            cur.execute(f"SHOW SCHEMAS IN {catalog_name}")
            rows = cur.fetchall()
            results = []
            for row in rows:
                schema_name = row[0]
                if schema_name.lower() in ("information_schema",):
                    continue
                try:
                    cur.execute(f"SHOW TABLES IN {catalog_name}.{schema_name}")
                    count = len(cur.fetchall())
                except Exception:
                    count = 0
                results.append({"name": schema_name, "table_count": count})
            return results
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            catalog_name = config.catalog or "main"
            schema_name = config.schema or "default"
            cur.execute(f"SHOW TABLES IN {catalog_name}.{schema_name}")
            rows = cur.fetchall()
            results = []
            for row in rows:
                table_name = row[1] if len(row) > 1 else row[0]
                try:
                    cur.execute(f"DESCRIBE TABLE {catalog_name}.{schema_name}.{table_name}")
                    col_count = len(cur.fetchall())
                except Exception:
                    col_count = 0
                results.append({"name": table_name, "type": "table", "column_count": col_count, "row_count": None})
            return sorted(results, key=lambda x: x["name"])
        finally:
            conn.close()

    def pull_schema(self, config: ConnectorConfig) -> ConnectorResult:
        conn = self._connect(config)
        try:
            return self._pull(conn, config)
        finally:
            conn.close()

    def _pull(self, conn: Any, config: ConnectorConfig) -> ConnectorResult:
        model = self._build_model(config)
        catalog_name = config.catalog or "main"
        schema_name = config.schema or "default"
        cur = conn.cursor()
        warnings: List[str] = []

        # --- Tables ---
        cur.execute(f"SHOW TABLES IN {catalog_name}.{schema_name}")
        tables_raw = cur.fetchall()

        table_entities: Dict[str, Dict[str, Any]] = {}
        for row in tables_raw:
            # SHOW TABLES returns (database, tableName, isTemporary)
            table_name = row[1] if len(row) > 1 else row[0]
            if not self._should_include_table(table_name, config):
                continue
            entity_name = self._entity_name(table_name)
            table_entities[table_name] = {
                "name": entity_name,
                "type": "table",
                "description": f"Pulled from Databricks {catalog_name}.{schema_name}.{table_name} on {date.today().isoformat()}",
                "fields": [],
                "schema": schema_name,
                "database": catalog_name,
            }

        # --- Columns via DESCRIBE ---
        total_columns = 0
        for table_name in list(table_entities.keys()):
            try:
                cur.execute(f"DESCRIBE TABLE {catalog_name}.{schema_name}.{table_name}")
                col_rows = cur.fetchall()
                for col_row in col_rows:
                    col_name = col_row[0]
                    col_type = col_row[1] if len(col_row) > 1 else "string"
                    comment = col_row[2] if len(col_row) > 2 else None

                    # Skip partition info / metadata rows
                    if col_name.startswith("#") or col_name == "" or col_name.startswith("---"):
                        continue

                    base_type = col_type.lower().split("(")[0].split("<")[0].strip()
                    dl_type = _SPARK_TYPE_MAP.get(base_type, "string")
                    if base_type == "decimal" and "(" in col_type:
                        dl_type = col_type.lower()

                    field: Dict[str, Any] = {
                        "name": col_name,
                        "type": dl_type,
                        "nullable": True,
                    }
                    if comment:
                        field["description"] = comment

                    table_entities[table_name]["fields"].append(field)
                    total_columns += 1
            except Exception as e:
                warnings.append(f"Could not describe table {table_name}: {e}")

        # --- Primary keys (Unity Catalog) ---
        relationships: List[Dict[str, Any]] = []
        try:
            for table_name in table_entities:
                try:
                    cur.execute(f"""
                        SELECT column_name
                        FROM {catalog_name}.information_schema.table_constraints tc
                        JOIN {catalog_name}.information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                        WHERE tc.table_schema = '{schema_name}'
                          AND tc.table_name = '{table_name}'
                          AND tc.constraint_type = 'PRIMARY KEY'
                    """)
                    pk_rows = cur.fetchall()
                    for pk_row in pk_rows:
                        pk_col = pk_row[0]
                        for f in table_entities[table_name]["fields"]:
                            if f["name"] == pk_col:
                                f["primary_key"] = True
                                f["nullable"] = False
                except Exception:
                    pass

            # --- Foreign keys ---
            for table_name in table_entities:
                try:
                    cur.execute(f"""
                        SELECT
                            kcu.column_name AS child_column,
                            ccu.table_name AS parent_table,
                            ccu.column_name AS parent_column,
                            tc.constraint_name
                        FROM {catalog_name}.information_schema.table_constraints tc
                        JOIN {catalog_name}.information_schema.key_column_usage kcu
                          ON tc.constraint_name = kcu.constraint_name
                        JOIN {catalog_name}.information_schema.constraint_column_usage ccu
                          ON tc.constraint_name = ccu.constraint_name
                        WHERE tc.table_schema = '{schema_name}'
                          AND tc.table_name = '{table_name}'
                          AND tc.constraint_type = 'FOREIGN KEY'
                    """)
                    fk_rows = cur.fetchall()
                    for fk_row in fk_rows:
                        child_col, parent_table, parent_col, fk_name = fk_row
                        parent_entity = self._entity_name(parent_table)
                        child_entity = self._entity_name(table_name)
                        for f in table_entities[table_name]["fields"]:
                            if f["name"] == child_col:
                                f["foreign_key"] = True
                        relationships.append({
                            "name": fk_name or f"{parent_entity.lower()}_{child_entity.lower()}_{child_col}_fk",
                            "from": f"{parent_entity}.{parent_col}",
                            "to": f"{child_entity}.{child_col}",
                            "cardinality": "one_to_many",
                        })
                except Exception:
                    pass
        except Exception as e:
            warnings.append(f"Could not fetch constraints: {e}")

        entities_list = list(table_entities.values())

        # --- Inference: fill in PKs and FKs when constraints are missing ---
        has_any_pk = any(
            f.get("primary_key") for ent in entities_list for f in ent.get("fields", [])
        )
        if not has_any_pk:
            entities_list, pk_msgs = infer_primary_keys(entities_list)
            warnings.extend(pk_msgs)

        if not relationships:
            inferred_rels, fk_msgs = infer_relationships(entities_list, relationships)
            relationships.extend(inferred_rels)
            warnings.extend(fk_msgs)
            if inferred_rels:
                warnings.insert(0, f"No FK constraints found — inferred {len(inferred_rels)} relationships from column naming patterns.")

        model["entities"] = entities_list
        model["relationships"] = relationships

        cur.close()

        return ConnectorResult(
            model=model,
            tables_found=len(table_entities),
            columns_found=total_columns,
            relationships_found=len(relationships),
            indexes_found=0,
            warnings=warnings,
        )
