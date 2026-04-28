# Tutorial: dbt sync in 5 minutes

This tutorial walks through turning a dbt project into a reviewable
DataLex YAML tree and emitting dbt-parseable YAML back with contracts.
Everything runs offline against a local DuckDB file — no external
warehouse needed.

If you finish this page you'll have:

- A synced DataLex tree with real warehouse column types
- A dbt `schema.yml` with `contract.enforced: true` and `data_type:` on
  every column
- A demonstration of doc-block round-trip preservation (1.4)
- A feel for how re-sync preserves anything you hand-author

Total time: about five minutes.

---

## 0. Install

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install -e '.[serve,duckdb]'
datalex --version             # 1.4.0+
```

That's it — no Node, no Docker, no database.

## 1. Build the demo warehouse

```bash
python examples/jaffle_shop_demo/setup.py
```

This creates `examples/jaffle_shop_demo/warehouse.duckdb` with three
raw tables (`raw_customers`, `raw_orders`, `raw_payments`) and two dbt
model outputs (`stg_customers`, `customers`). The manifest at
`examples/jaffle_shop_demo/target/manifest.json` already describes
them.

## 2. Run the sync

```bash
datalex dbt sync examples/jaffle_shop_demo \
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

"5 from warehouse" means every source/model table was introspected
live. "0 manifest-only" means we didn't fall back to manifest
`data_type` for any of them.

### What happened under the hood

1. Parsed `examples/jaffle_shop_demo/target/manifest.json`.
2. Built the **doc-block index** by scanning every `*.md` file for
   `{% docs name %}…{% enddocs %}` blocks (1.4).
3. Read `dbt_project.yml` → profile is `jaffle_shop`.
4. Read `examples/jaffle_shop_demo/profiles.yml` → target `dev` is
   DuckDB at `./warehouse.duckdb`.
5. For every source and model, ran
   `SELECT column_name, data_type, is_nullable FROM information_schema.columns`
   against DuckDB, normalized types to the DataLex palette (`varchar`
   → `string`, `int4` → `int`, etc.).
6. For every column whose manifest description matched a doc-block
   body, attached `description_ref: { doc: <name> }` so the round-trip
   preserves the reference.
7. Merged the live columns into the manifest-shaped docs (warehouse
   owns `type:` and `nullable:`; manifest/user own everything else),
   then wrote them out under `sources/` and `models/dbt/`.

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

- `type:` came from the live warehouse (DuckDB normalised to
  `int`/`string`).
- `nullable: false` on `id` because the column was declared `NOT NULL`.
- `description:` was carried over from the manifest.
- `meta.datalex.dbt.unique_id` is the stable round-trip key.

If your project has `{% docs %}` references, the imported column will
also carry a `description_ref` field — see
[step 7](#7-doc-block-round-trip-preservation) below.

## 4. Hand-author metadata

Open the source file and add a `sensitivity:` tag to one column:

```yaml
    - name: first_name
      type: string
      sensitivity: pii         # <- your edit
```

Save. Now re-run the sync:

```bash
datalex dbt sync examples/jaffle_shop_demo \
    --out-root examples/jaffle_shop_demo/datalex-out
```

Re-open the file. Your `sensitivity: pii` survived — the sync only
refreshes fields the warehouse owns (`type`, `nullable`). That's the
round-trip contract: **anything you author in YAML stays yours**.

## 5. Emit dbt YAML back

```bash
datalex dbt emit examples/jaffle_shop_demo/datalex-out \
    --out-dir examples/jaffle_shop_demo/dbt-out
```

```bash
cat examples/jaffle_shop_demo/dbt-out/models/_schema.yml
```

Every model has `config.contract.enforced: true` and `data_type:` on
every column. Run `dbt parse` against it — it parses clean. That's the
full loop:

```
dbt manifest  ->  DataLex YAML  ->  reviewable PR  ->  dbt YAML w/ contracts
```

## 6. Pre-flight a contracted sync (1.4)

When `contract.enforced: true` is on, dbt requires a concrete
`data_type` on every column. The api-server's `POST /api/forward/dbt-sync`
runs a pre-flight check — if any contract-enforced model has columns
with `type: unknown`, it returns 409 / `CONTRACT_PREFLIGHT` with an
actionable list. From the CLI you get the same signal via the policy
engine:

```bash
datalex policy-check models/marts/fct_orders.yml \
  --policy datalex/standards/base.yaml \
  --policy <(printf 'pack:\n  name: dtype\n  version: 0.0.1\npolicies:\n  - id: dtype\n    type: require_data_type_when_contracted\n    severity: error\n    params: {}\n')
```

A column whose type is missing or `unknown` shows up as a hard error;
fix it via the inspector or `dbt run`/`dbt compile` to repopulate the
warehouse types, then re-run the sync.

## 7. Doc-block round-trip preservation (1.4)

If your project uses `{% docs %}` blocks, DataLex preserves them
across the round-trip. Try this against
[`jaffle-shop-DataLex`](https://github.com/duckcode-ai/jaffle-shop-DataLex)
which ships with five canonical doc-blocks at
`models/docs/_canonical.md`:

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex /tmp/jaffle
cd /tmp/jaffle
make setup && make seed && make build

# Import → DataLex YAML → emit → original YAML
datalex dbt sync . --out-root /tmp/jaffle-datalex
datalex dbt emit /tmp/jaffle-datalex --out-dir /tmp/jaffle-emitted
diff /tmp/jaffle/models/marts/core/fct_orders.yml \
     /tmp/jaffle-emitted/models/_schema.yml
```

The `description: '{{ doc("order_id") }}'` line in `fct_orders.yml`
survives unchanged. Without 1.4 the emit would have produced
`description: 'Surrogate key identifying a single customer order. …'`
(the rendered text), breaking the doc-block reference and leaking
duplicated prose into git.

Manually rebuild the doc-block index after editing `.md` files:

```bash
datalex dbt docs reindex --project-dir .
```

## 8. Optional: validate, diff, gate, emit DDL

```bash
# Strict validation + structured diagnostics
datalex validate examples/jaffle_shop_demo/datalex-out

# Project summary (entities by layer, sources, models, policies, …)
datalex info examples/jaffle_shop_demo/datalex-out

# Emit per-dialect DDL for every physical entity
datalex emit ddl examples/jaffle_shop_demo/datalex-out \
    --dialect postgres \
    --out /tmp/ddl.sql

# 1.4 — readiness gate (red/yellow/green) on the imported tree
datalex readiness-gate --project examples/jaffle_shop_demo \
  --min-score 70 \
  --sarif /tmp/readiness.sarif --pr-comment /tmp/readiness.md

# Semantic diff between two snapshots (git-friendly in CI)
datalex diff old-snapshot/ new-snapshot/ --exit-on-breaking
```

## 9. Where to go next

- [Tutorial: CI readiness gate](./tutorials/ci-readiness-gate.md) (1.4)
- [Tutorial: Custom policy packs](./tutorials/policy-packs.md) (1.4)
- [DataLex layout reference](./datalex-layout.md) — what each `kind:`
  file looks like and how the parser discovers them.
- [CLI cheat sheet](./cli.md) — every `datalex …` subcommand on one
  page.
- [Architecture overview](./architecture.md) — the core engine modules
  and how they fit together.
- Try sync against your own dbt project:
  ```bash
  dbt parse                                          # in your dbt project
  datalex dbt sync /path/to/your/dbt/project \
      --out-root /path/to/datalex-out
  ```

## Troubleshooting

**`manifest.json not found`** — run `dbt parse` (or `dbt compile`) in
your dbt project first; it writes `target/manifest.json`. If you
don't have dbt installed, pass `--manifest /path/to/manifest.json`
explicitly.

**`profile … not found in profiles.yml`** — dbt looks in, in order:
`--profiles-dir`, `$DBT_PROFILES_DIR`, `<project>/profiles.yml`,
`~/.dbt/profiles.yml`. The sync uses the same precedence; pass
`--profiles-dir` if your file lives somewhere else.

**`0 from warehouse, N manifest-only`** — we couldn't reach the
warehouse for any table. Check the `warnings:` section of
`--output-json` output; common causes are a bad connection string,
missing driver (`pip install duckdb` / `psycopg2-binary`), or tables
that haven't been materialized yet (run `dbt run` first).

**I want to preview without touching the warehouse** — pass
`--skip-warehouse`; the sync falls back to `data_type` from the
manifest where dbt has it.

**Doc-block descriptions emit as the rendered string instead of
`{{ doc("...") }}`** — the source dbt project either doesn't have a
`.md` file containing the matching `{% docs %}` block, or your dbt
hasn't compiled it. Run `dbt compile` first; the doc-block index
needs the manifest's resolved description to find the binding.

**`CONTRACT_PREFLIGHT` failing** — a contract-enforced model has
columns with `type: unknown`. Run `dbt run` / `dbt compile` to populate
warehouse types, or set `data_type` explicitly in the model YAML.
