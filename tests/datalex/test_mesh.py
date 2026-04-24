from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
import json
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from datalex_core.datalex import load_project
from datalex_core.dbt import import_manifest
from datalex_core.dbt.emit import build_models_yaml
from datalex_core.importers import import_dbt_schema_yml, sync_dbt_schema_yml
from datalex_core.mesh import mesh_issues


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


class MeshInterfaceTests(unittest.TestCase):
    def test_canonical_model_interface_emits_to_dbt_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
            _write(
                root / "models" / "dim_customers.yaml",
                """
kind: model
name: dim_customers
description: Customer dimension for consumers.
owner: analytics
domain: commerce
materialization: table
contract: {enforced: true}
interface:
  enabled: true
  owner: analytics
  domain: commerce
  status: active
  version: v1
  description: Shared customer contract.
  unique_key: customer_id
  freshness: {warn_after: {count: 1, period: day}}
  stability: shared
columns:
  - name: customer_id
    type: integer
    description: Stable customer identifier.
    tests: [unique, not_null]
  - name: customer_name
    type: string
    description: Customer display name.
""",
            )
            project = load_project(root, strict=True)
            self.assertEqual(mesh_issues(project, strict=True), [])
            dbt_doc = build_models_yaml(project)["models/_schema.yml"]
            meta = dbt_doc["models"][0]["meta"]["datalex"]
            self.assertEqual(meta["interface"]["status"], "active")
            self.assertEqual(meta["interface"]["stability"], "shared")

    def test_strict_mesh_check_fails_incomplete_dbt_interface(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root / "models" / "marts" / "schema.yml",
                """
version: 2
models:
  - name: dim_customers
    meta:
      datalex:
        interface:
          enabled: true
          status: active
          stability: shared
    columns:
      - name: customer_id
        tests: [unique]
""",
            )
            project = load_project(root, strict=False)
            issues = mesh_issues(project, strict=True)
            codes = {issue.code for issue in issues}
            self.assertIn("MESH_INTERFACE_MISSING_OWNER", codes)
            self.assertIn("MESH_INTERFACE_MISSING_UNIQUE_KEY", codes)
            self.assertTrue(any(issue.severity == "error" for issue in issues))

            cmd = [sys.executable, str(ROOT / "datalex"), "datalex", "mesh", "check", str(root), "--strict", "--output-json"]
            proc = subprocess.run(cmd, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            self.assertNotEqual(proc.returncode, 0)
            self.assertIn("MESH_INTERFACE_MISSING_OWNER", proc.stdout)

    def test_dbt_interface_ready_passes_without_datalex_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(
                root / "models" / "marts" / "schema.yml",
                """
version: 2
models:
  - name: fct_orders
    description: Shared order facts for commerce reporting.
    config:
      materialized: table
      contract: {enforced: true}
    meta:
      datalex:
        interface:
          enabled: true
          owner: analytics
          domain: commerce
          status: active
          version: v1
          description: Shared order facts contract.
          unique_key: order_id
          freshness: {warn_after: {count: 1, period: day}}
          stability: shared
    columns:
      - name: order_id
        description: Stable order identifier.
        data_type: integer
        tests: [unique, not_null]
      - name: customer_id
        description: Customer placing the order.
        data_type: integer
        tests:
          - relationships: {to: ref('dim_customers'), field: customer_id}
""",
            )
            project = load_project(root, strict=False)
            self.assertEqual(mesh_issues(project, strict=True), [])

    def test_manifest_import_preserves_datalex_interface_meta(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(
                json.dumps(
                    {
                        "nodes": {
                            "model.shop.dim_customers": {
                                "resource_type": "model",
                                "name": "dim_customers",
                                "unique_id": "model.shop.dim_customers",
                                "config": {"materialized": "table"},
                                "meta": {
                                    "datalex": {
                                        "interface": {
                                            "enabled": True,
                                            "status": "active",
                                            "stability": "shared",
                                        }
                                    }
                                },
                                "columns": {},
                            }
                        },
                        "sources": {},
                    }
                ),
                encoding="utf-8",
            )
            result = import_manifest(str(manifest))
            self.assertEqual(result.models["dim_customers"]["interface"]["status"], "active")
            self.assertEqual(result.models["dim_customers"]["interface"]["stability"], "shared")

    def test_schema_yml_import_and_sync_round_trip_interface_meta(self) -> None:
        dbt_yaml = """
version: 2
models:
  - name: dim_customers
    meta:
      datalex:
        interface:
          enabled: true
          status: active
          stability: shared
    columns:
      - name: customer_id
        data_type: integer
"""
        imported = import_dbt_schema_yml(dbt_yaml)
        entity = imported["entities"][0]
        self.assertEqual(entity["interface"]["status"], "active")

        synced = sync_dbt_schema_yml(
            {"entities": [entity]},
            "version: 2\nmodels:\n  - name: dim_customers\n",
        )
        synced_doc = yaml.safe_load(synced)
        iface = synced_doc["models"][0]["meta"]["datalex"]["interface"]
        self.assertEqual(iface["stability"], "shared")


if __name__ == "__main__":
    unittest.main()
