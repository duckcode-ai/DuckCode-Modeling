"""DataLex MCP stdio server.

Exposes DataLex docs export, doc-block index, readiness review, and model
listing as MCP tools so Claude Desktop / Cursor / Code can answer
questions about a DataLex project without leaving the chat.
"""

from datalex_mcp.server import main

__all__ = ["main"]
