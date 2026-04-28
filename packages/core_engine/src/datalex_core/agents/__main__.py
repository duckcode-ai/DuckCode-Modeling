"""`python -m datalex_core.agents <subcommand> --project <path>` CLI bridge.

Reads every `*.yaml`/`*.yml` under the project, builds a `models` dict
keyed by model name, and runs the requested agent. Output is a single
JSON document on stdout — the api-server consumes it directly to produce
proposal changes.
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict

import yaml

from datalex_core.agents.canonicalizer import propose_canonical_layer
from datalex_core.agents.conceptualizer import propose_conceptual_model


def _load_models(project_path: Path) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    for path in sorted(project_path.rglob("*.y*ml")):
        if any(part.startswith(".") for part in path.relative_to(project_path).parts):
            continue
        try:
            doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(doc, dict):
            continue
        models = doc.get("models")
        if isinstance(models, list):
            for m in models:
                if isinstance(m, dict) and m.get("name"):
                    out[str(m["name"])] = m
        elif doc.get("kind") == "model" and doc.get("name"):
            out[str(doc["name"])] = doc
    return out


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="datalex_core.agents")
    sub = parser.add_subparsers(dest="cmd", required=True)

    conc = sub.add_parser("conceptualize", help="Propose entities + relationships from staging")
    conc.add_argument("--project", required=True)

    cano = sub.add_parser("canonicalize", help="Lift staging columns into a logical canonical layer")
    cano.add_argument("--project", required=True)
    cano.add_argument("--min-recurrence", type=int, default=2)

    args = parser.parse_args(argv)
    project_path = Path(args.project).resolve()
    if not project_path.exists():
        print(f"ERROR: project path not found: {project_path}", file=sys.stderr)
        return 1

    models = _load_models(project_path)
    if args.cmd == "conceptualize":
        proposal = propose_conceptual_model(models)
        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "agent": "conceptualizer",
                    "model_count": len(models),
                    "entities": proposal.entities,
                    "relationships": proposal.relationships,
                    "domains": proposal.domains,
                    "notes": proposal.notes,
                    "diagram": proposal.to_diagram(),
                }
            )
        )
        return 0
    if args.cmd == "canonicalize":
        proposal = propose_canonical_layer(models, min_recurrence=args.min_recurrence)
        sys.stdout.write(
            json.dumps(
                {
                    "ok": True,
                    "agent": "canonicalizer",
                    "model_count": len(models),
                    "entities": proposal.entities,
                    "doc_blocks": proposal.doc_blocks,
                    "notes": proposal.notes,
                    "proposal_changes": proposal.to_proposal_changes(),
                }
            )
        )
        return 0
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
