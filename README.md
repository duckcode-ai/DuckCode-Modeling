<div align="center">
  <a href="https://duckcode.ai/" target="_blank" rel="noopener noreferrer">
    <img src="Assets/DataLex.png" alt="DataLex by DuckCode AI Labs" width="220" />
  </a>

# DataLex

**Git-native data modeling for dbt users.**

Point us at your dbt project and warehouse — we produce versioned, reviewable YAML
with contracts, lineage, ERDs, and clean round-trip back to dbt.

<p align="center">
  <a href="https://pypi.org/project/datalex-cli/">
    <img src="https://img.shields.io/pypi/v/datalex-cli?style=for-the-badge&color=3b82f6&label=PyPI" alt="PyPI" />
  </a>
  <a href="https://github.com/duckcode-ai/DataLex/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/duckcode-ai/DataLex?style=for-the-badge&color=22c55e" alt="MIT License" />
  </a>
  <a href="https://discord.gg/Dnm6bUvk">
    <img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord Community" />
  </a>
  <a href="https://github.com/duckcode-ai/DataLex/stargazers">
    <img src="https://img.shields.io/github/stars/duckcode-ai/DataLex?style=for-the-badge&color=f59e0b" alt="GitHub Stars" />
  </a>
</p>
</div>

<p align="center">
  <img src="Assets/Overview.png" alt="DataLex Visual Studio — file tree, YAML editor, and React Flow ERD on the same entity" width="100%" />
</p>

## Quickstart — two commands

```bash
pip install -U 'datalex-cli[serve]'    # CLI + bundled Node — one command, no prereqs
datalex serve                          # opens http://localhost:3030
```

That's it. No Node install, no Docker, no database. `[serve]` pulls a
portable Node runtime so Python alone is enough. If you already have
Node 20+ on PATH, plain `pip install datalex-cli` works too.

**Point it at your dbt repo:**

```bash
cd ~/my-dbt-project                    # folder containing dbt_project.yml
datalex serve --project-dir .
```

The folder auto-registers as your active project; the browser opens
straight into your real file tree. Every UI edit writes back to the
original `.yml` files — `git status` shows real diffs.

**Build your first ER diagram:**

1. Click **Import dbt repo → Local folder** → pick your project root
2. Click **New modeling asset** and choose Conceptual, Logical, or
   Physical. New assets use the domain-first structure
   `DataLex/<domain>/<conceptual|logical|physical>/...`.
3. Open the new `.diagram.yaml`. Conceptual and logical diagrams can
   create boxes directly; physical diagrams are dbt-first, so drag any
   `schema.yml` / `.model.yaml` from the Explorer onto the canvas.
   Relationship handles on each card create business, logical, or
   physical relationships for the active layer.
4. Drag to reposition → **Save All** → positions persist in the
   diagram file; `git commit` picks them up. Save All is merge-safe:
   multiple in-memory docs targeting the same `schema.yml` are merged
   through the core-engine `merge_models_preserving_docs` helper
   instead of clobbering siblings.

See **[docs/getting-started.md](docs/getting-started.md)** for the full
path matrix (demo → local dbt → git URL → live warehouse).

**Want your warehouse drivers too?**

```bash
pip install 'datalex-cli[serve,postgres]'        # or snowflake, bigquery, databricks…
pip install 'datalex-cli[serve,all]'             # every driver + Node
```

### Pick a tutorial

Once `datalex serve` is running, follow the path that matches what you
have in hand:

| You have...                                | Tutorial                                                           | Time  |
|--------------------------------------------|--------------------------------------------------------------------|-------|
| Nothing — want to try with a known-good dbt repo | [Walk through jaffle-shop end-to-end](docs/tutorials/jaffle-shop-walkthrough.md) | 5 min |
| An existing dbt project (folder or git)    | [Import an existing dbt project](docs/tutorials/import-existing-dbt.md)        | 5 min |
| A live warehouse (Snowflake/Postgres/…)    | [Pull a warehouse schema](docs/tutorials/warehouse-pull.md)                    | 7 min |
| CLI-only, no UI                            | [CLI dbt-sync tutorial](docs/tutorial-dbt-sync.md)                             | 5 min |

New here? Start with **[docs/getting-started.md](docs/getting-started.md)** —
it's the map across all four paths plus the mental model.

## 60-second demo (offline, no warehouse)

<p align="center">
  <img src="demo/demo.gif" alt="DataLex dbt sync demo — build a DuckDB warehouse, sync into DataLex YAML, emit back to dbt with contracts enforced" width="100%" />
</p>

```bash
pip install 'datalex-cli[duckdb]'
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex

# 1. Build a local DuckDB warehouse (no external credentials)
python examples/jaffle_shop_demo/setup.py

# 2. Sync the dbt project into DataLex YAML
datalex datalex dbt sync examples/jaffle_shop_demo \
    --out-root examples/jaffle_shop_demo/datalex-out

# 3. Emit dbt-parseable YAML back, with contracts enforced
datalex datalex dbt emit examples/jaffle_shop_demo/datalex-out \
    --out-dir examples/jaffle_shop_demo/dbt-out
```

Open `examples/jaffle_shop_demo/datalex-out/sources/jaffle_shop_raw.yaml` —
every column has its warehouse type, descriptions from the manifest, and a
`meta.datalex.dbt.unique_id` stamp so re-running the sync never clobbers
anything you've hand-authored.

## What it does

DataLex treats your data models as code. On top of a stricter YAML
substrate (the **DataLex** layout — one file per entity, `kind:`-dispatched,
streaming-safe for 10K+ entities), it gives you:

- **`datalex datalex dbt sync <project>`** — reads `target/manifest.json` + your
  `profiles.yml`, introspects live column types, and merges them into
  DataLex YAML. Idempotent: user-authored `description:`, `tags:`,
  `sensitivity:`, and `tests:` survive re-sync.
- **`datalex datalex dbt emit`** — writes `sources.yml` and `schema.yml` with
  `contract.enforced: true` and `data_type:` on every column. `dbt parse`
  succeeds out of the box.
- **`datalex datalex emit ddl --dialect ...`** — Postgres, Snowflake, BigQuery,
  Databricks, MySQL, SQL Server, Redshift. Same source, all dialects.
- **`datalex datalex diff`** — semantic diff with explicit rename tracking
  (`previous_name:`), breaking-change gate for CI.
- **Cross-repo package imports** — pin `acme/warehouse-core@1.4.0` in
  `imports:`, lockfile + content hash drift detection, Git-or-path
  resolution, on-disk parse cache for large projects.
- **Visual studio** — React Flow UI for editing entities, relationships,
  and metadata; same YAML files as the CLI.

## Supported warehouses

| Warehouse | `dbt sync` introspection | Forward DDL | Reverse engineering |
|---|:---:|:---:|:---:|
| DuckDB | ✓ | — | — |
| PostgreSQL | ✓ | ✓ | ✓ |
| Snowflake | (fallback) | ✓ | ✓ |
| BigQuery | (fallback) | ✓ | ✓ |
| Databricks | (fallback) | ✓ | ✓ |
| MySQL | (fallback) | ✓ | ✓ |
| SQL Server / Azure SQL | (fallback) | ✓ | ✓ |
| Redshift | (fallback) | ✓ | ✓ |

"Fallback" = uses the existing full-schema connector (slower than the
per-table path but already works today; a narrow introspection path ships
per-dialect over time).

## Install

**For users** — from [PyPI](https://pypi.org/project/datalex-cli/):

```bash
pip install -U 'datalex-cli[serve]'                 # CLI + UI (recommended)
pip install -U 'datalex-cli[serve,postgres]'        # add a warehouse driver
pip install -U 'datalex-cli[serve,all]'             # every driver + UI
pip install -U datalex-cli                          # CLI-only, no UI
```

Available extras: `serve`, `duckdb`, `postgres`, `mysql`, `snowflake`,
`bigquery`, `databricks`, `sqlserver`, `redshift`, `all`.

**Prereqs:** Python 3.9+ and Git. That's it — `[serve]` bundles Node.

Verify the installed package:

```bash
datalex --version
```

For the local DuckDB-based example repo, install the matching driver too:

```bash
pip install -U 'datalex-cli[serve,duckdb]'
```

**For contributors** — from source:

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[serve,duckdb]'
datalex serve                                    # auto-builds the UI on first run
```

## Project layout

```text
DataLex/
  packages/
    core_engine/           # Python: loader, dialects, dbt integration, packages
      src/datalex_core/
        _schemas/datalex/  # JSON Schema per `kind:` — bundled with the package
    cli/                   # `datalex` entry point
    api-server/            # Node.js API (UI backend)
    web-app/               # React Flow studio
  examples/
    jaffle_shop_demo/      # zero-setup dbt-sync demo (DuckDB)
  model-examples/          # sample projects and scenario walkthroughs
  docs/                    # architecture, specs, runbooks
  tests/                   # unittest suite (core engine + datalex)
```

## Visual Studio

`datalex serve` ships the full UI — no extra setup. If you're hacking
on the web app itself and want hot-reload, run the two dev servers from
a source checkout:

```bash
# Terminal 1 — api (port 3030)
npm --prefix packages/api-server run dev
# Terminal 2 — web (port 5173)
npm --prefix packages/web-app run dev
```

The UI reads and writes the same YAML files the CLI does — no database,
no hosted service.

## CI / GitOps

DataLex is designed to live in your repo next to your dbt project.
A typical CI step:

```bash
./datalex datalex validate datalex/
./datalex datalex diff datalex-main/ datalex/ --exit-on-breaking
./datalex datalex dbt emit datalex/ --out-dir dbt/
dbt parse
```

## Documentation

**Onboarding**

- **[Getting started](docs/getting-started.md)** — the one-page map
  covering install, the three GUI paths, and the mental model.
- **[Jaffle-shop walkthrough](docs/tutorials/jaffle-shop-walkthrough.md)** —
  end-to-end demo: clone the real jaffle-shop repo, import it, rename an
  entity, commit back to git.
- **[Import an existing dbt project](docs/tutorials/import-existing-dbt.md)** —
  5-minute bring-your-own-repo flow (local folder or git URL).
- **[Pull a warehouse schema](docs/tutorials/warehouse-pull.md)** —
  7-minute live-connection flow with inferred PKs/FKs and streaming
  progress.
- **[CLI dbt-sync tutorial](docs/tutorial-dbt-sync.md)** — original
  CLI-only jaffle_shop walkthrough.

**Reference**

- **[DataLex layout reference](docs/datalex-layout.md)** — what each
  `kind:` file looks like and how the loader discovers them.
- **[CLI cheat sheet](docs/cli.md)** — every `datalex datalex …` subcommand on
  one page.
- **[API contracts](docs/api-contracts.md)** — HTTP API reference for
  integrators.
- **[Architecture](docs/architecture.md)** — core engine modules and
  end-to-end data flow.
- Pre-DataLex specs have moved to [docs/archive/](docs/archive/).

## Community

- Discord: [![Join Discord](https://img.shields.io/badge/Discord-Join%20DuckCode%20AI-5865F2?logo=discord&logoColor=white)](https://discord.gg/Dnm6bUvk)
- Issues: [![GitHub Issues](https://img.shields.io/badge/Issues-Report%20or%20Request-0ea5e9)](https://github.com/duckcode-ai/DataLex/issues)
- Contributing: `CONTRIBUTING.md`
- License: [![MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
