"""Shared readiness scoring engine for DataLex.

Single source of truth for the dbt-readiness review used by:
  - the api-server (`/api/dbt/review`)
  - the `datalex gate` CLI / GitHub Action

The engine produces JSON-identical output for the same project so the
api-server can shell out without parity drift.
"""

from .finding import Finding, finding, finding_to_dict
from .scoring import (
    review_project,
    review_file,
    summarize_review_file,
    review_add_document_findings,
    review_add_entity_findings,
    review_collect_entities,
    review_file_kind,
)
from .walker import (
    load_project_structure,
    walk_yaml_files,
    load_dbt_artifact_presence,
)

__all__ = [
    "Finding",
    "finding",
    "finding_to_dict",
    "review_project",
    "review_file",
    "summarize_review_file",
    "review_add_document_findings",
    "review_add_entity_findings",
    "review_collect_entities",
    "review_file_kind",
    "load_project_structure",
    "walk_yaml_files",
    "load_dbt_artifact_presence",
]
