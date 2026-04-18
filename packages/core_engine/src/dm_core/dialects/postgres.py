"""Postgres dialect plugin."""

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
    "string": "TEXT",
    "text": "TEXT",
    "integer": "INTEGER",
    "bigint": "BIGINT",
    "float": "DOUBLE PRECISION",
    "boolean": "BOOLEAN",
    "date": "DATE",
    "timestamp": "TIMESTAMP",
    "timestamp_tz": "TIMESTAMPTZ",
    "interval": "INTERVAL",
    "uuid": "UUID",
    "json": "JSONB",
    "binary": "BYTEA",
}


class PostgresDialect:
    name = "postgres"

    def quote(self, identifier: str) -> str:
        # Double-quote every identifier and escape embedded double quotes.
        escaped = identifier.replace('"', '""')
        return f'"{escaped}"'

    def render_type(self, logical: LogicalType, ctx: RenderContext) -> str:
        column = ctx.column or {}
        override = physical_override(column, self.name)
        if override:
            return override
        raw = physical_raw_ddl(column, self.name)
        if raw:
            return raw

        if logical.kind == "array":
            inner = self.render_type(logical.children[0], ctx)
            return f"{inner}[]"
        if logical.kind == "map":
            return "JSONB"
        if logical.kind == "struct":
            return "JSONB"
        if logical.kind == "decimal":
            if logical.params:
                return f"NUMERIC({','.join(str(p) for p in logical.params)})"
            return "NUMERIC"
        if logical.kind == "string" and logical.params:
            return f"VARCHAR({logical.params[0]})"
        if logical.kind == "binary" and logical.params:
            return "BYTEA"

        return _PRIMITIVE_MAP.get(logical.kind, logical.kind.upper())

    def render_entity(self, entity: Dict[str, Any]) -> str:
        from dm_core.datalex.types import parse_type  # local to avoid cycles

        name = qualified_table_name(entity, self.quote, self.name)
        lines: List[str] = [f"CREATE TABLE {name} ("]

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
            cols = ", ".join(self.quote(c) for c in pks)
            col_lines.append(f"  PRIMARY KEY ({cols})")

        lines.append(",\n".join(col_lines))
        lines.append(");")

        fk_lines: List[str] = []
        for col in entity.get("columns", []) or []:
            ref = col.get("references")
            if not ref:
                continue
            target = ref.get("entity")
            target_col = ref.get("column")
            on_delete = ref.get("on_delete")
            fk_name = f"fk_{entity['name']}_{col['name']}"
            fk = (
                f"ALTER TABLE {name} ADD CONSTRAINT "
                f"{self.quote(fk_name)} "
                f"FOREIGN KEY ({self.quote(col['name'])}) "
                f"REFERENCES {self.quote(target)} ({self.quote(target_col)})"
            )
            if on_delete:
                fk += f" ON DELETE {on_delete.upper().replace('_', ' ')}"
            fk_lines.append(fk + ";")

        idx_lines: List[str] = []
        for idx in entity.get("indexes", []) or []:
            unique = "UNIQUE " if idx.get("unique") else ""
            cols = ", ".join(self.quote(c) for c in idx.get("columns", []))
            idx_lines.append(
                f"CREATE {unique}INDEX {self.quote(idx['name'])} ON {name} ({cols});"
            )

        return "\n".join(lines + ([""] if fk_lines or idx_lines else []) + fk_lines + idx_lines).rstrip() + "\n"

    def render_alter(
        self,
        old_entity: Optional[Dict[str, Any]],
        new_entity: Optional[Dict[str, Any]],
    ) -> List[str]:
        # Minimal first pass — rely on the diff engine for richer output in Phase B.
        statements: List[str] = []
        if old_entity is None and new_entity is not None:
            statements.append(self.render_entity(new_entity))
            return statements
        if new_entity is None and old_entity is not None:
            statements.append(
                f"DROP TABLE {qualified_table_name(old_entity, self.quote, self.name)};"
            )
            return statements
        return statements

    def render_grant(self, policy: Dict[str, Any], entity: Dict[str, Any]) -> List[str]:
        out: List[str] = []
        target = qualified_table_name(entity, self.quote, self.name)
        for grant in policy.get("grants", []) or []:
            privs = ", ".join(grant.get("privileges", []))
            principal = grant.get("principal")
            if not principal:
                continue
            out.append(f"GRANT {privs} ON {target} TO {principal};")
        return out


def _format_default(value: Any) -> str:
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)):
        return str(value)
    if value is None:
        return "NULL"
    return "'" + str(value).replace("'", "''") + "'"


register_dialect(PostgresDialect())
