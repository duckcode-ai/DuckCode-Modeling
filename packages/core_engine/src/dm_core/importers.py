import json
import re
from datetime import date
from typing import Any, Dict, List, Optional, Tuple

import yaml


CREATE_TABLE_RE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)\s*\((.*?)\)\s*;",
    flags=re.IGNORECASE | re.DOTALL,
)
CREATE_VIEW_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?view\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)",
    flags=re.IGNORECASE,
)
CREATE_MVIEW_RE = re.compile(
    r"create\s+(?:or\s+replace\s+)?materialized\s+view\s+(?:if\s+not\s+exists\s+)?([\w\"\.\.]+)",
    flags=re.IGNORECASE,
)
CREATE_INDEX_RE = re.compile(
    r"create\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([\w\"]+)\s+on\s+([\w\"\.\.]+)\s*\(([^)]+)\)",
    flags=re.IGNORECASE,
)
TABLE_RE = re.compile(r"^\s*table\s+([\w\"]+)\s*\{\s*$", flags=re.IGNORECASE)
REF_RE = re.compile(r"^\s*ref\s*:\s*([\w]+)\.([\w]+)\s*([<>-]+)\s*([\w]+)\.([\w]+)", flags=re.IGNORECASE)
DBT_REF_RE = re.compile(r"ref\(\s*['\"]([^'\"]+)['\"]\s*\)", flags=re.IGNORECASE)
DBT_SOURCE_RE = re.compile(
    r"source\(\s*['\"]([^'\"]+)['\"]\s*,\s*['\"]([^'\"]+)['\"]\s*\)",
    flags=re.IGNORECASE,
)
DBT_SQL_REF_RE = re.compile(
    r"references\s+([A-Za-z0-9_\"\.]+)\s*\(\s*([A-Za-z0-9_\"]+)\s*\)",
    flags=re.IGNORECASE,
)


def _to_pascal(name: str) -> str:
    name = name.replace('"', "")
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _to_model_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_")
    cleaned = cleaned.lower()
    return cleaned or "imported_model"


def _to_snake(name: str) -> str:
    text = re.sub(r"[^A-Za-z0-9]+", "_", str(name or "").strip())
    text = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", text)
    text = re.sub(r"__+", "_", text).strip("_").lower()
    if not text:
        return ""
    if text[0].isdigit():
        text = f"f_{text}"
    return text


def _split_top_level(body: str) -> List[str]:
    parts: List[str] = []
    current: List[str] = []
    depth = 0
    in_single = False
    in_double = False

    for char in body:
        if char == "'" and not in_double:
            in_single = not in_single
        elif char == '"' and not in_single:
            in_double = not in_double
        elif not in_single and not in_double:
            if char == "(":
                depth += 1
            elif char == ")":
                depth = max(0, depth - 1)
            elif char == "," and depth == 0:
                parts.append("".join(current).strip())
                current = []
                continue
        current.append(char)

    if current:
        parts.append("".join(current).strip())
    return [part for part in parts if part]


def _default_model(model_name: str, domain: str, owners: List[str]) -> Dict[str, Any]:
    return {
        "model": {
            "name": _to_model_name(model_name),
            "version": "1.0.0",
            "domain": domain,
            "owners": owners,
            "state": "draft",
        },
        "entities": [],
        "relationships": [],
        "governance": {"classification": {}, "stewards": {}},
        "rules": [],
    }


def _parse_default_value(rest: str) -> Optional[str]:
    """Extract DEFAULT value from column definition tail."""
    m = re.search(r"default\s+('(?:[^']*)'|\S+)", rest, re.IGNORECASE)
    if m:
        val = m.group(1).strip("'")
        return val
    return None


def _parse_check_constraint(rest: str) -> Optional[str]:
    """Extract CHECK constraint expression from column definition tail."""
    m = re.search(r"check\s*\((.+?)\)", rest, re.IGNORECASE)
    if m:
        return m.group(1).strip()
    return None


def import_sql_ddl(
    ddl_text: str,
    model_name: str = "imported_sql_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    entity_fields: Dict[str, List[Dict[str, Any]]] = {}
    entity_meta: Dict[str, Dict[str, Any]] = {}
    primary_keys: Dict[str, List[str]] = {}
    relationships: List[Dict[str, Any]] = []
    indexes: List[Dict[str, Any]] = []

    # --- Parse CREATE TABLE ---
    for match in CREATE_TABLE_RE.finditer(ddl_text):
        table_token = match.group(1).strip()
        schema_name = ""
        parts = table_token.replace('"', '').split(".")
        if len(parts) >= 2:
            schema_name = parts[-2]
        table_raw = parts[-1]
        entity_name = _to_pascal(table_raw)
        entity_fields.setdefault(entity_name, [])
        primary_keys.setdefault(entity_name, [])
        if schema_name:
            entity_meta.setdefault(entity_name, {})["schema"] = schema_name

        body = match.group(2)
        for definition in _split_top_level(body):
            lowered = definition.lower()
            if lowered.startswith("primary key"):
                cols_match = re.search(r"\((.*?)\)", definition)
                if cols_match:
                    cols = [col.strip().replace('"', "") for col in cols_match.group(1).split(",")]
                    primary_keys[entity_name].extend(cols)
                continue

            if lowered.startswith("foreign key"):
                fk_match = re.search(
                    r"foreign\s+key\s*\((.*?)\)\s+references\s+([\w\"\.\.]+)\s*\((.*?)\)",
                    definition,
                    flags=re.IGNORECASE,
                )
                if fk_match:
                    local_field = fk_match.group(1).strip().replace('"', "")
                    ref_table = fk_match.group(2).strip().split(".")[-1].replace('"', "")
                    ref_field = fk_match.group(3).strip().replace('"', "")
                    parent_entity = _to_pascal(ref_table)
                    child_entity = entity_name
                    relationships.append(
                        {
                            "name": f"{parent_entity.lower()}_{child_entity.lower()}_{local_field}_fk",
                            "from": f"{parent_entity}.{ref_field}",
                            "to": f"{child_entity}.{local_field}",
                            "cardinality": "one_to_many",
                        }
                    )
                continue

            # Table-level CHECK constraint
            if lowered.startswith("check") or (lowered.startswith("constraint") and "check" in lowered):
                continue

            col_match = re.match(r"^\s*\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+([^\s,]+(?:\([^)]*\))?)(.*)$", definition)
            if not col_match:
                continue

            col_name = col_match.group(1)
            col_type = col_match.group(2)
            rest = col_match.group(3)
            rest_lower = rest.lower()

            field: Dict[str, Any] = {
                "name": col_name,
                "type": col_type.lower(),
                "nullable": "not null" not in rest_lower,
            }
            if "primary key" in rest_lower:
                field["primary_key"] = True
            if "unique" in rest_lower:
                field["unique"] = True

            default_val = _parse_default_value(rest)
            if default_val is not None:
                field["default"] = default_val

            check_expr = _parse_check_constraint(rest)
            if check_expr:
                field["check"] = check_expr

            ref_match = re.search(
                r"references\s+([\w\"\.\.]+)\s*\((.*?)\)",
                rest,
                flags=re.IGNORECASE,
            )
            if ref_match:
                ref_table = ref_match.group(1).strip().split(".")[-1].replace('"', "")
                ref_field = ref_match.group(2).strip().replace('"', "")
                parent_entity = _to_pascal(ref_table)
                child_entity = entity_name
                field["foreign_key"] = True
                relationships.append(
                    {
                        "name": f"{parent_entity.lower()}_{child_entity.lower()}_{col_name}_fk",
                        "from": f"{parent_entity}.{ref_field}",
                        "to": f"{child_entity}.{col_name}",
                        "cardinality": "one_to_many",
                    }
                )

            entity_fields[entity_name].append(field)

    # --- Parse CREATE VIEW / CREATE MATERIALIZED VIEW ---
    for m in CREATE_MVIEW_RE.finditer(ddl_text):
        view_token = m.group(1).strip().replace('"', '').split(".")[-1]
        ename = _to_pascal(view_token)
        if ename not in entity_fields:
            entity_fields[ename] = []
            entity_meta.setdefault(ename, {})["type"] = "materialized_view"

    for m in CREATE_VIEW_RE.finditer(ddl_text):
        view_token = m.group(1).strip().replace('"', '').split(".")[-1]
        ename = _to_pascal(view_token)
        # Don't overwrite materialized_view
        if ename not in entity_fields:
            entity_fields[ename] = []
            entity_meta.setdefault(ename, {})["type"] = "view"

    # --- Parse CREATE INDEX ---
    for m in CREATE_INDEX_RE.finditer(ddl_text):
        idx_name = m.group(1).strip().replace('"', '')
        idx_table = m.group(2).strip().replace('"', '').split(".")[-1]
        idx_cols = [c.strip().replace('"', '') for c in m.group(3).split(",")]
        # Check for UNIQUE by looking at the full matched statement prefix
        stmt_prefix = ddl_text[max(0, m.start()-50):m.start() + 30].lower()
        is_unique = bool(re.search(r"create\s+unique\s+index", stmt_prefix, re.IGNORECASE))
        idx_entity = _to_pascal(idx_table)
        indexes.append({
            "name": idx_name,
            "entity": idx_entity,
            "fields": idx_cols,
            "unique": is_unique,
        })

    # --- Build entities ---
    for entity_name, fields in sorted(entity_fields.items()):
        pk_set = {value for value in primary_keys.get(entity_name, []) if value}
        for field in fields:
            if field["name"] in pk_set:
                field["primary_key"] = True
                field["nullable"] = False

        meta = entity_meta.get(entity_name, {})
        entity: Dict[str, Any] = {
            "name": entity_name,
            "type": meta.get("type", "table"),
            "description": f"Imported from SQL on {date.today().isoformat()}",
            "fields": fields,
        }
        if meta.get("schema"):
            entity["schema"] = meta["schema"]
        model["entities"].append(entity)

    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for rel in relationships:
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel
    model["relationships"] = sorted(deduped.values(), key=lambda x: x["name"])

    if indexes:
        model["indexes"] = indexes

    return model


def import_dbml(
    dbml_text: str,
    model_name: str = "imported_dbml_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    entities: Dict[str, Dict[str, Any]] = {}
    current_entity: str = ""

    for raw_line in dbml_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith("//"):
            continue

        table_match = TABLE_RE.match(line)
        if table_match:
            table_name = table_match.group(1).replace('"', "")
            current_entity = _to_pascal(table_name)
            entities[current_entity] = {
                "name": current_entity,
                "type": "table",
                "description": f"Imported from DBML on {date.today().isoformat()}",
                "fields": [],
            }
            continue

        if line == "}":
            current_entity = ""
            continue

        ref_match = REF_RE.match(line)
        if ref_match:
            left_table = _to_pascal(ref_match.group(1))
            left_field = ref_match.group(2)
            direction = ref_match.group(3)
            right_table = _to_pascal(ref_match.group(4))
            right_field = ref_match.group(5)

            if ">" in direction:
                parent_table, parent_field = right_table, right_field
                child_table, child_field = left_table, left_field
            else:
                parent_table, parent_field = left_table, left_field
                child_table, child_field = right_table, right_field

            model["relationships"].append(
                {
                    "name": f"{parent_table.lower()}_{child_table.lower()}_{child_field}_fk",
                    "from": f"{parent_table}.{parent_field}",
                    "to": f"{child_table}.{child_field}",
                    "cardinality": "one_to_many",
                }
            )
            continue

        if current_entity:
            # Example: user_id integer [pk, not null, unique]
            field_match = re.match(
                r"^([A-Za-z_][A-Za-z0-9_]*)\s+([^\s\[]+)(?:\s*\[(.*?)\])?$",
                line,
            )
            if not field_match:
                continue

            field_name = field_match.group(1)
            field_type = field_match.group(2).lower()
            attrs = (field_match.group(3) or "").lower()

            field = {
                "name": field_name,
                "type": field_type,
                "nullable": "not null" not in attrs,
            }
            if "pk" in attrs:
                field["primary_key"] = True
                field["nullable"] = False
            if "unique" in attrs:
                field["unique"] = True
            entities[current_entity]["fields"].append(field)

    model["entities"] = sorted(entities.values(), key=lambda x: x["name"])

    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for rel in model["relationships"]:
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel
    model["relationships"] = sorted(deduped.values(), key=lambda x: x["name"])

    return model


# ---------------------------------------------------------------------------
# Spark schema importer (JSON struct type files)
# ---------------------------------------------------------------------------

_SPARK_TYPE_MAP = {
    "string": "string",
    "integer": "integer",
    "int": "integer",
    "long": "bigint",
    "bigint": "bigint",
    "short": "smallint",
    "smallint": "smallint",
    "byte": "tinyint",
    "tinyint": "tinyint",
    "float": "float",
    "double": "float",
    "boolean": "boolean",
    "binary": "binary",
    "date": "date",
    "timestamp": "timestamp",
    "timestamp_ntz": "timestamp",
    "void": "string",
}


def _spark_field_type(spark_type: Any) -> str:
    """Map a Spark schema type to a DataLex field type."""
    if isinstance(spark_type, str):
        lower = spark_type.lower()
        if lower.startswith("decimal"):
            return lower
        if lower.startswith("varchar") or lower.startswith("char"):
            return "string"
        if lower.startswith("array") or lower.startswith("map") or lower.startswith("struct"):
            return "json"
        return _SPARK_TYPE_MAP.get(lower, "string")
    if isinstance(spark_type, dict):
        type_name = spark_type.get("type", "string")
        if isinstance(type_name, str):
            lower = type_name.lower()
            if lower == "struct":
                return "json"
            if lower == "array":
                return "json"
            if lower == "map":
                return "json"
            if lower == "udt":
                return "json"
            return _SPARK_TYPE_MAP.get(lower, "string")
        return "json"
    return "string"


def import_spark_schema(
    schema_text: str,
    model_name: str = "imported_spark_schema",
    domain: str = "imported",
    owners: List[str] = None,
    table_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Import a Spark schema JSON file into a DataLex model.

    Supports:
    - Single StructType schema (from df.schema.json() or DESCRIBE TABLE output)
    - Array of named table schemas [{name: "...", schema: {...}}, ...]
    - Databricks catalog export format with table_name + columns
    """
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    schema = json.loads(schema_text)

    tables_to_process: List[Tuple[str, Dict[str, Any]]] = []

    if isinstance(schema, list):
        # Array of table schemas
        for idx, item in enumerate(schema):
            if isinstance(item, dict):
                name = item.get("name") or item.get("table_name") or f"table_{idx}"
                inner = item.get("schema") or item.get("columns") or item
                tables_to_process.append((name, inner))
    elif isinstance(schema, dict):
        if schema.get("type") == "struct" and "fields" in schema:
            # Single StructType
            name = table_name or model_name
            tables_to_process.append((name, schema))
        elif "columns" in schema:
            # Databricks-style: {table_name: "...", columns: [...]}
            name = schema.get("table_name") or schema.get("name") or table_name or model_name
            tables_to_process.append((name, schema))
        elif "fields" in schema:
            name = table_name or model_name
            tables_to_process.append((name, schema))

    for tbl_name, tbl_schema in tables_to_process:
        entity_name = _to_pascal(tbl_name)

        # Extract fields from StructType or columns array
        raw_fields = []
        if isinstance(tbl_schema, dict):
            if "fields" in tbl_schema:
                raw_fields = tbl_schema["fields"]
            elif "columns" in tbl_schema:
                raw_fields = tbl_schema["columns"]
        elif isinstance(tbl_schema, list):
            raw_fields = tbl_schema

        fields: List[Dict[str, Any]] = []
        for raw_field in raw_fields:
            if not isinstance(raw_field, dict):
                continue

            fname = raw_field.get("name", "")
            if not fname:
                continue

            ftype_raw = raw_field.get("type", raw_field.get("data_type", "string"))
            ftype = _spark_field_type(ftype_raw)
            nullable = raw_field.get("nullable", True)

            field: Dict[str, Any] = {
                "name": fname,
                "type": ftype,
                "nullable": bool(nullable),
            }

            metadata = raw_field.get("metadata", {})
            if isinstance(metadata, dict):
                if metadata.get("comment"):
                    field["description"] = metadata["comment"]
                if metadata.get("sensitivity"):
                    field["sensitivity"] = metadata["sensitivity"]

            if raw_field.get("comment"):
                field["description"] = raw_field["comment"]

            fields.append(field)

        entity: Dict[str, Any] = {
            "name": entity_name,
            "type": "table",
            "description": f"Imported from Spark schema on {date.today().isoformat()}",
            "fields": fields,
        }
        model["entities"].append(entity)

    return model


# ---------------------------------------------------------------------------
# dbt schema.yml importer
# ---------------------------------------------------------------------------

def _dbt_parse_to_entity(to_expr: Any) -> Optional[str]:
    if not isinstance(to_expr, str):
        return None
    text = to_expr.strip()
    if not text:
        return None

    ref_match = DBT_REF_RE.search(text)
    if ref_match:
        return _to_pascal(ref_match.group(1))

    source_match = DBT_SOURCE_RE.search(text)
    if source_match:
        return _to_pascal(source_match.group(2))

    token = text.split(".")[-1].strip().strip("'\"")
    return _to_pascal(token) if token else None


def _as_test_list(tests: Any) -> List[Any]:
    if tests is None:
        return []
    if isinstance(tests, list):
        return tests
    return [tests]


def _as_constraint_list(constraints: Any) -> List[Any]:
    if constraints is None:
        return []
    if isinstance(constraints, list):
        return constraints
    return [constraints]


def _dbt_constraint_target(constraint: Dict[str, Any]) -> Tuple[Optional[str], Optional[str]]:
    to_expr = constraint.get("to") or constraint.get("references")
    target_entity = _dbt_parse_to_entity(to_expr)
    target_field = _to_snake(str(constraint.get("field") or "").strip())
    if target_entity and target_field:
        return target_entity, target_field

    expr = str(constraint.get("expression") or constraint.get("references") or "").strip()
    if not expr:
        return None, None
    m = DBT_SQL_REF_RE.search(expr)
    if not m:
        return None, None
    entity_token = m.group(1).replace('"', "").split(".")[-1]
    field_token = _to_snake(m.group(2).replace('"', "").strip())
    return (_to_pascal(entity_token) if entity_token else None), (field_token or None)


def _ensure_field(entity: Dict[str, Any], field_name: str) -> None:
    field_name = _to_snake(field_name)
    if not field_name:
        return
    fields = entity.setdefault("fields", [])
    if any(str(f.get("name", "")) == field_name for f in fields):
        return
    fields.append(
        {
            "name": field_name,
            "type": "string",
            "nullable": True,
            "description": "Inferred from dbt relationships test",
        }
    )


def _upsert_field(entity: Dict[str, Any], field: Dict[str, Any]) -> None:
    fields = entity.setdefault("fields", [])
    name = str(field.get("name", ""))
    if not name:
        return
    existing = next((f for f in fields if str(f.get("name", "")) == name), None)
    if existing is None:
        fields.append(field)
        return

    if field.get("type") and (not existing.get("type") or existing.get("type") == "string"):
        existing["type"] = field["type"]
    if field.get("description") and not existing.get("description"):
        existing["description"] = field["description"]
    if field.get("nullable") is False:
        existing["nullable"] = False
    if field.get("unique"):
        existing["unique"] = True
    if field.get("primary_key"):
        existing["primary_key"] = True
    if field.get("foreign_key"):
        existing["foreign_key"] = True


def import_dbt_schema_yml(
    schema_yml_text: str,
    model_name: str = "imported_dbt_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    loaded = yaml.safe_load(schema_yml_text) or {}
    if not isinstance(loaded, dict):
        return model

    entities_by_name: Dict[str, Dict[str, Any]] = {}
    relationship_candidates: List[Dict[str, str]] = []

    def get_or_create_entity(
        raw_name: str,
        entity_type: str,
        description: str = "",
        tags: Optional[List[str]] = None,
        schema_name: str = "",
        subject_area: str = "",
    ) -> Dict[str, Any]:
        entity_name = _to_pascal(raw_name)
        if entity_name in entities_by_name:
            existing = entities_by_name[entity_name]
            if description and not existing.get("description"):
                existing["description"] = description
            if schema_name and not existing.get("schema"):
                existing["schema"] = schema_name
            if subject_area and not existing.get("subject_area"):
                existing["subject_area"] = subject_area
            if tags:
                merged = set(existing.get("tags", []))
                merged.update(str(t) for t in tags if t)
                existing["tags"] = sorted(merged)
            return existing

        entity: Dict[str, Any] = {
            "name": entity_name,
            "type": entity_type,
            "description": description or f"Imported from dbt schema.yml on {date.today().isoformat()}",
            "fields": [],
        }
        if schema_name:
            entity["schema"] = schema_name
        if subject_area:
            entity["subject_area"] = subject_area
        if tags:
            entity["tags"] = sorted({str(t) for t in tags if t})
        entities_by_name[entity_name] = entity
        return entity

    def process_columns(columns: Any, entity: Dict[str, Any]) -> None:
        if not isinstance(columns, list):
            return
        for col in columns:
            if not isinstance(col, dict):
                continue
            col_name = _to_snake(str(col.get("name", "")).strip())
            if not col_name:
                continue

            field: Dict[str, Any] = {
                "name": col_name,
                "type": str(col.get("data_type") or col.get("type") or "string"),
                "nullable": True,
            }
            if col.get("description"):
                field["description"] = str(col["description"])

            tests = _as_test_list(col.get("tests")) + _as_test_list(col.get("data_tests"))
            has_not_null = False
            has_unique = False
            has_fk = False

            for test_def in tests:
                if isinstance(test_def, str):
                    tname = test_def.split(".")[-1].lower()
                    if tname == "not_null":
                        has_not_null = True
                    elif tname == "unique":
                        has_unique = True
                    continue

                if not isinstance(test_def, dict):
                    continue

                for test_name, test_cfg in test_def.items():
                    tname = str(test_name).split(".")[-1].lower()
                    if tname == "not_null":
                        has_not_null = True
                    elif tname == "unique":
                        has_unique = True
                    elif tname == "relationships":
                        cfg = test_cfg if isinstance(test_cfg, dict) else {}
                        target_entity = _dbt_parse_to_entity(cfg.get("to"))
                        target_field = _to_snake(str(cfg.get("field") or "").strip())
                        if target_entity and target_field:
                            relationship_candidates.append(
                                {
                                    "parent_entity": target_entity,
                                    "parent_field": target_field,
                                    "child_entity": str(entity.get("name", "")),
                                    "child_field": col_name,
                                }
                            )
                            has_fk = True

            for constraint_def in _as_constraint_list(col.get("constraints")):
                if isinstance(constraint_def, str):
                    cname = constraint_def.lower().strip().replace(" ", "_")
                    if cname == "not_null":
                        has_not_null = True
                    elif cname == "unique":
                        has_unique = True
                    elif cname == "primary_key":
                        has_not_null = True
                        has_unique = True
                    continue

                if not isinstance(constraint_def, dict):
                    continue

                ctype = str(constraint_def.get("type") or constraint_def.get("constraint_type") or "").lower().strip().replace(" ", "_")
                if ctype == "not_null":
                    has_not_null = True
                elif ctype == "unique":
                    has_unique = True
                elif ctype == "primary_key":
                    has_not_null = True
                    has_unique = True
                elif ctype == "foreign_key":
                    has_fk = True
                    target_entity, target_field = _dbt_constraint_target(constraint_def)
                    if target_entity and target_field:
                        relationship_candidates.append(
                            {
                                "parent_entity": target_entity,
                                "parent_field": target_field,
                                "child_entity": str(entity.get("name", "")),
                                "child_field": col_name,
                            }
                        )

            if has_not_null:
                field["nullable"] = False
            if has_unique:
                field["unique"] = True
            if has_unique and has_not_null:
                field["primary_key"] = True
            if has_fk:
                field["foreign_key"] = True

            _upsert_field(entity, field)

    # dbt sources -> external tables
    for source in loaded.get("sources", []) if isinstance(loaded.get("sources"), list) else []:
        if not isinstance(source, dict):
            continue
        source_name = str(source.get("name", "")).strip()
        source_schema = str(source.get("schema", "")).strip()
        source_tags = source.get("tags") if isinstance(source.get("tags"), list) else []
        for table in source.get("tables", []) if isinstance(source.get("tables"), list) else []:
            if not isinstance(table, dict):
                continue
            table_name = str(table.get("name", "")).strip()
            if not table_name:
                continue
            table_tags = table.get("tags") if isinstance(table.get("tags"), list) else []
            entity = get_or_create_entity(
                raw_name=table_name,
                entity_type="external_table",
                description=str(table.get("description", "")).strip(),
                tags=[*source_tags, *table_tags],
                schema_name=source_schema,
                subject_area=source_name,
            )
            process_columns(table.get("columns"), entity)

    # dbt models -> views (safe default)
    for dbt_model in loaded.get("models", []) if isinstance(loaded.get("models"), list) else []:
        if not isinstance(dbt_model, dict):
            continue
        model_raw_name = str(dbt_model.get("name", "")).strip()
        if not model_raw_name:
            continue
        dbt_tags = dbt_model.get("tags") if isinstance(dbt_model.get("tags"), list) else []
        dbt_meta = dbt_model.get("meta") if isinstance(dbt_model.get("meta"), dict) else {}
        entity = get_or_create_entity(
            raw_name=model_raw_name,
            entity_type="view",
            description=str(dbt_model.get("description", "")).strip(),
            tags=dbt_tags,
            schema_name=str(dbt_model.get("schema", "")).strip(),
            subject_area=str(dbt_meta.get("subject_area", "")).strip(),
        )
        process_columns(dbt_model.get("columns"), entity)

        for constraint_def in _as_constraint_list(dbt_model.get("constraints")):
            if not isinstance(constraint_def, dict):
                continue
            ctype = str(constraint_def.get("type") or constraint_def.get("constraint_type") or "").lower().strip().replace(" ", "_")
            cols = constraint_def.get("columns")
            if not isinstance(cols, list):
                continue
            col_names = [_to_snake(str(c).strip()) for c in cols if str(c).strip()]
            if not col_names:
                continue

            if ctype == "primary_key":
                for cname in col_names:
                    _ensure_field(entity, cname)
                    for fld in entity.get("fields", []):
                        if str(fld.get("name", "")) == cname:
                            fld["primary_key"] = True
                            fld["nullable"] = False
                            fld["unique"] = True
            elif ctype == "foreign_key":
                target_entity, target_field = _dbt_constraint_target(constraint_def)
                for cname in col_names:
                    _ensure_field(entity, cname)
                    for fld in entity.get("fields", []):
                        if str(fld.get("name", "")) == cname:
                            fld["foreign_key"] = True
                    if target_entity and target_field:
                        relationship_candidates.append(
                            {
                                "parent_entity": target_entity,
                                "parent_field": target_field,
                                "child_entity": str(entity.get("name", "")),
                                "child_field": cname,
                            }
                        )

    # Materialize relationship tests into DataLex relationships where resolvable.
    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for cand in relationship_candidates:
        parent = entities_by_name.get(cand["parent_entity"])
        child = entities_by_name.get(cand["child_entity"])
        if not parent or not child:
            continue
        _ensure_field(parent, cand["parent_field"])
        _ensure_field(child, cand["child_field"])

        rel = {
            "name": f"{cand['parent_entity'].lower()}_{cand['child_entity'].lower()}_{cand['child_field']}_fk",
            "from": f"{cand['parent_entity']}.{cand['parent_field']}",
            "to": f"{cand['child_entity']}.{cand['child_field']}",
            "cardinality": "one_to_many",
        }
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel

    model["entities"] = sorted(entities_by_name.values(), key=lambda e: str(e.get("name", "")))
    model["relationships"] = sorted(deduped.values(), key=lambda r: str(r.get("name", "")))
    return model
