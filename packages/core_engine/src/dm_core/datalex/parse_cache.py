"""Content-hash parse cache for DataLex YAML files.

The loader parses YAML, validates against a JSON Schema, and strips source
marks — work that is deterministic given (file bytes, schema bytes). For a
10K-entity project, reparsing every file on every validate / diff / emit is
the dominant cost. This cache eliminates it.

Cache layout:
    <cache_root>/<content_sha>__<schema_sha>.json

where:
  content_sha is sha256(file bytes)
  schema_sha  is sha256(schema bytes for the file's declared kind)

The cached payload is a JSON dump of the already-validated, mark-stripped
document. We store JSON (not pickle) so the cache survives across Python
versions and is inspectable by humans.

Opt-in: set `DATALEX_CACHE=1` in the environment, or pass
`cache_dir=<path>` to `load_project`. Cache is keyed purely by content hash
so stale entries are never served — if the file changes by a single byte,
the cache key changes too.
"""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path
from typing import Any, Dict, Optional


class ParseCache:
    """Disk-backed, content-addressed parse cache.

    Safe to use from multiple processes: writes are atomic via rename.
    Schema hash is lazily computed once per (schemas_root, kind).
    """

    def __init__(self, cache_dir: Path, schemas_root: Path) -> None:
        self.cache_dir = cache_dir
        self.schemas_root = schemas_root
        self._schema_hashes: Dict[str, str] = {}
        self.hits = 0
        self.misses = 0
        self.cache_dir.mkdir(parents=True, exist_ok=True)

    def _schema_hash(self, kind: str) -> str:
        if kind in self._schema_hashes:
            return self._schema_hashes[kind]
        path = self.schemas_root / f"{kind}.schema.json"
        if not path.exists():
            self._schema_hashes[kind] = "no-schema"
            return "no-schema"
        h = hashlib.sha256(path.read_bytes()).hexdigest()
        self._schema_hashes[kind] = h
        return h

    def _key(self, content_sha: str, kind: str) -> Path:
        schema_sha = self._schema_hash(kind)
        return self.cache_dir / f"{content_sha}__{schema_sha}.json"

    def get(self, path: Path, kind: str) -> Optional[Dict[str, Any]]:
        content_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        key = self._key(content_sha, kind)
        if not key.exists():
            self.misses += 1
            return None
        try:
            with key.open("r", encoding="utf-8") as f:
                self.hits += 1
                return json.load(f)
        except (OSError, json.JSONDecodeError):
            # corrupt entry — treat as miss
            self.misses += 1
            return None

    def put(self, path: Path, kind: str, doc: Dict[str, Any]) -> None:
        content_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        key = self._key(content_sha, kind)
        tmp = key.with_suffix(".json.tmp")
        try:
            with tmp.open("w", encoding="utf-8") as f:
                json.dump(doc, f, sort_keys=True)
            os.replace(tmp, key)
        except OSError:
            if tmp.exists():
                tmp.unlink()

    def summary(self) -> Dict[str, int]:
        return {"hits": self.hits, "misses": self.misses}


def cache_enabled_from_env() -> bool:
    return os.environ.get("DATALEX_CACHE", "").lower() in {"1", "true", "yes"}


def default_cache_dir(project_root: Path) -> Path:
    """Return the per-project cache directory. Kept under the project, not $HOME,
    so it's scoped to the checkout and easy to wipe (`rm -rf build/`)."""
    return project_root / "build" / ".cache" / "datalex-parse"
