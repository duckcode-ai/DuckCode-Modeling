"""Cross-repo DataLex package resolver.

Given `imports:` entries in a DataLex project manifest, resolve each into a
local on-disk directory suitable for loading via `load_project`. Supports:

  * Local path imports:
      - package: local/warehouse-core
        path:    ../warehouse-core

  * Git-backed imports (tag, branch, or commit):
      - package: acme/warehouse-core
        git:     https://github.com/acme/warehouse-core.git
        ref:     v1.4.0

  * Shorthand `package: org/name@version` — resolves to a default registry
    URL (currently github.com/<org>/<name> tag <version>).

Cache layout:
    ~/.datalex/packages/<org>__<name>/<ref>/     # single shared cache per host

Lockfile layout (`.datalex/lock.yaml`):
    packages:
      acme/warehouse-core:
        version: 1.4.0
        git: https://github.com/acme/warehouse-core.git
        ref: v1.4.0
        resolved_sha: <40-char-sha>
        content_hash: sha256:<hash-of-packaged-tree>

Security notes:
  * When a lockfile exists, we refuse to use any resolution whose resolved_sha
    disagrees with the locked entry. Run `datalex datalex packages resolve --update`
    to regenerate.
  * `path:` imports are not sandboxed — a local import can be anywhere on the
    filesystem. That is the user's choice.
"""

from __future__ import annotations

import hashlib
import os
import re
import shutil
import subprocess
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple, Union

import yaml


PACKAGE_SPEC_RE = re.compile(r"^(?P<org>[a-z0-9][a-z0-9_-]*)/(?P<name>[a-z0-9][a-z0-9_-]*)(@(?P<version>[\w.+-]+))?$")
DEFAULT_REGISTRY_URL_TEMPLATE = "https://github.com/{org}/{name}.git"


# ---------- dataclasses ----------


@dataclass
class ImportSpec:
    """A single `imports:` entry as declared in `datalex.yaml`."""

    package: str
    path: Optional[str] = None          # local path import
    git: Optional[str] = None           # explicit git URL
    ref: Optional[str] = None           # tag / branch / sha
    alias: Optional[str] = None         # namespace prefix (default: package basename)
    version: Optional[str] = None       # parsed from `org/name@version` shorthand

    @classmethod
    def from_dict(cls, raw: Dict[str, Any]) -> "ImportSpec":
        pkg = raw.get("package") or ""
        spec = cls(
            package=pkg,
            path=raw.get("path"),
            git=raw.get("git"),
            ref=raw.get("ref"),
            alias=raw.get("alias"),
            version=raw.get("version"),
        )
        # Support `package: org/name@version` shorthand.
        m = PACKAGE_SPEC_RE.match(pkg)
        if m and m.group("version") and not spec.version:
            spec.version = m.group("version")
            spec.package = f"{m.group('org')}/{m.group('name')}"
        return spec

    def default_alias(self) -> str:
        """Alias for namespacing imported names. Defaults to the last path segment."""
        if self.alias:
            return self.alias
        base = self.package.split("/")[-1]
        return _slug(base)

    def kind(self) -> str:
        if self.path:
            return "path"
        if self.git or self.version:
            return "git"
        raise ValueError(f"Import '{self.package}' has neither path: nor git/version.")


@dataclass
class ResolvedPackage:
    spec: ImportSpec
    root: Path                      # local disk path the project was resolved into
    resolved_sha: Optional[str]     # git SHA (None for path imports)
    content_hash: str               # sha256 of the tree at `root` (stable)

    def to_lock_entry(self) -> Dict[str, Any]:
        entry: Dict[str, Any] = {"content_hash": self.content_hash}
        if self.spec.version:
            entry["version"] = self.spec.version
        if self.spec.git:
            entry["git"] = self.spec.git
        if self.spec.ref:
            entry["ref"] = self.spec.ref
        if self.spec.path:
            entry["path"] = self.spec.path
        if self.resolved_sha:
            entry["resolved_sha"] = self.resolved_sha
        return entry


@dataclass
class ResolveReport:
    resolved: List[ResolvedPackage] = field(default_factory=list)
    lockfile_path: Optional[Path] = None
    lockfile_written: bool = False
    warnings: List[str] = field(default_factory=list)

    def summary(self) -> str:
        lines = [f"Resolved {len(self.resolved)} package(s):"]
        for r in self.resolved:
            suffix = f"@{r.spec.version}" if r.spec.version else ""
            lines.append(f"  - {r.spec.package}{suffix} → {r.root}")
        if self.lockfile_written and self.lockfile_path:
            lines.append(f"Wrote lockfile: {self.lockfile_path}")
        for w in self.warnings:
            lines.append(f"  warning: {w}")
        return "\n".join(lines)


# ---------- resolver ----------


def resolve_imports(
    project_root: Union[str, Path],
    cache_root: Optional[Union[str, Path]] = None,
    update: bool = False,
) -> ResolveReport:
    """Resolve every `imports:` entry in `<project_root>/datalex.yaml`.

    When `update` is True, re-fetch git-backed packages even if the lockfile
    pins them. Otherwise, lockfile entries are authoritative.
    """
    project_root = Path(project_root).resolve()
    manifest = _load_manifest(project_root)
    cache_root = Path(cache_root) if cache_root else _default_cache_root()
    cache_root.mkdir(parents=True, exist_ok=True)

    lockfile_path = project_root / ".datalex" / "lock.yaml"
    existing_lock = _load_lockfile(lockfile_path)

    report = ResolveReport(lockfile_path=lockfile_path)

    for raw in manifest.get("imports", []) or []:
        spec = ImportSpec.from_dict(raw)
        if not spec.package:
            report.warnings.append("Skipping imports entry with empty package field.")
            continue

        resolved = _resolve_one(
            spec=spec,
            project_root=project_root,
            cache_root=cache_root,
            lock_entry=existing_lock.get(spec.package),
            update=update,
        )
        report.resolved.append(resolved)

    new_lock = {r.spec.package: r.to_lock_entry() for r in report.resolved}
    if new_lock != existing_lock:
        _write_lockfile(lockfile_path, new_lock)
        report.lockfile_written = True

    return report


def _resolve_one(
    spec: ImportSpec,
    project_root: Path,
    cache_root: Path,
    lock_entry: Optional[Dict[str, Any]],
    update: bool,
) -> ResolvedPackage:
    kind = spec.kind()

    if kind == "path":
        root = (project_root / spec.path).resolve() if not Path(spec.path).is_absolute() else Path(spec.path)
        if not root.exists():
            raise PackageResolveError(
                f"Local path import '{spec.package}' points to nonexistent directory: {root}"
            )
        ch = _hash_tree(root)
        _verify_against_lock(spec, ch, None, lock_entry, update)
        return ResolvedPackage(spec=spec, root=root, resolved_sha=None, content_hash=ch)

    # git-backed
    git_url = spec.git or _registry_url(spec)
    ref = spec.ref or spec.version
    if not ref:
        raise PackageResolveError(
            f"Git-backed import '{spec.package}' needs a ref or version."
        )

    pkg_dir = cache_root / _safe_cache_key(spec.package) / _safe_cache_key(ref)
    needs_fetch = update or not pkg_dir.exists() or not (pkg_dir / ".git_sha").exists()
    if needs_fetch:
        _fetch_git(git_url, ref, pkg_dir)

    sha = (pkg_dir / ".git_sha").read_text().strip() if (pkg_dir / ".git_sha").exists() else ""
    ch = _hash_tree(pkg_dir)
    _verify_against_lock(spec, ch, sha, lock_entry, update)
    return ResolvedPackage(spec=spec, root=pkg_dir, resolved_sha=sha, content_hash=ch)


def _verify_against_lock(
    spec: ImportSpec,
    content_hash: str,
    resolved_sha: Optional[str],
    lock_entry: Optional[Dict[str, Any]],
    update: bool,
) -> None:
    if not lock_entry or update:
        return
    locked_ch = lock_entry.get("content_hash")
    if locked_ch and locked_ch != content_hash:
        raise PackageResolveError(
            f"Package '{spec.package}' content_hash {content_hash} does not match "
            f"lockfile {locked_ch}. Run `datalex datalex packages resolve --update` to regenerate."
        )
    locked_sha = lock_entry.get("resolved_sha")
    if locked_sha and resolved_sha and locked_sha != resolved_sha:
        raise PackageResolveError(
            f"Package '{spec.package}' resolved_sha {resolved_sha} does not match "
            f"lockfile {locked_sha}. Run `datalex datalex packages resolve --update` to regenerate."
        )


# ---------- git backend ----------


def _fetch_git(url: str, ref: str, target: Path) -> None:
    """Shallow-clone `url@ref` into `target`. Writes the resolved SHA to .git_sha."""
    if target.exists():
        shutil.rmtree(target)
    target.mkdir(parents=True, exist_ok=True)

    try:
        # shallow clone of the single ref
        subprocess.run(
            ["git", "init", "--quiet", str(target)], check=True, capture_output=True
        )
        subprocess.run(
            ["git", "-C", str(target), "remote", "add", "origin", url],
            check=True, capture_output=True,
        )
        # Try fetching the ref directly (works for tags, branches, and SHAs on many servers)
        fetch = subprocess.run(
            ["git", "-C", str(target), "fetch", "--depth=1", "origin", ref],
            capture_output=True,
        )
        if fetch.returncode != 0:
            # fallback: full fetch then checkout
            subprocess.run(
                ["git", "-C", str(target), "fetch", "origin"],
                check=True, capture_output=True,
            )
        subprocess.run(
            ["git", "-C", str(target), "checkout", "--quiet", "FETCH_HEAD"]
            if fetch.returncode == 0
            else ["git", "-C", str(target), "checkout", "--quiet", ref],
            check=True, capture_output=True,
        )
        sha = subprocess.run(
            ["git", "-C", str(target), "rev-parse", "HEAD"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        (target / ".git_sha").write_text(sha + "\n", encoding="utf-8")
    except subprocess.CalledProcessError as e:
        err = (e.stderr or b"").decode("utf-8", errors="replace")
        raise PackageResolveError(
            f"git fetch failed for {url}@{ref}: {err.strip() or e}"
        ) from e


def _registry_url(spec: ImportSpec) -> str:
    m = PACKAGE_SPEC_RE.match(spec.package)
    if not m:
        raise PackageResolveError(
            f"Package '{spec.package}' is not in org/name form; provide `git:` explicitly."
        )
    return DEFAULT_REGISTRY_URL_TEMPLATE.format(org=m.group("org"), name=m.group("name"))


# ---------- helpers ----------


class PackageResolveError(RuntimeError):
    """Raised when a package cannot be resolved or fails verification."""


def _default_cache_root() -> Path:
    override = os.environ.get("DATALEX_CACHE_ROOT")
    if override:
        return Path(override) / "packages"
    return Path.home() / ".datalex" / "packages"


def _safe_cache_key(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]", "_", value).strip("._")


def _slug(value: str) -> str:
    out = re.sub(r"[^a-z0-9_]+", "_", value.lower()).strip("_")
    return out or "pkg"


def _hash_tree(root: Path) -> str:
    """Stable sha256 over all .yaml / .yml files in a tree."""
    h = hashlib.sha256()
    for p in sorted(root.rglob("*")):
        if not p.is_file():
            continue
        if p.suffix.lower() not in (".yaml", ".yml"):
            continue
        rel = p.relative_to(root).as_posix()
        h.update(rel.encode("utf-8"))
        h.update(b"\0")
        h.update(p.read_bytes())
        h.update(b"\0")
    return "sha256:" + h.hexdigest()


def _load_manifest(project_root: Path) -> Dict[str, Any]:
    manifest_path = project_root / "datalex.yaml"
    if not manifest_path.exists():
        return {}
    with manifest_path.open("r", encoding="utf-8") as f:
        return yaml.safe_load(f) or {}


def _load_lockfile(path: Path) -> Dict[str, Dict[str, Any]]:
    if not path.exists():
        return {}
    with path.open("r", encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    return dict(data.get("packages") or {})


def _write_lockfile(path: Path, packages: Dict[str, Dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    doc = {
        "version": 1,
        "packages": packages,
    }
    with path.open("w", encoding="utf-8") as f:
        yaml.safe_dump(doc, f, sort_keys=True, default_flow_style=False, allow_unicode=True)


# ---------- helpers consumed by the loader ----------


def load_imports_for(
    project_root: Union[str, Path],
    cache_root: Optional[Union[str, Path]] = None,
) -> List[ResolvedPackage]:
    """Resolve (using cached state) and return ResolvedPackage entries.

    Does not refetch; assumes `resolve_imports` has been run at least once.
    Raises if a git-backed import has never been fetched, and raises if any
    import's content_hash has drifted from the lockfile.
    """
    project_root = Path(project_root).resolve()
    manifest = _load_manifest(project_root)
    cache_root = Path(cache_root) if cache_root else _default_cache_root()
    lock = _load_lockfile(project_root / ".datalex" / "lock.yaml")
    out: List[ResolvedPackage] = []
    for raw in manifest.get("imports", []) or []:
        spec = ImportSpec.from_dict(raw)
        if not spec.package:
            continue
        resolved = _probe_resolved(spec, project_root, cache_root)
        lock_entry = lock.get(spec.package)
        if lock_entry:
            locked_ch = lock_entry.get("content_hash")
            if locked_ch and locked_ch != resolved.content_hash:
                raise PackageResolveError(
                    f"Package '{spec.package}' content_hash drifted from lockfile; "
                    f"run `datalex datalex packages resolve --update`."
                )
        out.append(resolved)
    return out


def _probe_resolved(
    spec: ImportSpec,
    project_root: Path,
    cache_root: Path,
) -> ResolvedPackage:
    """Return a ResolvedPackage pointing at the on-disk location without fetching."""
    if spec.path:
        root = (project_root / spec.path).resolve() if not Path(spec.path).is_absolute() else Path(spec.path).resolve()
        if not root.exists():
            raise PackageResolveError(
                f"Local path import '{spec.package}' points to nonexistent directory: {root}"
            )
        return ResolvedPackage(spec=spec, root=root, resolved_sha=None, content_hash=_hash_tree(root))
    ref = spec.ref or spec.version
    if not ref:
        raise PackageResolveError(f"Git-backed import '{spec.package}' missing ref/version.")
    pkg_dir = cache_root / _safe_cache_key(spec.package) / _safe_cache_key(ref)
    if not pkg_dir.exists():
        raise PackageResolveError(
            f"Package '{spec.package}@{ref}' is not in the cache. "
            f"Run `datalex datalex packages resolve` first."
        )
    sha = (pkg_dir / ".git_sha").read_text().strip() if (pkg_dir / ".git_sha").exists() else ""
    return ResolvedPackage(spec=spec, root=pkg_dir, resolved_sha=sha, content_hash=_hash_tree(pkg_dir))
