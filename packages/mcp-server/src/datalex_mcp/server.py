"""MCP stdio server exposing DataLex tools.

Each tool here is a thin wrapper around the same `datalex_core` functions
that back the CLI subcommands and the api-server endpoints, so behaviour
stays consistent across surfaces.

Tools:
  - docs.export      → datalex_core.docs_export.export_docs
  - docs.list        → datalex_core.docs_export.walk_project
  - dbt.doc_blocks   → datalex_core.dbt.doc_blocks.DocBlockIndex
  - dbt.review       → packages/readiness_engine (via subprocess; the
                       Python module isn't always import-clean)

Run via the `datalex-mcp` console script. The MCP client launches it as
a subprocess and talks JSON-RPC over stdio.
"""

from __future__ import annotations

import asyncio
import json
import subprocess
import sys
from dataclasses import asdict
from pathlib import Path
from typing import Any, Dict, List

import mcp.types as types
from mcp.server import NotificationOptions, Server
from mcp.server.models import InitializationOptions
from mcp.server.stdio import stdio_server

from datalex_core.dbt.doc_blocks import DocBlockIndex
from datalex_core.docs_export import export_docs, walk_project


SERVER_NAME = "datalex"
SERVER_VERSION = "0.1.0"


# ---------------------------------------------------------------------------
# Tool implementations — thin wrappers that return a TextContent JSON blob.
# ---------------------------------------------------------------------------


def _ok(payload: Dict[str, Any]) -> List[types.TextContent]:
    """Standard success envelope: pretty-printed JSON in a TextContent block."""
    return [types.TextContent(type="text", text=json.dumps(payload, indent=2, default=str))]


def _err(message: str, **extra: Any) -> List[types.TextContent]:
    payload: Dict[str, Any] = {"ok": False, "error": message, **extra}
    return [types.TextContent(type="text", text=json.dumps(payload, indent=2, default=str))]


def _project_dir(args: Dict[str, Any]) -> Path:
    project_dir = Path(str(args.get("project_dir") or "")).expanduser()
    if not project_dir.is_dir():
        raise FileNotFoundError(f"project_dir does not exist: {project_dir}")
    return project_dir.resolve()


def tool_docs_export(args: Dict[str, Any]) -> List[types.TextContent]:
    project_dir = _project_dir(args)
    out_dir = Path(str(args.get("out_dir") or (project_dir / "docs" / "_generated"))).expanduser()
    summary = export_docs(project_dir, out_dir)
    return _ok({"ok": True, "summary": summary.to_json()})


def tool_docs_list(args: Dict[str, Any]) -> List[types.TextContent]:
    project_dir = _project_dir(args)
    models = []
    for m in walk_project(project_dir):
        models.append({
            "rel_path": str(m.rel_path),
            "kind": m.kind,
            "domain": m.domain,
            "layer": m.layer,
            "name": m.name,
            "entity_count": len(m.data.get("entities") or []),
        })
    return _ok({"ok": True, "project_dir": str(project_dir), "models": models})


def tool_dbt_doc_blocks(args: Dict[str, Any]) -> List[types.TextContent]:
    project_dir = _project_dir(args)
    name = args.get("name")
    idx = DocBlockIndex.build(project_dir)
    if name:
        body = idx.resolve(str(name))
        if body is None:
            return _err(f"doc block not found: {name}", project_dir=str(project_dir))
        return _ok({"ok": True, "name": name, "body": body})
    return _ok({
        "ok": True,
        "project_dir": str(project_dir),
        "sources_scanned": len(idx.sources),
        "blocks": idx.blocks,
    })


def tool_dbt_review(args: Dict[str, Any]) -> List[types.TextContent]:
    project_dir = _project_dir(args)
    # Shell out to the readiness CLI — same surface the GitHub Action uses.
    # Honors `min_score`, `max_yellow`, `max_red` if provided, otherwise just
    # reports without enforcing.
    cmd = [
        sys.executable, "-m", "datalex_readiness", "review",
        "--project", str(project_dir),
        "--json",
    ]
    try:
        out = subprocess.check_output(cmd, stderr=subprocess.STDOUT, timeout=120)
    except subprocess.CalledProcessError as e:
        return _err(
            "datalex_readiness exited non-zero",
            stderr=(e.output or b"").decode("utf-8", "replace")[-2000:],
        )
    except FileNotFoundError:
        return _err(
            "datalex_readiness module not installed in this environment",
            hint="pip install -e packages/readiness_engine",
        )
    try:
        data = json.loads(out.decode("utf-8", "replace"))
    except json.JSONDecodeError:
        data = {"raw": out.decode("utf-8", "replace")[-2000:]}
    return _ok({"ok": True, "review": data})


# ---------------------------------------------------------------------------
# Tool registry — name → (description, input schema, handler)
# ---------------------------------------------------------------------------

TOOLS: Dict[str, Dict[str, Any]] = {
    "docs.export": {
        "description": (
            "Walk a DataLex project and write per-model + per-domain Markdown docs "
            "(with mermaid ERDs) under out_dir. Returns the export summary."
        ),
        "input_schema": {
            "type": "object",
            "required": ["project_dir"],
            "properties": {
                "project_dir": {"type": "string", "description": "Path to the DataLex project root"},
                "out_dir": {
                    "type": "string",
                    "description": "Directory to write the MD tree to. Defaults to <project_dir>/docs/_generated.",
                },
            },
        },
        "handler": tool_docs_export,
    },
    "docs.list": {
        "description": "List recognized DataLex models in a project (path, kind, domain, layer, name, entity_count).",
        "input_schema": {
            "type": "object",
            "required": ["project_dir"],
            "properties": {
                "project_dir": {"type": "string"},
            },
        },
        "handler": tool_docs_list,
    },
    "dbt.doc_blocks": {
        "description": (
            "List `{% docs %}` blocks scanned from the project (rendered text + name), "
            "or fetch one block's body when `name` is provided."
        ),
        "input_schema": {
            "type": "object",
            "required": ["project_dir"],
            "properties": {
                "project_dir": {"type": "string"},
                "name": {"type": "string", "description": "Optional doc-block name to fetch"},
            },
        },
        "handler": tool_dbt_doc_blocks,
    },
    "dbt.review": {
        "description": "Run the DataLex readiness gate over a project and return the per-file score summary.",
        "input_schema": {
            "type": "object",
            "required": ["project_dir"],
            "properties": {
                "project_dir": {"type": "string"},
            },
        },
        "handler": tool_dbt_review,
    },
}


# ---------------------------------------------------------------------------
# Server wiring
# ---------------------------------------------------------------------------

def _build_server() -> Server:
    server = Server(SERVER_NAME)

    @server.list_tools()
    async def list_tools() -> List[types.Tool]:
        return [
            types.Tool(
                name=name,
                description=meta["description"],
                inputSchema=meta["input_schema"],
            )
            for name, meta in TOOLS.items()
        ]

    @server.call_tool()
    async def call_tool(name: str, arguments: Dict[str, Any]) -> List[types.TextContent]:
        meta = TOOLS.get(name)
        if not meta:
            return _err(f"unknown tool: {name}")
        try:
            return meta["handler"](arguments or {})
        except Exception as exc:  # noqa: BLE001 — surface any failure to the client
            return _err(f"{type(exc).__name__}: {exc}")

    return server


async def _run() -> None:
    server = _build_server()
    init_options = InitializationOptions(
        server_name=SERVER_NAME,
        server_version=SERVER_VERSION,
        capabilities=server.get_capabilities(
            notification_options=NotificationOptions(),
            experimental_capabilities={},
        ),
    )
    async with stdio_server() as (read_stream, write_stream):
        await server.run(read_stream, write_stream, init_options)


def main() -> None:
    """Console entry point."""
    asyncio.run(_run())


if __name__ == "__main__":
    main()
