# DuckCodeModeling Architecture

## 1. System overview

DuckCodeModeling is a Git-native data modeling platform with three runtime
surfaces:

1. **CLI (`dm`)** — validation, dbt sync, DDL emission, diff, package
   resolution, layout migration.
2. **Core engine (`packages/core_engine`)** — deterministic loader,
   dialect plugins, dbt integration, cross-repo packages.
3. **Web UI (`packages/web-app`)** — visual studio for editing the same
   YAML the CLI reads.

The authoritative source of truth is a **DataLex project tree** — one YAML
file per object, dispatched by `kind:`. See
[datalex-layout.md](./datalex-layout.md) for the reference.

## 2. Core engine modules (`dm_core`)

### 2.1 DataLex loader (`dm_core/datalex/`)

- **`loader.py`** — streaming, `kind:`-dispatched walker. Reads one file at
  a time; does not materialize the whole project in memory. Source-located
  errors (`file`, `line`, `column`, `suggested_fix`).
- **`project.py`** — `DataLexProject` dataclass: entities, sources, models,
  terms, domains, policies, snippets, imports. Resolves snippets at load
  time.
- **`parse_cache.py`** — content-addressed on-disk cache
  (`build/.cache/*.json` or `~/.datalex/cache/`), keyed by
  `sha256(content) + schema_hash`. Warm loads skip re-parsing unchanged
  files.
- **`migrate_layout.py`** — one-shot migrator from legacy `*.model.yaml` to
  the DataLex tree. Invoked via `dm datalex migrate to-datalex-layout`.
- **`diff.py`** — semantic diff with explicit `previous_name:` rename
  detection; breaking-change classification.
- **`errors.py`** — source-positioned diagnostics with `to_dict()` for
  `--output-json`.
- **`types.py`** — type palette + composite type parser (`array<T>`,
  `map<K,V>`, `struct<...>`).

### 2.2 Dialect registry (`dm_core/dialects/`)

- **`base.py`** — `DialectPlugin` protocol (`render_type`,
  `render_entity`, …).
- **`registry.py`** — `register()` / `get_dialect()` / `known_dialects()`.
- **`postgres.py`, `snowflake.py`** — shipped today; plugin shape means
  new dialects are a self-contained module, not an edit to a monolith.

### 2.3 dbt integration (`dm_core/dbt/`)

- **`manifest.py`** — imports `target/manifest.json` into DataLex sources /
  models. Idempotent via `meta.datalex.dbt.unique_id`; user-authored
  fields merged, not overwritten.
- **`profiles.py`** — parses `profiles.yml` (with dbt's precedence:
  `--profiles-dir` → `$DBT_PROFILES_DIR` → `<project>/profiles.yml` →
  `~/.dbt/profiles.yml`). Resolves relative DuckDB paths against the dbt
  project dir.
- **`warehouse.py`** — narrow per-table introspection (not full schema
  discovery). Supports `duckdb` and `postgres` today; other dialects fall
  back to the full connector in §2.5.
- **`sync.py`** — orchestrator behind `dm datalex dbt sync`. Merge policy:
  warehouse owns `type` + `nullable`; manifest/user own everything else.
- **`emit.py`** — emits `sources.yml` + `models/_schema.yml` with
  `contract.enforced: true` and `data_type:` on every column.

### 2.4 Cross-repo packages (`dm_core/packages.py`)

- `ImportSpec.from_dict` — parses `imports:` entries
  (`org/name@version`, `git:` + `ref:`, or `path:`).
- `resolve_imports` — fetches each package (shallow git clone or local
  copy), hashes contents, writes `.datalex/lock.yaml`.
- `load_imports_for` — consumes the lockfile; errors on `content_hash`
  drift. Imported entities namespaced under `@alias.entity_name`.
- Cache root: `~/.datalex/packages/` (override via `--cache-root` or
  `DATALEX_CACHE_ROOT`).

### 2.5 Database connectors (`dm_core/connectors/`)

Full-schema introspection for reverse engineering (distinct from the
narrow `dbt/warehouse.py`):

- PostgreSQL, MySQL, Snowflake, BigQuery, Databricks, SQL Server, Azure
  SQL, Redshift.
- `BaseConnector` ABC, `ConnectorConfig` dataclass, `ConnectorResult` with
  driver check + include/exclude filters.
- Used by legacy `dm pull <connector>` and by `dbt sync` as a fallback
  when the narrow path doesn't support a dialect.

### 2.6 Legacy importers and emitters (`dm_core/`)

These predate DataLex but remain wired in for reverse-engineering tasks:

- `importers.py` — SQL DDL, DBML, JSON Schema / OpenAPI, Spark schema,
  dbt manifest (the legacy path; `dm_core/dbt/manifest.py` is the current
  one).
- `generators.py` — DDL emission; migrated into the dialect registry for
  Postgres and Snowflake, retained for other dialects during rollout.
- `docs_generator.py` — HTML / Markdown data dictionary.
- `policy.py` — policy rule evaluator (10 rule types: naming conventions,
  required fields, SLA, deprecation checks, custom expressions).

## 3. CLI surface (`packages/cli`)

- `datalex_cli.py` — registers the `dm datalex …` subcommand tree:
  `migrate`, `validate`, `info`, `emit ddl`, `diff`, `expand`, `dbt sync`,
  `dbt emit`, `dbt import`, `packages resolve`, `packages list`.
- Legacy flat `dm` commands (`dm validate`, `dm pull`, `dm generate sql`,
  `dm doctor`, `dm watch`, `dm apply`, `dm migrate`) still exist — see
  [archive/yaml-spec-v2.md](./archive/yaml-spec-v2.md) for their semantics
  if you're on a legacy project.

See [cli.md](./cli.md) for the current cheat sheet.

## 4. Web UI (`packages/web-app` + `packages/api-server`)

- React + React Flow studio reading/writing the DataLex tree through the
  Node API server.
- Features: subject-area grouping, dark mode, schema-aware YAML
  autocomplete with inline lint, virtualized rendering for 1000+ entities,
  diagram export (PNG/SVG), global search, keyboard shortcuts.
- The UI has no database of its own — everything is filesystem + Git.

## 5. End-to-end flow: dbt sync path

```
┌──────────────────┐    1. manifest.json      ┌──────────────────┐
│ dbt project      │  ─────────────────────▶  │ dm_core.dbt      │
│   target/        │    2. profiles.yml       │   .manifest      │
│   dbt_project.yml│  ─────────────────────▶  │   .profiles      │
│   profiles.yml   │                          │   .warehouse     │
└────────┬─────────┘                          │   .sync          │
         │                                    └────────┬─────────┘
         │ 3. information_schema query                 │
         │    (per table, per profile target)          │
         ▼                                             │
┌──────────────────┐                                   │
│ Warehouse        │ ◀─────────────────────────────────┘
│ (duckdb/postgres)│
└──────────────────┘                                   ▼
                                         ┌──────────────────────┐
                                         │ DataLex YAML tree    │
                                         │   sources/*.yaml     │
                                         │   models/dbt/*.yaml  │
                                         │   (unique_id stamped)│
                                         └──────────┬───────────┘
                                                    │  4. dm datalex dbt emit
                                                    ▼
                                         ┌──────────────────────┐
                                         │ dbt YAML out         │
                                         │   sources/*.yml      │
                                         │   models/_schema.yml │
                                         │   (contracts on)     │
                                         └──────────────────────┘
```

Full walkthrough: [tutorial-dbt-sync.md](./tutorial-dbt-sync.md).

## 6. Repository layout

```text
DuckCodeModeling/
  packages/
    core_engine/src/dm_core/
      datalex/      # loader, project, migrator, diff, parse cache
      dialects/     # dialect plugin registry (postgres, snowflake, …)
      dbt/          # manifest, profiles, warehouse, sync, emit
      connectors/   # full-schema introspection per warehouse
      …             # legacy importers/emitters/policy kept in parallel
    cli/src/dm_cli/
      datalex_cli.py        # dm datalex … subcommand tree
      main.py               # legacy flat commands
    api-server/             # Node.js: UI backend
    web-app/                # React Flow studio
  schemas/datalex/          # JSON Schema per kind:
  examples/jaffle_shop_demo # dbt sync demo (DuckDB, zero setup)
  model-examples/           # legacy scenario projects
  docs/                     # current docs (this file + tutorials/reference)
  docs/archive/             # pre-DataLex specs (kept for reference)
  tests/datalex/            # unittest suite for the DataLex surface
```

## 7. Design choices worth knowing

- **File-per-entity, `kind:`-dispatched.** Diffs stay small; the parser
  can stream; concurrent edits don't collide on a single 10K-line file.
- **`meta.datalex.*` is emitter-owned.** Anything else under `meta:` is
  yours and survives round-trip. This is the contract that makes
  `dbt sync` safe to re-run.
- **Warehouse introspection is narrow on purpose.** `dbt sync` only needs
  columns for named tables, not the full schema — so `dbt/warehouse.py`
  is a tight `information_schema.columns` query, not the heavier
  `connectors/` path.
- **Cross-repo packages are content-hashed.** Lockfile drift is an error,
  not a warning. If your CI runs `load_imports_for` it will catch
  silent upstream changes.

## 8. Non-goals (for now)

- Multi-tenant / hosted SaaS. Everything is local filesystem + Git.
- SSO / OIDC / SAML / RBAC.
- Write-path to live warehouses (no `dm apply` auto-run in prod).

These remain options for a future enterprise phase; the current tool is
shaped for individual dbt users and teams who want their models in Git.
