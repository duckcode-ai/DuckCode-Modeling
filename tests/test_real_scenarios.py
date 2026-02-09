import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCENARIOS = ROOT / "tests" / "scenarios"


class RealScenarioTests(unittest.TestCase):
    def run_dm(self, args):
        return subprocess.run(
            ["./dm", *args],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_non_breaking_gate_passes(self):
        result = self.run_dm(
            [
                "gate",
                str(SCENARIOS / "base.model.yaml"),
                str(SCENARIOS / "non_breaking.model.yaml"),
            ]
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("Gate passed.", result.stdout)

    def test_breaking_gate_fails_without_override(self):
        result = self.run_dm(
            [
                "gate",
                str(SCENARIOS / "base.model.yaml"),
                str(SCENARIOS / "breaking.model.yaml"),
            ]
        )
        self.assertEqual(2, result.returncode, result.stdout + result.stderr)
        self.assertIn("breaking changes", result.stdout.lower())

    def test_breaking_gate_can_be_overridden(self):
        result = self.run_dm(
            [
                "gate",
                str(SCENARIOS / "base.model.yaml"),
                str(SCENARIOS / "breaking.model.yaml"),
                "--allow-breaking",
            ]
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("Gate passed.", result.stdout)

    def test_invalid_model_fails_validation(self):
        result = self.run_dm(
            [
                "validate",
                str(SCENARIOS / "invalid.model.yaml"),
                "--schema",
                str(ROOT / "schemas" / "model.schema.json"),
            ]
        )
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn("ERROR", result.stdout)

    def test_validate_all_on_scenario_folder_detects_invalid(self):
        result = self.run_dm(
            [
                "validate-all",
                "--glob",
                "tests/scenarios/*.model.yaml",
                "--schema",
                str(ROOT / "schemas" / "model.schema.json"),
            ]
        )
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn("Validation failed", result.stdout)


if __name__ == "__main__":
    unittest.main()
