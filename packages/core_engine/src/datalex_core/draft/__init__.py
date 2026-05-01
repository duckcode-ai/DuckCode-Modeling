"""AI-assisted DataLex starter drafting from a dbt project.

Public entry point for `datalex draft`. The CLI command in
`datalex_cli.main.cmd_draft` is a thin wrapper around `draft_starter()`.
"""

from datalex_core.draft.manifest_loader import condense_manifest, load_manifest
from datalex_core.draft.runner import DraftError, draft_starter

__all__ = [
    "DraftError",
    "condense_manifest",
    "draft_starter",
    "load_manifest",
]
