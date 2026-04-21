# Changelog

All notable changes to DataLex are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `v0.1.0` onward.

## [Unreleased]

## [1.0.0] — 2026-04-21

First stable release. The modeling loop — import a dbt repo, lay out
YAMLs, build diagrams, wire relationships, save back to git — is now
correctness-hardened end-to-end, backed by an integration test harness,
and guided by a first-run onboarding tour. This is the baseline we'll
support going forward under semver.

### Added

- **First-run onboarding tour.** Nine-step spotlight walkthrough
  (driver.js) covering import, explorer, diagram creation, entity
  picker, relationships, validation, and save. Skip/continue welcome
  modal on first visit; replay + reset from Settings → Help & Tour.
- **Help & Tour** Settings tab with links to the tutorial docs.
- **Entity picker dialog** with search, domain filter, multi-select, and
  auto-layout on add (Phase 4).
- **Dangling relationship banner** in Validation with one-click prune.
- **Folder-aware Explorer**: new folder / new diagram here from the
  context menu, rename & delete with impact preview (Phase 3).
- **Structured error envelope** `{ error: { code, message, details? } }`
  surfaced to UI toasts (Phase 1).
- **API integration test harness** under `packages/api-server/test/`
  wired to CI — 41 tests covering CRUD, save-all partial failure, and
  path-traversal adversarials.

### Changed

- **Merge-safe Save All** routes shared `schema.yml` writes through the
  core-engine merge helper so sibling models are never clobbered.
  Partial failures return **207 Multi-Status** with a per-file error
  list instead of a generic toast (Phase 2).
- **Relationship creation** validates endpoints against the resolved
  model graph before writing — no more silent writes to non-existent
  columns (Phase 4).
- **Wildcard-diagram moves** dedupe in place instead of appending a new
  row on every drag (Phase 4 + v0.5.1 follow-up).
- **AboutPane** license label corrected to MIT to match `LICENSE`.

### Fixed

- **dbt import** no longer leaks tmp dirs and no longer swallows
  per-file write failures silently (Phase 2).
- **Cascade cleanup on file delete** rewrites FK references in sibling
  files instead of leaving dangling edges (Phase 2).
- Folder rename now propagates into `imports:` blocks and
  `.diagram.yaml` `file:` refs (Phase 3).

### Versioning

- Root `pyproject.toml`, `packages/web-app`, and `packages/api-server`
  all bumped from `0.5.1` → `1.0.0`.

## [0.5.1] — 2026-04-21

Patch release — the modeling loop had a grab-bag of silent data-loss
and stale-view bugs that all showed up once users started actually
building diagrams on top of v0.5.0. This release fixes them as a set.

### Fixed

- **Entity moves persist on wildcard diagrams.** Dropping a model file
  onto a `.diagram.yaml` writes a `{file, entity: "*"}` wildcard
  reference that expands to every entity in the file. Before this
  release, dragging an individual entity on the canvas called
  `setDiagramEntityDisplay` with a concrete entity name — which failed
  to match the wildcard row in the YAML and silently returned `null`,
  meaning `updateContent` never fired, the file never went dirty, and
  the new position was lost on reload. This was the root cause of the
  "I arrange them and they keep snapping back" complaint. Fix: the
  patcher now appends a concrete `{file, entity: <name>, x, y}`
  override next to the wildcard when no explicit row exists. The
  adapter's last-wins dedupe picks up the override on the next render
  without touching the wildcard, so the remaining entities stay on
  their adapter-default positions.
  - `packages/web-app/src/design/yamlPatch.js` — `setDiagramEntityDisplay`
    now falls back to the wildcard row (also handles entries with an
    empty or omitted `entity:` field for backward compat).
  - `packages/web-app/tests/yamlPatchDiagram.test.js` — regression
    suite covering explicit match, wildcard fallback, repeated moves,
    and the null-fallback path.
- **Diagram relationships no longer vanish between actions.** Building
  a relationship on a `.diagram.yaml` (drag-to-relate or "Add
  Relationship" dialog) updates `activeFileContent` in memory, but the
  per-tab `openTabs` content cache was never kept in sync. `switchTab`
  unconditionally delegated to `openFile`, which refetched the file
  from disk and overwrote the in-memory YAML — taking the new
  relationship with it. Browser reload hit the same path. Fix:
  - `updateContent` now mirrors the new content into the active file's
    `openTabs` entry (and records the disk baseline as
    `originalContent` the first time, so dirty state survives a tab
    round-trip).
  - `switchTab` short-circuits when the requested file is already
    active, and otherwise rehydrates from the cached tab content
    before falling through to `openFile`.
  - `openFile` refuses to refetch when the requested file is already
    active and dirty — prevents any re-entrant call path from
    clobbering unsaved work.
  - `saveCurrentFile` updates the tab cache's `originalContent` after
    a successful write so post-save dirty checks on rehydrate are
    accurate.
  - `packages/web-app/tests/diagramRelationshipRoundTrip.test.js` —
    new suite exercising the full write → adapt read-back loop for
    cross-file diagram FKs, including the move-then-link combination.
- **dbt import + every CLI shell-out works from a dev clone again.**
  Commit `2cac0cc` (Apr 18) renamed the launcher `dm → datalex` but 17
  call sites in `packages/api-server/index.js` still spawned
  `<REPO_ROOT>/dm`, producing `can't open file '.../dm': [Errno 2]` on
  dbt Import, Generate SQL, Transform, Standards, Sync, Pull,
  Connectors, Apply, and every other flow that shells out. All call
  sites now reference `<REPO_ROOT>/datalex`; the `dm` legacy path is
  kept as a fallback so pre-rename checkouts still boot.
- **Deleting an entity now cascades cleanly across the model.** Shell's
  "Delete entity" action (and ViewsView's "Delete view") routed through
  a minimal `deleteEntity` that stripped the entity row but left orphan
  relationships, indexes, metrics, and `governance.classification` /
  `governance.stewards` entries pointing at a nonexistent entity. The
  replacement `deleteEntityDeep` purges every referring block — matching
  both the string form (`from: "entity.field"`) and the diagram-level
  object form (`{from: {entity, field}}`) of relationships — and returns
  an impact report. The success toast now lists what came with the
  delete: e.g. *“Deleted ‘customer’ (also removed 3 relationships, 1
  index, 2 governance entries).”* Missing-entity no-ops surface a real
  error toast instead of silently saving.
- **Model Graph panel refreshes automatically after edits.** The
  read-only graph panel only reloaded on project switch, so deletes /
  renames / saves left it showing a stale model until the user clicked
  Refresh. A new `modelGraphVersion` counter in `workspaceStore` bumps
  on save, entity delete, file delete, folder delete, and file rename;
  `ModelGraphPanel` subscribes to it and refetches.

### Added

- **`deleteEntityDeep(yamlText, entityName)`** in `yamlPatch.js`
  returns `{yaml, impact}` with cascade counts. Legacy `deleteEntity`
  is retained as a thin wrapper that returns only the YAML string for
  older callers. 8 new regression tests cover the cascade path,
  case-insensitive matching, the diagram-level object form, minimal
  docs without optional blocks, and the wrapper's back-compat shape.

## [0.5.0] — 2026-04-21

First SQLDBM-parity minor: shareability. The v0.4.x line closed the
last-mile modeling loop (bulk rename, domain navigation, git-diff
overlay). v0.5.0 takes the next step — getting a diagram out of the
tool and in front of a stakeholder, without a server, without a git
checkout, without DataLex installed on the other end.

### Added

- **HTML share bundles.** New `Cmd-K → Share diagram as HTML…` opens a
  `ShareBundleDialog` that generates a self-contained HTML file from
  the currently adapted schema — entity cards grouped by subject area,
  a relationships table with in-page anchors, a legend, and an inlined
  stylesheet that honors `prefers-color-scheme`. The bundle has **zero
  external dependencies** — drop it on S3, paste it in an email, open
  it in any browser. Download + copy-to-clipboard + optional in-dialog
  preview (sandboxed iframe so the preview can't exfiltrate).
  - Generator lives in `packages/web-app/src/lib/shareBundle.js` with
    `generateShareBundleHtml({...})` + `downloadShareBundle(html,
    filename)` — both pure and testable.
  - The bundle reuses the v0.4.1 domain-filter pipeline, so if you're
    focused on one subject area the export is scoped to that area
    automatically.
- **Versioned snapshots via git tags.** New `Cmd-K → Snapshots (git
  tags)…` opens a `SnapshotsDialog` that lists every tag in the repo
  (annotated + lightweight) with commit hash, date, and subject, and
  lets you create a new annotated tag on HEAD in one click. Name
  auto-suggests the next `vMAJOR.MINOR` based on existing tags.
  Deleting a tag only touches the local ref — remote cleanup remains
  an explicit `git push --delete origin <tag>`.
  - Three new API endpoints on `packages/api-server/index.js`:
    `GET /api/git/tags`, `POST /api/git/tags`, `DELETE /api/git/tags`.
    Tag-name validation mirrors git's own rules (no leading `-`, no
    `.lock` suffix, restricted character set).
  - API client additions: `fetchGitTags`, `createGitTag`, `deleteGitTag`
    in `packages/web-app/src/lib/api.js`.

### Changed

- `Shell.jsx` command palette gains a "Share" section with the two new
  entries. Both route through the existing `openModal`/`modalPayload`
  plumbing — no new state stores.

### Roadmap complete

v0.5.0 closes out the v0.4+ SQLDBM-parity roadmap that landed in
v0.3.3's plan: bulk refactor, diff overlay, domain nav, forward DDL
(shipped earlier), read-only share, versioned snapshots. Next arc
focuses on collaboration surfaces (comments, review requests,
consumer-side schema subscriptions).

## [0.4.2] — 2026-04-21

### Added

- **Git-diff overlay on the canvas — "show me what changed since `main`."**
  Third v0.4+ roadmap item. A new `DiffToggle` dropdown in the TopBar
  (next to the DomainSwitcher) accepts a git ref (default `main`) and
  renders ADD / MOD / DEL decorations on every affected entity in both
  the diagram and the legacy table-list view.
  - **Backend:** new `GET /api/git/diff-files?projectId=&ref=` endpoint
    in `packages/api-server/index.js`. Runs
    `git diff --name-status <ref>...HEAD` (three-dot so only HEAD-side
    commits count) and returns `{added, modified, removed, renamed}`
    arrays of file paths. Renames surface as both an add on the new
    path and a remove on the old path so the overlay shows both sides.
    Invalid refs → 404; non-git projects → 400.
  - **Store:** `uiStore` gained `diffVsRef`, `diffState`, `diffLoading`,
    `diffError` plus a `setDiffVsRef(ref, {projectId, projectFiles})`
    action that walks the `workspace.projectFiles` tree once and maps
    each file path to its entity name via `yamlData.entities[*].name`
    (with a `yamlData.name` fallback for the dbt-model shape). Strongest
    signal wins when the same entity appears in multiple buckets
    (added > removed > modified).
  - **UI:** `DiffToggle.jsx` is a click-outside-dismiss popover with a
    ref input, Enable/Refresh/Disable buttons, and a summary row of
    colored pills ("3 added · 2 modified · 1 removed"). When the
    overlay is active, the TopBar button gains an `accent-dim` chip
    with the total-changed count badge. Hidden entirely when there's
    no active project.
  - **Canvas:** `TableCard` accepts a new `diffStatus` prop and renders
    a 2px outline in the status color plus an ADD / MOD / DEL badge in
    the card header. Palette is exposed as a module-level
    `DIFF_COLORS` constant so future legend work and DiffToggle share
    the same lexicon. Cards stay in the ordinary DOM flow so selection
    rings, junction-box styling, and FK-color cues all continue to work.

### Changed

- `Chrome.jsx` TopBar now mounts `<DiffToggle />` alongside
  `<DomainSwitcher />` in the same tool group so the two "filter the
  canvas by X" affordances live next to each other.

## [0.4.1] — 2026-04-21

### Added

- **Top-bar domain switcher.** New `DomainSwitcher` dropdown
  (`packages/web-app/src/design/DomainSwitcher.jsx`) lives in the
  TopBar between the view-mode switch and the Run-SQL group. Clicking
  it opens a scoped popover listing every subject area declared at
  the `subject_areas:` catalog level plus any domain derived from
  entity `subject_area:` fields, with membership counts pulled live
  from the adapted model. Picking a domain sets
  `diagramStore.activeSchemaFilter`; clicking the active row clears
  it (toggle semantics match the bottom-panel Subject Areas view).
  An "Unassigned" row surfaces entities with no domain assigned,
  using the `__unassigned_subject_area__` sentinel shared with
  `SubjectAreasPanel.jsx`.
- **Domain filter applied to diagram + table surfaces.** `Shell.jsx`
  derives `filteredTables` / `filteredRelationships` from
  `activeSchemaFilter` and threads them into both `<Canvas>` and
  `<TableView>`. Relationships are filtered to edges whose endpoints
  both live in the visible set, so a cross-domain FK disappears when
  you drill into either side — matching SQLDBM's "focus on a single
  subject area" flow. The ViewsView and EnumsView surfaces stay
  unfiltered since views/enums do not carry `subject_area:` in today's
  schema.

### Fixed

- **`subject_area` now round-trips through the live adapter pipeline.**
  `schemaAdapter.js` previously fell back to `e.subject` and returned
  `subjectAreas: []` as a stub, which meant any subject area declared
  in YAML was invisible to the switcher and the bottom-panel count
  widgets. The adapter now (a) reads `subject_area` from entities with
  a legacy `subject:` fallback, (b) unions the workspace-level
  `subject_areas:` catalog with domains derived from entity fields,
  (c) computes membership counts against the adapted table list, and
  (d) mirrors the same merge inside `adaptDiagramYaml` so diagram
  views see identical metadata. `dataLexModelDocToEntity` also
  surfaces `subject_area` on the selected-entity shape for Inspector
  editing.

## [0.4.0] — 2026-04-20

### Added

- **Bulk column rename with project-wide preview & atomic apply.** First
  landing of the v0.4+ "SQLDBM-parity refactor" roadmap. A new
  `packages/web-app/src/lib/bulkRefactor.js` module plans a cross-file
  rename by walking every YAML file in the workspace and rewriting
  eight ref shapes in a single pass:
  - entity field declarations (the primary rename)
  - field-level FKs (`foreign_key` + `references`, both `field` and
    `column` spellings)
  - relationship strings (`"entity.field"` form)
  - diagram-level object relationships (`{entity, field}` form)
  - indexes (`{entity, fields[]}`)
  - metrics (`entity`, `grain[]`, `dimensions[]`, `expression`,
    `time_dimension`)
  - governance maps keyed `"entity.field"`
  - entity key-sets and partitions (`candidate_keys`, `business_keys`,
    `grain`, `hash_diff_fields`, `partition_by`, `cluster_by`, and the
    single-value keys from 0.3.4's cascade).
  The planner is side-effect free — callers get an `{affected[], errors[],
  declaringFile}` summary that feeds a diff preview. `applyBulkColumnRename`
  writes in sequence with best-effort rollback on partial failure.
- **`BulkRenameColumnDialog` with inline LCS diff preview.** New dialog
  (`packages/web-app/src/components/dialogs/BulkRenameColumnDialog.jsx`)
  renders the source column, a new-name input, a scan button, a per-file
  list with ref-kind summary (`"5 refs across 3 files · 2 fk, 2
  relationship, 1 index"`), and a per-file expandable unified-diff
  preview. The diff is computed via an inline LCS DP (capped at 2k
  lines per side, with a naive-alignment fallback for oversize YAMLs)
  and trimmed to ±2 lines of context per hunk so the preview stays
  readable. Collision detection flags cases where the destination name
  already exists on the entity. Works in two modes: fully-specified
  (`{entity, oldField}`) and column-picker (`{entity, columns[]}`).
- **Three entry points.** The bulk-rename flow is reachable from:
  - the **Columns Inspector** — a "Rename across project…" button
    under the Flags row, prefilled with the selected column;
  - the **entity context menu** on the canvas — "Rename column…"
    opens the dialog in picker mode with every field of the
    right-clicked entity;
  - the **command palette** — "Rename column across project…" under a
    new `Refactor` section, which opens picker mode when an entity is
    selected and falls back to a guard card otherwise.

### Changed

- Workspace store now refreshes `fileContentCache` and the active file's
  `originalContent`/`isDirty` directly when a bulk-rename apply lands,
  so open editors and the canvas re-render without a round-trip to
  `fetchProjectFiles`.

## [0.3.4] — 2026-04-20

### Added

- **Auto Layout preserves manually placed entities.** Dragged tables
  (tracked via a new `manualPosition` flag threaded through
  `schemaAdapter` whenever the YAML `display:` block or a diagram ref
  carries both `x` and `y`) are now left untouched when the user hits
  the Auto Layout action. ELK only re-lays the unplaced subset and the
  result is offset to sit next to the locked cluster. Previously a
  full re-layout blew away any hand-positioning the user had committed
  to disk.
- **Column rename cascades to FK references, keys, and partitions.**
  `renameField` in `yamlRoundTrip.js` now rewrites every `foreign_key`
  on sibling entities that points at the renamed column, plus
  `candidate_keys`, `business_keys`, `grain`, `hash_diff_fields`,
  `partition_by`, `cluster_by`, and the single-value keys
  (`natural_key`, `surrogate_key`, `hash_key`,
  `load_timestamp_field`, `record_source_field`). Previously only
  relationships/indexes/metrics/governance followed the rename,
  leaving dangling FKs that disappeared on the next adapter pass.
- **`C` keyboard shortcut recenters the canvas on the selected
  entity.** Added to the shortcut help overlay and handled in Shell's
  global keydown (guarded against inputs and `Cmd/Ctrl+C`). The
  handler sniffs `.table-card.selected` so it stays safe against the
  Shell's keydown effect being installed before the `selected` state
  hook.
- **Diagram-level sticky notes persist to `.diagram.yaml`.** Added a
  `notes: []` block to `diagram.schema.json`, parsed it in
  `adaptDiagramYaml` (surfaced as `schema.notes`), and shipped
  `addDiagramNote`, `patchDiagramNote`, and `deleteDiagramNote`
  helpers in `yamlPatch.js`. Canvas authoring UI lands next; the YAML
  contract is stable and git-friendly (integer positions, color
  index, dedupe by id).

### Changed

- Auto Layout status toast now reports how many entities were kept in
  place (e.g. *"Auto-layout applied (3 manually placed entities
  preserved)"*) so users understand why some didn't move.

## [0.3.3] — 2026-04-20

### Fixed

- **New file / folder / diagram now shows up instantly.** Previously
  every create round-tripped through `fetchProjectFiles()` before the
  tree updated — users saw a 1–2s spinner flash. The workspace store
  now optimistically splices the new record into `projectFiles` as soon
  as the POST resolves (and rolls back on error). Empty folders go into
  a companion `optimisticFolders` array that merges into the Explorer
  tree at render, since the server only lists YAML files.
- **All imported columns rendering as `string`.** Root cause was in
  `datalex_core/dbt/manifest.py` — when a dbt manifest lacks
  `data_type` (uncompiled projects), the importer silently omitted
  `type:` and downstream code defaulted to `"string"`. The importer
  now writes the sentinel `type: unknown`, emits a warning at import
  end pointing users at `dbt compile`, the schema adapter preserves
  empty/unknown types verbatim, and EntityNode + Inspector render
  unknown as an em-dash (`—`) with an inline type editor + placeholder
  so one-click fixes are obvious.
- **Diagram-level relationships now persist.** Drag-to-relate across
  two different model files used to mutate whichever model YAML the
  dialog last touched, and `adaptDiagramYaml` didn't read the diagram's
  own relationships, so edges orphaned on reload. Added a top-level
  `relationships: []` block to the diagram schema (new `addDiagramRelationship`
  helper in `yamlPatch.js`), routed `NewRelationshipDialog.handleSubmit`
  through it whenever the active file is a `.diagram.yaml`, and extended
  `adaptDiagramYaml` to merge diagram-level edges into the combined
  relationship set (deduped against edges already declared by referenced
  model files).

### Added

- **Four new entry points for creating a relationship** so it no longer
  requires hunting for the canvas drag-to-relate handles:
  - **Toolbar "Add Relationship" button** in `DiagramToolbar` next to
    Auto Layout (canEdit() gated).
  - **Inspector "Add" button** in the RELATIONS tab with the current
    entity pre-filled as the `from` side.
  - **Right-click context menu** on each entity node — "Add Relationship
    from here…" opens the dialog with the clicked entity as `from` and
    the full model as the picker's `to` source.
  - **Command palette "New relationship…"** (previously a no-op toast
    stub at `Shell.jsx:808`) now opens the dialog in picker mode.
- **Picker mode in `NewRelationshipDialog`.** When opened without
  drag-pinned endpoints, the dialog renders entity + column dropdowns
  sourced from the caller's `modalPayload.tables`, with smart defaults
  (preselects `id` when present).
- **Identifying vs non-identifying edges.** `modelToFlow.js` now renders
  a solid stroke for identifying relationships and a dashed stroke for
  non-identifying, auto-detected from the `identifying:` flag or from
  whether the FK column is itself part of the referenced entity's PK.
  Legend updated to document the distinction.
- **Hover tooltips on column badges.** CHK badges reveal the constraint
  expression, DEF badges show the default value, IDX badges name the
  index + list its composite fields + flag uniqueness, FK badges name
  the target table, COMP badges show the computed expression, and a new
  **`ENUM` badge** renders for `enum(...)` columns (expanding the enum
  values in its tooltip).
- **`NOT NULL` in all view modes.** The `NN` flag was previously only
  visible in physical view despite being documented in the legend —
  it now renders in logical and diagram modes too.

## [0.3.2] — 2026-04-20

### Fixed

- **Imported dbt models now render on the canvas.** The schema adapter
  previously only understood DataLex's canonical `entities:[]` shape,
  so dropping an imported `stg_*.yml` (which is `kind: model` with
  top-level `columns:`) onto a diagram silently did nothing, and
  columns shown elsewhere fell back to the `"string"` default type.
  Added `adaptDataLexModelYaml` for `kind: model` and `kind: source`
  docs, wired into both the diagram adapter's file-dispatch chain and
  `Shell.jsx`'s direct-open path. `not_null` / `unique` / `relationships`
  tests on columns now fold into nullability + unique flags + FK edges
  automatically. Covered by 7 new unit tests in
  `packages/web-app/tests/schemaAdapter.test.js`.
- **Duplicate project entries (e.g. three "jaffle-shop" rows).**
  Project dedupe now uses `fs.realpathSync` for canonical comparison,
  so `~/Jaffle-Shop` and `~/jaffle-shop` collapse to one registration
  on macOS/Windows' case-insensitive filesystems. Applies to both
  `editInPlace` dbt imports and the `POST /api/projects` register
  route.
- **Phantom `model-examples` starter entry.** `loadProjects` no longer
  hardcodes a starter project pointing at `model-examples/` — users
  hit an empty dropdown item when the folder didn't exist. It also
  self-heals on load: existing `.dm-projects.json` entries whose
  folder no longer exists are removed and the file rewritten.
- **Bottom-panel scrollbar artifact.** The thin grey slider visible
  below the Modeler / Properties / Libraries tab row was Firefox's
  native horizontal scrollbar showing through a `scrollbar-width:
  thin` rule. Switched to `scrollbar-width: none` with an
  `-ms-overflow-style: none` fallback so the tabs still scroll via
  trackpad/wheel but render without a visible slider.

### Added

- **`datalex/diagrams/` folder is seeded on dbt import.** When
  `editInPlace` import succeeds, the api-server creates
  `<project>/datalex/diagrams/` with a `.gitkeep` so the Explorer
  shows the conventional diagrams location immediately — clicking
  "New Diagram" lands in a folder that already exists.

## [0.3.1] — 2026-04-20

### Added

- **Python loader dispatch for `diagram` kind.** `KINDS` now includes
  `"diagram"`, `DataLexLoader` buckets diagram docs into a new
  `diagrams` dict, the default manifest glob
  (`datalex/diagrams/**/*.yaml`) discovers them, and
  `DataLexProject.diagrams` + `to_dict()` surface them to callers. This
  closes the v0.3.0 gap where diagram files round-tripped through the
  web app but were invisible to the Python CLI/validator.
- **Distinct Explorer icon for `.diagram.yaml` files.** The file tree
  now renders a `Layers` icon for diagrams so they're visually
  distinguishable from regular `.yaml` entity/model files.

## [0.3.0] — 2026-04-20

### Added

- **Diagrams as files (`.diagram.yaml`).** A new file kind that composes an
  ER diagram from N referenced entity/model files. The diagram YAML stores
  only `{file, entity, x, y, width}` per entry — entity definitions stay
  in their source `.model.yaml` or dbt `schema.yml`. Canvas positions
  persist to the diagram file (not per-model `display:`), so moving a node
  inside one diagram doesn't leak into a sibling diagram of the same
  model. Ships with a JSON Schema at
  `_schemas/datalex/diagram.schema.json`.
- **"New Diagram" Explorer button.** Creates
  `datalex/diagrams/<slug>.diagram.yaml` seeded with an empty
  `entities: []` and opens it on the canvas.
- **Drag-to-canvas from the Explorer.** Dropping any `.yml`/`.yaml` file
  onto an open diagram appends its reference to the diagram's
  `entities:` list. dbt `schema.yml` files with N models land as N
  entities on one drop; FK edges inferred from
  `tests: - relationships: {to: "ref('x')"}` render as dashed edges
  immediately. Drops are deduped by `(file, entity)` so dropping the same
  file twice is idempotent.
- **dbt schema.yml → ER adapter** (`adaptDbtSchemaYaml`). Round-trips
  through the existing DataLex adapter so a single code path owns
  FK/PK/column inference. `not_null` / `unique` tests become column
  flags; `relationships` tests become synthetic foreign keys.
- **File-content cache + prefetch** (`fileContentCache`,
  `ensureFilesLoaded`). The diagram adapter needs raw YAML for every
  referenced file — not just metadata. The cache is eagerly seeded by
  `loadDbtImportTreeAsProject` and lazily populated by the Shell when
  opening a diagram, so diagrams render without round-tripping through
  per-file `/api/files` fetches on every re-render.

### Known limitations

- A dbt shared `schema.yml` with N models still persists as a single
  DataLex model with N entities on save (Phase 4 in the roadmap). Diagrams
  render all N entities correctly via the new adapter, but edits to a
  single entity rewrite the whole file.
- Layout state briefly lives in both `localStorage` and the diagram YAML.
  Scheduled to drop localStorage in 0.3.1.

## [0.2.3] — 2026-04-20

### Fixed

- **"Demo mode" stuck in UI after importing a real dbt project.** The
  demo/offline flag was only set on the initial `fetchProjects` failure
  and was never cleared by a later successful project switch, so the
  workspace chip still showed `prod-analytics-01`, the canvas rendered
  the Subscription-Tracking fixture, and the status bar said "Demo mode"
  even though a real project was active. `selectProject` now explicitly
  clears `offlineMode`, and the canvas falls back to an empty schema
  (not the demo) when a real project is active but the active file
  doesn't parse as a DataLex model.
- **Hardcoded workspace label in the Explorer.** `LeftPanel` previously
  rendered a literal `prod-analytics-01` string in the workspace chip.
  It now binds to the active project's name (and path as the subtitle)
  and renders a dropdown to switch projects when more than one is open.

## [0.2.2] — 2026-04-20

### Fixed

- **"File not found" after Import dbt repo (Edit in place).** Edit-in-place
  previously only registered the project and sent the tree in the import
  response — the YAMLs never touched disk, so clicking a file in the
  Explorer hit `/api/files?path=…` and got a 404 because dbt ships
  `.sql` + a shared `schema.yml`, not per-model `.yml`. The import now
  writes every DataLex-generated `.yml` into the user's dbt folder at its
  source path (never clobbering a pre-existing file), so clicks resolve
  to real on-disk content and the Canvas can render entities.
- As a side-effect, the Canvas is no longer empty after import: once
  the first file opens successfully, its entities populate the diagram
  and inferred relationships draw between them.

## [0.2.1] — 2026-04-20

### Fixed

- `pip install 'datalex-cli[serve]'` on Python 3.13+ silently backtracked
  to 0.1.1 because `nodejs-bin` has no wheels for those interpreters. The
  `[serve]` extra now gates `nodejs-bin` behind `python_version < '3.13'`
  so pip can resolve the extra on any supported Python. On 3.13/3.14,
  install Node 20+ from nodejs.org — `datalex serve` will pick it up.

### Fixed

- `datalex serve --project-dir <dir>` now auto-registers that directory as
  the active DataLex project by writing `.dm-projects.json` on first launch.
  Previously the UI fell back to the hardcoded `model-examples` default and
  new users had to manually click through Import before anything worked.
- Port-conflict detection: if another `datalex serve` is already on the
  target port, we print the kill command instead of letting Node fail
  silently with EADDRINUSE.
- Web bundle auto-build: running `datalex serve` from a source checkout
  where `packages/web-app/dist/` hasn't been built yet now runs
  `npm install && npm run build` automatically (one-time), provided `npm`
  is on PATH.
- Api-server subprocess calls (`/api/dbt/import`, `/api/connections/*`,
  `/api/pull`, etc.) now use the same Python interpreter that ran
  `datalex serve` via a new `DM_PYTHON` env var, fixing
  `ModuleNotFoundError: No module named 'datalex_cli'` on machines where
  PATH `python3` differs from the one that has the package installed.
- Edit-in-place mode for local dbt imports: `POST /api/dbt/import` now
  accepts `editInPlace: true` to register the dbt folder as a DataLex
  project so `Save All` writes back to the original `.yml` paths rather
  than to a disposable tmpdir.
- Removed the login page. DataLex is open source — there is no auth gate.

## [0.2.0] — 2026-04-20

**Backend integration for the dbt workflow.** Five PRs land together —
covering folder-preserving dbt import, a proper canvas modeling
experience, a file/folder workspace, a live warehouse-pull UX, and a
single-command install/serve flow.

### Added

- **`datalex serve` / `dm serve`** — starts the bundled Express API
  server and web-app static bundle on one port (`--port`, default
  `3030`). `pip install datalex-cli && datalex serve` is now the full
  install path: no Node/Docker, no second terminal, no CORS. Falls back
  to `nodejs-bin` when system `node` isn't present.
- **Folder-preserving dbt import** (PR A) — `dm dbt sync` and the new
  `POST /api/dbt/import` route write each model at its original
  `models/staging/...` / `models/marts/...` path on disk. Explorer now
  renders a recursive tree and a checked-in jaffle-shop fixture lights
  up the full project offline in one click.
- **Column lint** (`dbtLint.js`) surfaces missing `description`,
  `data_type`, and test-less primary keys inline in the inspector and
  aggregates in the Validation panel.
- **Canvas modeling** (PR B) — drag from one column to another to open
  a pre-filled relationship dialog, positions persist via a new
  `display:` sub-map per entity, and the old decorative Undo/Redo
  buttons now drive a real per-file history ring buffer (⌘Z / ⌘⇧Z).
- **File/folder workspace CRUD** (PR C) — new api-server routes for
  folders, rename, move, delete, and save-all; the Explorer gets a
  right-click context menu and HTML5 drag-to-move. Every path is
  resolved with a `..`/symlink guardrail.
- **Live warehouse pull polish** (PR D) —
  - `POST /api/connectors/test` returns `{ pingMs, serverVersion }`
    and renders a pill under the Test button.
  - `POST /api/connectors/pull/stream` streams per-table `[pull] …`
    progress lines as SSE; the Connectors panel has a live log pane.
  - `cmd_pull` can write dbt-shaped projects to
    `sources/<db>__<schema>.yaml` + `models/staging/stg_…yml` when the
    target is a dbt project (`--no-dbt-layout` to opt out).
  - New `WarehouseTablePickerDialog` lets users pick exact tables per
    schema with inferred primary keys + row counts, including a
    one-click "Pick demo tables" shortcut for a Snowflake
    `JAFFLE_SHOP` schema.

### Changed

- Version bumped to `0.2.0` across `pyproject.toml`,
  `packages/web-app/package.json`, and `packages/api-server/package.json`.
- Wheel now ships both the built web-app (`datalex_core/_webapp/`) and
  the api-server entry point (`datalex_core/_server/`) as package
  data, so `datalex serve` works from an installed wheel with zero
  extra setup.
- `CONNECTOR_FIELDS` / `CONNECTOR_META` unchanged — no credential
  migrations required.

## [0.1.1] — 2026-04-18

First PyPI release. `pip install datalex-cli` now works end-to-end.

### Added

- JSON Schemas are bundled with the `datalex_core` Python package under
  `datalex_core/_schemas/datalex/`. `pip install datalex-cli` from any
  working directory can validate projects without needing the repo on
  disk.
- Tag-triggered PyPI publish workflow (`.github/workflows/publish.yml`)
  using OIDC trusted publishing — no long-lived API tokens stored.
- `RELEASING.md` — one-time PyPI setup plus the release checklist.
- README hero screenshot (`Assets/Overview.png`) showing the Visual
  Studio: file tree, schema-aware YAML editor, and React Flow ERD
  side-by-side on the same entity.

## [0.1.0] — 2026-04-18

First tagged release. The project was previously known as
**DuckCodeModeling**; it is now **DataLex** (product) by **DuckCode AI
Labs** (company).

### Added

- **DataLex YAML substrate** — `kind:`-dispatched, file-per-entity
  layout under `models/{conceptual,logical,physical}/`,
  `glossary/<term>.yaml`, `domains/`, `policies/`, `snippets/`. Per-kind
  JSON Schemas under `schemas/datalex/`.
- **Streaming loader** with source-located errors
  (`file`/`line`/`column`/`suggested_fix`) and a content-addressed parse
  cache under `build/.cache/` or `~/.datalex/cache/`.
- **Dialect plugin registry** (`datalex_core/dialects/`) — Postgres and
  Snowflake first-party; BigQuery, Databricks, MySQL, SQL Server,
  Redshift via the existing generators path.
- **dbt integration** — `datalex datalex dbt sync` reads
  `target/manifest.json` + `profiles.yml`, introspects live column types
  (DuckDB + Postgres), and merges them into DataLex YAML with
  idempotent `meta.datalex.dbt.unique_id` stamping. `datalex datalex
  dbt emit` writes `sources.yml` + `models/_schema.yml` with
  `contract.enforced: true` and `data_type:` on every column.
- **Cross-repo packages** — `imports:` supports `org/name@version`,
  `git:` + `ref:`, or `path:`; lockfile + content-hash drift detection
  at `.datalex/lock.yaml`.
- **Explicit rename tracking** via `previous_name:`; diff prefers
  explicit renames over heuristics.
- **CLI binary** `datalex` (argparse subcommand tree). Legacy flat
  commands from the pre-DataLex prototype remain available.
- **Reusable GitHub Action** (`.github/actions/datalex`) for CI: validate
  → breaking-change diff → emit dbt YAML → optional `dbt parse`.
- **Visual Studio UI** — React + React Flow studio (`packages/web-app`
  + `packages/api-server`) reading and writing the same YAML tree as
  the CLI. No database, no hosted service.
- **Zero-setup demo** at `examples/jaffle_shop_demo/` — builds a local
  DuckDB warehouse and runs the full dbt sync pipeline without any
  external credentials.
- **Installable Python package** — `pyproject.toml` exposes
  `datalex-cli` on PyPI-style layout with optional extras (`[duckdb]`,
  `[postgres]`, `[snowflake]`, etc.). `pip install -e .` from a clone
  works today; a true PyPI publish requires bundling `schemas/datalex/`
  into the package (tracked as follow-up).

### Known limitations

- `datalex datalex ...` still has the nested subcommand name; flattening
  to `datalex <sub>` is a follow-up (will require resolving collisions
  with the legacy flat commands).
- Schemas under `schemas/datalex/` are discovered relative to the repo
  root; a `pip install`ed package run outside the repo needs
  `--schemas-root` or the repo on disk.

[Unreleased]: https://github.com/duckcode-ai/DataLex/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/duckcode-ai/DataLex/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/duckcode-ai/DataLex/releases/tag/v0.1.0
