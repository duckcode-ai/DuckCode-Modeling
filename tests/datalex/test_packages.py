"""Phase C tests: cross-repo package resolver + import merge + parse cache + lockfile.

Git-backed import tests use a local bare repo (no network dependency).
"""

from __future__ import annotations

import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from dm_core.datalex import load_project  # noqa: E402
from dm_core.datalex.parse_cache import ParseCache  # noqa: E402
from dm_core.packages import (  # noqa: E402
    ImportSpec,
    PackageResolveError,
    load_imports_for,
    resolve_imports,
)


def _write(path: Path, body: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(body, encoding="utf-8")


def _bootstrap_package(root: Path, name: str) -> None:
    """Write a minimal valid DataLex project at `root`."""
    _write(
        root / "datalex.yaml",
        f"kind: project\nname: {name}\nversion: '1'\n"
        "dialects: [postgres]\ndefault_dialect: postgres\n",
    )
    _write(
        root / "models" / "physical" / "postgres" / "shared_dim.yaml",
        "kind: entity\nlayer: physical\ndialect: postgres\nname: shared_dim\n"
        "columns:\n  - name: id\n    type: bigint\n    constraints: [{type: primary_key}]\n"
        "  - name: label\n    type: string(255)\n",
    )
    _write(
        root / "glossary" / "customer.yaml",
        "kind: term\nname: customer\ndefinition: A paying customer.\n",
    )


def _bootstrap_consumer(root: Path, imports: list) -> None:
    manifest = {
        "kind": "project",
        "name": "consumer",
        "version": "1",
        "dialects": ["postgres"],
        "default_dialect": "postgres",
        "imports": imports,
    }
    _write(root / "datalex.yaml", yaml.safe_dump(manifest, sort_keys=False))
    _write(
        root / "models" / "physical" / "postgres" / "local_fact.yaml",
        "kind: entity\nlayer: physical\ndialect: postgres\nname: local_fact\n"
        "columns:\n  - name: id\n    type: bigint\n    constraints: [{type: primary_key}]\n",
    )


class ImportSpecTests(unittest.TestCase):
    def test_parses_shorthand_org_name_version(self) -> None:
        spec = ImportSpec.from_dict({"package": "acme/warehouse-core@1.4.0"})
        self.assertEqual(spec.package, "acme/warehouse-core")
        self.assertEqual(spec.version, "1.4.0")
        self.assertEqual(spec.default_alias(), "warehouse_core")

    def test_explicit_alias_wins(self) -> None:
        spec = ImportSpec.from_dict({"package": "acme/warehouse-core", "alias": "wc"})
        self.assertEqual(spec.default_alias(), "wc")

    def test_kind_detection(self) -> None:
        self.assertEqual(ImportSpec.from_dict({"package": "x/y", "path": "../y"}).kind(), "path")
        self.assertEqual(
            ImportSpec.from_dict({"package": "x/y", "git": "https://...", "ref": "v1"}).kind(),
            "git",
        )
        with self.assertRaises(ValueError):
            ImportSpec.from_dict({"package": "x/y"}).kind()


class LocalPathResolveTests(unittest.TestCase):
    def test_resolves_and_writes_lockfile(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_root = Path(tmp) / "warehouse-core"
            consumer = Path(tmp) / "consumer"
            _bootstrap_package(pkg_root, "warehouse_core")
            _bootstrap_consumer(
                consumer,
                imports=[{"package": "local/warehouse-core", "path": "../warehouse-core"}],
            )

            report = resolve_imports(consumer)
            self.assertTrue(report.lockfile_written)
            self.assertEqual(len(report.resolved), 1)
            self.assertEqual(report.resolved[0].root, pkg_root.resolve())

            lock = yaml.safe_load((consumer / ".datalex" / "lock.yaml").read_text())
            entry = lock["packages"]["local/warehouse-core"]
            self.assertIn("content_hash", entry)
            self.assertTrue(entry["content_hash"].startswith("sha256:"))

    def test_missing_path_raises(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            consumer = Path(tmp) / "consumer"
            _bootstrap_consumer(
                consumer,
                imports=[{"package": "local/x", "path": "../does-not-exist"}],
            )
            with self.assertRaises(PackageResolveError):
                resolve_imports(consumer)

    def test_lockfile_drift_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_root = Path(tmp) / "warehouse-core"
            consumer = Path(tmp) / "consumer"
            _bootstrap_package(pkg_root, "warehouse_core")
            _bootstrap_consumer(
                consumer,
                imports=[{"package": "local/warehouse-core", "path": "../warehouse-core"}],
            )
            resolve_imports(consumer)

            # mutate the package: add a new entity
            _write(
                pkg_root / "models" / "physical" / "postgres" / "extra.yaml",
                "kind: entity\nlayer: physical\ndialect: postgres\nname: extra\n"
                "columns:\n  - name: id\n    type: bigint\n",
            )
            # load_imports_for should fail because content_hash drifted
            with self.assertRaises(PackageResolveError):
                load_imports_for(consumer)

            # resolve --update fixes it
            resolve_imports(consumer, update=True)
            load_imports_for(consumer)  # should now succeed


class ImportMergeIntoProjectTests(unittest.TestCase):
    def test_imported_entity_is_accessible_via_alias(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_root = Path(tmp) / "warehouse-core"
            consumer = Path(tmp) / "consumer"
            _bootstrap_package(pkg_root, "warehouse_core")
            _bootstrap_consumer(
                consumer,
                imports=[
                    {"package": "local/warehouse-core", "path": "../warehouse-core", "alias": "wc"}
                ],
            )
            resolve_imports(consumer)
            project = load_project(consumer, strict=True)

            self.assertIn("wc", project.imports)
            sub = project.imports["wc"]
            self.assertIsNotNone(sub.entity("shared_dim"))
            # consumer's own entities untouched
            self.assertIsNotNone(project.entity("local_fact"))
            # cross-package reference
            self.assertIsNotNone(project.resolve_cross_package("@wc.shared_dim"))
            self.assertIsNone(project.resolve_cross_package("@wc.nonexistent"))

    def test_alias_collision_is_an_error(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_a = Path(tmp) / "pkg-a"
            pkg_b = Path(tmp) / "pkg-b"
            consumer = Path(tmp) / "consumer"
            _bootstrap_package(pkg_a, "pkg_a")
            _bootstrap_package(pkg_b, "pkg_b")
            _bootstrap_consumer(
                consumer,
                imports=[
                    {"package": "local/a", "path": "../pkg-a", "alias": "shared"},
                    {"package": "local/b", "path": "../pkg-b", "alias": "shared"},
                ],
            )
            resolve_imports(consumer)
            project = load_project(consumer, strict=False)
            codes = [e["code"] for e in project.errors.to_list()]
            self.assertIn("IMPORT_ALIAS_COLLISION", codes)


class ParseCacheTests(unittest.TestCase):
    def test_cache_round_trip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_root = Path(tmp) / "p"
            _bootstrap_package(pkg_root, "p")
            cache_dir = Path(tmp) / "cache"

            # Cold
            p = load_project(pkg_root, strict=True, cache_dir=cache_dir)
            self.assertIsNotNone(p.entity("shared_dim"))

            # Warm — entities should match
            p2 = load_project(pkg_root, strict=True, cache_dir=cache_dir)
            self.assertEqual(set(p.entities.keys()), set(p2.entities.keys()))

            # At least one cache file written
            cache_files = list(cache_dir.glob("*.json"))
            self.assertGreaterEqual(len(cache_files), 2)

    def test_cache_miss_on_content_change(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            pkg_root = Path(tmp) / "p"
            _bootstrap_package(pkg_root, "p")
            cache_dir = Path(tmp) / "cache"
            load_project(pkg_root, strict=True, cache_dir=cache_dir)

            # mutate a file — content hash changes, so a new cache entry appears
            ent_path = pkg_root / "models" / "physical" / "postgres" / "shared_dim.yaml"
            body = ent_path.read_text() + "  - name: extra_col\n    type: string\n"
            ent_path.write_text(body)

            load_project(pkg_root, strict=True, cache_dir=cache_dir)
            project = load_project(pkg_root, strict=True, cache_dir=cache_dir)
            ent = project.entity("shared_dim")
            col_names = [c["name"] for c in ent["columns"]]
            self.assertIn("extra_col", col_names)


# --- git-backed resolution (uses a local bare repo, no network) ---


def _git(*args: str, cwd: Path) -> None:
    env = dict(os.environ)
    env.setdefault("GIT_AUTHOR_NAME", "t")
    env.setdefault("GIT_AUTHOR_EMAIL", "t@t")
    env.setdefault("GIT_COMMITTER_NAME", "t")
    env.setdefault("GIT_COMMITTER_EMAIL", "t@t")
    subprocess.run(["git", *args], cwd=cwd, check=True, capture_output=True, env=env)


class GitResolveTests(unittest.TestCase):
    def test_resolves_tag_from_local_bare_repo(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            src = tmp / "pkg-src"
            _bootstrap_package(src, "shared")
            _git("init", "-q", cwd=src)
            _git("add", ".", cwd=src)
            _git("commit", "-q", "-m", "v1", cwd=src)
            _git("tag", "v1.0.0", cwd=src)

            bare = tmp / "pkg.git"
            subprocess.run(
                ["git", "clone", "--bare", "--quiet", str(src), str(bare)],
                check=True, capture_output=True,
            )

            consumer = tmp / "consumer"
            _bootstrap_consumer(
                consumer,
                imports=[
                    {
                        "package": "acme/shared",
                        "git": str(bare),
                        "ref": "v1.0.0",
                        "alias": "shared",
                    }
                ],
            )

            prev_cache = os.environ.get("DATALEX_CACHE_ROOT")
            os.environ["DATALEX_CACHE_ROOT"] = str(tmp / "cache")
            try:
                report = resolve_imports(consumer)
                self.assertEqual(len(report.resolved), 1)
                self.assertTrue(report.resolved[0].resolved_sha)
                self.assertTrue(report.resolved[0].root.exists())
                self.assertTrue((report.resolved[0].root / "datalex.yaml").exists())

                project = load_project(consumer, strict=True)
                self.assertIn("shared", project.imports)
                self.assertIsNotNone(project.imports["shared"].entity("shared_dim"))
            finally:
                if prev_cache is None:
                    os.environ.pop("DATALEX_CACHE_ROOT", None)
                else:
                    os.environ["DATALEX_CACHE_ROOT"] = prev_cache


if __name__ == "__main__":
    unittest.main()
