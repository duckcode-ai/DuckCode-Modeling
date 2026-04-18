"""End-to-end dbt sync test: manifest + DuckDB introspection -> DataLex YAML.

Skips if DuckDB isn't installed. No network, no external warehouse.
"""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

try:
    import duckdb  # noqa: F401

    HAVE_DUCKDB = True
except ImportError:
    HAVE_DUCKDB = False


@unittest.skipUnless(HAVE_DUCKDB, "duckdb not installed")
class DbtSyncEndToEndTest(unittest.TestCase):
    def _bootstrap(self, tmp: Path) -> Path:
        """Lay out a minimal dbt project inside `tmp` and return its path."""
        import duckdb as _duckdb

        project = tmp / "dbt_project"
        (project / "target").mkdir(parents=True)

        (project / "dbt_project.yml").write_text(
            "name: demo\nversion: '1.0.0'\nconfig-version: 2\nprofile: demo\n",
            encoding="utf-8",
        )
        (project / "profiles.yml").write_text(
            "demo:\n"
            "  target: dev\n"
            "  outputs:\n"
            "    dev:\n"
            "      type: duckdb\n"
            f"      path: '{project / 'warehouse.duckdb'}'\n"
            "      schema: main\n",
            encoding="utf-8",
        )

        manifest = {
            "metadata": {"project_name": "demo"},
            "sources": {
                "source.demo.raw.customers": {
                    "unique_id": "source.demo.raw.customers",
                    "resource_type": "source",
                    "name": "customers",
                    "source_name": "raw",
                    "database": "warehouse",
                    "schema": "main",
                    "identifier": "raw_customers",
                    "description": "Raw customer feed.",
                    "columns": {
                        "id": {"name": "id", "description": "Primary key."},
                        "email": {"name": "email"},
                    },
                }
            },
            "nodes": {
                "model.demo.stg_customers": {
                    "unique_id": "model.demo.stg_customers",
                    "resource_type": "model",
                    "name": "stg_customers",
                    "database": "warehouse",
                    "schema": "main",
                    "description": "Staged customers.",
                    "config": {"materialized": "view"},
                    "depends_on": {"nodes": ["source.demo.raw.customers"]},
                    "columns": {
                        "customer_id": {"name": "customer_id"},
                        "email": {"name": "email"},
                    },
                }
            },
        }
        (project / "target" / "manifest.json").write_text(
            json.dumps(manifest), encoding="utf-8"
        )

        con = _duckdb.connect(str(project / "warehouse.duckdb"))
        try:
            con.execute(
                """
                CREATE TABLE raw_customers (
                  id BIGINT PRIMARY KEY,
                  email VARCHAR NOT NULL
                );
                INSERT INTO raw_customers VALUES (1, 'a@b.com'), (2, 'c@d.com');

                CREATE VIEW stg_customers AS
                  SELECT id AS customer_id, email FROM raw_customers;
                """
            )
        finally:
            con.close()

        return project

    def test_sync_enriches_columns_from_warehouse(self) -> None:
        from dm_core.dbt.sync import sync_dbt_project

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            project = self._bootstrap(tmp)
            out_root = tmp / "datalex-out"

            report = sync_dbt_project(
                dbt_project_dir=str(project),
                datalex_root=str(out_root),
            )

            self.assertEqual(report.dialect, "duckdb")
            self.assertEqual(len(report.tables), 2)
            by_kind = {t.kind: t for t in report.tables}
            self.assertTrue(by_kind["source"].warehouse_reachable)
            self.assertTrue(by_kind["model"].warehouse_reachable)
            self.assertEqual(by_kind["source"].columns_from_warehouse, 2)

            # Source file on disk now has warehouse types
            src_doc = yaml.safe_load(
                (out_root / "sources" / "raw.yaml").read_text(encoding="utf-8")
            )
            tables = {t["name"]: t for t in src_doc["tables"]}
            customers = tables["customers"]
            cols_by_name = {c["name"]: c for c in customers["columns"]}
            self.assertEqual(cols_by_name["id"]["type"], "bigint")
            # duckdb varchar normalizes to 'string'
            self.assertEqual(cols_by_name["email"]["type"], "string")
            # user-authored description on `id` must survive
            self.assertEqual(cols_by_name["id"]["description"], "Primary key.")
            # warehouse NOT NULL -> nullable: false
            self.assertEqual(cols_by_name["email"].get("nullable"), False)

            # Model file has model types + idempotent unique_id stamp
            mdl_doc = yaml.safe_load(
                (out_root / "models" / "dbt" / "stg_customers.yaml").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(
                mdl_doc["meta"]["datalex"]["dbt"]["unique_id"],
                "model.demo.stg_customers",
            )
            mdl_cols = {c["name"]: c for c in mdl_doc["columns"]}
            self.assertEqual(mdl_cols["customer_id"]["type"], "bigint")

    def test_skip_warehouse_falls_back_to_manifest(self) -> None:
        from dm_core.dbt.sync import sync_dbt_project

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            project = self._bootstrap(tmp)
            out_root = tmp / "datalex-out"

            report = sync_dbt_project(
                dbt_project_dir=str(project),
                datalex_root=str(out_root),
                skip_warehouse=True,
            )

            # All tables manifest-only (no warehouse hits)
            self.assertTrue(all(not t.warehouse_reachable for t in report.tables))
            # Files still written
            self.assertTrue((out_root / "sources" / "raw.yaml").exists())

    def test_resync_preserves_user_authored_fields(self) -> None:
        from dm_core.dbt.sync import sync_dbt_project

        with tempfile.TemporaryDirectory() as tmpdir:
            tmp = Path(tmpdir)
            project = self._bootstrap(tmp)
            out_root = tmp / "datalex-out"
            sync_dbt_project(str(project), str(out_root))

            # Author a tag on email by editing the source file
            src_path = out_root / "sources" / "raw.yaml"
            src_doc = yaml.safe_load(src_path.read_text(encoding="utf-8"))
            for tbl in src_doc["tables"]:
                if tbl["name"] == "customers":
                    for col in tbl["columns"]:
                        if col["name"] == "email":
                            col["sensitivity"] = "pii"
            src_path.write_text(yaml.safe_dump(src_doc, sort_keys=False), encoding="utf-8")

            # Re-sync
            sync_dbt_project(str(project), str(out_root))

            reread = yaml.safe_load(src_path.read_text(encoding="utf-8"))
            email = None
            for tbl in reread["tables"]:
                if tbl["name"] == "customers":
                    for col in tbl["columns"]:
                        if col["name"] == "email":
                            email = col
            self.assertIsNotNone(email)
            self.assertEqual(email.get("sensitivity"), "pii")


if __name__ == "__main__":
    unittest.main()
