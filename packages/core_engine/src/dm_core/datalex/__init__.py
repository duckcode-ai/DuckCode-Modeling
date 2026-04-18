"""DataLex — file-per-entity, kind-dispatched YAML data modeling layer.

This package implements the DataLex specification (see
/Users/Kranthi/Documents/Claude/Projects/DataLex/skills/datalex-builder/) on top of
the existing DuckCode core engine.

Public surface:
  types    — logical type parser (primitives + array/map/struct)
  loader   — kind-dispatched streaming loader with source-located errors
  project  — DataLexProject: the loaded, validated, resolved project graph
  errors   — DataLexError and friends
"""

from dm_core.datalex.errors import DataLexError, SourceLocation
from dm_core.datalex.types import LogicalType, parse_type
from dm_core.datalex.loader import load_project
from dm_core.datalex.project import DataLexProject

__all__ = [
    "DataLexError",
    "SourceLocation",
    "LogicalType",
    "parse_type",
    "load_project",
    "DataLexProject",
]
