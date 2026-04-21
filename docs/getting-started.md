# Getting started with DataLex

Pick the path that matches what you have in hand. Every path finishes
with a reviewable YAML tree on disk and a live ER diagram in the
browser. No Docker, no second terminal, no config files to hand-edit.

## 60-second install

```bash
pip install 'datalex-cli[serve]'     # CLI + bundled Node runtime
datalex serve                        # opens http://localhost:3030
```

That's it. `[serve]` pulls a portable Node so you don't need to install
Node separately. If you already have Node 20+ on your PATH, plain
`pip install datalex-cli` works too.

Want your own warehouse drivers? Add a connector extra:

```bash
pip install 'datalex-cli[serve,postgres]'        # or snowflake, bigquery, databricks, …
pip install 'datalex-cli[serve,all]'             # every driver + Node
```

---

## Pick your path

| You have...                                   | Start here                                                     | Time  |
|-----------------------------------------------|----------------------------------------------------------------|-------|
| Nothing — just want the demo                  | [Scenario 1 — jaffle-shop demo](#scenario-1--jaffle-shop-demo) | 3 min |
| An existing dbt project on disk               | [Scenario 2 — your local dbt repo](#scenario-2--your-local-dbt-repo) | 5 min |
| A dbt repo on GitHub you want to try          | [Scenario 3 — a git URL](#scenario-3--a-git-url)               | 4 min |
| A live warehouse, no dbt yet                  | [Scenario 4 — warehouse pull](#scenario-4--live-warehouse-pull) | 7 min |
| CLI only, no UI                               | [CLI dbt-sync tutorial](tutorial-dbt-sync.md)                   | 5 min |

---

## Scenario 1 — Jaffle-shop demo

The fastest way to see if DataLex fits how you think. No dbt repo
needed, no warehouse, fully offline.

```bash
pip install 'datalex-cli[serve]'
datalex serve
```

Browser opens. Click **Import dbt repo → Load jaffle-shop demo**. The
Explorer fills with `models/staging/`, `models/marts/`, the canvas
shows an ER diagram with relationships, and the inspector renders
every column.

Nothing is written to disk. Close the tab and everything is gone.
When you want the real workflow, go to Scenario 2.

📖 **Full walkthrough:** [tutorials/jaffle-shop-walkthrough.md](tutorials/jaffle-shop-walkthrough.md)

---

## Scenario 2 — Your local dbt repo

This is the main event. You point DataLex at your existing dbt folder;
every UI edit round-trips back to the original `.yml` files on disk,
so your git history sees real diffs.

```bash
cd ~/path/to/your-dbt-project     # folder containing dbt_project.yml
datalex serve --project-dir .
```

**What you'll see in the startup log:**

```
[datalex]   registered project: your-dbt-project → /Users/…/your-dbt-project
[datalex] Starting DataLex server on http://localhost:3030
```

The browser opens with your folder already registered as the active
project — no "Import" click needed to see the tree.

**Next, import your dbt models once:**

1. Top bar → **Import dbt repo**
2. Pick the **Local folder** tab
3. Select your project root
4. Leave **☑ Edit in place** checked (default ON)
5. Click **Import**

The importer shells out to `dm dbt import` in the background. For
projects with 200+ models, expect a few seconds. When it's done, the
Explorer shows every model file at its real dbt path.

**Then build your first ER diagram (v0.3+):**

1. In the Explorer, click the **New Diagram** icon (Layers icon next
   to "New file" / "New folder"). A new file appears at
   `datalex/diagrams/untitled.diagram.yaml` — rename it to something
   meaningful like `customer_360.diagram.yaml`.
2. Drag any `schema.yml` or `.model.yaml` from the Explorer onto the
   canvas. Each referenced model renders as an entity. Foreign keys
   from dbt `tests: - relationships: {to: "ref('…')"}` become dashed
   edges automatically.
3. Drag nodes to reposition. **Save All** writes positions into the
   `.diagram.yaml` file — so `git commit` captures your layout, and
   moving a node in one diagram never leaks into another diagram of
   the same model.

Diagram files are safe to commit alongside your dbt models. They live
under `datalex/diagrams/` by convention; add it to `.gitignore` if you
prefer to keep them local.

### Editing rules

- **Every UI edit writes back to the original file.** Rename a column,
  add a test, drag to create a foreign key — they all patch the `.yml`
  at its original path (`meta.datalex.dbt.source_path`).
- **No duplicate folders.** DataLex doesn't create a shadow tree. Your
  `~/your-dbt-project/models/staging/stg_customers.yml` is the one
  true source; we just read and patch it.
- **Shape A works today** (one `.yml` per model). **Shape B** (shared
  `schema.yml` covering many models) triggers a warning toast — the
  merge-safe writer is tracked for a follow-up PR.
- **Save All** flushes every dirty buffer to disk. Commit with plain
  `git`.

📖 **Full walkthrough:** [tutorials/import-existing-dbt.md](tutorials/import-existing-dbt.md)

---

## Scenario 3 — A git URL

"Try this dbt repo before I clone it." Works for any public URL; use
Scenario 2 for local round-trip.

```bash
datalex serve
```

In the UI: **Import dbt repo → Git URL tab** → paste
`https://github.com/<org>/<repo>` (optional ref: branch/tag/SHA) →
**Import**.

The api-server clones to `$TMPDIR/datalex-dbt-<uuid>/`, runs the
importer, and hands the tree to the workspace store. You can poke at
the model, but saves land in the tmpdir and get cleaned up on next
boot. For real round-trip, clone locally and go back to Scenario 2.

---

## Scenario 4 — Live warehouse pull

Your warehouse exists, dbt doesn't (yet). DataLex introspects the
database, lets you pick tables, writes a DataLex tree.

```bash
cd ~/path/to/new-or-existing-project
datalex serve --project-dir .
```

Then in the UI:

1. Left panel → **Connectors** → **New connection**
2. Pick your dialect: postgres, mysql, snowflake, bigquery, databricks,
   sqlserver, azure_sql, azure_fabric, redshift
3. Fill credentials → **Test**. You should see a pill like
   `pingMs: 12 · PostgreSQL 16.2`
4. **Pull** → the warehouse table picker opens
5. Tick the schemas/tables you want; toggle "Row counts" for a
   `SELECT COUNT(*)` per table; preview inferred PKs + FKs
6. **Commit** → SSE log streams `[pull] customers: 100 rows`, etc.

**Output layout adapts to the project.** If the folder contains
`dbt_project.yml`, pulls land at `sources/<db>__<schema>.yaml` +
`models/staging/stg_<schema>__<table>.yml`. Otherwise flat.

📖 **Full walkthrough:** [tutorials/warehouse-pull.md](tutorials/warehouse-pull.md)

---

## What stays in your project, what doesn't

Two files DataLex writes into `--project-dir`:

| File                    | What it is                                         | Commit it? |
|-------------------------|----------------------------------------------------|------------|
| `.dm-projects.json`     | Projects list the UI sees                          | Optional — safe to commit or gitignore |
| `.dm-credentials.json`  | Warehouse credentials                              | **Never** — already in our gitignore template |
| `dm`                    | Auto-written CLI shim for subprocess calls         | Gitignored |

Everything else is your YAML. `git status` shows real diffs on every
UI edit.

---

## Troubleshooting install

| Symptom                                       | Fix                                                                           |
|-----------------------------------------------|-------------------------------------------------------------------------------|
| `datalex: command not found`                  | Your pip bin dir isn't on PATH — `python -m datalex_cli serve` works too.     |
| `ERROR: 'node' was not found on PATH`         | `pip install "datalex-cli[serve]"` or install Node 20+.                       |
| `Port 3030 already in use`                    | Prior server still running. `lsof -ti:3030 \| xargs kill`, or `--port 4040`.   |
| `ModuleNotFoundError: No module named 'datalex_cli'` in API logs | Fixed in 0.2+ via `DM_PYTHON`. Upgrade: `pip install -U datalex-cli`.        |
| UI stuck on "model-examples" instead of my folder | Delete stale projects file: `rm .dm-projects.json && datalex serve --project-dir .` |
| Web bundle auto-build fails                   | `cd packages/web-app && npm install && npm run build` (only matters for source checkouts) |
| Blank page after refresh                      | Hard-refresh (⌘⇧R / Ctrl+F5) — old bundle cached in the browser.             |

---

## Mental model in 30 seconds

```
  warehouse   <──pull──>   DataLex YAML tree   <──sync──>   dbt project
   (live)                    (git-tracked)                   (models/*.yml)
```

- **Pull** introspects a live database → writes a DataLex model tree.
- **Import dbt** reads your dbt `manifest.json` → populates the same
  tree with columns/types/tests.
- **Sync** merges DataLex metadata back into dbt's `schema.yml` files
  non-destructively.
- **Emit** writes dbt-parseable YAML from scratch (greenfield).

All four are available from the CLI (`datalex --help`) and from the UI
toolbar.

---

## Where to go next

- 📘 **[docs/tutorials/](tutorials/)** — the four end-to-end walkthroughs
- 📗 **[docs/cli.md](cli.md)** — every CLI subcommand and flag
- 📙 **[docs/architecture.md](architecture.md)** — how DataLex is wired
- 📕 **[docs/api-contracts.md](api-contracts.md)** — HTTP API for integrators
- 📓 **[docs/datalex-layout.md](datalex-layout.md)** — on-disk YAML spec

Once you have a DataLex tree on disk, everything else is plain git:

```bash
git init && git add . && git commit -m "chore(model): baseline import"
```

From there, PRs review like any code change and these CLI commands
give you CI hooks:

- `datalex validate models/.../stg_customers.model.yaml` — schema check
- `datalex lint models/.../stg_customers.model.yaml` — semantic rules
- `datalex gate old.yml new.yml` — fail PRs on breaking changes
- `datalex generate dbt models/ --out dbt-project/` — emit back to dbt
- `datalex policy-check models/ --policy policies/default.yaml` — org rules
