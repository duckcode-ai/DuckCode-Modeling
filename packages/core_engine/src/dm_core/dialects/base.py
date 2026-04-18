"""DialectPlugin protocol.

A dialect plugin is a pure function bundle: given a DataLex entity (dict) it
renders DDL, migration ALTERs, GRANTs, and type strings. No hidden state.

Each plugin exposes:
  * `name` — canonical lowercase dialect name (`postgres`, `snowflake`, ...)
  * `render_type(logical_type, column)` — map a logical type to a physical type string
  * `render_entity(entity)` — emit CREATE TABLE / VIEW etc.
  * `render_alter(old_entity, new_entity)` — emit ALTER statements for a diff
  * `render_grant(policy, entity)` — emit GRANT statements for an access policy
  * `quote(identifier)` — dialect-correct identifier quoting

The registry calls `register_dialect(plugin)` at import time; downstream code
calls `get_dialect(name)` to retrieve it.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Protocol, runtime_checkable

from dm_core.datalex.types import LogicalType


@dataclass
class RenderContext:
    """Contextual hints passed to render_type. Dialect plugins can ignore it."""
    entity: Optional[Dict[str, Any]] = None
    column: Optional[Dict[str, Any]] = None


@runtime_checkable
class DialectPlugin(Protocol):
    name: str

    def quote(self, identifier: str) -> str: ...

    def render_type(self, logical: LogicalType, ctx: RenderContext) -> str: ...

    def render_entity(self, entity: Dict[str, Any]) -> str: ...

    def render_alter(
        self, old_entity: Optional[Dict[str, Any]], new_entity: Optional[Dict[str, Any]]
    ) -> List[str]: ...

    def render_grant(self, policy: Dict[str, Any], entity: Dict[str, Any]) -> List[str]: ...
