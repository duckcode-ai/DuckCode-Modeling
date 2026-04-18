"""`dm datalex ...` CLI surface — thin wrapper over dm_core.datalex.

Subcommands:
  migrate to-datalex-layout <v3-model.yaml>   split legacy v3 model into DataLex tree
  validate <project-root>                     load + validate a DataLex project
  emit ddl <project-root> --dialect ...       emit per-dialect DDL for every physical entity
  diff <old-root> <new-root>                  semantic diff with explicit rename tracking
  info <project-root>                         print a summary (entity/term/domain counts)

All subcommands accept --output-json for machine-readable output where sensible.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from dm_core.datalex import load_project
from dm_core.datalex.diff import diff_entities
from dm_core.datalex.errors import DataLexLoadError
from dm_core.datalex.migrate_layout import migrate_project
import dm_core.dialects  # noqa: F401  — side-effect registers built-in dialects
from dm_core.dialects.registry import get_dialect, known_dialects


def register_datalex(parent_sub: argparse._SubParsersAction) -> None:
    """Register `dm datalex <...>` under the given subparsers object."""
    datalex = parent_sub.add_parser("datalex", help="DataLex spec-layout tooling")
    dsub = datalex.add_subparsers(dest="datalex_command", required=True)

    # migrate
    migrate_parser = dsub.add_parser(
        "migrate", help="Migrate legacy v3 model to DataLex file-per-entity layout"
    )
    msub = migrate_parser.add_subparsers(dest="migrate_command", required=True)
    to_layout = msub.add_parser(
        "to-datalex-layout",
        help="Split a v3 *.model.yaml into DataLex file-per-entity project",
    )
    to_layout.add_argument("model", help="Path to legacy v3 *.model.yaml")
    to_layout.add_argument(
        "--output-root", help="Where to write the new tree (default: alongside model)"
    )
    to_layout.add_argument(
        "--dialect",
        default="postgres",
        help="Physical dialect the v3 model targets (default: postgres)",
    )
    to_layout.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be written without writing",
    )
    to_layout.add_argument(
        "--output-json", action="store_true", help="Print machine-readable report"
    )
    to_layout.set_defaults(func=_cmd_migrate)

    # validate
    validate_parser = dsub.add_parser(
        "validate", help="Load and validate a DataLex project"
    )
    validate_parser.add_argument("root", help="Project root containing datalex.yaml")
    validate_parser.add_argument(
        "--output-json", action="store_true", help="Emit diagnostics as JSON"
    )
    validate_parser.add_argument(
        "--non-strict",
        action="store_true",
        help="Do not exit non-zero on errors; just print them",
    )
    validate_parser.set_defaults(func=_cmd_validate)

    # emit ddl
    emit_parser = dsub.add_parser("emit", help="Emit artifacts from a DataLex project")
    esub = emit_parser.add_subparsers(dest="emit_command", required=True)
    ddl_parser = esub.add_parser("ddl", help="Emit per-dialect DDL for physical entities")
    ddl_parser.add_argument("root", help="Project root")
    ddl_parser.add_argument(
        "--dialect",
        required=True,
        help=f"Dialect. One of: {', '.join(sorted(known_dialects())) or '(none registered)'}",
    )
    ddl_parser.add_argument(
        "--out", help="Write DDL to this file (default: stdout)"
    )
    ddl_parser.set_defaults(func=_cmd_emit_ddl)

    # diff
    diff_parser = dsub.add_parser(
        "diff", help="Semantic diff between two DataLex projects"
    )
    diff_parser.add_argument("old", help="Old project root")
    diff_parser.add_argument("new", help="New project root")
    diff_parser.add_argument(
        "--output-json",
        action="store_true",
        help="Emit diff as JSON (default: human-readable)",
    )
    diff_parser.add_argument(
        "--exit-on-breaking",
        action="store_true",
        help="Exit non-zero if any breaking changes are detected",
    )
    diff_parser.set_defaults(func=_cmd_diff)

    # info
    info_parser = dsub.add_parser("info", help="Summarize a DataLex project")
    info_parser.add_argument("root", help="Project root")
    info_parser.add_argument(
        "--output-json", action="store_true", help="Emit summary as JSON"
    )
    info_parser.set_defaults(func=_cmd_info)


# ----------------- command impls -----------------


def _cmd_migrate(args: argparse.Namespace) -> int:
    report = migrate_project(
        args.model,
        output_root=args.output_root,
        default_dialect=args.dialect,
        dry_run=args.dry_run,
    )
    if args.output_json:
        payload = {
            "project_root": str(report.project_root),
            "manifest_written": report.manifest_written,
            "entities_written": report.entities_written,
            "terms_written": report.terms_written,
            "domains_written": report.domains_written,
            "warnings": report.warnings,
            "files": report.files,
            "dry_run": bool(args.dry_run),
        }
        print(json.dumps(payload, indent=2))
    else:
        print(report.summary())
        if args.dry_run:
            print("\n(dry-run — no files written)")
            for f in report.files:
                print(f"  would write: {f}")
    return 0


def _cmd_validate(args: argparse.Namespace) -> int:
    strict = not args.non_strict
    try:
        project = load_project(args.root, strict=strict)
    except DataLexLoadError as e:
        if args.output_json:
            print(json.dumps({"errors": [err.to_dict() for err in e.errors]}, indent=2))
        else:
            for err in e.errors:
                print(str(err), file=sys.stderr)
        return 1

    errors = project.errors.to_list()
    if args.output_json:
        print(
            json.dumps(
                {
                    "root": str(project.root),
                    "entities": len(project.entities),
                    "terms": len(project.terms),
                    "domains": len(project.domains),
                    "sources": len(project.sources),
                    "models": len(project.models),
                    "policies": len(project.policies),
                    "snippets": len(project.snippets),
                    "errors": errors,
                },
                indent=2,
            )
        )
    else:
        print(f"DataLex project: {project.root}")
        print(f"  entities: {len(project.entities)}")
        print(f"  terms:    {len(project.terms)}")
        print(f"  domains:  {len(project.domains)}")
        print(f"  sources:  {len(project.sources)}")
        print(f"  models:   {len(project.models)}")
        print(f"  policies: {len(project.policies)}")
        print(f"  snippets: {len(project.snippets)}")
        if errors:
            print(f"\n{len(errors)} diagnostic(s):")
            for err in project.errors.errors:
                print(f"  {err}")
    return 1 if project.errors.has_errors() else 0


def _cmd_emit_ddl(args: argparse.Namespace) -> int:
    try:
        project = load_project(args.root, strict=True)
    except DataLexLoadError as e:
        for err in e.errors:
            print(str(err), file=sys.stderr)
        return 1

    try:
        dialect = get_dialect(args.dialect)
    except KeyError:
        print(
            f"Unknown dialect '{args.dialect}'. Known: {', '.join(sorted(known_dialects()))}",
            file=sys.stderr,
        )
        return 2

    # Build name -> physical_name map so FK emission references the actual table name
    # rather than the logical/snake name used as a key inside DataLex.
    physical_name_of = {}
    for ent in project.physical_entities(dialect=args.dialect):
        physical_name_of[ent.get("name")] = ent.get("physical_name") or ent.get("name")

    chunks = []
    for ent in project.physical_entities(dialect=args.dialect):
        chunks.append(dialect.render_entity(_resolve_refs(ent, physical_name_of)))

    body = "\n".join(chunks).rstrip() + "\n" if chunks else ""

    if args.out:
        Path(args.out).parent.mkdir(parents=True, exist_ok=True)
        Path(args.out).write_text(body, encoding="utf-8")
        print(f"Wrote {len(chunks)} entity DDL block(s) to {args.out}")
    else:
        sys.stdout.write(body)
    return 0


def _cmd_diff(args: argparse.Namespace) -> int:
    try:
        old = load_project(args.old, strict=False)
        new = load_project(args.new, strict=False)
    except DataLexLoadError as e:
        for err in e.errors:
            print(str(err), file=sys.stderr)
        return 1

    result = diff_entities(old.entities, new.entities)

    if args.output_json:
        print(json.dumps(result, indent=2, default=str))
    else:
        _print_diff_human(result)

    if args.exit_on_breaking and result.get("breaking"):
        return 3
    return 0


def _cmd_info(args: argparse.Namespace) -> int:
    try:
        project = load_project(args.root, strict=False)
    except DataLexLoadError as e:
        for err in e.errors:
            print(str(err), file=sys.stderr)
        return 1

    entities_by_layer = {"conceptual": 0, "logical": 0, "physical": 0}
    dialects: dict = {}
    for key, ent in project.entities.items():
        layer = key.split(":", 1)[0]
        entities_by_layer[layer] = entities_by_layer.get(layer, 0) + 1
        if layer == "physical":
            d = ent.get("dialect") or "(unspecified)"
            dialects[d] = dialects.get(d, 0) + 1

    if args.output_json:
        print(
            json.dumps(
                {
                    "root": str(project.root),
                    "entities_by_layer": entities_by_layer,
                    "physical_by_dialect": dialects,
                    "terms": len(project.terms),
                    "domains": len(project.domains),
                    "sources": len(project.sources),
                    "models": len(project.models),
                    "policies": len(project.policies),
                    "snippets": len(project.snippets),
                },
                indent=2,
            )
        )
    else:
        print(f"DataLex project: {project.root}")
        print("  entities:")
        for layer, n in entities_by_layer.items():
            print(f"    {layer:11s} {n}")
        if dialects:
            print("  physical by dialect:")
            for d, n in sorted(dialects.items()):
                print(f"    {d:11s} {n}")
        print(f"  terms:     {len(project.terms)}")
        print(f"  domains:   {len(project.domains)}")
        print(f"  sources:   {len(project.sources)}")
        print(f"  models:    {len(project.models)}")
        print(f"  policies:  {len(project.policies)}")
        print(f"  snippets:  {len(project.snippets)}")
    return 0


def _resolve_refs(entity: dict, physical_name_of: dict) -> dict:
    """Return a shallow copy of entity with column references.entity rewritten
    to target physical names, so FK DDL points at the actual table name rather
    than the DataLex logical/snake key.
    """
    cols_out = []
    for col in entity.get("columns", []) or []:
        ref = col.get("references")
        if ref and ref.get("entity") in physical_name_of:
            new_ref = dict(ref)
            new_ref["entity"] = physical_name_of[ref["entity"]]
            col = {**col, "references": new_ref}
        cols_out.append(col)
    return {**entity, "columns": cols_out}


def _print_diff_human(result: dict) -> None:
    added = result.get("added") or []
    removed = result.get("removed") or []
    renamed = result.get("renamed") or []
    changed = result.get("changed") or []
    breaking = result.get("breaking") or []

    if added:
        print(f"Added ({len(added)}):")
        for k in added:
            print(f"  + {k}")
    if removed:
        print(f"Removed ({len(removed)}):")
        for k in removed:
            print(f"  - {k}")
    if renamed:
        print(f"Renamed ({len(renamed)}):")
        for old, new in renamed:
            print(f"  ~ {old} -> {new}")
    if changed:
        print(f"Changed ({len(changed)}):")
        for ch in changed:
            print(f"  * {ch.get('entity')}")
            cols = ch.get("columns") or {}
            for a in cols.get("added", []):
                print(f"      + column {a}")
            for r in cols.get("removed", []):
                print(f"      - column {r}")
            for rn in cols.get("renamed", []):
                print(f"      ~ column {rn['from']} -> {rn['to']}")
            for c in cols.get("changed", []):
                print(f"      * column {c.get('name')}: {list(k for k in c if k != 'name')}")
    if breaking:
        print(f"\nBreaking ({len(breaking)}):")
        for b in breaking:
            print(f"  ! {b}")
    if not (added or removed or renamed or changed):
        print("No changes.")
