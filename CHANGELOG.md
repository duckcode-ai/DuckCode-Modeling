# Changelog

All notable changes to DataLex are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `v0.1.0` onward.

## [Unreleased]

### Added

- JSON Schemas are now bundled with the `datalex_core` Python package under
  `datalex_core/_schemas/datalex/`. `pip install datalex-cli` from any
  working directory can validate projects without needing the repo on disk.

## [0.1.0] — 2026-04-18

First tagged release. The project was previously known as
**DuckCodeModeling**; it is now **DataLex** (product) by **DuckCode AI
Labs** (company).

### Added

- **DataLex YAML substrate** — `kind:`-dispatched, file-per-entity
  layout under `models/{conceptual,logical,physical}/`,
  `glossary/<term>.yaml`, `domains/`, `policies/`, `snippets/`. Per-kind
  JSON Schemas under `schemas/datalex/`.
- **Streaming loader** with source-located errors
  (`file`/`line`/`column`/`suggested_fix`) and a content-addressed parse
  cache under `build/.cache/` or `~/.datalex/cache/`.
- **Dialect plugin registry** (`datalex_core/dialects/`) — Postgres and
  Snowflake first-party; BigQuery, Databricks, MySQL, SQL Server,
  Redshift via the existing generators path.
- **dbt integration** — `datalex datalex dbt sync` reads
  `target/manifest.json` + `profiles.yml`, introspects live column types
  (DuckDB + Postgres), and merges them into DataLex YAML with
  idempotent `meta.datalex.dbt.unique_id` stamping. `datalex datalex
  dbt emit` writes `sources.yml` + `models/_schema.yml` with
  `contract.enforced: true` and `data_type:` on every column.
- **Cross-repo packages** — `imports:` supports `org/name@version`,
  `git:` + `ref:`, or `path:`; lockfile + content-hash drift detection
  at `.datalex/lock.yaml`.
- **Explicit rename tracking** via `previous_name:`; diff prefers
  explicit renames over heuristics.
- **CLI binary** `datalex` (argparse subcommand tree). Legacy flat
  commands from the pre-DataLex prototype remain available.
- **Reusable GitHub Action** (`.github/actions/datalex`) for CI: validate
  → breaking-change diff → emit dbt YAML → optional `dbt parse`.
- **Visual Studio UI** — React + React Flow studio (`packages/web-app`
  + `packages/api-server`) reading and writing the same YAML tree as
  the CLI. No database, no hosted service.
- **Zero-setup demo** at `examples/jaffle_shop_demo/` — builds a local
  DuckDB warehouse and runs the full dbt sync pipeline without any
  external credentials.
- **Installable Python package** — `pyproject.toml` exposes
  `datalex-cli` on PyPI-style layout with optional extras (`[duckdb]`,
  `[postgres]`, `[snowflake]`, etc.). `pip install -e .` from a clone
  works today; a true PyPI publish requires bundling `schemas/datalex/`
  into the package (tracked as follow-up).

### Known limitations

- `datalex datalex ...` still has the nested subcommand name; flattening
  to `datalex <sub>` is a follow-up (will require resolving collisions
  with the legacy flat commands).
- Schemas under `schemas/datalex/` are discovered relative to the repo
  root; a `pip install`ed package run outside the repo needs
  `--schemas-root` or the repo on disk.

[Unreleased]: https://github.com/duckcode-ai/DataLex/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/duckcode-ai/DataLex/releases/tag/v0.1.0
