# Pull a warehouse schema into DataLex

When your source of truth is a live database — not a dbt repo —
start here. You'll wire up a connection, preview the tables the
connector thinks you should model (primary keys inferred, foreign
keys inferred, row counts on demand), and stream the pull with a
live progress log. The output lands in a dbt-shaped folder layout
so you can commit it straight into your dbt repo.

**Time:** 7 minutes. **Prerequisites:**

- Python 3.9+ with pip
- A reachable warehouse (see [supported dialects](#supported-dialects) below)
- A user / role with `SELECT` on `information_schema` (or the dialect
  equivalent) for the schemas you want to pull

---

## Supported dialects

DataLex ships nine connectors, all exercised by the same UX:

| Dialect       | Driver                 | Notes                                      |
|---------------|------------------------|--------------------------------------------|
| postgres      | `psycopg[binary]`      | Tested against PG 13, 15, 16               |
| mysql         | `mysql-connector-python` | 5.7+                                      |
| snowflake     | `snowflake-connector-python` | Uses `CURRENT_ACCOUNT()` probe        |
| bigquery      | `google-cloud-bigquery` | ADC or service-account JSON                |
| databricks    | `databricks-sql-connector` | Personal access token                   |
| sqlserver     | `pyodbc`               | ODBC Driver 18 recommended                 |
| azure_sql     | `pyodbc`               | Same driver as sqlserver                   |
| azure_fabric  | `pyodbc`               | Fabric warehouse endpoint                  |
| redshift      | `redshift-connector`   | Standard or Serverless                     |

All of them flow through the same `ConnectorConfig` →
`ConnectorResult` contract, so once one works, they all work.

---

## Step 1 — Start the server

```bash
pip install datalex-cli
datalex serve --project-dir ~/your-dbt-project
```

Passing `--project-dir` matters here: when the connector writes its
output, it checks for a `dbt_project.yml` in the project dir. If
present, pulls land in `sources/<db>__<schema>.yaml` and
`models/staging/stg_<schema>__<table>.yml` — i.e., exactly where
dbt expects them. Without it, you get a flat layout.

## Step 2 — Add a connection

1. Open the **Connectors** panel (left-panel tab; plug icon).
2. Click **New connection**.
3. Pick a dialect, fill in host/port/database/user/password (or
   token, for Databricks/BigQuery). Nothing is sent until you click
   **Test** or **Pull** — fields live in component state.
4. Click **Save**. A card appears in the connection list.

Secrets note: credentials are stored in `.dm-projects.json` under
your project dir. That file is `.gitignore`'d by default. For
production use, point a secrets manager at the api-server host
(env-var overrides are on the roadmap).

## Step 3 — Test the connection

Click the **Test** button on the connection card. The button
round-trips to `POST /api/connectors/test`, which opens a cursor,
runs a one-shot probe, and returns `{ ok, pingMs, serverVersion }`.

A green pill appears under the button:

```
✓ ping 12ms · PostgreSQL 16.1 on x86_64-pc-linux-gnu
```

Red pill means the probe raised — the tooltip has the driver error
verbatim. Common fixes:

- Postgres: `FATAL: database "…" does not exist` → typo in DB name.
- Snowflake: `390100` → wrong account / region; the account
  locator is `xy12345.us-east-1`, not the full URL.
- BigQuery: `DefaultCredentialsError` → run `gcloud auth
  application-default login` on the api-server host.

## Step 4 — Pick tables

Click **Pick tables…** on the connection card. The
**WarehouseTablePickerDialog** opens with:

- **Left sidebar** — every schema the user can see. Click one to
  expand.
- **Right pane** — tables in the expanded schema. Each row has:
  - Checkbox to select
  - Table name, type (`BASE TABLE` / `VIEW`)
  - Inferred **PK** chip — the connector's
    `infer_primary_keys()` heuristic reads `information_schema.
    key_column_usage` when available, falls back to column-name
    rules (`id`, `<table>_id`, `pk_*`).
  - **Row count** column — blank by default (cheap); click the
    small refresh icon in the column header to issue `SELECT
    COUNT(*)` per selected row. Warehouses charge for scans; we
    don't run counts unless you ask.
- **Snowflake jaffle-shop shortcut** — if the connection is
  Snowflake and a schema named `JAFFLE_SHOP` exists, a yellow
  "Select jaffle-shop demo tables" button appears at the top of
  that schema's pane. One click selects `customers`, `orders`,
  `order_items`, `products`, `stores`, `supplies` — same set the
  offline demo uses.

Multi-select across schemas is allowed; the dialog tracks picks as
`{ schema → [tableNames] }`.

## Step 5 — Inferred relationships preview

Before you commit the pull, the dialog's footer shows the
connector's **inferred FK** list — edges
`infer_relationships()` detects by column-name convention
(`<fk_column>` matches `<other_table>.<pk>` where the data types
align).

Example (Postgres jaffle_shop):

```
fk_orders_customers:  orders.customer_id → customers.id  (1:N)
fk_order_items_orders: order_items.order_id → orders.id  (1:N)
fk_order_items_products: order_items.product_id → products.id  (1:N)
```

This preview is read-only. The inference isn't perfect — for
stronger guarantees, rely on actual warehouse FK constraints where
you have them (Postgres, MySQL, SQL Server), or correct them in
the Inspector after the pull lands.

## Step 6 — Pull with live progress

Click **Pull**. The dialog closes and a log pane appears at the
bottom of the Connectors panel. The web app opens a streaming
`fetch` to `POST /api/connectors/pull/stream` — we deliberately
don't use `EventSource` so we can send the password in the POST
body rather than as a URL param.

Each `[pull]` line the CLI emits streams through as an SSE event:

```
[pull] connecting...
[pull] introspecting schema PUBLIC...
[pull] public.customers: 100 rows
[pull] public.orders: 99 rows
[pull] public.order_items: 245 rows
[pull] wrote models/staging/stg_public__customers.yml
[pull] wrote models/staging/stg_public__orders.yml
[pull] wrote sources/your_db__public.yaml
[pull] done in 2.4s
```

Color coding in the log pane: errors red, warnings yellow,
informational cyan, progress (`[pull] …`) green.

## Step 7 — Review the pulled tree

The Explorer refreshes. In a dbt-shaped project you'll see:

```
models/
  staging/
    stg_public__customers.yml
    stg_public__orders.yml
    stg_public__order_items.yml
sources/
  your_db__public.yaml
```

Open `stg_public__customers.yml`. Its Inspector tabs show:

- **Columns**: pulled from `information_schema.columns`; every
  column has a `data_type` — no yellow "missing type" pills like
  a fresh dbt import.
- **Relationships**: every inferred FK landed as a
  `many_to_one` edge.
- **Indexes**: inferred PK plus any unique/btree index the
  connector surfaced.
- The bottom **Diff** panel shows the full new-file patch.

The `sources/your_db__public.yaml` file is the dbt
`sources:` block — DataLex keeps the two in sync so you can run
`datalex datalex dbt emit` and emit matching `sources.yml` /
`schema.yml` files.

## Step 8 — Commit

```bash
cd ~/your-dbt-project
git status
# staged: sources/your_db__public.yaml
# staged: models/staging/stg_public__*.yml
git add sources/ models/staging/
git commit -m "chore(model): import public schema from <warehouse>"
```

From here on, every column rename, relationship edit, or test
addition is a real git diff. CI can gate on
`datalex gate old.yaml new.yaml` exactly as it would for a
hand-authored YAML change.

---

## Private networks / VPN

The api-server runs on whatever host you launched it from. If
your warehouse lives behind a VPN (most corporate Snowflake,
Redshift, SQL Server setups), you need to be on the VPN on the
api-server host — not on your laptop if you're running the
server elsewhere. SSH tunnels (`ssh -L`) work for stop-gap use.

## Flat layout (non-dbt projects)

If `--project-dir` doesn't contain a `dbt_project.yml`, the
connector writes a flat layout instead:

```
<project>/
  <schema>/
    customers.model.yaml
    orders.model.yaml
```

You can always re-run the pull with a different `--project-dir`
pointed at a real dbt repo to switch layouts.

## Troubleshooting

| Symptom                                           | Fix                                                                          |
|---------------------------------------------------|------------------------------------------------------------------------------|
| Test pill shows "ping —ms"                        | The probe query raised — check the hover tooltip for the driver error.       |
| "Pick tables…" returns an empty schema list       | User lacks `SELECT` on `information_schema.schemata`. Grant it or pick a narrower DB. |
| Row-count column stays blank                      | Click the refresh icon in the column header — counts are on-demand.          |
| Pull log scrolls then stops with no "done"        | The api-server subprocess crashed. Check `datalex serve` output for a Python traceback. |
| Tree lands flat instead of `models/staging/`      | Your `--project-dir` doesn't have `dbt_project.yml` at its root.             |
| Inferred FKs look wrong                           | Correct them in the Inspector's Relationships tab after pull. The inference is name-based, not authoritative. |
| BigQuery pull hangs                               | ADC may be stale — run `gcloud auth application-default login` and restart `datalex serve`. |
| Snowflake "Select jaffle-shop demo" button missing | The connection isn't Snowflake, or no schema named `JAFFLE_SHOP` is visible to the role. |

## What to do next

- **Round-trip to dbt** — `datalex dbt emit models/
  --out-dir ~/your-dbt-repo/` regenerates `schema.yml` files with
  the DataLex column metadata merged in. Doc-block references
  (`{{ doc("...") }}`) are preserved across the round-trip in 1.4.
- **Score the imported tree (1.4)** —
  `datalex readiness-gate --project ~/your-dbt-repo --min-score 70`
  surfaces gaps before you push. Wire it into CI with
  [Tutorial: CI readiness gate](ci-readiness-gate.md).
- **Author org-specific rules (1.4)** —
  [Tutorial: Custom policy packs](policy-packs.md) walks through
  `regex_per_layer`, `required_meta_keys`, contract enforcement,
  and selectors.
- **Gate PRs on breaking changes** — `datalex gate old.yaml
  new.yaml` (see [docs/cli.md](../cli.md)).
- **Combine with a dbt import** — if you already have a dbt
  project, [import it first](import-existing-dbt.md), then pull
  the warehouse to fill in column types for models dbt hasn't
  built yet.
- **Try the AI agents (1.4)** — the entity inspector empty state
  surfaces the **Conceptualize from staging** and **Canonicalize
  from staging** buttons. See
  [Agentic AI modeling](../ai-agentic-modeling.md).
- **Full CLI reference** — [docs/cli.md](../cli.md).
