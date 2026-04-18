"""Phase B tests: dbt emitter + manifest importer round-trip + snippet expand.

Golden-file-lite: emitter outputs are checked by asserting key fields exist rather
than byte-identical matching, since dbt YAML formatting is sensitive to PyYAML
version and list ordering inside tests/constraints.
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

from dm_core.datalex import load_project
from dm_core.dbt import emit_dbt, import_manifest, write_import_result


def _write(p: Path, body: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(body, encoding="utf-8")


def _bootstrap_project(root: Path) -> None:
    _write(
        root / "datalex.yaml",
        "kind: project\nname: t\nversion: '1'\n"
        "dialects: [snowflake]\ndefault_dialect: snowflake\n",
    )
    _write(
        root / "sources" / "raw.yaml",
        "kind: source\nname: raw\ndatabase: analytics\nschema: raw\n"
        "loaded_at_field: _loaded_at\n"
        "freshness:\n  warn_after: {count: 6, period: hour}\n"
        "  error_after: {count: 24, period: hour}\n"
        "tables:\n  - name: orders\n    description: Orders.\n"
        "    columns:\n"
        "      - name: id\n        type: bigint\n        tests: [unique, not_null]\n"
        "      - name: email\n        type: string\n        sensitivity: pii-email\n",
    )
    _write(
        root / "models" / "dbt" / "stg_orders.yaml",
        "kind: model\nname: stg_orders\nmaterialization: view\nschema: staging\n"
        "contract: {enforced: true}\n"
        "depends_on:\n  - source: {source: raw, name: orders}\n"
        "columns:\n"
        "  - name: order_id\n    type: bigint\n    constraints: [{type: primary_key}]\n"
        "    tests: [unique, not_null]\n"
        "  - name: email\n    type: string\n    sensitivity: pii-email\n    tags: [pii]\n",
    )


class DbtEmitterTests(unittest.TestCase):
    def test_emits_sources_and_models(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            out = Path(tmp) / "dbt_out"
            _bootstrap_project(root)
            project = load_project(root, strict=True)

            report = emit_dbt(project, out_dir=str(out))
            self.assertEqual(report.sources, 1)
            self.assertEqual(report.models, 1)

            sources_doc = yaml.safe_load((out / "sources" / "raw.yml").read_text())
            self.assertEqual(sources_doc["version"], 2)
            src = sources_doc["sources"][0]
            self.assertEqual(src["name"], "raw")
            self.assertEqual(src["database"], "analytics")
            self.assertIn("freshness", src)
            tbl = src["tables"][0]
            self.assertEqual(tbl["name"], "orders")
            col_ids = [c["name"] for c in tbl["columns"]]
            self.assertEqual(col_ids, ["id", "email"])
            self.assertEqual(tbl["columns"][0]["tests"], ["unique", "not_null"])

            models_doc = yaml.safe_load((out / "models" / "_schema.yml").read_text())
            self.assertEqual(models_doc["version"], 2)
            m = models_doc["models"][0]
            self.assertEqual(m["config"]["contract"], {"enforced": True})
            self.assertEqual(m["config"]["materialized"], "view")

            order_col = next(c for c in m["columns"] if c["name"] == "order_id")
            self.assertEqual(order_col["data_type"], "bigint")
            self.assertIn({"type": "primary_key"}, order_col["constraints"])

            email_col = next(c for c in m["columns"] if c["name"] == "email")
            self.assertEqual(email_col["meta"]["datalex"]["sensitivity"], "pii-email")
            self.assertIn("pii", email_col["meta"]["datalex"]["tags"])

    def test_contract_forces_data_type(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "project"
            _bootstrap_project(root)
            # Overwrite model: drop the type to prove the emitter still includes data_type
            _write(
                root / "models" / "dbt" / "stg_orders.yaml",
                "kind: model\nname: stg_orders\ncontract: {enforced: true}\n"
                "columns:\n  - name: missing_type\n",
            )
            project = load_project(root, strict=True)
            out = Path(tmp) / "dbt_out"
            emit_dbt(project, out_dir=str(out))
            doc = yaml.safe_load((out / "models" / "_schema.yml").read_text())
            col = doc["models"][0]["columns"][0]
            self.assertEqual(col["data_type"], "UNSPECIFIED")


class DbtManifestImportTests(unittest.TestCase):
    def _fake_manifest(self) -> dict:
        return {
            "metadata": {"dbt_version": "1.7.0", "project_name": "acme"},
            "nodes": {
                "model.acme.stg_orders": {
                    "resource_type": "model",
                    "name": "stg_orders",
                    "unique_id": "model.acme.stg_orders",
                    "database": "analytics",
                    "schema": "staging",
                    "description": "Staging orders.",
                    "config": {"materialized": "view"},
                    "depends_on": {"nodes": ["source.acme.raw.orders"]},
                    "columns": {
                        "order_id": {"name": "order_id", "data_type": "bigint"},
                        "placed_at": {"name": "placed_at", "data_type": "timestamp"},
                    },
                },
            },
            "sources": {
                "source.acme.raw.orders": {
                    "resource_type": "source",
                    "source_name": "raw",
                    "name": "orders",
                    "unique_id": "source.acme.raw.orders",
                    "database": "analytics",
                    "schema": "raw",
                    "description": "Orders landing table.",
                    "columns": {
                        "id": {"name": "id", "data_type": "bigint"},
                    },
                }
            },
        }

    def test_import_writes_files_with_unique_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(json.dumps(self._fake_manifest()))
            result = import_manifest(str(manifest))
            paths = write_import_result(result, str(Path(tmp) / "proj"))
            self.assertEqual(len(paths), 2)

            src_doc = yaml.safe_load((Path(tmp) / "proj" / "sources" / "raw.yaml").read_text())
            self.assertEqual(src_doc["kind"], "source")
            self.assertIn(
                "source.acme.raw.orders",
                src_doc["meta"]["datalex"]["dbt"]["unique_ids"],
            )

            mdl_doc = yaml.safe_load(
                (Path(tmp) / "proj" / "models" / "dbt" / "stg_orders.yaml").read_text()
            )
            self.assertEqual(mdl_doc["kind"], "model")
            self.assertEqual(
                mdl_doc["meta"]["datalex"]["dbt"]["unique_id"], "model.acme.stg_orders"
            )

    def test_reimport_preserves_user_authored_fields(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            manifest = Path(tmp) / "manifest.json"
            manifest.write_text(json.dumps(self._fake_manifest()))
            proj = Path(tmp) / "proj"

            # first import
            result = import_manifest(str(manifest))
            write_import_result(result, str(proj))

            # user edits owner + tags on the model
            mdl_path = proj / "models" / "dbt" / "stg_orders.yaml"
            doc = yaml.safe_load(mdl_path.read_text())
            doc["owner"] = "data-eng-team"
            doc["tags"] = ["sales", "staging"]
            mdl_path.write_text(yaml.safe_dump(doc, sort_keys=False))

            # second import — should merge, not overwrite
            result2 = import_manifest(str(manifest), existing_project_root=str(proj))
            write_import_result(result2, str(proj))

            doc_after = yaml.safe_load(mdl_path.read_text())
            self.assertEqual(doc_after.get("owner"), "data-eng-team")
            self.assertEqual(doc_after.get("tags"), ["sales", "staging"])
            # unique_id is preserved
            self.assertEqual(
                doc_after["meta"]["datalex"]["dbt"]["unique_id"], "model.acme.stg_orders"
            )


class ExpandTests(unittest.TestCase):
    def test_snippet_expand_merges_into_column(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write(root / "datalex.yaml", "kind: project\nname: t\nversion: '1'\n")
            _write(
                root / "models" / "physical" / "postgres" / "customer.yaml",
                "kind: entity\nlayer: physical\ndialect: postgres\nname: customer\n"
                "columns:\n  - name: email\n    type: string(320)\n    use: pii_email\n",
            )
            _write(
                root / ".datalex" / "snippets" / "pii_email.yaml",
                "kind: snippet\nname: pii_email\ntargets: [column]\napply:\n  sensitivity: pii-email\n  tags: [pii]\n",
            )
            project = load_project(root, strict=True)
            email_col = next(
                c for c in project.entity("customer")["columns"] if c["name"] == "email"
            )
            self.assertEqual(email_col["sensitivity"], "pii-email")
            self.assertIn("pii", email_col["tags"])


if __name__ == "__main__":
    unittest.main()
