"""DataLex loader, snippet expansion, diff, and migrator smoke tests.

These cover the Phase A vertical slice: kind-dispatched YAML load, snippet
`use:` inlining, explicit rename tracking, and v3→DataLex migration.
"""

from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from dm_core.datalex import load_project
from dm_core.datalex.diff import diff_entities
from dm_core.datalex.migrate_layout import migrate_project
from dm_core.datalex.types import parse_type


def _write(p: Path, body: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


def _mk_project(root: Path) -> None:
    _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
    _write(
        root / "models" / "physical" / "postgres" / "customer.yaml",
        "kind: entity\nlayer: physical\ndialect: postgres\nname: customer\n"
        "columns:\n"
        "  - name: id\n    type: bigint\n    primary_key: true\n    nullable: false\n"
        "  - name: email\n    type: string(320)\n    use: pii_email\n",
    )
    _write(
        root / ".datalex" / "snippets" / "pii_email.yaml",
        "kind: snippet\nname: pii_email\ntargets: [column]\napply:\n  sensitivity: pii-email\n  tags: [pii]\n",
    )


class TypeParserTests(unittest.TestCase):
    def test_parameterized_and_composite(self) -> None:
        self.assertEqual(parse_type("decimal(12,2)").kind, "decimal")
        self.assertEqual(parse_type("array<string>").kind, "array")
        self.assertEqual(parse_type("map<string,integer>").kind, "map")
        s = parse_type("struct<a:string,b:integer>")
        self.assertEqual(s.kind, "struct")
        self.assertEqual([f[0] for f in s.fields], ["a", "b"])


class ProjectLoaderTests(unittest.TestCase):
    def test_loads_and_expands_snippet(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _mk_project(root)
            project = load_project(root, strict=True)
            self.assertEqual(1, len(project.entities))
            email_col = next(
                c for c in project.entity("customer").get("columns", []) if c["name"] == "email"
            )
            self.assertEqual("pii-email", email_col.get("sensitivity"))
            self.assertIn("pii", email_col.get("tags", []))


class DiffTests(unittest.TestCase):
    def test_explicit_rename_is_not_drop_add(self) -> None:
        old = {
            "physical:customer": {
                "kind": "entity", "layer": "physical", "dialect": "postgres",
                "name": "customer", "columns": [{"name": "id", "type": "bigint"}],
            }
        }
        new = {
            "physical:party": {
                "kind": "entity", "layer": "physical", "dialect": "postgres",
                "name": "party", "previous_name": "customer",
                "columns": [{"name": "id", "type": "bigint"}],
            }
        }
        result = diff_entities(old, new)
        self.assertEqual(result["renamed"], [("physical:customer", "physical:party")])
        self.assertEqual(result["added"], [])
        self.assertEqual(result["removed"], [])

    def test_column_type_change_is_breaking(self) -> None:
        old = {
            "physical:x": {
                "kind": "entity", "layer": "physical", "name": "x",
                "columns": [{"name": "a", "type": "integer"}],
            }
        }
        new = {
            "physical:x": {
                "kind": "entity", "layer": "physical", "name": "x",
                "columns": [{"name": "a", "type": "bigint"}],
            }
        }
        result = diff_entities(old, new)
        self.assertTrue(any("type changed" in b for b in result["breaking"]))


class MigratorTests(unittest.TestCase):
    def test_migrates_starter_commerce(self) -> None:
        v3 = ROOT / "model-examples" / "starter-commerce.model.yaml"
        if not v3.exists():
            self.skipTest("starter-commerce.model.yaml not present")
        with tempfile.TemporaryDirectory() as tmp:
            report = migrate_project(str(v3), output_root=tmp, default_dialect="postgres")
            self.assertTrue(report.manifest_written)
            self.assertGreater(report.entities_written, 0)
            project = load_project(tmp, strict=True)
            self.assertEqual(report.entities_written, len(project.entities))


if __name__ == "__main__":
    unittest.main()
