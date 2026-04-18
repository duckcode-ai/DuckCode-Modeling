"""Snowflake dialect plugin."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from dm_core.datalex.types import LogicalType
from dm_core.dialects.base import DialectPlugin, RenderContext
from dm_core.dialects.registry import register_dialect
from dm_core.dialects._common import (
    physical_override,
    physical_raw_ddl,
    primary_key_columns,
    qualified_table_name,
)


_PRIMITIVE_MAP = {
    "string": "VARCHAR",
    "text": "VARCHAR",
    "integer": "NUMBER(38,0)",
    "bigint": "NUMBER(38,0)",
    "float": "FLOAT",
    "boolean": "BOOLEAN",
    "date": "DATE",
    "timestamp": "TIMESTAMP_NTZ",
    "timestamp_tz": "TIMESTAMP_TZ",
    "interval": "VARCHAR",
    "uuid": "VARCHAR",
    "json": "VARIANT",
    "binary": "BINARY",
}


class SnowflakeDialect:
    name = "snowflake"

    def quote(self, identifier: str) -> str:
        # Snowflake identifiers are case-sensitive when quoted; prefer uppercase.
        escaped = identifier.replace('"', '""')
        return f'"{escaped.upper()}"'

    def render_type(self, logical: LogicalType, ctx: RenderContext) -> str:
        column = ctx.column or {}
        override = physical_override(column, self.name)
        if override:
            return override
        raw = physical_raw_ddl(column, self.name)
        if raw:
            return raw

        if logical.kind == "array":
            return "ARRAY"
        if logical.kind == "map":
            return "OBJECT"
        if logical.kind == "struct":
            return "OBJECT"
        if logical.kind == "decimal":
            if logical.params:
                return f"NUMBER({','.join(str(p) for p in logical.params)})"
            return "NUMBER"
        if logical.kind == "string" and logical.params:
            return f"VARCHAR({logical.params[0]})"

        return _PRIMITIVE_MAP.get(logical.kind, logical.kind.upper())

    def render_entity(self, entity: Dict[str, Any]) -> str:
        from dm_core.datalex.types import parse_type

        name = qualified_table_name(entity, self.quote, self.name)
        lines: List[str] = [f"CREATE OR REPLACE TABLE {name} ("]

        col_lines: List[str] = []
        for col in entity.get("columns", []) or []:
            logical = parse_type(col.get("type", "string"))
            sql_type = self.render_type(logical, RenderContext(entity=entity, column=col))
            piece = f"  {self.quote(col['name'])} {sql_type}"
            if col.get("nullable") is False or col.get("primary_key"):
                piece += " NOT NULL"
            default = col.get("default")
            if default is not None:
                piece += f" DEFAULT {_format_default(default)}"
            col_lines.append(piece)

        pks = primary_key_columns(entity)
        if pks:
            col_lines.append(
                f"  PRIMARY KEY ({', '.join(self.quote(c) for c in pks)})"
            )

        lines.append(",\n".join(col_lines))
        lines.append(");")

        return "\n".join(lines) + "\n"

    def render_alter(
        self,
        old_entity: Optional[Dict[str, Any]],
        new_entity: Optional[Dict[str, Any]],
    ) -> List[str]:
        if old_entity is None and new_entity is not None:
            return [self.render_entity(new_entity)]
        if new_entity is None and old_entity is not None:
            return [f"DROP TABLE IF EXISTS {qualified_table_name(old_entity, self.quote, self.name)};"]
        return []

    def render_grant(self, policy: Dict[str, Any], entity: Dict[str, Any]) -> List[str]:
        out: List[str] = []
        target = qualified_table_name(entity, self.quote, self.name)
        for grant in policy.get("grants", []) or []:
            privs = ", ".join(grant.get("privileges", []))
            principal = grant.get("principal")
            if not principal:
                continue
            out.append(f"GRANT {privs} ON TABLE {target} TO ROLE {principal};")
        return out


def _format_default(value: Any) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


register_dialect(SnowflakeDialect())
