"""`python -m datalex_readiness review --project <path> [--scope all|changed] [--paths a,b]`

Used by the api-server to shell out to the shared engine. Output is a
single JSON document on stdout matching the `/api/dbt/review` shape.
"""

from __future__ import annotations

import argparse
import json
import sys
from typing import List, Optional

from .finding import findings_to_sarif
from .scoring import review_project


def _split_paths(value: Optional[str]) -> List[str]:
    if not value:
        return []
    return [p for p in (s.strip() for s in value.split(",")) if p]


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(prog="datalex_readiness")
    sub = parser.add_subparsers(dest="cmd", required=True)

    review = sub.add_parser("review", help="Score a project and print JSON")
    review.add_argument("--project", required=True, help="Project path")
    review.add_argument("--project-id", default="", help="Project id (passthrough)")
    review.add_argument("--scope", default="all", choices=["all", "changed", "selected"])
    review.add_argument("--paths", default="", help="Comma-separated relative paths to focus on")
    review.add_argument("--sarif", default="", help="If set, write SARIF to this path as a side-effect")

    docs = sub.add_parser("doc-blocks", help="List doc-block index for a dbt project")
    docs.add_argument("--project", required=True, help="dbt project root")

    args = parser.parse_args(argv)
    if args.cmd == "review":
        result = review_project(
            project_id=args.project_id,
            project_path=args.project,
            paths=_split_paths(args.paths),
            scope=args.scope,
        )
        if args.sarif:
            with open(args.sarif, "w", encoding="utf-8") as fh:
                json.dump(findings_to_sarif(result.get("files", [])), fh, indent=2)
        sys.stdout.write(json.dumps(result))
        return 0
    if args.cmd == "doc-blocks":
        # Lazy import — core_engine is required only for this subcommand so
        # the readiness_engine can be used in CI without DataLex installed.
        from datalex_core.dbt.doc_blocks import DocBlockIndex

        idx = DocBlockIndex.build(args.project)
        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "projectPath": str(idx.project_root),
                    "blocks": idx.blocks,
                    "sources": idx.sources,
                    "names": idx.names(),
                }
            )
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
