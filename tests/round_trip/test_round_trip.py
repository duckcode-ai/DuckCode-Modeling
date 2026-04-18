"""Round-trip golden tests for DataLex dialect emission.

Each dialect has a small fixture project under tests/round_trip/<dialect>/fixtures/
and a committed SQL snapshot under tests/round_trip/<dialect>/golden/expected.sql.
The test loads the project, emits DDL, and requires a byte-for-byte match against
the golden file.

Regenerate goldens with:
    pytest tests/round_trip/test_round_trip.py --regenerate-golden
"""

from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

from dm_core.datalex import load_project
import dm_core.dialects  # noqa: F401  — registers built-in dialects
from dm_core.dialects.registry import get_dialect


REGEN = os.environ.get("DATALEX_REGEN_GOLDEN") == "1"


def _render_ddl(project_root: Path, dialect_name: str) -> str:
    project = load_project(project_root, strict=True)
    dialect = get_dialect(dialect_name)

    physical_name_of = {
        ent.get("name"): ent.get("physical_name") or ent.get("name")
        for ent in project.physical_entities(dialect=dialect_name)
    }

    chunks = []
    for ent in project.physical_entities(dialect=dialect_name):
        resolved_cols = []
        for col in ent.get("columns", []) or []:
            ref = col.get("references")
            if ref and ref.get("entity") in physical_name_of:
                new_ref = dict(ref)
                new_ref["entity"] = physical_name_of[ref["entity"]]
                col = {**col, "references": new_ref}
            resolved_cols.append(col)
        resolved = {**ent, "columns": resolved_cols}
        chunks.append(dialect.render_entity(resolved))

    return ("\n".join(chunks).rstrip() + "\n") if chunks else ""


class RoundTripTests(unittest.TestCase):
    def _check(self, dialect: str) -> None:
        fixture = ROOT / "tests" / "round_trip" / dialect / "fixtures"
        golden = ROOT / "tests" / "round_trip" / dialect / "golden" / "expected.sql"
        actual = _render_ddl(fixture, dialect)

        if REGEN:
            golden.parent.mkdir(parents=True, exist_ok=True)
            golden.write_text(actual, encoding="utf-8")
            return

        self.assertTrue(
            golden.exists(),
            f"Golden file missing at {golden}; regenerate with DATALEX_REGEN_GOLDEN=1",
        )
        expected = golden.read_text(encoding="utf-8")
        self.assertEqual(
            expected,
            actual,
            msg=(
                f"DDL emission drifted from {golden}.\n"
                f"If this change is intentional, regenerate with "
                f"DATALEX_REGEN_GOLDEN=1 pytest tests/round_trip/."
            ),
        )

    def test_postgres_round_trip(self) -> None:
        self._check("postgres")

    def test_snowflake_round_trip(self) -> None:
        self._check("snowflake")


if __name__ == "__main__":
    unittest.main()
