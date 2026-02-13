"""MySQL connector — pulls schema from information_schema."""

from __future__ import annotations

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import BaseConnector, ConnectorConfig, ConnectorResult


_MYSQL_TYPE_MAP = {
    "int": "integer",
    "integer": "integer",
    "bigint": "bigint",
    "smallint": "smallint",
    "tinyint": "tinyint",
    "mediumint": "integer",
    "float": "float",
    "double": "float",
    "decimal": "decimal",
    "numeric": "decimal",
    "varchar": "string",
    "char": "string",
    "text": "text",
    "mediumtext": "text",
    "longtext": "text",
    "tinytext": "text",
    "blob": "binary",
    "mediumblob": "binary",
    "longblob": "binary",
    "tinyblob": "binary",
    "date": "date",
    "datetime": "timestamp",
    "timestamp": "timestamp",
    "time": "time",
    "year": "integer",
    "boolean": "boolean",
    "bool": "boolean",
    "json": "json",
    "binary": "binary",
    "varbinary": "binary",
    "enum": "string",
    "set": "string",
    "bit": "string",
    "geometry": "string",
    "point": "string",
    "linestring": "string",
    "polygon": "string",
}


class MySQLConnector(BaseConnector):
    connector_type = "mysql"
    display_name = "MySQL"
    required_package = "mysql.connector"

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            import mysql.connector
            conn = mysql.connector.connect(
                host=config.host,
                port=config.port or 3306,
                database=config.database,
                user=config.user,
                password=config.password,
            )
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "mysql-connector-python not installed. Run: pip install mysql-connector-python"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def _connect(self, config: ConnectorConfig):
        import mysql.connector
        return mysql.connector.connect(
            host=config.host,
            port=config.port or 3306,
            database=config.database,
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
                WHERE s.schema_name NOT IN ('information_schema', 'mysql', 'performance_schema', 'sys')
                GROUP BY s.schema_name
                ORDER BY s.schema_name
            """)
            return [{"name": row[0], "table_count": row[1]} for row in cur.fetchall()]
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        schema = config.schema or config.database
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT t.table_name, t.table_type,
                       (SELECT COUNT(*) FROM information_schema.columns c
                        WHERE c.table_schema = t.table_schema AND c.table_name = t.table_name) AS col_count,
                       t.table_rows
                FROM information_schema.tables t
                WHERE t.table_schema = %s
                  AND t.table_type IN ('BASE TABLE', 'VIEW')
                ORDER BY t.table_name
            """, (schema,))
            results = []
            for row in cur.fetchall():
                ttype = "view" if "VIEW" in row[1] else "table"
                results.append({"name": row[0], "type": ttype, "column_count": row[2], "row_count": row[3]})
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
        db_name = config.database
        cur = conn.cursor()
        warnings: List[str] = []

        # --- Tables ---
        cur.execute("""
            SELECT TABLE_NAME, TABLE_TYPE
            FROM information_schema.TABLES
            WHERE TABLE_SCHEMA = %s
              AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY TABLE_NAME
        """, (db_name,))
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
                "description": f"Pulled from MySQL {db_name}.{table_name} on {date.today().isoformat()}",
                "fields": [],
            }

        # --- Columns ---
        cur.execute("""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                   COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH,
                   NUMERIC_PRECISION, NUMERIC_SCALE, COLUMN_TYPE, COLUMN_KEY
            FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = %s
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """, (db_name,))
        columns = cur.fetchall()
        total_columns = 0

        for row in columns:
            tname, col_name, data_type, is_nullable, col_default, char_max_len, num_prec, num_scale, col_type, col_key = row
            if tname not in table_entities:
                continue

            dl_type = _MYSQL_TYPE_MAP.get(data_type.lower(), "string")
            if data_type.lower() in ("decimal", "numeric") and num_prec:
                dl_type = f"decimal({num_prec},{num_scale or 0})"
            if data_type.lower() == "varchar" and char_max_len:
                dl_type = f"varchar({char_max_len})"

            field: Dict[str, Any] = {
                "name": col_name,
                "type": dl_type,
                "nullable": is_nullable == "YES",
            }
            if col_default is not None:
                field["default"] = str(col_default)
            if col_key == "PRI":
                field["primary_key"] = True
                field["nullable"] = False
            if col_key == "UNI":
                field["unique"] = True

            table_entities[tname]["fields"].append(field)
            total_columns += 1

        # --- Foreign keys ---
        cur.execute("""
            SELECT
                TABLE_NAME, COLUMN_NAME,
                REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME,
                CONSTRAINT_NAME
            FROM information_schema.KEY_COLUMN_USAGE
            WHERE TABLE_SCHEMA = %s
              AND REFERENCED_TABLE_NAME IS NOT NULL
        """, (db_name,))
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
            SELECT INDEX_NAME, TABLE_NAME, NON_UNIQUE, COLUMN_NAME
            FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = %s
              AND INDEX_NAME != 'PRIMARY'
            ORDER BY TABLE_NAME, INDEX_NAME, SEQ_IN_INDEX
        """, (db_name,))
        idx_rows = cur.fetchall()
        idx_map: Dict[str, Dict[str, Any]] = {}
        for idx_name, tname, non_unique, col_name in idx_rows:
            if tname not in table_entities:
                continue
            key = f"{tname}.{idx_name}"
            if key not in idx_map:
                idx_map[key] = {
                    "name": idx_name,
                    "entity": self._entity_name(tname),
                    "fields": [],
                    "unique": non_unique == 0,
                }
            idx_map[key]["fields"].append(col_name)

        indexes = list(idx_map.values())

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
