"""SQL migration script generator.

Compares two model versions and produces ALTER TABLE / CREATE / DROP
statements that migrate the database schema from old to new.

Supports Postgres, Snowflake, BigQuery, and Databricks dialects.
"""

from typing import Any, Dict, List, Optional, Tuple

from dm_core.canonical import compile_model
from dm_core.generators import _qualified_name, _sql_type, _to_snake, _format_default, SUPPORTED_DIALECTS


def _index_entities(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {str(e.get("name", "")): e for e in model.get("entities", [])}


def _index_fields(entity: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {str(f.get("name", "")): f for f in entity.get("fields", [])}


def _index_indexes(model: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
    return {str(idx.get("name", "")): idx for idx in model.get("indexes", [])}


def _add_column_sql(
    entity: Dict[str, Any],
    field: Dict[str, Any],
    dialect: str,
) -> str:
    qualified = _qualified_name(entity, dialect)
    fname = str(field.get("name", ""))
    col_type = _sql_type(str(field.get("type", "string")), dialect)
    nullable = bool(field.get("nullable", True))

    parts = [f'ALTER TABLE {qualified} ADD COLUMN "{fname}" {col_type}']

    default_val = field.get("default")
    if "default" in field:
        formatted = _format_default(default_val, dialect)
        if formatted is not None:
            parts.append(f"DEFAULT {formatted}")

    if not nullable:
        parts.append("NOT NULL")

    return " ".join(parts) + ";"


def _drop_column_sql(
    entity: Dict[str, Any],
    field_name: str,
    dialect: str,
) -> str:
    qualified = _qualified_name(entity, dialect)
    return f'ALTER TABLE {qualified} DROP COLUMN "{field_name}";'


def _alter_column_type_sql(
    entity: Dict[str, Any],
    field_name: str,
    new_type: str,
    dialect: str,
) -> str:
    qualified = _qualified_name(entity, dialect)
    sql_type = _sql_type(new_type, dialect)
    if dialect == "bigquery":
        return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" SET DATA TYPE {sql_type};'
    return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" TYPE {sql_type};'


def _alter_column_nullable_sql(
    entity: Dict[str, Any],
    field_name: str,
    new_nullable: bool,
    dialect: str,
) -> str:
    qualified = _qualified_name(entity, dialect)
    if new_nullable:
        return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" DROP NOT NULL;'
    return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" SET NOT NULL;'


def _alter_column_default_sql(
    entity: Dict[str, Any],
    field_name: str,
    new_default: Any,
    has_default: bool,
    dialect: str,
) -> str:
    qualified = _qualified_name(entity, dialect)
    if not has_default:
        return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" DROP DEFAULT;'
    formatted = _format_default(new_default, dialect)
    return f'ALTER TABLE {qualified} ALTER COLUMN "{field_name}" SET DEFAULT {formatted};'


def _create_table_sql(entity: Dict[str, Any], dialect: str) -> str:
    qualified = _qualified_name(entity, dialect)
    fields = entity.get("fields", [])
    column_lines: List[str] = []
    pk_fields: List[str] = []

    for field in fields:
        if field.get("computed") is True:
            continue
        fname = str(field.get("name", ""))
        col_type = _sql_type(str(field.get("type", "string")), dialect)
        nullable = bool(field.get("nullable", True))
        unique = bool(field.get("unique", False))
        primary_key = bool(field.get("primary_key", False))

        parts = [f'  "{fname}"', col_type]

        default_val = field.get("default")
        if "default" in field:
            formatted = _format_default(default_val, dialect)
            if formatted is not None:
                parts.append(f"DEFAULT {formatted}")

        if not nullable:
            parts.append("NOT NULL")
        if unique:
            parts.append("UNIQUE")
        if primary_key:
            pk_fields.append(fname)

        column_lines.append(" ".join(parts))

    if pk_fields:
        pk_cols = ", ".join([f'"{c}"' for c in pk_fields])
        column_lines.append(f"  PRIMARY KEY ({pk_cols})")

    return f"CREATE TABLE {qualified} (\n" + ",\n".join(column_lines) + "\n);"


def _drop_table_sql(entity: Dict[str, Any], dialect: str) -> str:
    qualified = _qualified_name(entity, dialect)
    return f"DROP TABLE IF EXISTS {qualified};"


def _create_index_sql(idx: Dict[str, Any], entity_map: Dict[str, Dict[str, Any]], dialect: str) -> str:
    idx_name = str(idx.get("name", ""))
    idx_entity = str(idx.get("entity", ""))
    idx_fields = idx.get("fields", [])
    idx_unique = bool(idx.get("unique", False))
    entity_obj = entity_map.get(idx_entity, {"name": idx_entity})
    qualified = _qualified_name(entity_obj, dialect)
    cols = ", ".join([f'"{f}"' for f in idx_fields])
    unique_kw = "UNIQUE " if idx_unique else ""
    return f'CREATE {unique_kw}INDEX "{idx_name}" ON {qualified} ({cols});'


def _drop_index_sql(idx_name: str, dialect: str) -> str:
    if dialect == "snowflake":
        return f'DROP INDEX IF EXISTS "{idx_name}";'
    return f'DROP INDEX IF EXISTS "{idx_name}";'


def generate_migration(
    old_model: Dict[str, Any],
    new_model: Dict[str, Any],
    dialect: str = "postgres",
) -> str:
    """Generate SQL migration script from old_model to new_model.

    Returns a string of SQL statements that, when executed, transform the
    database schema from the old model state to the new model state.
    """
    dialect = dialect.lower()
    if dialect not in SUPPORTED_DIALECTS:
        raise ValueError(f"Unsupported dialect: {dialect}")

    old_canonical = compile_model(old_model)
    new_canonical = compile_model(new_model)

    old_entities = _index_entities(old_canonical)
    new_entities = _index_entities(new_canonical)

    old_indexes = _index_indexes(old_canonical)
    new_indexes = _index_indexes(new_canonical)

    statements: List[str] = []
    comments: List[str] = []

    old_version = old_model.get("model", {}).get("version", "?")
    new_version = new_model.get("model", {}).get("version", "?")
    model_name = new_model.get("model", {}).get("name", "unknown")

    statements.append(f"-- Migration: {model_name} v{old_version} -> v{new_version}")
    statements.append(f"-- Dialect: {dialect}")
    statements.append(f"-- Generated by DataLex dm migrate")
    statements.append("")

    # --- Dropped entities ---
    removed_entity_names = sorted(set(old_entities.keys()) - set(new_entities.keys()))
    drop_stmts: List[str] = []
    for name in removed_entity_names:
        entity = old_entities[name]
        entity_type = str(entity.get("type", "table"))
        if entity_type in ("view", "materialized_view", "external_table", "snapshot"):
            continue
        drop_stmts.append(_drop_table_sql(entity, dialect))
    if drop_stmts:
        statements.append("-- ========== DROP TABLES ==========")
        statements.extend(drop_stmts)

    # --- New entities ---
    added_entity_names = sorted(set(new_entities.keys()) - set(old_entities.keys()))
    create_stmts: List[str] = []
    for name in added_entity_names:
        entity = new_entities[name]
        entity_type = str(entity.get("type", "table"))
        if entity_type in ("view", "materialized_view", "external_table", "snapshot"):
            continue
        create_stmts.append(_create_table_sql(entity, dialect))
    if create_stmts:
        statements.append("")
        statements.append("-- ========== CREATE TABLES ==========")
        statements.extend(create_stmts)

    # --- Altered entities ---
    common_entity_names = sorted(set(old_entities.keys()) & set(new_entities.keys()))
    alter_statements: List[str] = []

    for name in common_entity_names:
        old_entity = old_entities[name]
        new_entity = new_entities[name]
        entity_type = str(new_entity.get("type", "table"))
        if entity_type in ("view", "materialized_view", "external_table", "snapshot"):
            continue

        old_fields = _index_fields(old_entity)
        new_fields = _index_fields(new_entity)

        entity_alters: List[str] = []

        # Added fields
        for fname in sorted(set(new_fields.keys()) - set(old_fields.keys())):
            field = new_fields[fname]
            if field.get("computed") is True:
                continue
            entity_alters.append(_add_column_sql(new_entity, field, dialect))

        # Removed fields
        for fname in sorted(set(old_fields.keys()) - set(new_fields.keys())):
            entity_alters.append(_drop_column_sql(new_entity, fname, dialect))

        # Changed fields
        for fname in sorted(set(old_fields.keys()) & set(new_fields.keys())):
            old_f = old_fields[fname]
            new_f = new_fields[fname]

            if old_f.get("computed") is True or new_f.get("computed") is True:
                continue

            old_type = str(old_f.get("type", "string"))
            new_type = str(new_f.get("type", "string"))
            if old_type != new_type:
                entity_alters.append(_alter_column_type_sql(new_entity, fname, new_type, dialect))

            old_nullable = bool(old_f.get("nullable", True))
            new_nullable = bool(new_f.get("nullable", True))
            if old_nullable != new_nullable:
                entity_alters.append(_alter_column_nullable_sql(new_entity, fname, new_nullable, dialect))

            old_has_default = "default" in old_f
            new_has_default = "default" in new_f
            old_default = old_f.get("default")
            new_default = new_f.get("default")
            if old_has_default != new_has_default or old_default != new_default:
                entity_alters.append(_alter_column_default_sql(new_entity, fname, new_default, new_has_default, dialect))

        if entity_alters:
            alter_statements.append(f"-- Alter: {name}")
            alter_statements.extend(entity_alters)

    if alter_statements:
        statements.append("")
        statements.append("-- ========== ALTER TABLES ==========")
        statements.extend(alter_statements)

    # --- Indexes ---
    if dialect == "bigquery":
        pass  # BigQuery doesn't support CREATE INDEX
    else:
        removed_idx_names = sorted(set(old_indexes.keys()) - set(new_indexes.keys()))
        added_idx_names = sorted(set(new_indexes.keys()) - set(old_indexes.keys()))

        idx_statements: List[str] = []
        for idx_name in removed_idx_names:
            idx_statements.append(_drop_index_sql(idx_name, dialect))
        for idx_name in added_idx_names:
            idx_statements.append(_create_index_sql(new_indexes[idx_name], new_entities, dialect))

        if idx_statements:
            statements.append("")
            statements.append("-- ========== INDEXES ==========")
            statements.extend(idx_statements)

    return "\n".join(statements) + "\n"


def write_migration(
    old_model: Dict[str, Any],
    new_model: Dict[str, Any],
    out_path: str,
    dialect: str = "postgres",
) -> str:
    """Generate and write migration SQL to a file. Returns the path."""
    from pathlib import Path
    sql = generate_migration(old_model, new_model, dialect=dialect)
    Path(out_path).parent.mkdir(parents=True, exist_ok=True)
    Path(out_path).write_text(sql, encoding="utf-8")
    return out_path
