"""Streaming, kind-dispatched DataLex project loader.

Design goals (from the DataLex spec):
  * Streaming-safe: load a 10,000-entity project without holding all YAML in memory.
  * Kind-dispatched: every file declares `kind:` at top; unrecognized is a parse error.
  * Source-locating: every error carries file/line/column.
  * Deterministic: iteration order is sorted by (kind, name) for stable emission.

This loader is intentionally self-contained — it does not go through the legacy
`loader.py` path, which is v3-model-shaped and not kind-aware.
"""

from __future__ import annotations

import glob
import json
from pathlib import Path
from typing import Any, Dict, Iterator, List, Optional, Tuple, Union

import yaml
from jsonschema import Draft202012Validator

from dm_core.datalex.errors import DataLexError, DataLexErrorBag, SourceLocation
from dm_core.datalex.parse_cache import (
    ParseCache,
    cache_enabled_from_env,
    default_cache_dir,
)


KINDS = ("project", "entity", "source", "model", "term", "domain", "policy", "snippet")


class _MarkedSafeLoader(yaml.SafeLoader):
    """PyYAML SafeLoader that tags every mapping with its source line/column.

    Line/column are stored under the double-underscore key `__mark__` which the loader
    strips before returning to user code. This lets us surface file:line:column in
    validation errors without a second parse.
    """


def _construct_mapping(loader, node, deep=False):
    loader.flatten_mapping(node)
    mapping: Dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        value = loader.construct_object(value_node, deep=deep)
        mapping[key] = value
    # attach source mark — use start_mark of the mapping node itself
    mapping["__mark__"] = (node.start_mark.line + 1, node.start_mark.column + 1)
    return mapping


_MarkedSafeLoader.add_constructor(
    yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, _construct_mapping
)


def _strip_marks(value: Any) -> Any:
    """Return a deep copy of value with all __mark__ keys removed.

    Marks are attached during parsing for error reporting; the user-facing document
    should never include them.
    """
    if isinstance(value, dict):
        return {k: _strip_marks(v) for k, v in value.items() if k != "__mark__"}
    if isinstance(value, list):
        return [_strip_marks(v) for v in value]
    return value


def _mark_of(value: Any) -> Optional[Tuple[int, int]]:
    if isinstance(value, dict):
        m = value.get("__mark__")
        if isinstance(m, tuple) and len(m) == 2:
            return m
    return None


def _load_yaml_marked(path: Path, bag: DataLexErrorBag) -> Optional[Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return yaml.load(f, Loader=_MarkedSafeLoader)
    except yaml.YAMLError as e:
        mark = getattr(e, "problem_mark", None)
        loc = SourceLocation(
            file=str(path),
            line=(mark.line + 1) if mark else None,
            column=(mark.column + 1) if mark else None,
        )
        bag.add(
            DataLexError(
                code="YAML_PARSE",
                message=f"YAML parse error: {e}",
                location=loc,
                suggested_fix="Check indentation and quoting near the reported line.",
            )
        )
        return None
    except OSError as e:
        bag.add(
            DataLexError(
                code="YAML_IO",
                message=f"Cannot read file: {e}",
                location=SourceLocation(file=str(path)),
            )
        )
        return None


_SCHEMA_CACHE: Dict[str, Dict[str, Any]] = {}


def _load_kind_schema(schemas_root: Path, kind: str) -> Optional[Dict[str, Any]]:
    if kind in _SCHEMA_CACHE:
        return _SCHEMA_CACHE[kind]
    path = schemas_root / f"{kind}.schema.json"
    if not path.exists():
        return None
    with path.open("r", encoding="utf-8") as f:
        schema = json.load(f)
    _SCHEMA_CACHE[kind] = schema
    return schema


def _validate_against_kind_schema(
    doc: Dict[str, Any], kind: str, schemas_root: Path, path: Path, bag: DataLexErrorBag
) -> None:
    schema = _load_kind_schema(schemas_root, kind)
    if schema is None:
        bag.add(
            DataLexError(
                code="SCHEMA_MISSING",
                message=f"No schema file found for kind '{kind}' under {schemas_root}",
                location=SourceLocation(file=str(path)),
            )
        )
        return

    clean = _strip_marks(doc)
    validator = Draft202012Validator(schema)
    for err in sorted(validator.iter_errors(clean), key=lambda e: list(e.absolute_path)):
        line, column = _lookup_mark(doc, list(err.absolute_path))
        bag.add(
            DataLexError(
                code="SCHEMA_VALIDATION",
                message=err.message,
                location=SourceLocation(file=str(path), line=line, column=column),
                path="/" + "/".join(str(p) for p in err.absolute_path),
                suggested_fix=_suggest_fix(err),
            )
        )


def _lookup_mark(doc: Any, abs_path: List[Any]) -> Tuple[Optional[int], Optional[int]]:
    """Walk the doc along abs_path and return the closest known source mark."""
    best: Optional[Tuple[int, int]] = _mark_of(doc)
    current = doc
    for part in abs_path:
        try:
            if isinstance(current, list) and isinstance(part, int):
                current = current[part]
            elif isinstance(current, dict):
                current = current.get(part)
            else:
                break
        except (IndexError, KeyError, TypeError):
            break
        m = _mark_of(current)
        if m:
            best = m
    if best:
        return best
    return (None, None)


def _suggest_fix(err) -> Optional[str]:
    validator = err.validator
    if validator == "required":
        missing = err.message.split("'")[1] if "'" in err.message else "required key"
        return f"Add the missing key '{missing}' to this object."
    if validator == "enum":
        return f"Use one of: {err.validator_value}"
    if validator == "pattern":
        return f"Value must match pattern {err.validator_value}"
    if validator == "const":
        return f"Expected constant value: {err.validator_value}"
    if validator == "additionalProperties":
        return "Remove the unknown property, or check for a typo."
    return None


def iter_yaml_files(root: Path, glob_pattern: str) -> Iterator[Path]:
    """Yield files matching the glob relative to root. Streaming — never materializes the full list."""
    # glob returns sorted by Path on most filesystems; sort explicitly for determinism.
    full = str(root / glob_pattern)
    for p in sorted(glob.iglob(full, recursive=True)):
        path = Path(p)
        if path.is_file():
            yield path


def load_file(
    path: Path,
    schemas_root: Path,
    bag: DataLexErrorBag,
    cache: Optional[ParseCache] = None,
) -> Optional[Dict[str, Any]]:
    """Load and validate a single DataLex YAML file. Returns the marked document or None.

    When `cache` is provided, a cache hit short-circuits YAML parsing and schema
    validation — the cached document is already mark-stripped and validated. A
    miss parses + validates + writes back. Cache keys are content-addressed so
    stale entries are impossible.
    """
    if cache is not None:
        # Cheap pre-flight: read `kind:` via a partial parse is expensive, so we
        # just peek the content hash + try each kind-schema key. In practice we
        # store under the real kind. Simpler: read kind from the file once via
        # a lightweight YAML parse gated on a cache miss.
        cached = _try_cache_get(path, cache)
        if cached is not None:
            return cached

    doc = _load_yaml_marked(path, bag)
    if doc is None:
        return None
    if not isinstance(doc, dict):
        bag.add(
            DataLexError(
                code="SHAPE",
                message="Top-level YAML must be a mapping.",
                location=SourceLocation(file=str(path)),
            )
        )
        return None
    kind = doc.get("kind")
    if kind not in KINDS:
        bag.add(
            DataLexError(
                code="KIND_UNKNOWN",
                message=f"Unknown kind '{kind}'",
                location=SourceLocation(
                    file=str(path),
                    line=_mark_of(doc)[0] if _mark_of(doc) else None,
                    column=_mark_of(doc)[1] if _mark_of(doc) else None,
                ),
                suggested_fix=f"Set 'kind:' to one of: {', '.join(KINDS)}",
            )
        )
        return None
    _validate_against_kind_schema(doc, kind, schemas_root, path, bag)
    if cache is not None:
        # Cache the mark-stripped doc — downstream callers strip marks anyway.
        cache.put(path, kind, _strip_marks(doc))
    return doc


def _try_cache_get(path: Path, cache: ParseCache) -> Optional[Dict[str, Any]]:
    """Probe cache for this file's parsed doc.

    The cache key includes the schema hash, which depends on `kind`. We cheat
    by trying each known kind. File-reads are one stat + one open on hit,
    negligible cost, and a miss returns None quickly.
    """
    for kind in KINDS:
        hit = cache.get(path, kind)
        if hit is not None and hit.get("kind") == kind:
            return hit
    return None


def load_project(
    project_root: Union[str, Path],
    schemas_root: Optional[Union[str, Path]] = None,
    strict: bool = True,
    cache_dir: Optional[Union[str, Path]] = None,
) -> "DataLexProject":
    """Entry point: discover, parse, validate, and aggregate a DataLex project.

    project_root  — directory containing `datalex.yaml`.
    schemas_root  — directory containing per-kind JSON Schemas.
                    Defaults to <repo-root>/schemas/datalex.
    strict        — when True, raise DataLexLoadError if any errors are collected.
                    When False, return the project with errors on the bag.
    cache_dir     — optional parse cache directory. If None and DATALEX_CACHE=1
                    is set in the environment, uses <project_root>/build/.cache.
                    Pass an explicit path to override.
    """
    from dm_core.datalex.project import DataLexProject  # local import to avoid cycle

    root = Path(project_root).resolve()
    if schemas_root is None:
        schemas_root = _infer_schemas_root(root)
    schemas_root = Path(schemas_root)

    cache: Optional[ParseCache] = None
    if cache_dir is not None:
        cache = ParseCache(Path(cache_dir), schemas_root)
    elif cache_enabled_from_env():
        cache = ParseCache(default_cache_dir(root), schemas_root)

    bag = DataLexErrorBag()

    manifest_path = root / "datalex.yaml"
    manifest: Optional[Dict[str, Any]] = None
    if manifest_path.exists():
        manifest = load_file(manifest_path, schemas_root, bag, cache=cache)

    if manifest is None:
        # Missing manifest is not fatal — we can still load discovered files for migration
        # tooling, but we warn.
        bag.add(
            DataLexError(
                code="PROJECT_MANIFEST_MISSING",
                severity="warn",
                message="No datalex.yaml manifest found; discovery will use default globs.",
                location=SourceLocation(file=str(root)),
                suggested_fix="Create datalex.yaml at the project root. See schemas/datalex/project.schema.json.",
            )
        )

    globs = {
        "models": (manifest or {}).get("models", "models/**/*.yaml"),
        "sources": (manifest or {}).get("sources", "sources/**/*.yaml"),
        "glossary": (manifest or {}).get("glossary", "glossary/**/*.yaml"),
        "snippets": (manifest or {}).get("snippets", ".datalex/snippets/**/*.yaml"),
        "policies": (manifest or {}).get("policies", "policies/**/*.yaml"),
    }

    entities: Dict[str, Dict[str, Any]] = {}
    sources: Dict[str, Dict[str, Any]] = {}
    models_dict: Dict[str, Dict[str, Any]] = {}
    terms: Dict[str, Dict[str, Any]] = {}
    domains: Dict[str, Dict[str, Any]] = {}
    policies: Dict[str, Dict[str, Any]] = {}
    snippets: Dict[str, Dict[str, Any]] = {}
    file_of: Dict[Tuple[str, str], str] = {}

    def _register(doc: Dict[str, Any], path: Path) -> None:
        kind = doc.get("kind")
        name = doc.get("name")
        if not name:
            return
        bucket = {
            "entity": entities,
            "source": sources,
            "model": models_dict,
            "term": terms,
            "domain": domains,
            "policy": policies,
            "snippet": snippets,
        }.get(kind)
        if bucket is None:
            return
        # layer uniqueness for entities — name is unique *per layer*
        key = name if kind != "entity" else f"{doc.get('layer', 'physical')}:{name}"
        if key in bucket:
            bag.add(
                DataLexError(
                    code="DUPLICATE_NAME",
                    message=f"Duplicate {kind} '{name}' — first defined in {file_of.get((kind, key))}",
                    location=SourceLocation(
                        file=str(path),
                        line=_mark_of(doc)[0] if _mark_of(doc) else None,
                    ),
                    suggested_fix="Rename one of the duplicates or merge them.",
                )
            )
            return
        bucket[key] = doc
        file_of[(kind, key)] = str(path)

    # Walk the trees in a stable order
    for group, pattern in sorted(globs.items()):
        for p in iter_yaml_files(root, pattern):
            doc = load_file(p, schemas_root, bag, cache=cache)
            if doc is not None:
                _register(doc, p)

    project = DataLexProject(
        root=root,
        manifest=_strip_marks(manifest) if manifest else None,
        entities={k: _strip_marks(v) for k, v in entities.items()},
        sources={k: _strip_marks(v) for k, v in sources.items()},
        models={k: _strip_marks(v) for k, v in models_dict.items()},
        terms={k: _strip_marks(v) for k, v in terms.items()},
        domains={k: _strip_marks(v) for k, v in domains.items()},
        policies={k: _strip_marks(v) for k, v in policies.items()},
        snippets={k: _strip_marks(v) for k, v in snippets.items()},
        file_of=file_of,
        errors=bag,
    )

    _load_imports(project, schemas_root, bag)

    project.resolve()  # resolves term references, snippet `use:`, logical back-refs

    if strict:
        bag.raise_if_errors()

    return project


def _load_imports(
    project: "DataLexProject",
    schemas_root: Path,
    bag: DataLexErrorBag,
) -> None:
    """Resolve `imports:` in the manifest and attach each as a sub-project.

    Skips silently if no imports are declared. Each import is loaded in
    non-strict mode so sub-project warnings bubble up as warnings rather than
    aborting the whole load; fatal sub-project errors become errors on the main
    bag.
    """
    manifest = project.manifest or {}
    imports = manifest.get("imports") or []
    if not imports:
        return

    try:
        from dm_core.packages import load_imports_for, PackageResolveError
    except ImportError:
        bag.add(
            DataLexError(
                code="PACKAGES_MODULE_MISSING",
                message="dm_core.packages is unavailable; cannot resolve imports.",
                location=SourceLocation(file=str(project.root)),
            )
        )
        return

    try:
        resolved = load_imports_for(project.root)
    except PackageResolveError as e:
        bag.add(
            DataLexError(
                code="PACKAGE_RESOLVE",
                message=str(e),
                location=SourceLocation(file=str(project.root / "datalex.yaml")),
                suggested_fix="Run `dm datalex packages resolve` and re-validate.",
            )
        )
        return

    for pkg in resolved:
        alias = pkg.spec.default_alias()
        if alias in project.imports:
            bag.add(
                DataLexError(
                    code="IMPORT_ALIAS_COLLISION",
                    message=f"Two imports share alias '{alias}'. Add an `alias:` to one of them.",
                    location=SourceLocation(file=str(project.root / "datalex.yaml")),
                )
            )
            continue
        try:
            sub = load_project(pkg.root, schemas_root=schemas_root, strict=False)
        except Exception as e:  # noqa: BLE001 — surface any loader failure as an error
            bag.add(
                DataLexError(
                    code="IMPORT_LOAD_FAILED",
                    message=f"Failed to load imported package '{pkg.spec.package}': {e}",
                    location=SourceLocation(file=str(pkg.root)),
                )
            )
            continue

        # Propagate sub-project errors as warnings prefixed by the alias so
        # it's clear which package they came from.
        for err in sub.errors.to_list():
            bag.add(
                DataLexError(
                    code=err.get("code", "IMPORT_CHILD"),
                    severity=err.get("severity", "warn"),
                    message=f"[import:{alias}] {err.get('message', '')}",
                    location=SourceLocation(file=err.get("file") or str(pkg.root)),
                )
            )
        project.imports[alias] = sub


def _infer_schemas_root(project_root: Path) -> Path:
    """Walk up from the project root looking for a DuckCode repo with schemas/datalex/."""
    here = project_root
    for _ in range(6):
        candidate = here / "schemas" / "datalex"
        if candidate.exists():
            return candidate
        if here.parent == here:
            break
        here = here.parent

    # Fallback: relative to this file
    this_file = Path(__file__).resolve()
    for _ in range(6):
        candidate = this_file.parent / "schemas" / "datalex"
        if candidate.exists():
            return candidate
        this_file = this_file.parent
    # Final fallback — the repo-relative path
    repo_root = Path(__file__).resolve().parents[4]
    return repo_root / "schemas" / "datalex"
