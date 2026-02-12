"""Snowflake connector — pulls schema from information_schema."""

from __future__ import annotations

import os
import warnings
warnings.filterwarnings("ignore", message=".*incompatible version of 'pyarrow'.*")

from datetime import date
from typing import Any, Dict, List, Tuple

from dm_core.connectors.base import BaseConnector, ConnectorConfig, ConnectorResult, infer_primary_keys, infer_relationships


def _load_private_key(path: str, passphrase: str | None = None) -> bytes:
    """Load an RSA private key from a PEM file and return DER bytes for Snowflake.

    Handles header/content mismatches (e.g. 'ENCRYPTED PRIVATE KEY' header
    with an unencrypted key body) by trying multiple parsing strategies.
    """
    from cryptography.hazmat.backends import default_backend
    from cryptography.hazmat.primitives import serialization

    with open(os.path.expanduser(path), "rb") as f:
        pem_data = f.read()

    pw = passphrase.encode() if passphrase else None

    # Strategy 1: try as-is with provided passphrase
    # Strategy 2: try without passphrase (header may say ENCRYPTED but body isn't)
    # Strategy 3: fix header to match actual content and retry
    attempts = [
        (pem_data, pw),
        (pem_data, None),
    ]

    # If header says ENCRYPTED but no passphrase, also try fixing the header
    text = pem_data.decode("utf-8", errors="replace")
    if "ENCRYPTED PRIVATE KEY" in text:
        fixed = text.replace(
            "BEGIN ENCRYPTED PRIVATE KEY", "BEGIN PRIVATE KEY"
        ).replace(
            "END ENCRYPTED PRIVATE KEY", "END PRIVATE KEY"
        ).encode("utf-8")
        attempts.append((fixed, None))

    last_err = None
    for data, password in attempts:
        try:
            private_key = serialization.load_pem_private_key(
                data, password=password, backend=default_backend(),
            )
            return private_key.private_bytes(
                encoding=serialization.Encoding.DER,
                format=serialization.PrivateFormat.PKCS8,
                encryption_algorithm=serialization.NoEncryption(),
            )
        except Exception as e:
            last_err = e
            continue

    raise last_err  # type: ignore[misc]


_SF_TYPE_MAP = {
    "NUMBER": "decimal",
    "DECIMAL": "decimal",
    "NUMERIC": "decimal",
    "INT": "integer",
    "INTEGER": "integer",
    "BIGINT": "bigint",
    "SMALLINT": "smallint",
    "TINYINT": "tinyint",
    "BYTEINT": "tinyint",
    "FLOAT": "float",
    "FLOAT4": "float",
    "FLOAT8": "float",
    "DOUBLE": "float",
    "DOUBLE PRECISION": "float",
    "REAL": "float",
    "VARCHAR": "string",
    "CHAR": "string",
    "CHARACTER": "string",
    "STRING": "string",
    "TEXT": "text",
    "BINARY": "binary",
    "VARBINARY": "binary",
    "BOOLEAN": "boolean",
    "DATE": "date",
    "DATETIME": "timestamp",
    "TIME": "time",
    "TIMESTAMP": "timestamp",
    "TIMESTAMP_LTZ": "timestamp",
    "TIMESTAMP_NTZ": "timestamp",
    "TIMESTAMP_TZ": "timestamp",
    "VARIANT": "json",
    "OBJECT": "json",
    "ARRAY": "json",
    "GEOGRAPHY": "string",
    "GEOMETRY": "string",
}


class SnowflakeConnector(BaseConnector):
    connector_type = "snowflake"
    display_name = "Snowflake"
    required_package = "snowflake.connector"

    def _build_connect_params(self, config: ConnectorConfig) -> Dict[str, Any]:
        """Build connection kwargs, using RSA key-pair auth when private_key_path is set."""
        params: Dict[str, Any] = {
            "account": config.host,
            "user": config.user,
            "warehouse": config.warehouse,
            "database": config.database,
            "schema": config.schema or "PUBLIC",
        }
        if config.private_key_path:
            # Use password as the optional passphrase for the key file
            passphrase = config.password if config.password else None
            params["private_key"] = _load_private_key(config.private_key_path, passphrase)
        else:
            params["password"] = config.password
        return params

    def test_connection(self, config: ConnectorConfig) -> Tuple[bool, str]:
        try:
            import snowflake.connector
            conn = snowflake.connector.connect(**self._build_connect_params(config))
            conn.close()
            return True, "Connection successful"
        except ImportError:
            return False, "snowflake-connector-python not installed. Run: pip install snowflake-connector-python"
        except FileNotFoundError:
            return False, f"Private key file not found: {config.private_key_path}"
        except Exception as e:
            return False, f"Connection failed: {e}"

    def _connect(self, config: ConnectorConfig):
        import snowflake.connector
        conn = snowflake.connector.connect(**self._build_connect_params(config))
        # Auto-resume the warehouse if it is suspended
        if config.warehouse:
            try:
                conn.cursor().execute(f"ALTER WAREHOUSE IF EXISTS {config.warehouse} RESUME IF SUSPENDED")
            except Exception:
                pass  # permission denied or warehouse doesn't exist — let the main query surface the error
        return conn

    def list_schemas(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute(f"SHOW SCHEMAS IN DATABASE {config.database}")
            rows = cur.fetchall()
            results = []
            for row in rows:
                schema_name = row[1]  # name is second column in SHOW SCHEMAS
                if schema_name.upper() in ("INFORMATION_SCHEMA",):
                    continue
                # Count tables in this schema
                try:
                    cur.execute(f"SELECT COUNT(*) FROM {config.database}.INFORMATION_SCHEMA.TABLES WHERE TABLE_SCHEMA = %s", (schema_name,))
                    count = cur.fetchone()[0]
                except Exception:
                    count = 0
                results.append({"name": schema_name, "table_count": count})
            return results
        finally:
            conn.close()

    def list_tables(self, config: ConnectorConfig) -> List[Dict[str, Any]]:
        schema = config.schema or "PUBLIC"
        conn = self._connect(config)
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT TABLE_NAME, TABLE_TYPE,
                       (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS c
                        WHERE c.TABLE_SCHEMA = t.TABLE_SCHEMA AND c.TABLE_NAME = t.TABLE_NAME) AS COL_COUNT,
                       ROW_COUNT
                FROM INFORMATION_SCHEMA.TABLES t
                WHERE TABLE_SCHEMA = %s
                ORDER BY TABLE_NAME
            """, (schema.upper(),))
            results = []
            for row in cur.fetchall():
                ttype = "view" if "VIEW" in (row[1] or "").upper() else "table"
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
        schema_filter = (config.schema or "PUBLIC").upper()
        db_name = (config.database or "").upper()
        cur = conn.cursor()
        warnings: List[str] = []

        # --- Tables ---
        cur.execute(f"""
            SELECT TABLE_NAME, TABLE_TYPE
            FROM {db_name}.INFORMATION_SCHEMA.TABLES
            WHERE TABLE_SCHEMA = '{schema_filter}'
              AND TABLE_TYPE IN ('BASE TABLE', 'VIEW')
            ORDER BY TABLE_NAME
        """)
        tables = cur.fetchall()

        table_entities: Dict[str, Dict[str, Any]] = {}
        for table_name, table_type in tables:
            if not self._should_include_table(table_name, config):
                continue
            entity_name = self._entity_name(table_name)
            entity_type = "view" if table_type == "VIEW" else "table"
            table_entities[table_name] = {
                "name": entity_name,
                "type": entity_type,
                "description": f"Pulled from Snowflake {db_name}.{schema_filter}.{table_name} on {date.today().isoformat()}",
                "fields": [],
                "schema": schema_filter,
                "database": db_name,
            }

        # --- Columns ---
        cur.execute(f"""
            SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE,
                   COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH,
                   NUMERIC_PRECISION, NUMERIC_SCALE
            FROM {db_name}.INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_SCHEMA = '{schema_filter}'
            ORDER BY TABLE_NAME, ORDINAL_POSITION
        """)
        columns = cur.fetchall()
        total_columns = 0

        for row in columns:
            tname, col_name, data_type, is_nullable, col_default, char_max_len, num_prec, num_scale = row
            if tname not in table_entities:
                continue

            dl_type = _SF_TYPE_MAP.get(data_type.upper(), "string")
            if data_type.upper() in ("NUMBER", "DECIMAL", "NUMERIC") and num_prec:
                dl_type = f"decimal({num_prec},{num_scale or 0})"

            field: Dict[str, Any] = {
                "name": col_name.lower(),
                "type": dl_type,
                "nullable": is_nullable == "YES",
            }
            if col_default is not None:
                field["default"] = str(col_default)

            table_entities[tname]["fields"].append(field)
            total_columns += 1

        # --- Primary keys ---
        try:
            for tname in table_entities:
                cur.execute(f"SHOW PRIMARY KEYS IN TABLE {db_name}.{schema_filter}.{tname}")
                pk_rows = cur.fetchall()
                for pk_row in pk_rows:
                    pk_col = pk_row[4] if len(pk_row) > 4 else None
                    if pk_col:
                        for f in table_entities[tname]["fields"]:
                            if f["name"] == pk_col.lower():
                                f["primary_key"] = True
                                f["nullable"] = False
        except Exception as e:
            warnings.append(f"Could not fetch primary keys: {e}")

        # --- Foreign keys ---
        relationships: List[Dict[str, Any]] = []
        try:
            for tname in table_entities:
                cur.execute(f"SHOW IMPORTED KEYS IN TABLE {db_name}.{schema_filter}.{tname}")
                fk_rows = cur.fetchall()
                for fk_row in fk_rows:
                    parent_table = fk_row[2] if len(fk_row) > 2 else None
                    parent_col = fk_row[3] if len(fk_row) > 3 else None
                    child_col = fk_row[7] if len(fk_row) > 7 else None
                    fk_name = fk_row[11] if len(fk_row) > 11 else None
                    if parent_table and parent_col and child_col:
                        for f in table_entities[tname]["fields"]:
                            if f["name"] == child_col.lower():
                                f["foreign_key"] = True
                        parent_entity = self._entity_name(parent_table)
                        child_entity = self._entity_name(tname)
                        relationships.append({
                            "name": fk_name or f"{parent_entity.lower()}_{child_entity.lower()}_{child_col.lower()}_fk",
                            "from": f"{parent_entity}.{parent_col.lower()}",
                            "to": f"{child_entity}.{child_col.lower()}",
                            "cardinality": "one_to_many",
                        })
        except Exception as e:
            warnings.append(f"Could not fetch foreign keys: {e}")

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
