"""Doc-block index for dbt projects.

dbt resolves `{{ doc("name") }}` jinja references at parse time, so by the
time a manifest is read the description is the rendered markdown — the
reference is gone. To round-trip these references losslessly we maintain a
secondary index that:

  1. Scans every `*.md` file in the project for `{% docs <name> %}…{% enddocs %}`
     blocks → `name → rendered_text`.
  2. Scans every YAML schema file for `{{ doc("<name>") }}` references →
     reverse lookup `rendered_text → reference_name`.
  3. Lets the importer attach `description_ref: { doc: "<name>" }` on a
     column or model whose description matches a known doc-block, and the
     emitter re-emit `description: '{{ doc("<name>") }}'` instead of the
     rendered text.

The index lives in this module (core_engine), is rebuilt lazily by the
api-server on file write, and persists no state to disk — callers cache by
project root + mtime hash.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Iterator, List, Optional


_DOC_BLOCK_RE = re.compile(
    r"\{%\s*docs\s+(?P<name>[A-Za-z0-9_]+)\s*%\}(?P<body>.*?)\{%\s*enddocs\s*%\}",
    re.DOTALL,
)
_DOC_REF_RE = re.compile(r"\{\{\s*doc\(\s*['\"](?P<name>[A-Za-z0-9_]+)['\"]\s*\)\s*\}\}")


@dataclass
class DocBlockIndex:
    """In-memory index of `{% docs %}` blocks and their references."""

    project_root: Path
    blocks: Dict[str, str] = field(default_factory=dict)
    # rendered_text → name (first match wins; on ties prefer earliest by file path)
    by_text: Dict[str, str] = field(default_factory=dict)
    # files scanned, for cache-invalidation diagnostics
    sources: List[str] = field(default_factory=list)

    @classmethod
    def build(cls, project_root: str | Path) -> "DocBlockIndex":
        root = Path(project_root)
        idx = cls(project_root=root)
        if not root.exists() or not root.is_dir():
            return idx
        for md in sorted(root.rglob("*.md")):
            if any(part.startswith(".") for part in md.relative_to(root).parts):
                continue
            try:
                text = md.read_text(encoding="utf-8")
            except OSError:
                continue
            for match in _DOC_BLOCK_RE.finditer(text):
                name = match.group("name")
                body = match.group("body").strip()
                if not name or not body:
                    continue
                idx.blocks.setdefault(name, body)
                idx.by_text.setdefault(body, name)
            idx.sources.append(str(md.relative_to(root)))
        return idx

    # ------------------------------------------------------------------
    # Lookup helpers

    def resolve(self, name: str) -> Optional[str]:
        """`{{ doc("orders") }}` → rendered markdown or None."""
        return self.blocks.get(name)

    def reverse(self, rendered: str) -> Optional[str]:
        """Find the doc-block name whose body matches the rendered description.

        Matching is whitespace-insensitive at the edges so trailing newlines
        introduced by the dbt parser don't cause misses.
        """
        if not rendered:
            return None
        key = rendered.strip()
        if key in self.by_text:
            return self.by_text[key]
        # Fallback: exact whitespace-insensitive scan
        for body, name in self.by_text.items():
            if body.strip() == key:
                return name
        return None

    def references_in(self, text: str) -> Iterator[str]:
        """Yield every `{{ doc("name") }}` reference in a string."""
        for m in _DOC_REF_RE.finditer(text or ""):
            yield m.group("name")

    def as_ref(self, name: str) -> str:
        """Render the dbt jinja reference for embedding in YAML descriptions."""
        return f'{{{{ doc("{name}") }}}}'

    def names(self) -> List[str]:
        return sorted(self.blocks.keys())


# ---------------------------------------------------------------------------
# Module-level helpers


def find_description_ref(
    rendered_description: str,
    index: Optional[DocBlockIndex],
) -> Optional[Dict[str, str]]:
    """Return `{"doc": "<name>"}` if the rendered description came from a doc block."""
    if not index or not rendered_description:
        return None
    name = index.reverse(rendered_description)
    return {"doc": name} if name else None


def render_description_from_ref(
    ref: Dict[str, str],
) -> str:
    """Convert a `description_ref` value back to the dbt jinja string."""
    name = (ref or {}).get("doc") or ""
    if not name:
        return ""
    return f'{{{{ doc("{name}") }}}}'
