"""Dialect plugin registry.

Each SQL/NoSQL target engine ships as a module under this package implementing the
DialectPlugin protocol in `base.py`. The registry in `registry.py` is the single
entry point for code that wants to emit DDL or type-map without knowing which
dialect is in play.

Ports in Phase A: postgres, snowflake. The legacy monolithic `generators.py`
remains available as a fallback and continues to serve bigquery/databricks/mysql/
sqlserver until those are ported (Phase A task 5).
"""

from dm_core.dialects import base, registry, postgres, snowflake  # noqa: F401

__all__ = ["base", "registry"]
