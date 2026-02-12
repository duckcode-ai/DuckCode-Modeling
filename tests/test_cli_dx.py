"""Phase 7 — CLI & Developer Experience tests.

Covers:
  - dm doctor (diagnostics)
  - dm migrate (SQL migration generation)
  - dm completion (bash/zsh/fish)
  - dm watch (parser only — actual watch is interactive)
  - CLI parser entries for new commands
  - Migration SQL correctness (add/drop/alter column, create/drop table, indexes)
  - Rich output helpers
"""

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from typing import Any, Dict, List

import yaml

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "packages" / "cli" / "src"))

from dm_core.migrate import generate_migration, write_migration
from dm_core.doctor import run_diagnostics, format_diagnostics, diagnostics_as_json, DiagnosticResult
from dm_core.completion import generate_bash_completion, generate_zsh_completion, generate_fish_completion


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_model(**overrides) -> Dict[str, Any]:
    base: Dict[str, Any] = {
        "model": {
            "name": "test_model",
            "version": "1.0.0",
            "domain": "test",
            "owners": ["test@example.com"],
            "state": "draft",
        },
        "entities": [
            {
                "name": "Customer",
                "type": "table",
                "fields": [
                    {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                    {"name": "email", "type": "string", "nullable": False},
                    {"name": "name", "type": "string", "nullable": True},
                ],
            },
        ],
        "relationships": [],
        "indexes": [],
    }
    base.update(overrides)
    return base


# ===========================================================================
# Migration generator
# ===========================================================================

class TestMigrationGenerator(unittest.TestCase):
    """Tests for generate_migration."""

    def test_no_changes(self):
        model = _make_model()
        sql = generate_migration(model, model)
        self.assertIn("Migration:", sql)
        self.assertNotIn("ALTER TABLE", sql)
        self.assertNotIn("CREATE TABLE", sql.split("-- Generated")[1] if "-- Generated" in sql else "")

    def test_add_entity(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "string", "nullable": True},
            ]},
            {"name": "Order", "type": "table", "fields": [
                {"name": "order_id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "total", "type": "float", "nullable": False},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("CREATE TABLE", sql)
        self.assertIn("order", sql.lower())

    def test_drop_entity(self):
        old = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
            ]},
            {"name": "Legacy", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
            ]},
        ])
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("DROP TABLE", sql)
        self.assertIn("legacy", sql.lower())

    def test_add_column(self):
        old = _make_model()
        new_entities = [
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "phone", "type": "string", "nullable": True},
            ]},
        ]
        new = _make_model(entities=new_entities)
        sql = generate_migration(old, new)
        self.assertIn("ADD COLUMN", sql)
        self.assertIn("phone", sql.lower())

    def test_drop_column(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("DROP COLUMN", sql)
        self.assertIn("name", sql.lower())

    def test_alter_column_type(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "text", "nullable": True},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("ALTER COLUMN", sql)
        self.assertIn("TYPE", sql)

    def test_alter_column_nullable(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "string", "nullable": False},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("SET NOT NULL", sql)

    def test_alter_column_drop_not_null(self):
        old = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
            ]},
        ])
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": True},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("DROP NOT NULL", sql)

    def test_alter_column_default(self):
        old = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "status", "type": "string", "nullable": False},
            ]},
        ])
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "status", "type": "string", "nullable": False, "default": "active"},
            ]},
        ])
        sql = generate_migration(old, new)
        self.assertIn("SET DEFAULT", sql)
        self.assertIn("active", sql)

    def test_add_index(self):
        old = _make_model()
        new = _make_model(indexes=[
            {"name": "idx_customer_email", "entity": "Customer", "fields": ["email"], "unique": True},
        ])
        sql = generate_migration(old, new)
        self.assertIn("CREATE UNIQUE INDEX", sql)
        self.assertIn("idx_customer_email", sql)

    def test_drop_index(self):
        old = _make_model(indexes=[
            {"name": "idx_customer_email", "entity": "Customer", "fields": ["email"], "unique": True},
        ])
        new = _make_model()
        sql = generate_migration(old, new)
        self.assertIn("DROP INDEX", sql)
        self.assertIn("idx_customer_email", sql)

    def test_snowflake_dialect(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "phone", "type": "string", "nullable": True},
            ]},
        ])
        sql = generate_migration(old, new, dialect="snowflake")
        self.assertIn("ADD COLUMN", sql)
        self.assertIn("Dialect: snowflake", sql)

    def test_bigquery_dialect(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "text", "nullable": True},
            ]},
        ])
        sql = generate_migration(old, new, dialect="bigquery")
        self.assertIn("Dialect: bigquery", sql)

    def test_write_migration(self):
        old = _make_model()
        new = _make_model(entities=[
            {"name": "Customer", "type": "table", "fields": [
                {"name": "id", "type": "integer", "primary_key": True, "nullable": False},
                {"name": "email", "type": "string", "nullable": False},
                {"name": "name", "type": "string", "nullable": True},
                {"name": "phone", "type": "string", "nullable": True},
            ]},
        ])
        with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as f:
            out_path = f.name
        try:
            result = write_migration(old, new, out_path)
            self.assertEqual(result, out_path)
            content = Path(out_path).read_text()
            self.assertIn("ADD COLUMN", content)
        finally:
            os.unlink(out_path)

    def test_version_in_header(self):
        old = _make_model()
        new_model = _make_model()
        new_model["model"]["version"] = "2.0.0"
        sql = generate_migration(old, new_model)
        self.assertIn("v1.0.0 -> v2.0.0", sql)

    def test_skip_views(self):
        old = {
            "model": {"name": "test", "version": "1.0.0", "domain": "t", "owners": ["a@b.com"], "state": "draft"},
            "entities": [
                {"name": "MyView", "type": "view", "fields": [{"name": "a", "type": "string"}]},
            ],
            "relationships": [],
            "indexes": [],
        }
        new = {
            "model": {"name": "test", "version": "1.0.0", "domain": "t", "owners": ["a@b.com"], "state": "draft"},
            "entities": [],
            "relationships": [],
            "indexes": [],
        }
        sql = generate_migration(old, new)
        self.assertNotIn("DROP TABLE", sql)

    def test_invalid_dialect(self):
        with self.assertRaises(ValueError):
            generate_migration(_make_model(), _make_model(), dialect="invalid")


# ===========================================================================
# Doctor diagnostics
# ===========================================================================

class TestDoctor(unittest.TestCase):
    """Tests for dm doctor diagnostics."""

    def test_run_diagnostics_on_project(self):
        results = run_diagnostics(str(ROOT))
        self.assertGreater(len(results), 0)
        statuses = {r.status for r in results}
        self.assertTrue(statuses.issubset({"ok", "warn", "error"}))

    def test_model_schema_found(self):
        results = run_diagnostics(str(ROOT))
        schema_check = [r for r in results if r.name == "model_schema"]
        self.assertEqual(len(schema_check), 1)
        self.assertEqual(schema_check[0].status, "ok")

    def test_policy_schema_found(self):
        results = run_diagnostics(str(ROOT))
        schema_check = [r for r in results if r.name == "policy_schema"]
        self.assertEqual(len(schema_check), 1)
        self.assertEqual(schema_check[0].status, "ok")

    def test_model_files_found(self):
        results = run_diagnostics(str(ROOT))
        model_check = [r for r in results if r.name == "model_files"]
        self.assertEqual(len(model_check), 1)
        self.assertEqual(model_check[0].status, "ok")

    def test_format_diagnostics(self):
        results = run_diagnostics(str(ROOT))
        output = format_diagnostics(results)
        self.assertIn("DuckCodeModeling Doctor", output)
        self.assertIn("Summary:", output)

    def test_diagnostics_as_json(self):
        results = run_diagnostics(str(ROOT))
        data = diagnostics_as_json(results)
        self.assertIn("checks", data)
        self.assertIn("summary", data)
        self.assertIn("healthy", data)
        self.assertIsInstance(data["checks"], list)

    def test_nonexistent_directory(self):
        results = run_diagnostics("/nonexistent/path/xyz")
        self.assertTrue(any(r.status == "error" for r in results))

    def test_diagnostic_result_to_dict(self):
        r = DiagnosticResult("test", "ok", "message")
        d = r.to_dict()
        self.assertEqual(d["name"], "test")
        self.assertEqual(d["status"], "ok")
        self.assertEqual(d["message"], "message")


# ===========================================================================
# Shell completion
# ===========================================================================

class TestCompletion(unittest.TestCase):
    """Tests for shell completion generators."""

    def test_bash_completion(self):
        output = generate_bash_completion()
        self.assertIn("_dm_completions", output)
        self.assertIn("complete -F", output)
        self.assertIn("validate", output)
        self.assertIn("policy-check", output)
        self.assertIn("doctor", output)
        self.assertIn("migrate", output)
        self.assertIn("apply", output)
        self.assertIn("watch", output)

    def test_zsh_completion(self):
        output = generate_zsh_completion()
        self.assertIn("#compdef dm", output)
        self.assertIn("_dm", output)
        self.assertIn("validate", output)
        self.assertIn("doctor", output)
        self.assertIn("migrate", output)
        self.assertIn("apply", output)

    def test_fish_completion(self):
        output = generate_fish_completion()
        self.assertIn("complete -c dm", output)
        self.assertIn("validate", output)
        self.assertIn("doctor", output)
        self.assertIn("migrate", output)
        self.assertIn("apply", output)

    def test_bash_includes_subcommands(self):
        output = generate_bash_completion()
        self.assertIn("sql", output)
        self.assertIn("dbt", output)
        self.assertIn("avro", output)
        self.assertIn("json-schema", output)

    def test_bash_includes_dialects(self):
        output = generate_bash_completion()
        self.assertIn("postgres", output)
        self.assertIn("snowflake", output)
        self.assertIn("bigquery", output)
        self.assertIn("databricks", output)

    def test_zsh_includes_subcommands(self):
        output = generate_zsh_completion()
        self.assertIn("sql", output)
        self.assertIn("dbt", output)

    def test_fish_includes_subcommands(self):
        output = generate_fish_completion()
        self.assertIn("generate", output)
        self.assertIn("import", output)


# ===========================================================================
# CLI parser
# ===========================================================================

class TestCLIParser(unittest.TestCase):
    """Tests for CLI parser entries for new commands."""

    def test_doctor_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["doctor"])
        self.assertEqual(args.path, ".")

    def test_doctor_parser_with_path(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["doctor", "--path", "/tmp"])
        self.assertEqual(args.path, "/tmp")

    def test_doctor_parser_json(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["doctor", "--output-json"])
        self.assertTrue(args.output_json)

    def test_migrate_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["migrate", "old.yaml", "new.yaml"])
        self.assertEqual(args.old, "old.yaml")
        self.assertEqual(args.new, "new.yaml")
        self.assertEqual(args.dialect, "postgres")

    def test_migrate_parser_dialect(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["migrate", "old.yaml", "new.yaml", "--dialect", "snowflake"])
        self.assertEqual(args.dialect, "snowflake")

    def test_migrate_parser_out(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["migrate", "old.yaml", "new.yaml", "--out", "migration.sql"])
        self.assertEqual(args.out, "migration.sql")

    def test_apply_parser_sql_file_dry_run(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "apply", "snowflake", "--sql-file", "migration.sql", "--dry-run", "--dialect", "snowflake"
        ])
        self.assertEqual(args.connector, "snowflake")
        self.assertEqual(args.sql_file, "migration.sql")
        self.assertTrue(args.dry_run)

    def test_apply_parser_old_new(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "apply", "bigquery", "--old", "old.model.yaml", "--new", "new.model.yaml", "--project", "p", "--dataset", "d"
        ])
        self.assertEqual(args.connector, "bigquery")
        self.assertEqual(args.old, "old.model.yaml")
        self.assertEqual(args.new, "new.model.yaml")
        self.assertEqual(args.project, "p")
        self.assertEqual(args.dataset, "d")

    def test_apply_parser_guardrail_and_report_flags(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args([
            "apply", "snowflake", "--sql-file", "migration.sql", "--allow-destructive",
            "--policy-pack", "policies/default.policy.yaml", "--skip-policy-check",
            "--write-sql", "final.sql", "--report-json", "apply_report.json", "--output-json",
        ])
        self.assertTrue(args.allow_destructive)
        self.assertEqual(args.policy_pack, "policies/default.policy.yaml")
        self.assertTrue(args.skip_policy_check)
        self.assertEqual(args.write_sql, "final.sql")
        self.assertEqual(args.report_json, "apply_report.json")
        self.assertTrue(args.output_json)

    def test_detect_destructive_statements(self):
        from dm_cli.main import _detect_destructive_statements
        findings = _detect_destructive_statements([
            "CREATE TABLE demo (id INT)",
            "DROP TABLE demo",
            "ALTER TABLE demo DROP COLUMN legacy_col",
        ])
        self.assertEqual(len(findings), 2)
        self.assertEqual(findings[0]["statement_index"], 2)
        self.assertEqual(findings[0]["kind"], "DROP TABLE")
        self.assertEqual(findings[1]["statement_index"], 3)

    def test_completion_parser_bash(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["completion", "bash"])
        self.assertEqual(args.shell, "bash")

    def test_completion_parser_zsh(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["completion", "zsh"])
        self.assertEqual(args.shell, "zsh")

    def test_completion_parser_fish(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["completion", "fish"])
        self.assertEqual(args.shell, "fish")

    def test_watch_parser(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["watch"])
        self.assertEqual(args.glob, "**/*.model.yaml")
        self.assertEqual(args.interval, 2)

    def test_watch_parser_custom(self):
        from dm_cli.main import build_parser
        parser = build_parser()
        args = parser.parse_args(["watch", "--glob", "models/*.yaml", "--interval", "5"])
        self.assertEqual(args.glob, "models/*.yaml")
        self.assertEqual(args.interval, 5)


# ===========================================================================
# CLI integration (subprocess)
# ===========================================================================

class TestCLIIntegration(unittest.TestCase):
    """Integration tests running actual CLI commands."""

    def test_doctor_runs(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "doctor", "--path", str(ROOT)],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertIn("DuckCodeModeling Doctor", result.stdout)

    def test_doctor_json_runs(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "doctor", "--path", str(ROOT), "--output-json"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        data = json.loads(result.stdout)
        self.assertIn("checks", data)
        self.assertIn("healthy", data)

    def test_migrate_runs(self):
        import subprocess
        model_path = str(ROOT / "model-examples" / "starter-commerce.model.yaml")
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "migrate", model_path, model_path],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("Migration:", result.stdout)

    def test_apply_dry_run_runs(self):
        import subprocess
        with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as f:
            f.write(b"CREATE TABLE t1 (id INT);\n")
            sql_path = f.name
        try:
            result = subprocess.run(
                [sys.executable, "-m", "dm_cli.main", "apply", "snowflake", "--sql-file", sql_path, "--dry-run", "--dialect", "snowflake"],
                capture_output=True, text=True, cwd=str(ROOT),
                env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
            )
            self.assertEqual(result.returncode, 0)
            self.assertIn("DRY RUN", result.stdout)
        finally:
            os.unlink(sql_path)


    def test_apply_dry_run_blocks_destructive_sql(self):
        import subprocess
        with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as f:
            f.write(b"DROP TABLE t1;\n")
            sql_path = f.name
        try:
            result = subprocess.run(
                [sys.executable, "-m", "dm_cli.main", "apply", "snowflake", "--sql-file", sql_path, "--dry-run", "--dialect", "snowflake"],
                capture_output=True, text=True, cwd=str(ROOT),
                env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("destructive SQL detected", result.stderr)
        finally:
            os.unlink(sql_path)

    def test_apply_dry_run_allow_destructive_with_report(self):
        import subprocess
        with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as f:
            f.write(b"DROP TABLE t1;\n")
            sql_path = f.name
        with tempfile.NamedTemporaryFile(suffix=".json", delete=False) as f_report:
            report_path = f_report.name
        with tempfile.NamedTemporaryFile(suffix=".sql", delete=False) as f_write:
            write_sql_path = f_write.name
        try:
            result = subprocess.run(
                [
                    sys.executable, "-m", "dm_cli.main", "apply", "snowflake", "--sql-file", sql_path,
                    "--dry-run", "--dialect", "snowflake", "--allow-destructive",
                    "--report-json", report_path, "--write-sql", write_sql_path, "--output-json",
                ],
                capture_output=True, text=True, cwd=str(ROOT),
                env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
            )
            self.assertEqual(result.returncode, 0)
            payload = json.loads(result.stdout)
            self.assertEqual(payload.get("status"), "dry_run")
            self.assertEqual(payload.get("destructive_statement_count"), 1)

            report_payload = json.loads(Path(report_path).read_text())
            self.assertEqual(report_payload.get("status"), "dry_run")
            self.assertEqual(report_payload.get("destructive_statement_count"), 1)

            written_sql = Path(write_sql_path).read_text()
            self.assertIn("DROP TABLE t1", written_sql)
        finally:
            os.unlink(sql_path)
            os.unlink(report_path)
            os.unlink(write_sql_path)

    def test_completion_bash_runs(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "completion", "bash"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("_dm_completions", result.stdout)

    def test_completion_zsh_runs(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "completion", "zsh"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("#compdef dm", result.stdout)

    def test_completion_fish_runs(self):
        import subprocess
        result = subprocess.run(
            [sys.executable, "-m", "dm_cli.main", "completion", "fish"],
            capture_output=True, text=True, cwd=str(ROOT),
            env={**os.environ, "PYTHONPATH": str(ROOT / "packages" / "core_engine" / "src") + ":" + str(ROOT / "packages" / "cli" / "src")},
        )
        self.assertEqual(result.returncode, 0)
        self.assertIn("complete -c dm", result.stdout)


# ===========================================================================
# Module existence
# ===========================================================================

class TestModuleFiles(unittest.TestCase):
    """Verify new module files exist."""

    def test_migrate_module(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "migrate.py").exists())

    def test_doctor_module(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "doctor.py").exists())

    def test_completion_module(self):
        self.assertTrue((ROOT / "packages" / "core_engine" / "src" / "dm_core" / "completion.py").exists())


if __name__ == "__main__":
    unittest.main()
