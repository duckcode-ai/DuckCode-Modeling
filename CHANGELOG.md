# Changelog

All notable changes to DataLex are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `v0.1.0` onward.

## [Unreleased]

## [0.2.0] — 2026-04-20

**Backend integration for the dbt workflow.** Five PRs land together —
covering folder-preserving dbt import, a proper canvas modeling
experience, a file/folder workspace, a live warehouse-pull UX, and a
single-command install/serve flow.

### Added

- **`datalex serve` / `dm serve`** — starts the bundled Express API
  server and web-app static bundle on one port (`--port`, default
  `3030`). `pip install datalex-cli && datalex serve` is now the full
  install path: no Node/Docker, no second terminal, no CORS. Falls back
  to `nodejs-bin` when system `node` isn't present.
- **Folder-preserving dbt import** (PR A) — `dm dbt sync` and the new
  `POST /api/dbt/import` route write each model at its original
  `models/staging/...` / `models/marts/...` path on disk. Explorer now
  renders a recursive tree and a checked-in jaffle-shop fixture lights
  up the full project offline in one click.
- **Column lint** (`dbtLint.js`) surfaces missing `description`,
  `data_type`, and test-less primary keys inline in the inspector and
  aggregates in the Validation panel.
- **Canvas modeling** (PR B) — drag from one column to another to open
  a pre-filled relationship dialog, positions persist via a new
  `display:` sub-map per entity, and the old decorative Undo/Redo
  buttons now drive a real per-file history ring buffer (⌘Z / ⌘⇧Z).
- **File/folder workspace CRUD** (PR C) — new api-server routes for
  folders, rename, move, delete, and save-all; the Explorer gets a
  right-click context menu and HTML5 drag-to-move. Every path is
  resolved with a `..`/symlink guardrail.
- **Live warehouse pull polish** (PR D) —
  - `POST /api/connectors/test` returns `{ pingMs, serverVersion }`
    and renders a pill under the Test button.
  - `POST /api/connectors/pull/stream` streams per-table `[pull] …`
    progress lines as SSE; the Connectors panel has a live log pane.
  - `cmd_pull` can write dbt-shaped projects to
    `sources/<db>__<schema>.yaml` + `models/staging/stg_…yml` when the
    target is a dbt project (`--no-dbt-layout` to opt out).
  - New `WarehouseTablePickerDialog` lets users pick exact tables per
    schema with inferred primary keys + row counts, including a
    one-click "Pick demo tables" shortcut for a Snowflake
    `JAFFLE_SHOP` schema.

### Changed

- Version bumped to `0.2.0` across `pyproject.toml`,
  `packages/web-app/package.json`, and `packages/api-server/package.json`.
- Wheel now ships both the built web-app (`datalex_core/_webapp/`) and
  the api-server entry point (`datalex_core/_server/`) as package
  data, so `datalex serve` works from an installed wheel with zero
  extra setup.
- `CONNECTOR_FIELDS` / `CONNECTOR_META` unchanged — no credential
  migrations required.

## [0.1.1] — 2026-04-18

First PyPI release. `pip install datalex-cli` now works end-to-end.

### Added

- JSON Schemas are bundled with the `datalex_core` Python package under
  `datalex_core/_schemas/datalex/`. `pip install datalex-cli` from any
  working directory can validate projects without needing the repo on
  disk.
- Tag-triggered PyPI publish workflow (`.github/workflows/publish.yml`)
  using OIDC trusted publishing — no long-lived API tokens stored.
- `RELEASING.md` — one-time PyPI setup plus the release checklist.
- README hero screenshot (`Assets/Overview.png`) showing the Visual
  Studio: file tree, schema-aware YAML editor, and React Flow ERD
  side-by-side on the same entity.

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

[Unreleased]: https://github.com/duckcode-ai/DataLex/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/duckcode-ai/DataLex/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/duckcode-ai/DataLex/releases/tag/v0.1.0
