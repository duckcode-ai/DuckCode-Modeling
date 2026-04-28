# Import an existing dbt project

This is the "bring your own dbt repo" path. You'll end with a DataLex
tree built from *your* models — every `models/staging/`,
`models/marts/…` folder preserved exactly as it was on disk — plus
red/yellow/green readiness scoring, a custom policy pack, and (if
you're on dbt 1.8+) snapshots/exposures/unit-tests rendered in
dedicated drawer panels.

**Time:** 8 minutes. **Prerequisites:**

- Python 3.9+ with pip (3.11 or 3.12 recommended for dbt)
- A dbt project you can read locally (either a folder path or a git URL)
- `dbt` itself installed if your project hasn't been compiled yet
- Node 20+ only if you install `datalex-cli` without the `[serve]` extra

---

## Decide where your import lives

The importer has two output modes:

| Mode             | Writes to                               | When to use                                            |
|------------------|-----------------------------------------|--------------------------------------------------------|
| **In-memory**    | The browser's Zustand store only        | Exploratory — poke at the tree, discard it, try again  |
| **Edit in place**| Your real dbt folder                    | The real workflow — every save round-trips to disk     |

Pick **Edit in place** for the real workflow.

## Option A — From a local folder

### 1. Install and verify

```bash
pip install -U 'datalex-cli[serve]'
datalex --version             # 1.4.0+
```

If `datalex serve` fails with
`ERR_MODULE_NOT_FOUND ... datalex_core/_server/ai/providerMeta.js`,
upgrade to `datalex-cli` 1.4.0 or newer.

### 2. Compile manifest.json (if you haven't)

The importer prefers `target/manifest.json` because it carries the
full dbt graph, column types, `original_file_path` for each model
(preserves your folder structure), AND **doc-block bodies** for the
1.4 round-trip:

```bash
cd ~/path/to/your-dbt-project
dbt compile    # or `dbt parse` for a lighter run
```

If `target/manifest.json` is missing, the importer falls back to
plain YAML parsing — you lose column types but folder layout still
works. Doc-block round-trip needs `dbt compile` so dbt has resolved
the `{{ doc("…") }}` references against the right `.md` files.

### 3. Start the server pointed at your project

```bash
datalex serve --project-dir ~/path/to/your-dbt-project
```

`--project-dir` sets the working directory for the api-server. It
does **not** modify your dbt project files; it only reads them.

### 4. Run the import

1. Top bar → **Import dbt repo** (folder-arrow icon).
2. Pick **Local folder**.
3. **Choose folder** → your project root (folder containing
   `dbt_project.yml`).
4. Leave **☑ Edit in place** checked.
5. Click **Import**.

The api-server shells out to `dm dbt sync` in the background. For
projects with 200+ models, expect a few seconds; the dialog streams
each file. When it finishes, the Explorer shows every YAML file at
its real dbt path.

DataLex also rebuilds the local AI modeling index using your dbt YAML,
SQL, `target/manifest.json`, `target/catalog.json`, semantic manifest,
validation findings, **doc blocks**, and any DataLex artifacts. This
is what lets repo-wide *Ask AI* prompts work after import.

### 5. Run a readiness review

New in 1.4: the readiness review scores every YAML file red / yellow /
green and surfaces fixable findings.

1. Top bar → **Run readiness review** (or right-click any folder →
   *Run dbt readiness review*).
2. Each file gets a colored badge in the Explorer.
3. Click any badge → the **Validation** drawer shows the findings,
   rationale, suggested fix, and an *Ask AI* handoff.

Run the same gate from the CLI:

```bash
datalex readiness-gate --project ~/path/to/your-dbt-project \
  --min-score 80 \
  --sarif datalex-readiness.sarif \
  --pr-comment datalex-readiness.md
```

→ Wire it into CI: [Tutorial: CI readiness gate](ci-readiness-gate.md).

### 6. Walk the tree

Open any model. The right-panel Inspector now shows:

- **Column-level lint** — missing `description`, `data_type`, or
  missing tests on PK columns each render a warning pill.
- **Column data types** — pulled from `manifest.json`'s compiled
  schema. Columns dbt couldn't resolve show `—`.
- **dbt metadata** — raw dbt fields (`meta`, `tests`, `contract`)
  preserved under `meta.datalex.dbt.*`.
- **Contract toggle** (1.4) — turn on `contract.enforced: true` per
  model. The card shows a live blocker list of columns that still
  need a `data_type`.
- **Doc-block bindings** (1.4) — columns whose description came from
  a `{% docs %}` block show a small `📝 doc("name")` indicator.

### 7. Try the new drawer panels (1.4)

If your project has them, the bottom drawer surfaces dedicated tabs:

- **Snapshots** — SCD strategy + unique_key + check_cols
- **Exposures** — owner.email + maturity + dependencies
- **Unit Tests** — given/expect rows + model under test
- **Policy Packs** — list / edit `<project>/.datalex/policies/*.yaml`

If your project doesn't have these resources yet, the panels show an
empty state with a one-line nudge.

### 8. Build your first diagram

The import gave you the raw file tree. To see the ER diagram — and to
compose several models onto one canvas — create a `.diagram.yaml`:

1. Create a diagram. Two paths:
   - **Explorer toolbar → New Diagram** (Layers icon). Lands in
     `datalex/diagrams/untitled.diagram.yaml`.
   - **Right-click any folder in the Explorer → New diagram here…**
     to seed the file alongside the models it describes.
2. Populate the canvas. Two interchangeable paths:
   - **Canvas toolbar → Add Entities** with search, domain filter,
     multi-select.
   - **Drag** `models/staging/schema.yml` (or any `.model.yaml`)
     from the Explorer onto the canvas.
3. Foreign keys from `tests: - relationships:` render as dashed edges
   automatically.
4. Drag entities to reposition. **Save All** persists positions into
   the diagram YAML.

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

### 9. Ask AI to model for you

Two new 1.4 buttons in the entity inspector empty state:

- **Conceptualize from staging** — clusters every staging-layer model
  into business entities + relationships. Domains are inferred from
  common nouns (customer→crm, order→sales, payment→finance, …). Output
  is a `kind: diagram` proposal applied through the Review plan flow.
- **Canonicalize from staging** — detects columns that recur across
  staging models (same name, similar description) and lifts them into
  a logical canonical entity with **shared `{% docs %}` blocks**
  emitted alongside the YAML. The doc-blocks land at
  `DataLex/docs/_canonical.md` so the round-trip preserves them.

Both agents are deterministic. They produce proposals through the
existing **Review plan → Validate → Apply** flow, so nothing is
written until you accept it.

For free-form Ask AI:

```text
Reverse engineer this dbt repo into a business conceptual model.
Explain what fct_orders is missing before we publish it.
Find weak relationships and missing tests for customer/order models.
Propose focused YAML changes to improve descriptions and relationships.
```

→ More: [Agentic AI modeling](../ai-agentic-modeling.md).

### 10. Author a custom policy pack

Custom rules live under `<project>/.datalex/policies/*.yaml` and
inherit the bundled `datalex/standards/base.yaml`. Open the **Policy
Packs** drawer tab and click **New pack**:

```yaml
pack:
  name: my-org-standards
  version: 0.1.0
  extends: datalex/standards/base.yaml

policies:
  - id: stg_naming
    type: regex_per_layer
    severity: warn
    params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"

  - id: marts_meta
    type: required_meta_keys
    severity: warn
    params:
      keys: [owner, grain]
      selectors:
        layer: fct
```

→ Full reference: [Custom policy packs](policy-packs.md).

### 11. Make an edit; see the diff

Rename a column description in the inspector. The **Diff** panel
(bottom) shows the patch. This is exactly the diff that'll land in
your git commit if you save.

> **Doc-block guardrail.** If you try to overwrite a description that
> resolves through `description_ref: { doc: <name> }`, DataLex blocks
> the save with a `DOC_BLOCK_OVERWRITE` toast and points you at the
> `.md` file. This keeps the round-trip lossless.

### 12. Save to disk

Two options:

- **Edit in-place (live folder):** if you started with
  `--project-dir ~/my-dbt-repo`, DataLex uses that folder as the
  workspace root. Use **Save All** to flush every dirty file back to
  the original paths. Writes are merge-safe — when multiple in-memory
  docs target the same shared `schema.yml`, the api-server routes
  through the core-engine `merge_models_preserving_docs` helper. If a
  subset of files fails, Save All returns a 207 Multi-Status response.

- **Save to a fresh folder:** File menu → New Project → pick a
  different folder → save. Useful for a side-by-side migration.

## Option B — From a git URL

### 1. Start the server

```bash
datalex serve
```

### 2. Trigger the git import

1. Top bar → **Import dbt repo**.
2. **Git URL** tab.
3. Paste a public URL like `https://github.com/duckcode-ai/jaffle-shop-DataLex.git`
   or a private one.
4. Optional ref: branch, tag, or commit SHA (default: `main`).
5. **Import**. The api-server clones into
   `$TMPDIR/datalex-dbt-<uuid>/`, runs the importer, and hands the
   tree to the workspace store.

### 3. Save the imported tree

In-memory by default, just like Option A. For a permanent location,
File menu → New Project → pick a folder → **Save All**.

Private repos: the clone runs with whatever credentials are on the
api-server host. For a cloud-hosted `datalex serve`, set up SSH or a
credential helper on that machine; we don't prompt for tokens in the
UI yet.

## What stays in sync, what doesn't

The importer only reads from dbt. It doesn't push changes back
automatically. To emit DataLex → dbt:

```bash
# Re-emit schema.yml with DataLex column metadata merged non-destructively
datalex dbt emit models/ --out-dir ~/your-dbt-repo/

# Or re-sync (reads manifest.json + introspects the warehouse, merges
# results back into DataLex YAML without clobbering hand edits)
datalex dbt sync ~/your-dbt-repo --out-root models/
```

The `sync` form is non-destructive — anything you hand-author (custom
tests, macros, meta fields, **doc-block references**) stays intact.
Only DataLex-owned fields are reconciled.

## Round-tripping: DataLex ↔ dbt

```
  dbt repo  ─── import ──▶  DataLex tree  ─── emit ──▶  dbt repo
   (models/…)               (models/…)                  (models/…)
     \________________________________________________________/
                       same folder layout
                       same `{{ doc(...) }}` references
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
| Doc-block descriptions render as `{{ doc("...") }}` literally | The doc-block index hasn't built yet. Run `datalex dbt docs reindex --project-dir <path>` or open the **Snapshots** drawer to trigger an index rebuild. |
| `DOC_BLOCK_OVERWRITE` blocking a save           | A bound description can only be edited via the `.md` file. Open `models/docs/_canonical.md` (or wherever your `{% docs %}` blocks live) and edit there. |
| Contract toggle stays red after typing data_types | Save the file — the blocker list refreshes from on-disk YAML, not the in-memory buffer. |
| Git clone fails with auth error                 | The api-server host needs credentials. Configure SSH/PAT there.        |
| "Import dbt repo" dialog hangs                  | Check the api-server logs (printed by `datalex serve`) — most often a Python dependency missing (`pip install dbt-core`). |
| Folders appear but files inside are empty       | The dbt schema YAML was unparseable. The importer returns a structured `PARSE_FAILED` error with file path + line/column. |
| Relationships panel flags "N dangling"          | Open the Validation tab — the red **Dangling relationships** banner lists every `relationships:` entry whose endpoints reference a missing entity or column. Click **Remove dangling** to prune them. |
| Renaming/deleting a folder feels risky          | Both actions show an impact preview first. Nothing cascades silently. |
| Ask AI only sees one diagram                     | Rebuild the AI index from Settings → AI or re-run the dbt import. |

## What to do next

- **Wire CI →** [Tutorial: CI readiness gate](ci-readiness-gate.md)
- **Author rules →** [Custom policy packs](policy-packs.md)
- **Connect a warehouse →** [Pull a warehouse schema](warehouse-pull.md)
- **Catalog export →** [Mesh interfaces + catalog export](../mesh-interfaces.md)
- **Full CLI reference →** [docs/cli.md](../cli.md)
