<div align="center">
  <a href="https://duckcode.ai/" target="_blank" rel="noopener noreferrer">
    <img src="Assets/DataLex.png" alt="DataLex by DuckCode AI Labs" width="220" />
  </a>

# DataLex

**Git-native data modeling for dbt users.**

Point us at your dbt project and warehouse — we produce versioned, reviewable YAML
with contracts, lineage, ERDs, and clean round-trip back to dbt.

<p align="center">
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

## 60-second demo

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
pip install -r requirements.txt

# 1. Build a local DuckDB warehouse (no external credentials)
python examples/jaffle_shop_demo/setup.py

# 2. Sync the dbt project into DataLex YAML
./datalex datalex dbt sync examples/jaffle_shop_demo \
    --out-root examples/jaffle_shop_demo/datalex-out

# 3. Emit dbt-parseable YAML back, with contracts enforced
./datalex datalex dbt emit examples/jaffle_shop_demo/datalex-out \
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

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# optional — only needed for the Visual Studio
npm --prefix packages/api-server install
npm --prefix packages/web-app install
```

Prereqs: Python 3.9+, Git. Node.js 18+ if you want the UI.

## Project layout

```text
DataLex/
  packages/
    core_engine/           # Python: loader, dialects, dbt integration, packages
    cli/                   # `datalex` entry point
    api-server/            # Node.js API (UI backend)
    web-app/               # React Flow studio
  schemas/datalex/         # JSON Schema per `kind:` (project, entity, source, ...)
  examples/
    jaffle_shop_demo/      # zero-setup dbt-sync demo (DuckDB)
  model-examples/          # sample projects and scenario walkthroughs
  docs/                    # architecture, specs, runbooks
  tests/                   # unittest suite (core engine + datalex)
```

## Visual Studio (optional)

If you want the UI on top of your DataLex project, run the two dev servers:

```bash
# Terminal 1
npm --prefix packages/api-server run dev
# Terminal 2
npm --prefix packages/web-app run dev
```

Then open `http://localhost:5173`. The UI reads and writes the same YAML
files the CLI does — no database, no hosted service.

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

- **[Tutorial: dbt sync in 5 minutes](docs/tutorial-dbt-sync.md)** — the
  full jaffle_shop walkthrough with explanations.
- **[DataLex layout reference](docs/datalex-layout.md)** — what each
  `kind:` file looks like and how the loader discovers them.
- **[CLI cheat sheet](docs/cli.md)** — every `datalex datalex …` subcommand on
  one page.
- **[Architecture](docs/architecture.md)** — core engine modules and
  end-to-end data flow.
- Pre-DataLex specs have moved to [docs/archive/](docs/archive/).

## Community

- Discord: [![Join Discord](https://img.shields.io/badge/Discord-Join%20DuckCode%20AI-5865F2?logo=discord&logoColor=white)](https://discord.gg/Dnm6bUvk)
- Issues: [![GitHub Issues](https://img.shields.io/badge/Issues-Report%20or%20Request-0ea5e9)](https://github.com/duckcode-ai/DataLex/issues)
- Contributing: `CONTRIBUTING.md`
- License: [![MIT](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)
