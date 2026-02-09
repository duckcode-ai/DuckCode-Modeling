import subprocess
import tempfile
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
FIXTURES = ROOT / "tests" / "fixtures"
POLICIES = ROOT / "tests" / "policies"
MODEL = ROOT / "model-examples" / "starter-commerce.model.yaml"


class IntegrationCommandTests(unittest.TestCase):
    def run_dm(self, args):
        return subprocess.run(
            ["./dm", *args],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )

    def test_generate_sql_postgres(self):
        result = self.run_dm(
            ["generate", "sql", str(MODEL), "--dialect", "postgres"]
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("CREATE TABLE", result.stdout)

    def test_generate_dbt_scaffold(self):
        with tempfile.TemporaryDirectory() as tmp:
            result = self.run_dm(
                [
                    "generate",
                    "dbt",
                    str(MODEL),
                    "--out-dir",
                    tmp,
                    "--project-name",
                    "commerce_models",
                ]
            )
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertTrue((Path(tmp) / "dbt_project.yml").exists())
            self.assertTrue((Path(tmp) / "models" / "staging" / "schema.yml").exists())

    def test_generate_metadata_json(self):
        result = self.run_dm(["generate", "metadata", str(MODEL)])
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("\"entity_count\"", result.stdout)

    def test_import_sql_and_validate(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "imported_sql.model.yaml"
            result = self.run_dm(
                [
                    "import",
                    "sql",
                    str(FIXTURES / "sample_schema.sql"),
                    "--out",
                    str(out),
                ]
            )
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertTrue(out.exists())

            validate = self.run_dm(["validate", str(out)])
            self.assertEqual(0, validate.returncode, validate.stdout + validate.stderr)

    def test_import_dbml_and_validate(self):
        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "imported_dbml.model.yaml"
            result = self.run_dm(
                [
                    "import",
                    "dbml",
                    str(FIXTURES / "sample_schema.dbml"),
                    "--out",
                    str(out),
                ]
            )
            self.assertEqual(0, result.returncode, result.stdout + result.stderr)
            self.assertTrue(out.exists())

            validate = self.run_dm(["validate", str(out)])
            self.assertEqual(0, validate.returncode, validate.stdout + validate.stderr)

    def test_policy_check_pass(self):
        result = self.run_dm(
            [
                "policy-check",
                str(MODEL),
                "--policy",
                str(POLICIES / "pass.policy.yaml"),
            ]
        )
        self.assertEqual(0, result.returncode, result.stdout + result.stderr)
        self.assertIn("Policy check passed.", result.stdout)

    def test_policy_check_fail(self):
        result = self.run_dm(
            [
                "policy-check",
                str(MODEL),
                "--policy",
                str(POLICIES / "fail.policy.yaml"),
            ]
        )
        self.assertEqual(1, result.returncode, result.stdout + result.stderr)
        self.assertIn("Policy check failed.", result.stdout)


if __name__ == "__main__":
    unittest.main()
