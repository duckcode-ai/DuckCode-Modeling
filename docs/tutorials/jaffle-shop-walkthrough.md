# Jaffle-shop: the three-minute demo

The fastest way to see every DataLex feature without connecting a
warehouse or cloning a dbt repo. The jaffle-shop fixture is a trimmed
version of `dbt-labs/jaffle-shop` checked into the wheel, so this
entire flow works offline.

You'll end with:

- A browser tab showing the full jaffle-shop model (staging + marts)
  as both a file tree and an ER diagram
- Inline lint warnings for every column missing `description`,
  `data_type`, or primary-key tests
- A feel for drag-to-relate, position persistence, and the
  diff/history panels — the same UX you'll use for your real project

**Time:** 3 minutes. **Prerequisites:** Python 3.9+ with pip.

---

## Step 1 — Install and start the server

```bash
pip install 'datalex-cli[serve]'     # CLI + bundled Node, one command
datalex serve                        # opens http://localhost:3030
```

The first `datalex serve` call prints something like:

```
[datalex] Starting DataLex server on http://localhost:3030
[datalex]   server:   /…/datalex_core/_server/index.js
[datalex]   web dist: /…/datalex_core/_webapp
[datalex]   project:  /Users/you/current-dir
```

A browser tab opens on `http://localhost:3030`. If it doesn't, open
that URL manually or re-run with `--no-browser` and copy the link.

## Step 2 — Load the jaffle-shop demo

1. In the top bar, click **Import dbt repo** (the folder icon with
   "Dep" label, next to **Open project**).
2. The **Import dbt repository** dialog opens. At the top there's a
   **Load jaffle-shop demo** button — click it.
3. The dialog closes and the Explorer (left panel) populates with the
   full tree:
   ```
   models/
     staging/
       stg_customers.yml
       stg_orders.yml
       stg_order_items.yml
       stg_products.yml
       stg_stores.yml
       stg_supplies.yml
     marts/
       customers.yml
       orders.yml
       order_items.yml
       products.yml
     sources/
       jaffle_shop_raw.yml
   ```

The fixture is bundled as YAML files inside the wheel — no network
call, no git clone. If you ever re-run `dm dbt sync` against the real
`dbt-labs/jaffle-shop` repo you'll get the same tree (modulo the
`meta.datalex.dbt.*` timestamps).

## Step 3 — Build your first diagram (v0.3+)

The Explorer tree is your source of truth; diagrams are how you pick
which models to visualize together.

1. In the Explorer toolbar, click **New Diagram** (the Layers icon).
   A new file `datalex/diagrams/untitled.diagram.yaml` is created and
   opens on the canvas (empty).
2. Drag `models/staging/stg_customers.yml` from the Explorer onto the
   canvas. The customer entity appears.
3. Drag `models/staging/stg_orders.yml` onto the canvas too. A dashed
   FK edge between `stg_orders.customer_id` and `stg_customers.customer_id`
   renders automatically — inferred from the dbt `tests: - relationships:`
   on that column.
4. Reposition nodes by dragging. The positions land in the diagram
   YAML's `entities[].x/y` — not in the model files — so you can have
   a second diagram with different coordinates for the same models.

## Step 4 — Open a model in the inspector

Click `models/staging/stg_customers.yml` in the Explorer.

- **Centre canvas** renders the entity as an ER node with columns
  listed inline. Other entities it references (via FKs) are positioned
  around it.
- **Right panel** shows the Inspector: tabs for Columns, Relationships,
  Indexes, Enums, Tests.
- **Columns tab** lists each column. Any column missing a
  `description` or `data_type` shows a warning pill — that's the PR A
  lint rule (`packages/web-app/src/lib/dbtLint.js`) running client-side
  with no save-cost.

Try renaming a column description: click the description cell, type
something, hit Enter. The YAML updates in-memory; the **Diff** panel
at the bottom shows the pending change as a red/green patch.

## Step 5 — Drag to create a relationship

On the canvas, each column has two tiny handles (left = target,
right = source).

1. Drag from `stg_orders.customer_id` (right handle) to
   `stg_customers.customer_id` (left handle).
2. A **New relationship** dialog opens, pre-filled with
   `from: stg_orders.customer_id`, `to: stg_customers.customer_id`,
   cardinality `many_to_one`. Give it a name like
   `fk_orders_customers`, optionally mark it `identifying` or
   `optional`, and hit **Create**.
3. A new FK edge renders. The Diff panel shows a new
   `relationships:` block landed under `stg_orders`.

## Step 6 — Move a node; confirm it sticks

Drag `stg_customers` 300 px to the right. Reload the tab
(`⌘R` / `Ctrl+R`). The node stays where you put it because the canvas
wrote the new `x/y` into your active `.diagram.yaml`'s `entities[]`
list on `onNodeDragStop`. (When no diagram is active, positions fall
back to a `display:` block on the entity YAML itself.)

## Step 7 — Try undo / redo

Every mutating action (column edit, relationship add, position change)
pushes to a per-file history stack capped at 50 entries.

- `⌘Z` reverts the last change
- `⌘⇧Z` re-applies

The Chrome header's Undo and Redo buttons drive the same store —
they're live now, no longer decorative.

## Step 8 — Validate + aggregate lint

Click the **Validation** tab in the bottom panel. It aggregates every
lint warning and error across the whole tree, grouped by file. For
jaffle-shop you'll see a handful of "column missing description"
warnings — useful guide for a real import.

## Step 9 — Save the project to a real folder (optional)

The jaffle-shop demo lives in-memory. If you want to write it to disk
for real git tracking:

1. Click the **Save All** button in the top bar (the "All" download
   icon — only enabled when you have a real project open).
2. Or use the File menu → New Project, pick a folder, then re-trigger
   the import; the tree writes to your chosen directory.

Once on disk:

```bash
cd ~/my-jaffle-clone
git init && git add . && git commit -m "chore: jaffle-shop baseline"
```

## What to do next

- **Try the live warehouse flow →** [Pull a warehouse schema](warehouse-pull.md)
- **Use your own dbt repo →** [Import an existing dbt project](import-existing-dbt.md)
- **Hook it into CI →** `datalex gate old.yaml new.yaml` fails PRs on
  breaking schema changes; see `docs/cli.md`.

## Troubleshooting

| Symptom                                     | Fix                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| "Load jaffle-shop demo" button does nothing | Open devtools console. If you see a `glob()` error, the fixture wasn't bundled — reinstall with a recent wheel. |
| Explorer looks flat, no folders             | You hit the single-file fallback — check the browser console for a `buildFileTree` error. |
| Node positions reset on reload              | The YAML didn't save. Check for a red Save indicator in the header; save explicitly. |
| Diff panel keeps showing changes after save | Stale editor state — hit `⌘R`. The in-flight Zustand store and the on-disk bytes should match. |
