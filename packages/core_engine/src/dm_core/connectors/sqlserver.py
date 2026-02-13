"""SQL Server-family connectors (SQL Server, Azure SQL, Microsoft Fabric Warehouse)."""

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


_SQLSERVER_TYPE_MAP = {
    "int": "integer",
    "bigint": "bigint",
    "smallint": "smallint",
    "tinyint": "tinyint",
    "bit": "boolean",
    "decimal": "decimal",
    "numeric": "decimal",
    "money": "decimal",
    "smallmoney": "decimal",
    "float": "float",
    "real": "float",
    "char": "string",
    "nchar": "string",
    "varchar": "string",
    "nvarchar": "string",
    "text": "text",
    "ntext": "text",
    "date": "date",
    "datetime": "timestamp",
    "datetime2": "timestamp",
    "smalldatetime": "timestamp",
    "time": "time",
    "datetimeoffset": "timestamp",
    "uniqueidentifier": "uuid",
    "binary": "binary",
    "varbinary": "binary",
    "image": "binary",
    "xml": "string",
    "sql_variant": "string",
    "geography": "string",
    "geometry": "string",
    "hierarchyid": "string",
    "json": "json",
}


class _SqlServerBaseConnector(BaseConnector):
    required_package = "pyodbc"
    default_port = 1433
    default_schema = "dbo"

    def _build_conn_string(self, config: ConnectorConfig) -> str:
        server = config.host or "localhost"
        port = config.port or self.default_port
        if port:
            server = f"{server},{port}"

        driver = config.extra.get("odbc_driver", "ODBC Driver 18 for SQL Server")
        database = config.database or "master"
        encrypt = str(config.extra.get("encrypt", "yes"))
        trust = str(config.extra.get("trust_server_certificate", "yes"))

        parts = [
            f"DRIVER={{{driver}}}",
            f"SERVER={server}",
            f"DATABASE={database}",
            f"Encrypt={encrypt}",
            f"TrustServerCertificate={trust}",
            "Connection Timeout=10",
        ]

        if config.user:
            parts.extend([
                f"UID={config.user}",
                f"PWD={config.password or ''}",
            ])
        else:
            parts.append("Trusted_Connection=yes")

        return ";".join(parts)

    def _map_type(self, data_type: str, char_max_len: Any, num_prec: Any, num_scale: Any) -> str:
        base = (data_type or "").lower()

        if base in ("decimal", "numeric") and num_prec:
            return f"decimal({int(num_prec)},{int(num_scale or 0)})"

        if base in ("varchar", "nvarchar", "char", "nchar"):
            if char_max_len in (None, 0):
                return _SQLSERVER_TYPE_MAP.get(base, "string")
            try:
                length = int(char_max_len)
            except Exception:
                return _SQLSERVER_TYPE_MAP.get(base, "string")
            if length < 0:
                return "text"
            return f"{base}({length})"

        return _SQLSERVER_TYPE_MAP.get(base, "string")

    def _connect(self, config: ConnectorConfig):
        import pyodbc

        return pyodbc.connect(self._build_conn_string(config), autocommit=True)

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            conn = self._connect(config)
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "pyodbc not installed. Run: pip install pyodbc"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute(
                """
                SELECT s.name AS schema_name,
                       (
                         SELECT COUNT(*)
                         FROM information_schema.tables t
                         WHERE t.table_schema = s.name
                           AND t.table_type IN ('BASE TABLE', 'VIEW')
                       ) AS table_count
                FROM sys.schemas s
                WHERE s.name NOT IN ('sys', 'INFORMATION_SCHEMA')
                ORDER BY s.name
                """
            )
            return [{"name": row[0], "table_count": int(row[1] or 0)} for row in cur.fetchall()]
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        schema = config.schema or self.default_schema
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
                WHERE t.table_schema = ?
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
        schema_filter = config.schema or self.default_schema
        cur = conn.cursor()
        warnings: List[str] = []

        cur.execute(
            """
            SELECT table_name, table_type
            FROM information_schema.tables
            WHERE table_schema = ?
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
                "description": f"Pulled from {self.display_name} {config.database}.{schema_filter}.{table_name} on {date.today().isoformat()}",
                "fields": [],
            }
            if schema_filter != self.default_schema:
                table_entities[table_name]["schema"] = schema_filter

        cur.execute(
            """
            SELECT table_name, column_name, data_type, is_nullable,
                   column_default, character_maximum_length,
                   numeric_precision, numeric_scale
            FROM information_schema.columns
            WHERE table_schema = ?
            ORDER BY table_name, ordinal_position
            """,
            (schema_filter,),
        )
        columns = cur.fetchall()
        total_columns = 0

        for row in columns:
            tname, col_name, data_type, is_nullable, col_default, char_max_len, num_prec, num_scale = row
            if tname not in table_entities:
                continue

            dl_type = self._map_type(data_type, char_max_len, num_prec, num_scale)
            field: Dict[str, Any] = {
                "name": col_name,
                "type": dl_type,
                "nullable": str(is_nullable).upper() == "YES",
            }
            if col_default is not None:
                cleaned = str(col_default).strip()
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
              AND tc.table_schema = ?
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
            SELECT tc.table_name, kcu.column_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON tc.constraint_name = kcu.constraint_name
             AND tc.table_schema = kcu.table_schema
            WHERE tc.constraint_type = 'UNIQUE'
              AND tc.table_schema = ?
            """,
            (schema_filter,),
        )
        for tname, col_name in cur.fetchall():
            if tname in table_entities:
                for f in table_entities[tname]["fields"]:
                    if f["name"] == col_name:
                        f["unique"] = True

        cur.execute(
            """
            SELECT
                fk.name AS constraint_name,
                tr.name AS child_table,
                cr.name AS child_column,
                tp.name AS parent_table,
                cp.name AS parent_column
            FROM sys.foreign_keys fk
            JOIN sys.foreign_key_columns fkc
              ON fk.object_id = fkc.constraint_object_id
            JOIN sys.tables tr
              ON fkc.parent_object_id = tr.object_id
            JOIN sys.schemas sr
              ON tr.schema_id = sr.schema_id
            JOIN sys.columns cr
              ON tr.object_id = cr.object_id
             AND fkc.parent_column_id = cr.column_id
            JOIN sys.tables tp
              ON fkc.referenced_object_id = tp.object_id
            JOIN sys.columns cp
              ON tp.object_id = cp.object_id
             AND fkc.referenced_column_id = cp.column_id
            WHERE sr.name = ?
            """,
            (schema_filter,),
        )
        fk_rows = cur.fetchall()
        relationships: List[Dict[str, Any]] = []
        for constraint_name, child_table, child_col, parent_table, parent_col in fk_rows:
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

        indexes: List[Dict[str, Any]] = []
        try:
            cur.execute(
                """
                SELECT
                    i.name AS index_name,
                    t.name AS table_name,
                    i.is_unique,
                    STRING_AGG(c.name, ',') WITHIN GROUP (ORDER BY ic.key_ordinal) AS columns_csv
                FROM sys.indexes i
                JOIN sys.tables t
                  ON i.object_id = t.object_id
                JOIN sys.schemas s
                  ON t.schema_id = s.schema_id
                JOIN sys.index_columns ic
                  ON i.object_id = ic.object_id
                 AND i.index_id = ic.index_id
                JOIN sys.columns c
                  ON ic.object_id = c.object_id
                 AND ic.column_id = c.column_id
                WHERE s.name = ?
                  AND i.is_primary_key = 0
                  AND i.is_hypothetical = 0
                  AND i.index_id > 0
                GROUP BY i.name, t.name, i.is_unique
                ORDER BY t.name, i.name
                """,
                (schema_filter,),
            )
            for idx_name, tname, is_unique, columns_csv in cur.fetchall():
                if tname not in table_entities:
                    continue
                cols = [c.strip() for c in str(columns_csv or "").split(",") if c.strip()]
                indexes.append(
                    {
                        "name": idx_name,
                        "entity": self._entity_name(tname),
                        "fields": cols,
                        "unique": bool(is_unique),
                    }
                )
        except Exception as e:
            warnings.append(f"Could not fetch index metadata: {e}")

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


class SQLServerConnector(_SqlServerBaseConnector):
    connector_type = "sqlserver"
    display_name = "SQL Server"


class AzureSQLConnector(_SqlServerBaseConnector):
    connector_type = "azure_sql"
    display_name = "Azure SQL"


class AzureFabricConnector(_SqlServerBaseConnector):
    connector_type = "azure_fabric"
    display_name = "Microsoft Fabric Warehouse"
