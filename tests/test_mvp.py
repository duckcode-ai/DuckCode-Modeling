import json
import subprocess
import tempfile
import unittest
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

from dm_core import compile_model, lint_issues, load_schema, load_yaml_model, schema_issues, semantic_diff


class MvpTests(unittest.TestCase):
    def setUp(self) -> None:
        self.sample_model = ROOT / "model-examples" / "starter-commerce.model.yaml"
        self.updated_model = ROOT / "tests" / "updated-commerce.model.yaml"
        self.schema = ROOT / "schemas" / "model.schema.json"

    def test_schema_validation_passes(self) -> None:
        model = load_yaml_model(str(self.sample_model))
        schema = load_schema(str(self.schema))
        issues = schema_issues(model, schema)
        self.assertEqual([], issues)

    def test_semantic_lint_passes_for_starter(self) -> None:
        model = load_yaml_model(str(self.sample_model))
        issues = lint_issues(model)
        errors = [issue for issue in issues if issue.severity == "error"]
        self.assertEqual([], errors)

    def test_compile_is_deterministic_shape(self) -> None:
        model = load_yaml_model(str(self.sample_model))
        compiled = compile_model(model)
        self.assertIn("entities", compiled)
        self.assertIn("relationships", compiled)
        self.assertEqual("commerce", compiled["model"]["name"])

    def test_diff_detects_changes(self) -> None:
        old_model = load_yaml_model(str(self.sample_model))
        new_model = load_yaml_model(str(self.updated_model))
        diff = semantic_diff(old_model, new_model)
        self.assertEqual(2, diff["summary"]["changed_entities"])
        self.assertTrue(diff["has_breaking_changes"])

    def test_compile_writes_json(self) -> None:
        model = load_yaml_model(str(self.sample_model))
        compiled = compile_model(model)
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "compiled.json"
            out.write_text(json.dumps(compiled, indent=2), encoding="utf-8")
            self.assertTrue(out.exists())

    def test_cli_validate_all(self) -> None:
        result = subprocess.run(
            ["./dm", "validate-all", "--glob", "model-examples/*.model.yaml"],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("All model files passed validation.", result.stdout)

    def test_cli_gate_blocks_breaking_changes(self) -> None:
        result = subprocess.run(
            [
                "./dm",
                "gate",
                str(self.sample_model),
                str(self.updated_model),
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn("breaking changes", result.stdout.lower())

    def test_cli_gate_allow_breaking(self) -> None:
        result = subprocess.run(
            [
                "./dm",
                "gate",
                str(self.sample_model),
                str(self.updated_model),
                "--allow-breaking",
            ],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("Gate passed.", result.stdout)


if __name__ == "__main__":
    unittest.main()
