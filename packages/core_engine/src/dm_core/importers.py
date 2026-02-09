import re
from datetime import date
from typing import Any, Dict, List, Tuple


CREATE_TABLE_RE = re.compile(
    r"create\s+table\s+(?:if\s+not\s+exists\s+)?([\w\"\.]+)\s*\((.*?)\)\s*;",
    flags=re.IGNORECASE | re.DOTALL,
)
TABLE_RE = re.compile(r"^\s*table\s+([\w\"]+)\s*\{\s*$", flags=re.IGNORECASE)
REF_RE = re.compile(r"^\s*ref\s*:\s*([\w]+)\.([\w]+)\s*([<>-]+)\s*([\w]+)\.([\w]+)", flags=re.IGNORECASE)


def _to_pascal(name: str) -> str:
    name = name.replace('"', "")
    parts = re.split(r"[^A-Za-z0-9]+", name)
    return "".join(part[:1].upper() + part[1:] for part in parts if part)


def _to_model_name(text: str) -> str:
    cleaned = re.sub(r"[^a-zA-Z0-9]+", "_", text).strip("_")
    cleaned = cleaned.lower()
    return cleaned or "imported_model"


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


def import_sql_ddl(
    ddl_text: str,
    model_name: str = "imported_sql_model",
    domain: str = "imported",
    owners: List[str] = None,
) -> Dict[str, Any]:
    owners = owners or ["data-team@example.com"]
    model = _default_model(model_name=model_name, domain=domain, owners=owners)

    entity_fields: Dict[str, List[Dict[str, Any]]] = {}
    primary_keys: Dict[str, List[str]] = {}
    relationships: List[Dict[str, Any]] = []

    for match in CREATE_TABLE_RE.finditer(ddl_text):
        table_token = match.group(1).strip().split(".")[-1].replace('"', "")
        body = match.group(2)
        entity_name = _to_pascal(table_token)
        entity_fields.setdefault(entity_name, [])
        primary_keys.setdefault(entity_name, [])

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
                    r"foreign\s+key\s*\((.*?)\)\s+references\s+([\w\"\.]+)\s*\((.*?)\)",
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

            col_match = re.match(r"^\s*\"?([A-Za-z_][A-Za-z0-9_]*)\"?\s+([^\s,]+(?:\([^)]*\))?)(.*)$", definition)
            if not col_match:
                continue

            col_name = col_match.group(1)
            col_type = col_match.group(2)
            rest = col_match.group(3).lower()

            field = {
                "name": col_name,
                "type": col_type.lower(),
                "nullable": "not null" not in rest,
            }
            if "primary key" in rest:
                field["primary_key"] = True
            if "unique" in rest:
                field["unique"] = True

            ref_match = re.search(
                r"references\s+([\w\"\.]+)\s*\((.*?)\)",
                rest,
                flags=re.IGNORECASE,
            )
            if ref_match:
                ref_table = ref_match.group(1).strip().split(".")[-1].replace('"', "")
                ref_field = ref_match.group(2).strip().replace('"', "")
                parent_entity = _to_pascal(ref_table)
                child_entity = entity_name
                relationships.append(
                    {
                        "name": f"{parent_entity.lower()}_{child_entity.lower()}_{col_name}_fk",
                        "from": f"{parent_entity}.{ref_field}",
                        "to": f"{child_entity}.{col_name}",
                        "cardinality": "one_to_many",
                    }
                )

            entity_fields[entity_name].append(field)

    for entity_name, fields in sorted(entity_fields.items()):
        pk_set = {value for value in primary_keys.get(entity_name, []) if value}
        for field in fields:
            if field["name"] in pk_set:
                field["primary_key"] = True
                field["nullable"] = False
        model["entities"].append(
            {
                "name": entity_name,
                "type": "table",
                "description": f"Imported from SQL on {date.today().isoformat()}",
                "fields": fields,
            }
        )

    deduped: Dict[Tuple[str, str, str, str], Dict[str, str]] = {}
    for rel in relationships:
        key = (rel["name"], rel["from"], rel["to"], rel["cardinality"])
        deduped[key] = rel
    model["relationships"] = sorted(deduped.values(), key=lambda x: x["name"])

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
