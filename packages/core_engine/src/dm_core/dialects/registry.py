"""Runtime registry of DialectPlugin instances.

Dialects self-register at import time by calling `register_dialect(...)`.
"""

from __future__ import annotations

from typing import Dict, List, Optional

from dm_core.dialects.base import DialectPlugin


_REGISTRY: Dict[str, DialectPlugin] = {}


def register_dialect(plugin: DialectPlugin) -> None:
    if not isinstance(plugin, DialectPlugin):
        raise TypeError(f"{plugin!r} does not implement DialectPlugin")
    _REGISTRY[plugin.name] = plugin


def get_dialect(name: str) -> Optional[DialectPlugin]:
    return _REGISTRY.get(name)


def known_dialects() -> List[str]:
    return sorted(_REGISTRY.keys())


def require_dialect(name: str) -> DialectPlugin:
    plugin = get_dialect(name)
    if plugin is None:
        raise KeyError(
            f"Dialect '{name}' is not registered. Known: {', '.join(known_dialects())}"
        )
    return plugin
