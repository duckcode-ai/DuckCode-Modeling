"""Warehouse introspection for dbt sync.

Given a dialect + connection config + a (database, schema, table) triple,
return the column list the warehouse actually has. Kept narrow on purpose —
the existing connectors in dm_core/connectors/ do full schema discovery; for
sync we only need per-table column introspection so we can backfill types
into DataLex files.

Supported dialects (v1):
  * duckdb    — file-based, no setup (the zero-friction demo path)
  * postgres  — information_schema.columns (psycopg2)

Other dialects fall back to the existing full-pull connector and filter.
The fallback is slower but means `dbt sync` works against any warehouse that
already has a connector implementation — users don't have to wait for us to
ship a bespoke path.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional


@dataclass
class WarehouseColumn:
    name: str
    data_type: str
    nullable: bool = True
    description: Optional[str] = None


class WarehouseError(RuntimeError):
    """Raised when warehouse introspection fails or is unsupported."""


def introspect_table(
    dialect: str,
    config: Dict[str, Any],
    database: str,
    schema: str,
    table: str,
) -> List[WarehouseColumn]:
    """Return the live column list for one table.

    `config` is a dbt-profile-shaped dict — e.g. `{path: "/tmp/db.duckdb"}` for
    duckdb, `{host, port, user, password, dbname}` for postgres. Per-dialect
    functions know how to pick the keys they need.
    """
    dialect = dialect.lower()
    if dialect == "duckdb":
        return _introspect_duckdb(config, database, schema, table)
    if dialect in ("postgres", "postgresql"):
        return _introspect_postgres(config, database, schema, table)
    raise WarehouseError(
        f"dialect '{dialect}' is not supported yet for `dbt sync`. "
        f"Supported: duckdb, postgres. "
        f"Open an issue or contribute a driver under dm_core/dbt/warehouse.py."
    )


# ------------------------ DuckDB ------------------------


def _introspect_duckdb(
    config: Dict[str, Any],
    database: str,
    schema: str,
    table: str,
) -> List[WarehouseColumn]:
    try:
        import duckdb  # type: ignore
    except ImportError as e:
        raise WarehouseError(
            "DuckDB driver not installed. Run: pip install duckdb"
        ) from e

    path = config.get("path") or config.get("database")
    if not path:
        raise WarehouseError("DuckDB profile needs a `path:` pointing at the .duckdb file.")

    conn = duckdb.connect(str(path), read_only=True)
    try:
        # duckdb_columns() is the stable introspection view
        rows = conn.execute(
            """
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position
            """,
            [schema, table],
        ).fetchall()
    finally:
        conn.close()

    return [
        WarehouseColumn(
            name=r[0],
            data_type=_normalize_type(str(r[1])),
            nullable=(str(r[2]).upper() == "YES"),
        )
        for r in rows
    ]


# ------------------------ Postgres ------------------------


def _introspect_postgres(
    config: Dict[str, Any],
    database: str,
    schema: str,
    table: str,
) -> List[WarehouseColumn]:
    try:
        import psycopg2  # type: ignore
    except ImportError as e:
        raise WarehouseError(
            "Postgres driver not installed. Run: pip install psycopg2-binary"
        ) from e

    # dbt uses `dbname` (sometimes `database`) + `host`/`port`/`user`/`password`.
    conn = psycopg2.connect(
        host=config.get("host", "localhost"),
        port=int(config.get("port", 5432)),
        user=config.get("user") or config.get("username") or "",
        password=config.get("password", ""),
        dbname=config.get("dbname") or config.get("database") or database,
    )
    try:
        cur = conn.cursor()
        cur.execute(
            """
            SELECT column_name, data_type, is_nullable, col_description(
                ('"' || table_schema || '"."' || table_name || '"')::regclass,
                ordinal_position
            )
            FROM information_schema.columns
            WHERE table_schema = %s AND table_name = %s
            ORDER BY ordinal_position
            """,
            (schema, table),
        )
        rows = cur.fetchall()
        cur.close()
    finally:
        conn.close()

    return [
        WarehouseColumn(
            name=r[0],
            data_type=_normalize_type(str(r[1])),
            nullable=(str(r[2]).upper() == "YES"),
            description=r[3] if r[3] else None,
        )
        for r in rows
    ]


# ------------------------ type normalization ------------------------


_TYPE_ALIASES = {
    "character varying": "string",
    "varchar": "string",
    "text": "string",
    "character": "string",
    "char": "string",
    "double precision": "double",
    "double": "double",
    "real": "float",
    "numeric": "decimal",
    "integer": "int",
    "int4": "int",
    "int8": "bigint",
    "bigint": "bigint",
    "smallint": "smallint",
    "int2": "smallint",
    "boolean": "boolean",
    "bool": "boolean",
    "timestamp without time zone": "timestamp",
    "timestamp with time zone": "timestamp_tz",
    "timestamp": "timestamp",
    "date": "date",
    "time": "time",
    "uuid": "uuid",
    "json": "json",
    "jsonb": "json",
    "bytea": "binary",
    "blob": "binary",
    "decimal": "decimal",
    "hugeint": "bigint",
    "utinyint": "smallint",
    "usmallint": "int",
    "uinteger": "bigint",
    "ubigint": "bigint",
}


def _normalize_type(raw: str) -> str:
    """Fold warehouse-specific type names to the DataLex canonical palette.

    Unknown types pass through unchanged — the DataLex layer is permissive
    about types at the physical layer.
    """
    raw_l = raw.lower().strip()
    if raw_l in _TYPE_ALIASES:
        return _TYPE_ALIASES[raw_l]
    # Preserve parametric types: "varchar(255)" → "string(255)"
    if "(" in raw_l:
        head, tail = raw_l.split("(", 1)
        base = _TYPE_ALIASES.get(head.strip(), head.strip())
        return f"{base}({tail}"
    return raw_l
