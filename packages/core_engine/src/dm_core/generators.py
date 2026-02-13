import re
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

SUPPORTED_DIALECTS = {"postgres", "snowflake", "bigquery", "databricks"}


def _to_snake(name: str) -> str:
    out: List[str] = []
    for idx, char in enumerate(name):
        if char.isupper() and idx > 0 and (not name[idx - 1].isupper()):
            out.append("_")
        out.append(char.lower())
    return "".join(out)


def _sql_type(field_type: str, dialect: str) -> str:
    value = field_type.strip().lower()
    if value.startswith("decimal"):
        return value.upper()

    mapping_postgres = {
        "string": "TEXT",
        "integer": "INTEGER",
        "bigint": "BIGINT",
        "boolean": "BOOLEAN",
        "date": "DATE",
        "timestamp": "TIMESTAMP",
        "float": "DOUBLE PRECISION",
        "json": "JSONB",
        "uuid": "UUID",
        "text": "TEXT",
        "binary": "BYTEA",
    }
    mapping_snowflake = {
        "string": "VARCHAR",
        "integer": "NUMBER",
        "bigint": "NUMBER",
        "boolean": "BOOLEAN",
        "date": "DATE",
        "timestamp": "TIMESTAMP_NTZ",
        "float": "FLOAT",
        "json": "VARIANT",
        "uuid": "VARCHAR",
        "text": "VARCHAR",
        "binary": "BINARY",
    }
    mapping_bigquery = {
        "string": "STRING",
        "integer": "INT64",
        "bigint": "INT64",
        "boolean": "BOOL",
        "date": "DATE",
        "timestamp": "TIMESTAMP",
        "float": "FLOAT64",
        "json": "JSON",
        "uuid": "STRING",
        "text": "STRING",
        "binary": "BYTES",
    }
    mapping_databricks = {
        "string": "STRING",
        "integer": "INT",
        "bigint": "BIGINT",
        "boolean": "BOOLEAN",
        "date": "DATE",
        "timestamp": "TIMESTAMP",
        "float": "DOUBLE",
        "json": "STRING",
        "uuid": "STRING",
        "text": "STRING",
        "binary": "BINARY",
    }

    mappings = {
        "postgres": mapping_postgres,
        "snowflake": mapping_snowflake,
        "bigquery": mapping_bigquery,
        "databricks": mapping_databricks,
    }
    mapping = mappings.get(dialect, mapping_postgres)
    return mapping.get(value, field_type)


def _qualified_name(entity: Dict[str, Any], dialect: str) -> str:
    physical_name = entity.get("physical_name") or entity.get("physicalName")
    inferred_physical = None
    if not physical_name:
        # Backward-compatible fallback: older connector pulls didn't store physical_name.
        # Try to recover the warehouse identifier from the standard "Pulled from ..." description.
        desc = str(entity.get("description") or "")
        m = re.search(r"Pulled from Snowflake [^\s.]+\.[^\s.]+\.([^\s]+) on ", desc)
        if m:
            inferred_physical = m.group(1)

    table_name = (
        str(physical_name or inferred_physical).strip()
        if (physical_name or inferred_physical)
        else _to_snake(str(entity.get("name", "")))
    )

    schema_name = entity.get("schema")
    database_name = entity.get("database")

    # Snowflake treats quoted identifiers as case-sensitive; prefer uppercase identifiers by default
    # so generated DDL matches warehouse naming conventions when physical_name isn't provided.
    if dialect == "snowflake" and not (physical_name or inferred_physical):
        table_name = table_name.upper()

    if dialect == "bigquery":
        parts = [p for p in [database_name, schema_name, table_name] if p]
        return ".".join([f"`{p}`" for p in parts])

    if database_name and schema_name:
        return f'"{database_name}"."{schema_name}"."{table_name}"'
    if schema_name:
        return f'"{schema_name}"."{table_name}"'
    return f'"{table_name}"'


def _format_default(value: Any, dialect: str) -> Optional[str]:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    return f"'{value}'"


def generate_sql_ddl(model: Dict[str, Any], dialect: str = "postgres") -> str:
    dialect = dialect.lower()
    if dialect not in SUPPORTED_DIALECTS:
        raise ValueError(f"Unsupported SQL dialect. Use one of: {', '.join(sorted(SUPPORTED_DIALECTS))}.")

    entities = model.get("entities", [])
    relationships = model.get("relationships", [])
    indexes = model.get("indexes", [])

    create_blocks: List[str] = []
    alter_blocks: List[str] = []
    index_blocks: List[str] = []

    entity_map = {str(e.get("name", "")): e for e in entities}

    for entity in entities:
        entity_type = entity.get("type", "table")
        entity_name = str(entity.get("name", ""))
        qualified = _qualified_name(entity, dialect)
        fields = entity.get("fields", [])

        if entity_type in ("view", "materialized_view"):
            keyword = "MATERIALIZED VIEW" if entity_type == "materialized_view" else "VIEW"
            col_list = ", ".join([f'NULL AS "{f.get("name")}"' for f in fields])
            create_blocks.append(f"CREATE {keyword} {qualified} AS\nSELECT {col_list};")
            continue

        if entity_type == "external_table":
            continue

        if entity_type == "snapshot":
            continue

        column_lines: List[str] = []
        pk_fields: List[str] = []
        check_constraints: List[str] = []

        for field in fields:
            if field.get("computed") is True:
                continue

            field_name = str(field.get("name", ""))
            col_type = _sql_type(str(field.get("type", "string")), dialect)
            nullable = bool(field.get("nullable", True))
            unique = bool(field.get("unique", False))
            primary_key = bool(field.get("primary_key", False))

            parts = [f'"{field_name}"', col_type]

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
                pk_fields.append(field_name)

            column_lines.append("  " + " ".join(parts))

            check_expr = field.get("check")
            if check_expr:
                constraint_name = f"chk_{_to_snake(entity_name)}_{field_name}"
                check_constraints.append(
                    f'  CONSTRAINT "{constraint_name}" CHECK ({check_expr})'
                )

        if pk_fields:
            pk_cols = ", ".join([f'"{col}"' for col in pk_fields])
            column_lines.append(f"  PRIMARY KEY ({pk_cols})")

        column_lines.extend(check_constraints)

        create_sql = f"CREATE TABLE {qualified} (\n" + ",\n".join(column_lines) + "\n);"
        create_blocks.append(create_sql)

    for rel in relationships:
        from_ref = str(rel.get("from", ""))
        to_ref = str(rel.get("to", ""))
        cardinality = str(rel.get("cardinality", "one_to_many"))
        rel_name = str(rel.get("name", "relationship"))

        if "." not in from_ref or "." not in to_ref:
            continue

        from_entity, from_field = from_ref.split(".", 1)
        to_entity, to_field = to_ref.split(".", 1)

        if cardinality == "one_to_many":
            parent_entity, parent_field = from_entity, from_field
            child_entity, child_field = to_entity, to_field
        elif cardinality == "many_to_one":
            parent_entity, parent_field = to_entity, to_field
            child_entity, child_field = from_entity, from_field
        elif cardinality == "one_to_one":
            parent_entity, parent_field = from_entity, from_field
            child_entity, child_field = to_entity, to_field
        else:
            continue

        constraint = f"fk_{_to_snake(rel_name)}"
        child_qualified = _qualified_name(entity_map.get(child_entity, {"name": child_entity}), dialect)
        parent_qualified = _qualified_name(entity_map.get(parent_entity, {"name": parent_entity}), dialect)

        if dialect == "bigquery":
            continue

        alter_sql = (
            f"ALTER TABLE {child_qualified} "
            f'ADD CONSTRAINT "{constraint}" FOREIGN KEY ("{child_field}") '
            f'REFERENCES {parent_qualified} ("{parent_field}");'
        )
        alter_blocks.append(alter_sql)

    for idx_def in indexes:
        idx_name = idx_def.get("name", "")
        idx_entity = idx_def.get("entity", "")
        idx_fields = idx_def.get("fields", [])
        idx_unique = idx_def.get("unique", False)

        entity_obj = entity_map.get(idx_entity, {"name": idx_entity})
        qualified = _qualified_name(entity_obj, dialect)
        cols = ", ".join([f'"{f}"' for f in idx_fields])
        unique_kw = "UNIQUE " if idx_unique else ""

        if dialect == "bigquery":
            continue

        index_blocks.append(
            f'CREATE {unique_kw}INDEX "{idx_name}" ON {qualified} ({cols});'
        )

    blocks = create_blocks + alter_blocks + index_blocks
    return "\n\n".join(blocks) + ("\n" if blocks else "")


def _dbt_source_table_name(entity_name: str) -> str:
    return _to_snake(entity_name)


def dbt_scaffold_files(
    model: Dict[str, Any],
    source_name: str = "raw",
    project_name: str = "data_modeling_mvp",
) -> List[Tuple[str, str]]:
    entities = model.get("entities", [])

    files: List[Tuple[str, str]] = []
    dbt_project = (
        f"name: {project_name}\n"
        "version: 1.0.0\n"
        "config-version: 2\n\n"
        "profile: default\n\n"
        "models:\n"
        f"  {project_name}:\n"
        "    staging:\n"
        "      +materialized: view\n"
    )
    files.append(("dbt_project.yml", dbt_project))

    schema_lines = ["version: 2", "", "models:"]

    for entity in entities:
        entity_name = str(entity.get("name", ""))
        table_name = _dbt_source_table_name(entity_name)
        model_name = f"stg_{table_name}"
        fields = entity.get("fields", [])

        sql = (
            f"select\n  "
            + ",\n  ".join([f'"{field.get("name")}"' for field in fields])
            + f"\nfrom {{{{ source('{source_name}', '{table_name}') }}}}\n"
        )
        files.append((f"models/staging/{model_name}.sql", sql))

        schema_lines.append(f"  - name: {model_name}")
        if entity.get("description"):
            schema_lines.append(f"    description: \"{entity.get('description')}\"")
        entity_meta: List[str] = []
        if entity.get("tags"):
            entity_meta.append(f"      tags: {entity['tags']}")
        if entity.get("owner"):
            entity_meta.append(f"      owner: \"{entity['owner']}\"")
        if entity.get("subject_area"):
            entity_meta.append(f"      subject_area: \"{entity['subject_area']}\"")
        if entity_meta:
            schema_lines.append("    meta:")
            schema_lines.extend(entity_meta)
        schema_lines.append("    columns:")
        for field in fields:
            field_name = str(field.get("name", ""))
            schema_lines.append(f"      - name: {field_name}")
            description = str(field.get("description", "")).strip() or f"Field {field_name}"
            schema_lines.append(f"        description: \"{description}\"")
            field_meta: List[str] = []
            if field.get("sensitivity"):
                field_meta.append(f"          sensitivity: \"{field['sensitivity']}\"")
            if field.get("tags"):
                field_meta.append(f"          tags: {field['tags']}")
            if field.get("deprecated"):
                field_meta.append("          deprecated: true")
            if field_meta:
                schema_lines.append("        meta:")
                schema_lines.extend(field_meta)
            tests: List[str] = []
            if field.get("primary_key"):
                tests.extend(["not_null", "unique"])
            elif field.get("nullable") is False:
                tests.append("not_null")
            if tests:
                schema_lines.append("        tests:")
                for test_name in tests:
                    schema_lines.append(f"          - {test_name}")

    files.append(("models/staging/schema.yml", "\n".join(schema_lines) + "\n"))

    source_schema = [
        "version: 2",
        "",
        "sources:",
        f"  - name: {source_name}",
        "    schema: public",
        "    tables:",
    ]
    for entity in entities:
        table_name = _dbt_source_table_name(str(entity.get("name", "")))
        source_schema.append(f"      - name: {table_name}")
    files.append(("models/sources.yml", "\n".join(source_schema) + "\n"))

    return files


def write_dbt_scaffold(
    model: Dict[str, Any],
    out_dir: str,
    source_name: str = "raw",
    project_name: str = "data_modeling_mvp",
) -> List[str]:
    root = Path(out_dir)
    root.mkdir(parents=True, exist_ok=True)

    created: List[str] = []
    for rel_path, content in dbt_scaffold_files(
        model=model, source_name=source_name, project_name=project_name
    ):
        target = root / rel_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")
        created.append(str(target))

    return created
