# Tutorial: dbt sync in 5 minutes

This tutorial walks through turning a dbt project into a reviewable DataLex
YAML tree and then emitting dbt-parseable YAML back with contracts. Everything
runs offline against a local DuckDB file — no external warehouse needed.

If you finish this page you'll have:

- A synced DataLex tree with real warehouse column types
- A dbt `schema.yml` with `contract.enforced: true` and `data_type:` on every
  column
- A feel for how re-sync preserves anything you hand-author

Total time: about five minutes.

---

## 0. Install

```bash
git clone https://github.com/duckcode-ai/DuckCode-Modeling.git
cd DuckCode-Modeling

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

That's it — no Node, no Docker, no database.

## 1. Build the demo warehouse

```bash
python examples/jaffle_shop_demo/setup.py
```

This creates `examples/jaffle_shop_demo/warehouse.duckdb` with three raw
tables (`raw_customers`, `raw_orders`, `raw_payments`) and two dbt model
outputs (`stg_customers`, `customers`). The manifest at
`examples/jaffle_shop_demo/target/manifest.json` already describes them.

## 2. Run the sync

```bash
./dm datalex dbt sync examples/jaffle_shop_demo \
    --out-root examples/jaffle_shop_demo/datalex-out
```

You should see:

```
dbt sync complete
  dbt project: examples/jaffle_shop_demo
  DataLex out: examples/jaffle_shop_demo/datalex-out
  profile:     jaffle_shop / dev (duckdb)
  tables:      5 (5 from warehouse, 0 manifest-only)
  files:       3 written
```

"5 from warehouse" means every source/model table was introspected live.
"0 manifest-only" means we didn't fall back to manifest `data_type` for any
of them.

### What happened under the hood

1. Parsed `examples/jaffle_shop_demo/target/manifest.json`.
2. Read `dbt_project.yml` → profile is `jaffle_shop`.
3. Read `examples/jaffle_shop_demo/profiles.yml` → target `dev` is DuckDB at
   `./warehouse.duckdb`.
4. For every source and model, ran
   `SELECT column_name, data_type, is_nullable FROM information_schema.columns`
   against DuckDB, normalized types to the DataLex palette (`varchar` →
   `string`, `int4` → `int`, etc.).
5. Merged the live columns into the manifest-shaped docs (warehouse owns
   `type:` and `nullable:`; manifest/user own everything else), then wrote
   them out under `sources/` and `models/dbt/`.

## 3. Read the output

```bash
cat examples/jaffle_shop_demo/datalex-out/sources/jaffle_shop_raw.yaml
```

```yaml
kind: source
name: jaffle_shop_raw
database: warehouse
schema: main
tables:
- name: raw_customers
  description: Raw customer records from the source system.
  columns:
  - name: id
    description: Primary key.
    type: int
    nullable: false
  - name: first_name
    type: string
  - name: last_name
    type: string
  meta:
    datalex:
      dbt:
        unique_id: source.jaffle_shop.jaffle_shop_raw.raw_customers
```

Notice:

- `type:` came from the live warehouse (DuckDB normalised to `int`/`string`).
- `nullable: false` on `id` because the column was declared `NOT NULL`.
- `description:` was carried over from the manifest.
- `meta.datalex.dbt.unique_id` is the stable round-trip key.

## 4. Hand-author metadata

Open the source file and add a `sensitivity:` tag to one column:

```yaml
    - name: first_name
      type: string
      sensitivity: pii         # <- your edit
```

Save. Now re-run the sync:

```bash
./dm datalex dbt sync examples/jaffle_shop_demo \
    --out-root examples/jaffle_shop_demo/datalex-out
```

Re-open the file. Your `sensitivity: pii` survived — the sync only refreshes
fields the warehouse owns (`type`, `nullable`). That's the round-trip
contract: **anything you author in YAML stays yours**.

## 5. Emit dbt YAML back

```bash
./dm datalex dbt emit examples/jaffle_shop_demo/datalex-out \
    --out-dir examples/jaffle_shop_demo/dbt-out
```

```bash
cat examples/jaffle_shop_demo/dbt-out/models/_schema.yml
```

Every model has `config.contract.enforced: true` and `data_type:` on every
column. Run `dbt parse` against it — it parses clean. That's the full
loop:

```
dbt manifest  ->  DataLex YAML  ->  reviewable PR  ->  dbt YAML w/ contracts
```

## 6. Optional: validate, diff, emit DDL

```bash
# Strict validation + structured diagnostics
./dm datalex validate examples/jaffle_shop_demo/datalex-out

# Project summary (entities by layer, sources, models, policies, …)
./dm datalex info examples/jaffle_shop_demo/datalex-out

# Emit per-dialect DDL for every physical entity
./dm datalex emit ddl examples/jaffle_shop_demo/datalex-out \
    --dialect postgres \
    --out /tmp/ddl.sql

# Semantic diff between two snapshots (git-friendly in CI)
./dm datalex diff old-snapshot/ new-snapshot/ --exit-on-breaking
```

## 7. Where to go next

- [DataLex layout reference](./datalex-layout.md) — what each `kind:` file
  looks like and how the parser discovers them.
- [CLI cheat sheet](./cli.md) — every `dm datalex …` subcommand on one page.
- [Architecture overview](./architecture.md) — the core engine modules and
  how they fit together.
- Try sync against your own dbt project:
  ```bash
  dbt parse                                          # in your dbt project
  ./dm datalex dbt sync /path/to/your/dbt/project \
      --out-root /path/to/datalex-out
  ```

## Troubleshooting

**`manifest.json not found`** — run `dbt parse` (or `dbt compile`) in your
dbt project first; it writes `target/manifest.json`. If you don't have dbt
installed, pass `--manifest /path/to/manifest.json` explicitly.

**`profile … not found in profiles.yml`** — dbt looks in, in order:
`--profiles-dir`, `$DBT_PROFILES_DIR`, `<project>/profiles.yml`,
`~/.dbt/profiles.yml`. The sync uses the same precedence; pass
`--profiles-dir` if your file lives somewhere else.

**`0 from warehouse, N manifest-only`** — we couldn't reach the warehouse
for any table. Check the `warnings:` section of `--output-json` output;
common causes are a bad connection string, missing driver
(`pip install duckdb` / `psycopg2-binary`), or tables that haven't been
materialized yet (run `dbt run` first).

**I want to preview without touching the warehouse** — pass
`--skip-warehouse`; the sync falls back to `data_type` from the manifest
where dbt has it.
