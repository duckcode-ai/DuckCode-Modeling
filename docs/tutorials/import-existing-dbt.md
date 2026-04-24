# Import an existing dbt project

This is the "bring your own dbt repo" path. You'll end with the same
DataLex tree you saw in the [jaffle-shop walkthrough](jaffle-shop-walkthrough.md),
but built from *your* models — with every `models/staging/`,
`models/marts/…` folder preserved exactly as it was on disk.

**Time:** 5 minutes. **Prerequisites:**

- Python 3.9+ with pip
- A dbt project you can read locally (either a folder path or a git URL)
- `dbt` itself installed if your project hasn't been compiled yet

---

## Decide where your import lives

The importer has two output modes:

| Mode         | Writes to                                       | When to use                                            |
|--------------|-------------------------------------------------|--------------------------------------------------------|
| **In-memory**    | The browser's Zustand store only             | Exploratory — poke at the tree, discard it, try again  |
| **On-disk**      | A real folder you pick                       | You want git diffs, PRs, CI — i.e., the real workflow  |

The GUI defaults to in-memory for safety. After you've reviewed the
tree, use **Save All** (top-bar button) to write it to a chosen folder.

## Option A — From a local folder

### 1. Start the server pointed at your project

```bash
datalex serve --project-dir ~/path/to/your-dbt-project
```

`--project-dir` sets the working directory for the api-server — this
is where `.dm-projects.json`, connection metadata, and the auto-generated
`dm` CLI shim live. It does **not** modify your dbt project files; it
only reads them.

### 2. Compile manifest.json (if you haven't)

The importer prefers `target/manifest.json` because it carries the
full dbt graph, column types, and `original_file_path` for each model
(which lets the Explorer preserve your folder structure).

```bash
cd ~/path/to/your-dbt-project
dbt compile    # or `dbt parse` for a lighter run
```

If `target/manifest.json` is missing, the importer falls back to
plain YAML parsing — you lose column types but folder layout still
works.

### 3. Run the import

1. Top bar → **Import dbt repo** (folder-arrow icon).
2. In the dialog, pick **Local folder**.
3. Click **Choose folder** and select your project root (the folder
   that contains `dbt_project.yml`). Safari/Firefox get a multi-file
   upload fallback; Chrome-based browsers get a native directory
   picker.
4. Click **Import**. The dialog shows a progress log while the
   api-server shells out to `dm dbt sync`. For big projects (200+
   models) expect a few seconds; the log streams each file.
5. The Explorer populates. Every YAML file lives at exactly the path
   it occupied in your dbt repo — `models/staging/customers/…`,
   `models/marts/finance/…`, etc.
6. The AI index rebuilds automatically. DataLex indexes dbt YAML, SQL,
   `target/manifest.json`, `target/catalog.json`, semantic manifest,
   validation findings, DataLex diagrams/models, glossary facts, and
   `DataLex/Skills/*.md` so repo-wide Ask AI prompts can retrieve the
   whole project context.

### 4. Walk the tree

Open any model. The right-panel inspector now has:

- **Column-level lint** — missing `description`, `data_type`, or
  missing tests on primary-key columns each render a warning pill
  (`packages/web-app/src/lib/dbtLint.js`).
- **Column data types** — pulled from `manifest.json`'s compiled
  schema. Columns that dbt couldn't resolve (e.g. new models that
  haven't been built) show `—`.
- **dbt metadata** — the raw dbt fields (`meta`, `tests`, `contract`)
  are preserved under `meta.datalex.dbt.*` in the DataLex YAML. You
  can round-trip this back to dbt with `datalex datalex dbt emit`.

### 5. Build your first diagram

The import gave you the raw file tree. To see the ER diagram — and to
compose several models onto one canvas — create a `.diagram.yaml`:

1. Create a diagram. Two paths:
   - **Explorer toolbar → New Diagram** (Layers icon). Lands in
     `datalex/diagrams/untitled.diagram.yaml`.
   - **Right-click any folder in the Explorer → New diagram here…**
     to seed the file alongside the models it describes (for example
     inside `models/marts/finance/`). Rename it to something
     meaningful like `customer_360.diagram.yaml`.
2. Populate the canvas. Two interchangeable paths:
   - **Canvas toolbar → Add Entities** (or pane right-click → Add
     entities to diagram…). The picker lists every entity resolved
     from the imported tree, with search, domain filter, and
     multi-select. Entities already on the diagram are disabled.
     Confirm → entities are appended and auto-lay-out via ELK (when
     `layoutMode: elk` is active).
   - **Drag `models/staging/schema.yml`** (or any individual
     `.model.yaml`) from the Explorer onto the canvas. Each dbt model
     in the dropped file appears as an entity; drops are deduped by
     `(file, entity)`, so dropping the same file twice is idempotent.
3. Foreign keys from `tests: - relationships:` render as dashed edges
   automatically — no manual wiring.
4. Drag entities to reposition. **Save All** persists positions into
   the diagram YAML (not into your model files), so the same model
   can live at different coordinates in different diagrams.

The diagram file looks like this on disk:

```yaml
kind: diagram
name: customer_360
title: Customer 360
entities:
  - file: models/staging/schema.yml
    entity: stg_customers
    x: 60
    y: 60
  - file: models/marts/dim_customers.yml
    entity: dim_customers
    x: 360
    y: 60
```

Entity definitions stay in their original `.yml` files — the diagram
only stores references and positions.

### Use Ask AI after import

Ask AI is designed for the common dbt reality: teams often have physical
models first and need help explaining, governing, or reverse-engineering
them.

Useful prompts after import:

```text
Reverse engineer this dbt repo into a business conceptual model.
Explain what fct_orders is missing before we publish it.
Find weak relationships and missing tests for customer/order models.
Propose focused YAML changes to improve descriptions and relationships.
```

Where to ask:

- Right-panel **AI** tab for the active selection or file.
- Canvas floating **Ask AI** button for diagram-level questions.
- Right-click an entity, relationship, Explorer file/folder, or
  validation issue and choose **Ask AI**.
- Select text in a YAML/editor panel and use the small Ask AI affordance.

How proposals work:

1. The agent retrieves exact structured dbt/DataLex facts, BM25 lexical
   matches, graph/lineage context, validation output, relevant skills, and
   local memory.
2. The chat shows the answer and any proposed YAML changes.
3. Click **Review plan** to open the center review editor with the full
   request, answer, sources, agents, skills, validation impact, and change
   JSON.
4. Click **Validate** before applying. Invalid YAML, path escapes, wrong
   layer operations, and duplicate relationships are blocked.
5. Click **Apply** only after review. DataLex writes through the same
   guarded create/save/delete APIs as manual UI edits, refreshes Explorer,
   rebuilds the graph, reruns validation, updates SQL previews, and
   rebuilds the AI index.

Skills are project-local Markdown files under `DataLex/Skills/*.md`.
Commit them when they represent team standards such as naming rules,
governance requirements, dbt testing policy, or domain conventions.

### 6. Make an edit; see the diff

Rename a column description in the inspector. The **Diff** panel
(bottom) shows the patch. This is exactly the diff that'll land in
your git commit if you save.

### 7. Save to disk

Two options:

- **Edit in-place (live folder):** if you started with
  `--project-dir ~/my-dbt-repo`, DataLex uses that folder as the
  workspace root. Use **Save All** to flush every dirty file back to
  the original paths. Writes are merge-safe — when multiple in-memory
  docs target the same shared `schema.yml`, the api-server routes
  through the core-engine `merge_models_preserving_docs` helper
  instead of overwriting siblings. If a subset of files fails, Save
  All returns a 207 Multi-Status response and the UI lists the exact
  paths that didn't land. Your `git status` will show real diffs.

- **Save to a fresh folder:** File menu → New Project → pick a
  different folder → save. Useful for a side-by-side migration
  without touching your real repo.

## Option B — From a git URL

### 1. Start the server

```bash
datalex serve
```

### 2. Trigger the git import

1. Top bar → **Import dbt repo**.
2. Switch to the **Git URL** tab.
3. Enter a public URL like `https://github.com/dbt-labs/jaffle-shop.git`
   or a private one.
4. Optional ref: branch, tag, or commit SHA (default: `main`).
5. Click **Import**. The api-server clones the repo into
   `$TMPDIR/datalex-dbt-<uuid>/`, runs `dm dbt sync` against it,
   streams progress to the dialog, and hands the resulting tree to
   the workspace store.

### 3. Save the imported tree

In-memory by default, just like Option A step 7. If you want a
permanent location, File menu → New Project → pick a folder →
**Save All**.

Private repos: the clone runs with whatever credentials are on the
api-server host. For a cloud-hosted `dm serve`, set up SSH or a
credential helper on that machine; we don't prompt for tokens in the
UI yet (tracked for a future PR).

## What stays in sync, what doesn't

The importer only reads from dbt. It doesn't push changes back
automatically. To emit DataLex → dbt:

```bash
# Re-emit schema.yml with DataLex column metadata merged non-destructively
datalex datalex dbt emit models/ --out-dir ~/your-dbt-repo/

# Or re-sync (reads manifest.json + introspects the warehouse, merges
# results back into DataLex YAML without clobbering hand edits)
datalex datalex dbt sync ~/your-dbt-repo --out-root models/
```

The `sync` form is non-destructive — anything you hand-authored
(custom tests, macros, meta fields) stays intact. Only DataLex-owned
fields (`description`, `data_type`, `tests` you added via the
inspector) are reconciled.

## Round-tripping: DataLex ↔ dbt

```
  dbt repo  ─── import ──▶  DataLex tree  ─── generate ──▶  dbt repo
   (models/…)               (models/…)                      (models/…)
     \__________________________________________________________/
                         same folder layout
```

The `models/staging/stg_*.model.yaml` files in the DataLex tree write
back to `models/staging/stg_*.yml` / `schema.yml` at the same
relative paths. There's no translation layer to get lost in.

## Troubleshooting

| Symptom                                         | Fix                                                                    |
|-------------------------------------------------|------------------------------------------------------------------------|
| "manifest.json not found"                       | Run `dbt compile` in your project first.                               |
| Explorer renders models as a flat list          | Your dbt version is old enough that `manifest.json` lacks `original_file_path`. Upgrade dbt or accept the flat layout. |
| Column `data_type` shows `—` everywhere         | dbt hasn't compiled the model's source columns. Run `dbt run` once.   |
| Git clone fails with auth error                 | The api-server host needs credentials. Configure SSH/PAT there, not in the UI. |
| "Import dbt repo" dialog hangs                  | Check the api-server logs (printed by `datalex serve`) — most often a Python dependency missing (`pip install dbt-core`). |
| Folders appear but files inside are empty       | The dbt schema YAML was unparseable. The importer returns a structured `PARSE_FAILED` error with file path + line/column; open the dev-tools console or run `dbt parse` to see which file. |
| Relationships panel flags "N dangling"          | Open the Validation tab — the red **Dangling relationships** banner lists every `relationships:` entry whose endpoints reference a missing entity or column. Click **Remove dangling** to prune only the offending entries from the active file. |
| Renaming/deleting a folder feels risky          | Both actions show an impact preview first (how many diagrams, `imports:` blocks, and relationships will be rewritten or removed) and require explicit confirmation — nothing cascades silently. |
| Ask AI only sees one diagram                     | Rebuild the AI index from Settings → AI or re-run the dbt import. Repo-wide prompts such as "reverse engineer this repo" intentionally expand beyond the active file once the index exists. |
| Old chat history lacks sources/proposals         | Chats created before AI result persistence only contain messages. New chats store sources, skills, memory, proposals, and Review plan context. |

## What to do next

- **Review diffs on every PR** — once you save to a folder, every
  DataLex edit lands as a YAML diff. No opaque tool state.
- **Add a CI gate** — `datalex gate old.yaml new.yaml` fails PRs on
  breaking schema changes. Wire it into your `.github/workflows/`.
- **Connect a warehouse too** — see
  [Pull a warehouse schema](warehouse-pull.md) for live column-type
  confirmation.
- **Full CLI reference** — `docs/cli.md`.
