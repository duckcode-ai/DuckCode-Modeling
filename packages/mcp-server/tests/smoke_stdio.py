"""Manual smoke test for the datalex-mcp stdio server.

Spawns `datalex-mcp` as a subprocess and walks the standard MCP handshake
(`initialize` → `tools/list` → `tools/call`) over stdio JSON-RPC. Prints
the responses so a human can sanity-check that each tool returns sane
output against the local jaffle-shop-DataLex checkout.

Run:
    python packages/mcp-server/tests/smoke_stdio.py [project_dir]

Default project_dir: /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex/DataLex
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from pathlib import Path

PROJECT_DIR = sys.argv[1] if len(sys.argv) > 1 else "/Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex/DataLex"


def send(proc: subprocess.Popen, msg: dict) -> None:
    body = json.dumps(msg) + "\n"
    proc.stdin.write(body.encode("utf-8"))
    proc.stdin.flush()


def recv(proc: subprocess.Popen, timeout_s: float = 10.0) -> dict | None:
    """Read one line of JSON from the server (it uses LSP-style line-delimited JSON-RPC over stdio)."""
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        line = proc.stdout.readline()
        if not line:
            time.sleep(0.05)
            continue
        try:
            return json.loads(line.decode("utf-8"))
        except json.JSONDecodeError:
            sys.stderr.write(f"[non-json] {line!r}\n")
            continue
    raise TimeoutError("server did not respond in time")


def main() -> int:
    cmd = [sys.executable, "-m", "datalex_mcp.server"]
    proc = subprocess.Popen(
        cmd,
        stdin=subprocess.PIPE,
        stdout=subprocess.PIPE,
        stderr=sys.stderr,
        env={**os.environ},
    )

    try:
        # 1. initialize
        send(proc, {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": {"name": "smoke-test", "version": "0.1"},
            },
        })
        init = recv(proc)
        print("\n=== initialize ===")
        print(json.dumps(init, indent=2)[:600])

        # MCP requires sending the `notifications/initialized` notification
        send(proc, {"jsonrpc": "2.0", "method": "notifications/initialized"})

        # 2. tools/list
        send(proc, {"jsonrpc": "2.0", "id": 2, "method": "tools/list"})
        tools = recv(proc)
        print("\n=== tools/list ===")
        names = [t["name"] for t in tools["result"]["tools"]]
        print("tools:", names)

        # 3. docs.list
        send(proc, {
            "jsonrpc": "2.0", "id": 3, "method": "tools/call",
            "params": {"name": "docs.list", "arguments": {"project_dir": PROJECT_DIR}},
        })
        out = recv(proc)
        print("\n=== docs.list ===")
        print(out["result"]["content"][0]["text"][:600])

        # 4. dbt.doc_blocks
        send(proc, {
            "jsonrpc": "2.0", "id": 4, "method": "tools/call",
            "params": {"name": "dbt.doc_blocks", "arguments": {"project_dir": PROJECT_DIR}},
        })
        out = recv(proc)
        print("\n=== dbt.doc_blocks ===")
        print(out["result"]["content"][0]["text"][:400])

        # 5. docs.export
        out_dir = "/tmp/datalex-mcp-export"
        send(proc, {
            "jsonrpc": "2.0", "id": 5, "method": "tools/call",
            "params": {
                "name": "docs.export",
                "arguments": {"project_dir": PROJECT_DIR, "out_dir": out_dir},
            },
        })
        out = recv(proc, timeout_s=30)
        print("\n=== docs.export ===")
        print(out["result"]["content"][0]["text"][:600])
        print(f"\nfiles under {out_dir}:")
        for p in sorted(Path(out_dir).rglob("*.md")):
            print(f"  {p.relative_to(out_dir)}")

        return 0
    finally:
        try:
            proc.stdin.close()
        except Exception:
            pass
        proc.terminate()
        proc.wait(timeout=3)


if __name__ == "__main__":
    sys.exit(main())
