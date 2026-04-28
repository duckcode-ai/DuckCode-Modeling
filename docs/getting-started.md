# Getting started with DataLex

Pick the path that matches what you have in hand. Every path finishes
with a reviewable YAML tree on disk and a live ER diagram in the
browser. The normal path needs no Docker, no second terminal, and no
config files to hand-edit; Docker is available as an isolated fallback.

> **DataLex 1.4 highlights** — doc-block round-trip, custom policy
> packs, snapshots/exposures/unit-tests panels, contract enforcement,
> Atlan/DataHub/OpenMetadata catalog export, the
> `datalex readiness-gate` CI gate, and two AI agents that propose
> entities + canonical layers from your staging models. See
> [CHANGELOG.md](../CHANGELOG.md#140---2026-04-27) for the full list.

## 60-second install

```bash
pip install 'datalex-cli[serve]'     # CLI + bundled Node runtime
datalex serve                        # opens http://localhost:3030
```

That's it for most machines. The `[serve]` extra pulls a portable Node
runtime so you do not need to install Node separately. If you already
have Node 20+ on your PATH, plain `pip install datalex-cli` works too.

Want your own warehouse drivers? Add a connector extra:

```bash
pip install 'datalex-cli[serve,postgres]'        # or snowflake, bigquery, databricks, …
pip install 'datalex-cli[serve,all]'             # every driver + Node
```

Verify the installed package before opening a real repo:

```bash
datalex --version
```

If startup fails with
`ERR_MODULE_NOT_FOUND ... datalex_core/_server/ai/providerMeta.js`,
upgrade to `datalex-cli` 1.4.0 or newer.

---

## Docker fallback

Docker is optional. Use it when you want a fully isolated install path
or your local Python/Node versions are getting in the way.

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
docker build -t datalex:local .
docker run --rm -p 3030:3001 datalex:local
```

Open `http://localhost:3030`.

For an existing dbt repo:

```bash
cd ~/path/to/your-dbt-project
docker run --rm -p 3030:3001 \
  -v "$PWD":/workspace \
  -e REPO_ROOT=/workspace \
  -e DM_CLI=/app/datalex \
  datalex:local
```

In the UI, use `/workspace` as the dbt repository path.

---

## Pick your path

| You have...                                        | Start here                                                       | Time   |
|----------------------------------------------------|------------------------------------------------------------------|--------|
| Nothing — want to try with a canonical dbt repo    | [Scenario 1 — clone jaffle-shop](#scenario-1--clone-jaffle-shop) | 5 min  |
| An existing dbt project on disk                    | [Scenario 2 — your local dbt repo](#scenario-2--your-local-dbt-repo) | 5 min  |
| A dbt repo on GitHub you want to try               | [Scenario 3 — a git URL](#scenario-3--a-git-url)                 | 4 min  |
| A live warehouse, no dbt yet                       | [Scenario 4 — warehouse pull](#scenario-4--live-warehouse-pull)  | 7 min  |
| A dbt repo + GitHub Actions you want gated         | [Scenario 5 — wire up CI](#scenario-5--wire-up-ci)               | 5 min  |
| CLI only, no UI                                    | [CLI dbt-sync tutorial](tutorial-dbt-sync.md)                     | 5 min  |

---

## Scenario 1 — Clone jaffle-shop DataLex

The fastest way to see the full DataLex workflow is the dedicated
[`duckcode-ai/jaffle-shop-DataLex`](https://github.com/duckcode-ai/jaffle-shop-DataLex)
repo. It extends jaffle-shop with DuckDB seeds, dbt staging and marts,
semantic models, DataLex conceptual/logical/physical diagrams, generated
SQL, Interface metadata, project-local modeling skills, and **every 1.4
moat feature** wired up:

- Doc-block references in `stg_customers.yml` + `fct_orders.yml`
- A custom policy pack at `.datalex/policies/jaffle.policy.yaml`
- Snapshot, exposure, and unit-test fixtures
- Glossary bindings ready for `datalex emit catalog`
- A GitHub Actions workflow that runs `actions/datalex-gate`

```bash
pip install 'datalex-cli[serve,duckdb]'
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex ~/src/jaffle-shop-DataLex
cd ~/src/jaffle-shop-DataLex
make setup        # creates .venv, installs dbt + datalex-cli >= 1.4.0
make seed         # dbt seed
make build        # dbt build → jaffle_shop.duckdb
make serve        # datalex serve --project-dir .
```

Use Python 3.11 or 3.12 for this dbt example. Python 3.13+ currently
breaks in dbt's serializer stack; use the Docker fallback (`make
docker-up`) if you do not want to manage Python versions locally.

Open the project in the UI and start with these files / panels:

- `DataLex/commerce/Conceptual/commerce_concepts.diagram.yaml`
- `DataLex/commerce/Logical/commerce_logical.diagram.yaml`
- `DataLex/commerce/Physical/duckdb/commerce_physical.diagram.yaml`
- `models/marts/core/dim_customers.yml`
- `models/marts/core/fct_orders.yml`
- Bottom drawer → **Snapshots / Exposures / Unit Tests / Policy Packs**
  tabs (new in 1.4)

Every UI edit lands in the clone, so `git diff` shows normal dbt and
DataLex YAML changes.

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

**Then run a readiness review** — new in 1.4:

1. Top bar → **Run readiness review** (or right-click any folder →
   *Run dbt readiness review*).
2. Each YAML file gets a red / yellow / green badge in the Explorer.
3. Click any badge → the Validation drawer shows the findings,
   rationale, suggested fix, and an *Ask AI* handoff.

DataLex also rebuilds the local AI modeling index automatically using
your dbt YAML, SQL files, `target/manifest.json`, `target/catalog.json`,
semantic manifest, validation findings, doc blocks, and DataLex files.
This is what lets *Ask AI* answer repo-wide questions instead of only
reading the open diagram. Doc-block bound descriptions
(`description_ref: { doc: <name> }`) are expanded in the AI index so
prompts that match the doc-block prose retrieve the bound columns.

**Then build your first ER diagram:**

1. Create a diagram. Two paths:
   - **Explorer toolbar → New Diagram** (Layers icon). A new file
     appears at `datalex/diagrams/untitled.diagram.yaml`.
   - **Right-click any folder in the Explorer → New diagram here…**
     to land it next to the models it describes. Rename it to
     something meaningful like `customer_360.diagram.yaml`.
2. Populate the canvas. Two paths, same result:
   - **Canvas toolbar → Add Entities** (or pane right-click → Add
     entities to diagram…). A picker opens with search, domain
     filter, and multi-select over every entity resolved from the
     model graph.
   - **Drag a `schema.yml` or `.model.yaml` from the Explorer onto
     the canvas.** Each referenced model renders as an entity.
3. Foreign keys from dbt `tests: - relationships: {to: "ref('…')"}`
   become dashed edges automatically.
4. **Save All** writes positions into the `.diagram.yaml` file — so
   `git commit` captures your layout.

### Ask the AI to model for you

In the entity inspector empty state (no entity selected), two new 1.4
buttons surface deterministic agents:

- **Conceptualize from staging** clusters every staging-layer model
  into business entities + relationships and proposes a conceptual
  diagram. Domains are inferred from common nouns
  (`customer`→`crm`, `order`→`sales`, …).
- **Canonicalize from staging** detects columns that recur across
  staging models (same name, similar description) and lifts them into
  a logical canonical entity with shared `{% docs %}` blocks.

Both agents are deterministic — no API key required. They produce
proposals through the existing review-and-apply flow, so nothing is
written until you accept it.

### Editing rules

- **Every UI edit writes back to the original file.** Rename a column,
  add a test, drag to create a foreign key — they all patch the `.yml`
  at its original path.
- **Doc-block round-trip is preserved.** When a column's description
  resolves to `{{ doc("name") }}`, DataLex stores
  `description_ref: { doc: "name" }` next to the rendered text. On
  re-emit the YAML keeps the jinja reference, not the rendered string.
  AI proposals that try to overwrite a doc-block-bound description in
  YAML are rejected with `DOC_BLOCK_OVERWRITE` — propose a change to
  the `.md` file instead.
- **No duplicate folders.** DataLex doesn't create a shadow tree. Your
  `~/your-dbt-project/models/staging/stg_customers.yml` is the one
  true source; we just read and patch it.
- **Save All** flushes every dirty buffer to disk. Writes return a
  structured `{ code, message, details? }` envelope and a 207
  Multi-Status response when some files fail.
- **Rename / delete previews.** Renaming or deleting a folder or file
  from the Explorer shows an impact preview first.
- **Dangling relationships.** Open the Validation panel: any
  `relationships:` entry pointing at a missing entity or column gets
  a red banner with a one-click **Remove dangling** action.
- **Ask AI with reviewable YAML proposals.** Use **Ask AI** from the
  right panel, canvas, Explorer context menu, or selected text. The
  agent retrieves doc-blocks, BM25 lexical context, validation
  findings, and skills before proposing changes. Click **Review plan**
  to inspect the proposal in the center editor before you apply.
- **Team skills live in Git.** The Skills tab writes Markdown skill
  files under `DataLex/Skills/*.md`.

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

## Scenario 5 — Wire up CI

DataLex 1.4 ships a GitHub Action that runs the same readiness review
shown in the UI on every PR. It posts a sticky comment with the
red/yellow/green file counts, uploads SARIF to the Security tab, and
fails the build when the project score drops below your threshold.

Drop this into `.github/workflows/datalex-readiness.yml`:

```yaml
name: DataLex readiness
on:
  pull_request:
permissions:
  contents: read
  issues: write           # sticky PR comments
  pull-requests: write
  security-events: write  # SARIF upload
jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: duckcode-ai/DataLex/actions/datalex-gate@main
        with:
          project-path: .
          min-score: 80
          changed-only: true
          base-ref: origin/${{ github.base_ref }}
```

Run the same gate locally:

```bash
pip install 'datalex-cli'
datalex readiness-gate --project . --min-score 80 \
  --sarif datalex-readiness.sarif --pr-comment datalex-readiness.md
```

📖 **Full walkthrough:** [tutorials/ci-readiness-gate.md](tutorials/ci-readiness-gate.md)

---

## What stays in your project, what doesn't

DataLex writes these local runtime files into `--project-dir`:

| File / folder              | What it is                                         | Commit it? |
|----------------------------|----------------------------------------------------|------------|
| `.dm-projects.json`        | Projects list the UI sees                          | Optional — safe to commit or gitignore |
| `.dm-credentials.json`     | Warehouse credentials                              | **Never** — already in our gitignore template |
| `.datalex/agent/`          | Local AI index, chat history, memory, runtime cache | No — local runtime state |
| `.datalex/policies/*.yaml` | **Custom policy packs** (1.4)                      | **Yes** — checked into git so CI uses the same rules |
| `dm`                       | Auto-written CLI shim for subprocess calls         | Gitignored |

Your DataLex modeling artifacts live under `DataLex/` and are meant to
be reviewable YAML. Commit model/diagram YAML and `DataLex/Skills/*.md`
when they represent team standards. `git status` shows real diffs on
every UI edit.

---

## Troubleshooting install

| Symptom                                       | Fix                                                                           |
|-----------------------------------------------|-------------------------------------------------------------------------------|
| `datalex: command not found`                  | Your pip bin dir isn't on PATH — `python -m datalex_cli serve` works too.     |
| `ERROR: 'node' was not found on PATH`         | `pip install "datalex-cli[serve]"` or install Node 20+.                       |
| `Port 3030 already in use`                    | Prior server still running. `lsof -ti:3030 \| xargs kill`, or `--port 4040`.   |
| `ModuleNotFoundError: No module named 'datalex_cli'` in API logs | Upgrade: `pip install -U datalex-cli`.                                       |
| UI stuck on "model-examples" instead of my folder | Delete stale projects file: `rm .dm-projects.json && datalex serve --project-dir .` |
| Web bundle auto-build fails                   | `cd packages/web-app && npm install && npm run build` (only matters for source checkouts) |
| Blank page after refresh                      | Hard-refresh (⌘⇧R / Ctrl+F5) — old bundle cached in the browser.             |
| `DOC_BLOCK_OVERWRITE` when applying an AI proposal | Doc-block-bound descriptions live in `.md` files. Edit the `{% docs %}` block instead of the YAML description, or remove `description_ref` first if you really mean to break the binding. |
| `CONTRACT_PREFLIGHT` on dbt-sync forward      | A contract-enforced model has columns with `type: unknown`. Run `dbt compile` to populate types or set `data_type` explicitly. |

---

## Mental model in 30 seconds

```
  warehouse   <──pull──>   DataLex YAML tree   <──sync──>   dbt project
   (live)                    (git-tracked)                   (models/*.yml)
                                  │
                                  ├── readiness-gate ──▶  GitHub PR
                                  ├── emit catalog ──▶  Atlan / DataHub / OpenMetadata
                                  └── conceptualize / canonicalize ──▶  AI proposals
```

- **Pull** introspects a live database → writes a DataLex model tree.
- **Import dbt** reads your dbt `manifest.json` → populates the same
  tree with columns/types/tests; preserves `{% docs %}` references.
- **Sync** merges DataLex metadata back into dbt's `schema.yml` files
  non-destructively. Runs a contract pre-flight in 1.4.
- **Emit** writes dbt-parseable YAML from scratch (greenfield).
- **Readiness gate** scores the project red/yellow/green and fails CI
  on regressions.
- **Emit catalog** ships glossary + bindings to Atlan, DataHub, or
  OpenMetadata.
- **Conceptualize / Canonicalize** propose entities and a logical layer
  from staging models.

All are available from the CLI (`datalex --help`) and from the UI
toolbar.

---

## Where to go next

- 📘 **[docs/tutorials/](tutorials/)** — end-to-end walkthroughs:
  - [Jaffle-shop walkthrough](tutorials/jaffle-shop-walkthrough.md)
  - [Import an existing dbt repo](tutorials/import-existing-dbt.md)
  - [Live warehouse pull](tutorials/warehouse-pull.md)
  - [CI readiness gate](tutorials/ci-readiness-gate.md) (1.4)
  - [Custom policy packs](tutorials/policy-packs.md) (1.4)
- 📗 **[docs/cli.md](cli.md)** — every CLI subcommand and flag
- 🧠 **[docs/ai-agentic-modeling.md](ai-agentic-modeling.md)** —
  Ask AI, doc-block-aware retrieval, conceptualizer + canonicalizer
- 🌐 **[docs/mesh-interfaces.md](mesh-interfaces.md)** — shared model
  contracts + catalog export (1.4)
- 📙 **[docs/architecture.md](architecture.md)** — how DataLex is wired
- 📕 **[docs/api-contracts.md](api-contracts.md)** — HTTP API for integrators
- 📓 **[docs/datalex-layout.md](datalex-layout.md)** — on-disk YAML spec

Once you have a DataLex tree on disk, everything else is plain git:

```bash
git init && git add . && git commit -m "chore(model): baseline import"
```

From there, PRs review like any code change and these CLI commands
give you CI hooks:

- `datalex readiness-gate --project .` — red/yellow/green PR gate (1.4)
- `datalex policy-check models/.../stg_customers.model.yaml --policy ...` — org rules
- `datalex validate models/.../stg_customers.model.yaml` — schema check
- `datalex lint models/.../stg_customers.model.yaml` — semantic rules
- `datalex gate old.yml new.yml` — fail PRs on breaking changes
- `datalex emit catalog --target atlan|datahub|openmetadata --model ...` — catalog export (1.4)
