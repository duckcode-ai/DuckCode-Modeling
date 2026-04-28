# `datalex-mcp` — MCP stdio server for DataLex

Exposes DataLex's docs export, doc-block index, readiness review, and model
listing as MCP tools. Plug into Claude Desktop, Cursor, or any MCP-aware
agent and ask questions about a DataLex project without leaving the chat.

## Install

From the monorepo root, while developing:

```bash
pip install -e packages/mcp-server -e packages/cli -e packages/core_engine
```

Or as a published package (when shipped to PyPI):

```bash
pip install datalex-mcp
```

## Configure

### Claude Desktop / Cursor / Code

Add to `~/Library/Application Support/Claude/claude_desktop_config.json`
(or the equivalent for your client):

```json
{
  "mcpServers": {
    "datalex": {
      "command": "datalex-mcp"
    }
  }
}
```

Restart the client. The DataLex tools should appear under the MCP picker.

## Tools

| Tool name | Description |
|---|---|
| `docs.export` | Walk a project, write per-model + per-domain Markdown (with mermaid ERDs) to `out_dir`. Returns the export summary. |
| `docs.list` | List recognized DataLex models in a project (path, kind, domain, layer, name). |
| `dbt.doc_blocks` | List all `{% docs %}` blocks for a project, or fetch one by name. |
| `dbt.review` | Run the readiness gate over a project; return the per-file scores summary. |

All tools take a `project_dir` argument that points at the DataLex project root.

## Why this exists

Daniel Wiszowaty in dbt Slack: *"Like an internal Data Catalog MCP with all
the lineage, yaml, mds and clis and so on."* This is that — a thin MCP
wrapper over the DataLex CLI/core surface, so any MCP client gets every
DataLex feature for free.
