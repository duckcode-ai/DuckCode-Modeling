"""Amazon Redshift connector — pulls schema from information_schema with inference fallback."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import (
    BaseConnector,
    ConnectorConfig,
    ConnectorResult,
    infer_primary_keys,
    infer_relationships,
)


_RS_TYPE_MAP = {
    "smallint": "smallint",
    "integer": "integer",
    "bigint": "bigint",
    "decimal": "decimal",
    "numeric": "decimal",
    "real": "float",
    "double precision": "float",
    "boolean": "boolean",
    "character varying": "string",
    "varchar": "string",
    "character": "string",
    "char": "string",
    "text": "text",
    "date": "date",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamp",
    "time without time zone": "time",
    "time with time zone": "time",
    "super": "json",
    "varbyte": "binary",
    "binary varying": "binary",
    "geometry": "string",
    "geography": "string",
    "hllsketch": "string",
}


class RedshiftConnector(BaseConnector):
    connector_type = "redshift"
    display_name = "Amazon Redshift"
    required_package = "redshift_connector"

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            conn = self._connect(config)
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "redshift-connector not installed. Run: pip install redshift-connector"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def _connect(self, config: ConnectorConfig):
        import redshift_connector

        return redshift_connector.connect(
            host=config.host,
            port=config.port or 5439,
            database=config.database,
            user=config.user,
            password=config.password,
            timeout=10,
        )

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT n.nspname AS schema_name,
                       COUNT(t.table_name) AS table_count
                FROM pg_namespace n
                LEFT JOIN information_schema.tables t
                  ON t.table_schema = n.nspname
                 AND t.table_type IN ('BASE TABLE', 'VIEW')
                WHERE n.nspname NOT IN ('pg_catalog', 'information_schema', 'pg_internal')
                  AND n.nspname NOT LIKE 'pg_temp_%'
                GROUP BY n.nspname
                ORDER BY n.nspname
                """
            )
            return [{"name": row[0], "table_count": int(row[1] or 0)} for row in cur.fetchall()]
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        schema = config.schema or "public"
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT t.table_name, t.table_type,
                       (
                         SELECT COUNT(*)
                         FROM information_schema.columns c
                         WHERE c.table_schema = t.table_schema
                           AND c.table_name = t.table_name
                       ) AS col_count
                FROM information_schema.tables t
                WHERE t.table_schema = %s
                  AND t.table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY t.table_name
                """,
                (schema,),
            )
            results = []
            for row in cur.fetchall():
                ttype = "view" if "VIEW" in str(row[1]).upper() else "table"
                results.append({
                    "name": row[0],
                    "type": ttype,
                    "column_count": int(row[2] or 0),
                    "row_count": None,
                })
            return results
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
        schema_filter = config.schema or "public"
        cur = conn.cursor()
        warnings: List[str] = []

        cur.execute(
            """
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = %s
              AND table_type IN ('BASE TABLE', 'VIEW')
            ORDER BY table_name
            """,
            (schema_filter,),
        )
        tables = cur.fetchall()

        table_entities: Dict[str, Dict[str, Any]] = {}
        for table_name, table_type in tables:
            if not self._should_include_table(table_name, config):
                continue
            entity_name = self._entity_name(table_name)
            entity_type = "view" if str(table_type).upper() == "VIEW" else "table"
            table_entities[table_name] = {
                "name": entity_name,
                "physical_name": table_name,
                "type": entity_type,
                "description": f"Pulled from Redshift {config.database}.{schema_filter}.{table_name} on {date.today().isoformat()}",
                "fields": [],
            }
            if schema_filter != "public":
                table_entities[table_name]["schema"] = schema_filter

        cur.execute(
            """
            SELECT table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length,
                   numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = %s
            ORDER BY table_name, ordinal_position
            """,
            (schema_filter,),
        )
        total_columns = 0

        for row in cur.fetchall():
            tname, col_name, data_type, is_nullable, col_default, char_max_len, num_prec, num_scale = row
            if tname not in table_entities:
                continue

            dl_type = _RS_TYPE_MAP.get((data_type or "").lower(), "string")
            if str(data_type).lower() in ("decimal", "numeric") and num_prec:
                dl_type = f"decimal({int(num_prec)},{int(num_scale or 0)})"
            if str(data_type).lower() in ("character varying", "varchar") and char_max_len:
                try:
                    dl_type = f"varchar({int(char_max_len)})"
                except Exception:
                    dl_type = "string"

            field: Dict[str, Any] = {
                "name": col_name,
                "type": dl_type,
                "nullable": str(is_nullable).upper() == "YES",
            }
            if col_default is not None:
                cleaned = str(col_default).split("::")[0].strip("'")
                if cleaned:
                    field["default"] = cleaned

            table_entities[tname]["fields"].append(field)
            total_columns += 1

        cur.execute(
            """
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = %s
            """,
            (schema_filter,),
        )
        for tname, col_name in cur.fetchall():
            if tname in table_entities:
                for f in table_entities[tname]["fields"]:
                    if f["name"] == col_name:
                        f["primary_key"] = True
                        f["nullable"] = False

        cur.execute(
            """
            SELECT
                kcu.table_name AS child_table,
                kcu.column_name AS child_column,
                ccu.table_name AS parent_table,
                ccu.column_name AS parent_column,
                tc.constraint_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON tc.constraint_name = ccu.constraint_name
             AND tc.table_schema = ccu.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = %s
            """,
            (schema_filter,),
        )
        fk_rows = cur.fetchall()
        relationships: List[Dict[str, Any]] = []
        for child_table, child_col, parent_table, parent_col, constraint_name in fk_rows:
            if child_table in table_entities:
                for f in table_entities[child_table]["fields"]:
                    if f["name"] == child_col:
                        f["foreign_key"] = True
                parent_entity = self._entity_name(parent_table)
                child_entity = self._entity_name(child_table)
                relationships.append(
                    {
                        "name": constraint_name or f"{parent_entity.lower()}_{child_entity.lower()}_{child_col}_fk",
                        "from": f"{parent_entity}.{parent_col}",
                        "to": f"{child_entity}.{child_col}",
                        "cardinality": "one_to_many",
                    }
                )

        entities_list = list(table_entities.values())

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
                warnings.insert(
                    0,
                    f"No FK constraints found — inferred {len(inferred_rels)} relationships from column naming patterns.",
                )

        model["entities"] = entities_list
        model["relationships"] = relationships
        model["indexes"] = []

        cur.close()

        return ConnectorResult(
            model=model,
            tables_found=len(table_entities),
            columns_found=total_columns,
            relationships_found=len(relationships),
            indexes_found=0,
            warnings=warnings,
        )
