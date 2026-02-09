from pathlib import Path
from typing import Any, Dict, List, Tuple


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
    }

    mapping = mapping_postgres if dialect == "postgres" else mapping_snowflake
    return mapping.get(value, field_type)


def generate_sql_ddl(model: Dict[str, Any], dialect: str = "postgres") -> str:
    dialect = dialect.lower()
    if dialect not in {"postgres", "snowflake"}:
        raise ValueError("Unsupported SQL dialect. Use 'postgres' or 'snowflake'.")

    entities = model.get("entities", [])
    relationships = model.get("relationships", [])

    create_blocks: List[str] = []
    alter_blocks: List[str] = []

    for entity in entities:
        if entity.get("type") != "table":
            continue

        entity_name = str(entity.get("name", ""))
        table_name = _to_snake(entity_name)
        fields = entity.get("fields", [])

        column_lines: List[str] = []
        pk_fields: List[str] = []

        for field in fields:
            field_name = str(field.get("name", ""))
            col_type = _sql_type(str(field.get("type", "string")), dialect)
            nullable = bool(field.get("nullable", True))
            unique = bool(field.get("unique", False))
            primary_key = bool(field.get("primary_key", False))

            parts = [f'"{field_name}"', col_type]
            if not nullable:
                parts.append("NOT NULL")
            if unique:
                parts.append("UNIQUE")
            if primary_key:
                pk_fields.append(field_name)

            column_lines.append("  " + " ".join(parts))

        if pk_fields:
            pk_cols = ", ".join([f'"{col}"' for col in pk_fields])
            column_lines.append(f"  PRIMARY KEY ({pk_cols})")

        create_sql = f'CREATE TABLE "{table_name}" (\n' + ",\n".join(column_lines) + "\n);"
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
        child_table = _to_snake(child_entity)
        parent_table = _to_snake(parent_entity)
        alter_sql = (
            f'ALTER TABLE "{child_table}" '
            f'ADD CONSTRAINT "{constraint}" FOREIGN KEY ("{child_field}") '
            f'REFERENCES "{parent_table}" ("{parent_field}");'
        )
        alter_blocks.append(alter_sql)

    blocks = create_blocks + alter_blocks
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
        schema_lines.append("    columns:")
        for field in fields:
            field_name = str(field.get("name", ""))
            schema_lines.append(f"      - name: {field_name}")
            description = str(field.get("description", "")).strip() or f"Field {field_name}"
            schema_lines.append(f"        description: \"{description}\"")
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
