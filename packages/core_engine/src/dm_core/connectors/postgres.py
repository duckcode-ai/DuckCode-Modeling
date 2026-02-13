"""PostgreSQL connector — pulls schema from information_schema."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import BaseConnector, ConnectorConfig, ConnectorResult


_PG_TYPE_MAP = {
    "integer": "integer",
    "bigint": "bigint",
    "smallint": "smallint",
    "serial": "integer",
    "bigserial": "bigint",
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
    "uuid": "uuid",
    "json": "json",
    "jsonb": "json",
    "bytea": "binary",
    "inet": "string",
    "cidr": "string",
    "macaddr": "string",
    "interval": "string",
    "array": "json",
    "xml": "string",
    "money": "decimal",
    "bit": "string",
    "bit varying": "string",
    "point": "string",
    "line": "string",
    "polygon": "string",
    "tsvector": "string",
    "tsquery": "string",
}


class PostgresConnector(BaseConnector):
    connector_type = "postgres"
    display_name = "PostgreSQL"
    required_package = "psycopg2"

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            import psycopg2
            conn = psycopg2.connect(
                host=config.host,
                port=config.port or 5432,
                dbname=config.database,
                user=config.user,
                password=config.password,
            )
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "psycopg2 not installed. Run: pip install psycopg2-binary"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def _connect(self, config: ConnectorConfig):
        import psycopg2
        return psycopg2.connect(
            host=config.host,
            port=config.port or 5432,
            dbname=config.database,
            user=config.user,
            password=config.password,
        )

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT s.schema_name,
                       COUNT(t.table_name) AS table_count
                FROM information_schema.schemata s
                LEFT JOIN information_schema.tables t
                  ON t.table_schema = s.schema_name
                  AND t.table_type IN ('BASE TABLE', 'VIEW')
                WHERE s.schema_name NOT IN ('pg_catalog', 'information_schema', 'pg_toast')
                GROUP BY s.schema_name
                ORDER BY s.schema_name
            """)
            return [{"name": row[0], "table_count": row[1]} for row in cur.fetchall()]
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        schema = config.schema or "public"
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT t.table_name, t.table_type,
                       (SELECT COUNT(*) FROM information_schema.columns c
                        WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS col_count
                FROM information_schema.tables t
                WHERE t.table_schema = %s
                  AND t.table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY t.table_name
            """, (schema,))
            results = []
            for row in cur.fetchall():
                ttype = "view" if "VIEW" in row[1] else "table"
                results.append({"name": row[0], "type": ttype, "column_count": row[2], "row_count": None})
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

        # --- Tables ---
        cur.execute("""
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = %s
              AND table_type IN ('BASE TABLE', 'VIEW')
            ORDER BY table_name
        """, (schema_filter,))
        tables = cur.fetchall()

        table_entities: Dict[str, Dict[str, Any]] = {}
        for table_name, table_type in tables:
            if not self._should_include_table(table_name, config):
                continue
            entity_name = self._entity_name(table_name)
            entity_type = "view" if table_type == "VIEW" else "table"
            table_entities[table_name] = {
                "name": entity_name,
                "physical_name": table_name,
                "type": entity_type,
                "description": f"Pulled from PostgreSQL {config.database}.{schema_filter}.{table_name} on {date.today().isoformat()}",
                "fields": [],
            }
            if schema_filter != "public":
                table_entities[table_name]["schema"] = schema_filter

        # --- Columns ---
        cur.execute("""
            SELECT table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length,
                   numeric_precision, numeric_scale, udt_name
            FROM information_schema.columns
            WHERE table_schema = %s
            ORDER BY table_name, ordinal_position
        """, (schema_filter,))
        columns = cur.fetchall()
        total_columns = 0

        for row in columns:
            tname, col_name, data_type, is_nullable, col_default, char_max_len, num_prec, num_scale, udt_name = row
            if tname not in table_entities:
                continue

            dl_type = _PG_TYPE_MAP.get(data_type, "string")
            if data_type == "numeric" and num_prec:
                dl_type = f"decimal({num_prec},{num_scale or 0})"
            if data_type in ("character varying", "varchar") and char_max_len:
                dl_type = f"varchar({char_max_len})"
            if data_type == "USER-DEFINED":
                dl_type = udt_name or "string"

            field: Dict[str, Any] = {
                "name": col_name,
                "type": dl_type,
                "nullable": is_nullable == "YES",
            }
            if col_default is not None:
                cleaned = str(col_default).split("::")[0].strip("'")
                if not cleaned.startswith("nextval("):
                    field["default"] = cleaned

            table_entities[tname]["fields"].append(field)
            total_columns += 1

        # --- Primary keys ---
        cur.execute("""
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'PRIMARY KEY'
              AND tc.table_schema = %s
        """, (schema_filter,))
        for tname, col_name in cur.fetchall():
            if tname in table_entities:
                for f in table_entities[tname]["fields"]:
                    if f["name"] == col_name:
                        f["primary_key"] = True
                        f["nullable"] = False

        # --- Unique constraints ---
        cur.execute("""
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
              AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
              AND tc.table_schema = %s
        """, (schema_filter,))
        for tname, col_name in cur.fetchall():
            if tname in table_entities:
                for f in table_entities[tname]["fields"]:
                    if f["name"] == col_name:
                        f["unique"] = True

        # --- Foreign keys ---
        cur.execute("""
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
        """, (schema_filter,))
        fk_rows = cur.fetchall()
        relationships: List[Dict[str, Any]] = []
        for child_table, child_col, parent_table, parent_col, constraint_name in fk_rows:
            if child_table in table_entities:
                for f in table_entities[child_table]["fields"]:
                    if f["name"] == child_col:
                        f["foreign_key"] = True
                parent_entity = self._entity_name(parent_table)
                child_entity = self._entity_name(child_table)
                relationships.append({
                    "name": constraint_name or f"{parent_entity.lower()}_{child_entity.lower()}_{child_col}_fk",
                    "from": f"{parent_entity}.{parent_col}",
                    "to": f"{child_entity}.{child_col}",
                    "cardinality": "one_to_many",
                })

        # --- Indexes ---
        cur.execute("""
            SELECT indexname, tablename, indexdef
            FROM pg_indexes
            WHERE schemaname = %s
            ORDER BY tablename, indexname
        """, (schema_filter,))
        indexes: List[Dict[str, Any]] = []
        for idx_name, tname, idx_def in cur.fetchall():
            if tname not in table_entities:
                continue
            if "_pkey" in idx_name:
                continue
            is_unique = "UNIQUE" in (idx_def or "").upper()
            import re
            cols_match = re.search(r"\(([^)]+)\)", idx_def or "")
            cols = []
            if cols_match:
                cols = [c.strip().split()[0] for c in cols_match.group(1).split(",")]
            entity_name = self._entity_name(tname)
            indexes.append({
                "name": idx_name,
                "entity": entity_name,
                "fields": cols,
                "unique": is_unique,
            })

        model["entities"] = list(table_entities.values())
        model["relationships"] = relationships
        model["indexes"] = indexes

        cur.close()

        return ConnectorResult(
            model=model,
            tables_found=len(table_entities),
            columns_found=total_columns,
            relationships_found=len(relationships),
            indexes_found=len(indexes),
            warnings=warnings,
        )
