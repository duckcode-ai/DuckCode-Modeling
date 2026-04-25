# Jaffle-shop end-to-end walkthrough

The fastest way to see every DataLex feature is the dedicated
`duckcode-ai/jaffle-shop-DataLex` repository. It keeps the familiar
jaffle-shop domain, but adds the pieces needed to exercise DataLex end
to end: DuckDB seeds, dbt staging and marts, semantic models,
conceptual/logical/physical diagrams, generated SQL/YAML, Interface
metadata, and project-local modeling skills.

You'll end with:

- A browser tab showing dbt files, DataLex diagrams, generated SQL, and
  project skills in one tree
- Conceptual, logical, and physical diagrams that demonstrate the three
  modeling layers
- Interface readiness checks on shared dbt models such as
  `dim_customers` and `fct_orders`
- A real `.git` history of your edits — DataLex writes back into the
  cloned repo, so `git log` / `git diff` show normal dbt changes

**Time:** 5 minutes. **Prerequisites:** Python 3.11 or 3.12 for dbt,
Git, and network access to `github.com`.

---

## Step 1 — Install and start the server

```bash
pip install 'datalex-cli[serve]'     # CLI + bundled Node, one command
datalex serve                        # opens http://localhost:3030
```

On Python 3.13+ or 3.14+, install Node 20+ first. The `[serve]` extra
bundles Node for Python 3.9-3.12, but the portable Node wheel is not
published for newer Python versions yet.

The first `datalex serve` call prints something like:

```
[datalex] Starting DataLex server on http://localhost:3030
[datalex]   server:   /…/datalex_core/_server/index.js
[datalex]   web dist: /…/datalex_core/_webapp
[datalex]   project:  /Users/you/current-dir
```

A browser tab opens on `http://localhost:3030`. If it doesn't, open
that URL manually or re-run with `--no-browser` and copy the link.

## Step 2 — Clone and build the DataLex jaffle-shop repo

Use the example repo as the project root. It is designed for DataLex,
so you do not need to start from the generic starter repo.

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex ~/src/jaffle-shop-DataLex
cd ~/src/jaffle-shop-DataLex
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
dbt seed --profiles-dir .
dbt build --profiles-dir .
```

This creates `jaffle_shop.duckdb` locally. The database file is ignored
by git.

Use Python 3.11 or 3.12 for this dbt example. Python 3.14 currently
breaks in dbt's serializer stack; use Docker if you do not want to
manage Python versions locally.

Now start DataLex against the clone:

```bash
datalex serve --project-dir ~/src/jaffle-shop-DataLex
```

The Explorer should show this project shape:

```
DataLex/
  commerce/
    Conceptual/commerce_concepts.diagram.yaml
    Logical/commerce_logical.diagram.yaml
    Physical/duckdb/commerce_physical.diagram.yaml
    Generated/dbt/customer_order_summary.sql
models/
  staging/
    jaffle_shop/
  marts/
    core/
  semantic/
```

## Step 3 — Review the three DataLex layers

The example repo already includes diagrams that demonstrate the three
DataLex layers.

1. Open `DataLex/commerce/Conceptual/commerce_concepts.diagram.yaml`.
   It uses business concepts and verbs: Customer places Order, Order
   contains Order Item, Product describes Order Item, and Supply
   supports Product.
2. Open `DataLex/commerce/Logical/commerce_logical.diagram.yaml`. It
   adds attributes, keys, candidate keys, business keys, and the Order
   Line associative entity.
3. Open `DataLex/commerce/Physical/duckdb/commerce_physical.diagram.yaml`.
   It references dbt YAML files under `models/`, shows physical columns,
   and maps relationships to dbt/database intent.

## Step 4 — Open a model in the inspector

Click `models/marts/core/dim_customers.yml` in the Explorer.

- **Centre canvas** renders the entity as an ER node with columns
  listed inline. Other entities it references (via FKs) are positioned
  around it.
- **Right panel** shows the Inspector: tabs for Columns, Relationships,
  Indexes, Enums, Tests.
- **Columns tab** lists each column. Any column missing a
  `description` or `data_type` shows a warning pill — that's the lint
  rule (`packages/web-app/src/lib/dbtLint.js`) running client-side
  with no save-cost.

Try renaming a column description: click the description cell, type
something, blur. The YAML updates in-memory and **autosave** flushes
the change to disk ~800ms later — you'll see the **Diff** panel at
the bottom transition from pending to clean.

## Step 5 — Check Interface readiness

Open `models/marts/core/dim_customers.yml` and
`models/marts/core/fct_orders.yml`. Both are marked as shared DataLex
Interfaces under `meta.datalex.interface`.

From a DataLex source checkout, run:

```bash
cd /Users/Kranthi_1/DataLex
.venv/bin/python ./datalex datalex mesh check /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex --strict
```

Expected result:

```text
DataLex mesh Interface check: /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex
  strict: yes
  interfaces: ready
```

## Step 6 — Turn on auto-commit (optional)

1. Open the Commit dialog (`⌘⇧G` or the branch icon in the Chrome
   header).
2. Enable **Auto-commit on save**.
3. Back in the inspector, change three field descriptions in quick
   succession. Auto-commit debounces bursty saves: within ~3s you'll
   see **exactly one** new commit in `git log`.

Failure mode: if the commit fails (e.g. missing `user.email`), the
save itself still succeeds — the auto-commit error surfaces as a
toast so you can fix the config and retry manually.

## Step 7 — Review generated dbt assets

Open `DataLex/commerce/Generated/dbt/customer_order_summary.sql` and
`DataLex/commerce/Generated/dbt/customer_order_summary.yml`. These show
how DataLex-generated dbt work can stay staged and reviewable before it
is promoted into `models/marts/core/`.

After promoting generated dbt assets, run:

```bash
dbt build --profiles-dir .
```

## Step 8 — Apply DDL to a warehouse (optional)

1. In an open `.model.yaml`, press `⌘K` → **Apply to warehouse…**
2. Pick a dialect (DuckDB for a throwaway local run, Snowflake / BQ /
   Databricks if you have a connector profile saved).
3. Click **Generate DDL** — the preview shows the forward-engineered
   SQL.
4. Pick a connector profile. Leave **Dry run** checked for the first
   pass; hit **Dry run**. The server compiles and validates against
   the target without executing.
5. Uncheck **Dry run** → **Apply** when you're ready.

The endpoint is gated by `DM_ENABLE_DIRECT_APPLY` on the server. When
disabled (the GitOps default), the dialog instead instructs you to
commit the generated SQL and deploy via CI/CD.

## Step 9 — Export a PNG of the diagram

With any diagram open, press `⌘⇧E`. A PNG of the current canvas
downloads. That same action lives in the diagram toolbar overflow
menu for discoverability.

## What to do next

- **Try the live warehouse flow →** [Pull a warehouse schema](warehouse-pull.md)
- **Use your own dbt repo →** [Import an existing dbt project](import-existing-dbt.md)
- **Hook it into CI →** `datalex gate old.yaml new.yaml` fails PRs on
  breaking schema changes; see `docs/cli.md`.

## Troubleshooting

| Symptom                                     | Fix                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| Clone fails with a network error            | Check GitHub access, firewalls, proxies, or clone the repo through your normal Git credentials. |
| `dbt build` cannot find a profile           | Run dbt commands from the repo root and include `--profiles-dir .`; the example ships a DuckDB `profiles.yml`. |
| Rename cascade complains about a file       | The atomic endpoint rolls the whole rename back on any write failure. Fix the reported file (permissions, locks) and retry. |
| Diff panel keeps showing changes after save | Stale editor state — hit `⌘R`. The in-flight Zustand store and the on-disk bytes should match. |
| Auto-commit produces no commit              | Check `git config user.email` inside the cloned repo. The Chrome status bar shows the last auto-commit error as a toast. |
| `ERR_MODULE_NOT_FOUND ... providerMeta.js` during `datalex serve` | Upgrade to `datalex-cli` 1.3.4 or newer. The older wheel is missing API server runtime files. |
