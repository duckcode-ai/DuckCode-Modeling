# Changelog

All notable changes to DataLex are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project
adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html)
from `v0.1.0` onward.

## [Unreleased]

## [1.9.0] - 2026-05-01

Minor release — bundles the OSS roadmap milestones that landed in #106
(`datalex draft` AI-assisted authoring, community foothold artifacts,
launch HQ) and #108 (embedded `manifest-spec` v1) in a single user-
visible version, plus the joint-tutorial Tier-2 update from this PR.

### Added

- **`datalex draft` CLI** — AI-assisted starter generation from a dbt
  project. Reads `target/manifest.json`, condenses to <50 KB JSON, calls
  Anthropic with a system prompt + 2-shot pack (cache-controlled), and
  emits a draft `*.model.yaml` validated against the v3 model schema.
  Reviewable AI output — never silent rewrites of project files. Opt-in
  install via `pip install datalex-cli[draft]`. From #106.
- **Manifest-spec v1 embedded** at `docs/manifest-spec/`. Stable schema
  URLs at `https://duckcode-ai.github.io/DataLex/manifest-spec/v1/{datalex,dql}-manifest.schema.json`
  for external consumers (Atlan, Marquez, Monte Carlo) to pin. From
  #108.
- **`SUPPORT.md`, `ROADMAP.md`, `docs/rfcs/0000-template.md`** — public
  community routing + triage SLA + RFC scaffold. From #106.
- **`docs/launch/`** — coordinated-launch artifacts: readiness
  checklist, 5 channel post drafts (HN, dbt Slack, LinkedIn, X,
  r/dataengineering), 60-second demo script, custom-domain runbook.
  From #106.
- **5-minute end-to-end tutorial** at
  `docs/tutorials/datalex-plus-dql-end-to-end.md` updated to walk the
  full graduated-trust loop: Tier 1 certified → Tier 2
  `query_via_metadata` capture → `dql certify --from-draft` promotion.
  Pairs with [duckcode-ai/dql#31](https://github.com/duckcode-ai/dql/pull/31).

### Changed

- `tests/test_draft_manifest_loader.py` covers the deterministic
  manifest condenser (8/8 cases, no API key needed in CI).

## [1.8.2] - 2026-04-30

Patch release — Roadmap **Phase 4b** (EventStorming narrative in DocsView)
and **Phase 5a** (Markdown export from DocsView). Closes the originally
planned roadmap; Phase 4c (canvas swim-lanes) and Phase 5b/c (Confluence
push, collaboration) remain deferred for future passes.

### Added

- **EventStorming flow** card in DocsView (Phase 4b). Renders any
  `event`/`command`/`actor`/`policy`/`aggregate` entities as a
  numbered narrative grouped in canonical Brandolini order:
  Actors → Commands → Aggregates → Events → Policies. Each group
  carries the same sticky-note swatch hex values as the canvas
  (`EntityNode.jsx`, Phase 4a) so the docs read like the diagram.
  Self-hides for plain ER models.
- **`buildEventStormingFlow`** pure helper in
  `design/views/eventStormingFlow.js` — testable without React,
  mirroring the `buildCapabilityHierarchy` pattern from Phase 3.
  Preserves YAML order within each group (the modeler's chosen
  narrative order, not alphabetical).
- **Export Markdown** button in DocsView (Phase 5a). Downloads the
  active docs page as a portable `.md` containing the model header,
  overview, mermaid `erDiagram` (renders inline on GitHub / GitLab /
  Confluence-with-mermaid / Notion / LLM context windows),
  EventStorming flow, and per-entity field tables. Works for both
  conceptual diagrams and physical/logical models.
- **`buildDocsMarkdown`** pure helper in
  `design/views/docsToMarkdown.js`, plus shared mermaid source
  builder extracted from `MermaidERD.jsx` to
  `lib/mermaidErdSource.js` so the rendered diagram and the
  exported diagram come from a single source of truth.
- **22 new tests** (9 for `eventStormingFlow`, 13 for
  `docsToMarkdown`); web-app suite now 147/147.

### Out of scope (deferred)

- Phase 4c — canvas swim-lane layout. The narrative version above
  covers the workshop-readout value; the canvas is a v2 feature.
- Phase 5b/c — Confluence direct push and collaboration features.
  Each warrants its own design pass and auth integration.

PRs: [#101](https://github.com/duckcode-ai/DataLex/pull/101),
[#102](https://github.com/duckcode-ai/DataLex/pull/102).

## [1.8.1] - 2026-04-30

Patch release — Roadmap Phase 4a: EventStorming sticky-note shapes.

### Added

- **Five new entity types** registered in `ALLOWED_ENTITY_TYPES`,
  vocabulary borrowed verbatim from the Brandolini canon: `event`,
  `command`, `actor`, `policy`, `aggregate`. `INVALID_ENTITY_TYPE`
  no longer fires for these.
- **Canonical EventStorming palette** in
  `EntityNode.jsx → TYPE_COLORS`:
    event     → orange     (past tense — "Order Placed")
    command   → blue       (imperative — "Place Order")
    actor     → yellow     (person, role, external system)
    policy    → pink       (reactive rule that may issue commands)
    aggregate → pale-yellow (consistency boundary holding state)
- **Build panel** type picker on the conceptual layer now lists the
  EventStorming family alongside `concept`, with one-line
  descriptions in the dropdown. Logical and physical layers stay
  focused on data shape.
- **2 new tests** in `modelQuality.test.js` — positive (accepts new
  types) and negative (still rejects unknown types so a missed
  registration would be caught).

### Out of scope (Phase 4b — separate PR)

- Swim-lane layout (`flow_mode: true` on diagrams).
- Numbered narrative for flow files in DocsView.
- AI conceptualizer extension to propose event/command/actor types
  from staging-layer behavior (needs deeper read than current
  FK-walk supports).

PR: [#100](https://github.com/duckcode-ai/DataLex/pull/100).

## [1.8.0] - 2026-04-30

Minor release — picks up the roadmap after the v1.7.x polish pass.
**Phase 3 — Capability Map view**: a new top-tab that renders the
active YAML doc's entities as a 2-level boxes-in-boxes hierarchy
(Domain → Subject area → Concept), replacing the LeanIX /
Avolution use case for a YAML-first crowd.

### Added

- **`Capabilities` top-tab** (peer of Diagram / Docs / Table /
  Views / Enums) registered in `VALID_SHELL_VIEW_MODES` and the
  `VIEW_MODES` strip in `Chrome.jsx`.
- **`design/views/CapabilityMap.jsx`** — new view (270 LOC). Top
  of page shows totals (N domains · N subject areas · N concepts).
  Real-time search filters concepts by name, owner, tag, subject
  area, or domain. Concept chips are clickable: click drills into
  Diagram view-mode with that concept selected and the Build panel
  opened so the user lands on the Phase 1A inline-editable Selected
  Concept block.
- **Visibility tinting** on concept chips: `internal` → orange-ish
  background, `public` → green tint, `shared` → default. PII
  concepts visually stand out from the public hierarchy.
- **`design/views/capabilityHierarchy.js`** — pure builder function
  extracted so it's testable without React. Domain falls through:
  `entity.domain → doc.domain → doc.model.domain → "Uncategorized"`.
- **8 unit tests** at `tests/capabilityHierarchy.test.js` covering
  the domain fallback, subject-area fallback, malformed-entry
  resilience, and alphabetical sort. Web-app suite: 115 → 123 pass.

### Out of scope (deferred)

- RACI matrix view (different mental model — process not
  capability; scoped for a later phase).
- Capability authoring (edit-in-place from the map). v1 is
  read-only; the Build panel remains the canonical authoring
  surface.

PR: [#99](https://github.com/duckcode-ai/DataLex/pull/99).

## [1.7.3] - 2026-04-30

Patch release. The AI fix-agent now actually has rule-by-rule recipes
loaded into its prompt and refuses to hallucinate values it can't
legitimately know.

### Added

- **`Skills/validation-fix-recipes.md`** — single source of truth
  mapping every validation rule code to: trigger, output contract
  (`patch_yaml` / `needs_user_input` / `no_patch_needed`), and the
  exact action. Loaded once at module init and injected into the
  `validation_fix` system prompt (prompt grew from ~840 chars to
  ~9.8k carrying the full table).
- **14-rule server-side short-circuit.** Rule codes whose fix needs
  human-only data (project name, owner emails, columns, schema)
  bypass the LLM entirely and emit a stable `needs_user_input`
  payload. Zero tokens, zero hallucinated placeholders. Covered:
  `MISSING_MODEL_SECTION`, `INVALID_MODEL_NAME/VERSION/DOMAIN/OWNERS`,
  `INVALID_OWNER_EMAIL`, `INVALID_ENTITIES`, `DBT_ENTITY_NO_COLUMNS`,
  `DBT_COLUMN_NO_TYPE`, `CONCEPTUAL_MISSING_OWNER/SUBJECT_AREA/
  GLOSSARY_LINK/DOMAIN`, `LOGICAL_UNRESOLVED_TYPE`, `LOGICAL_MANY_TO_
  MANY_NEEDS_ASSOCIATIVE_ENTITY`, `PHYSICAL_MISSING_DBT_SOURCE/
  SQL_OUTPUT`.
- Validation panel pipes the same Why/Fix copy into the user prompt,
  so panel and agent share one source of truth.

### Changed

- **`Skills/dbt-naming-conventions.md`** — was telling the agent
  "snake_case everywhere. Never PascalCase in YAML." which directly
  contradicted `INVALID_ENTITY_NAME`'s PascalCase requirement.
  Replaced with a layered rule: snake_case for fields/paths/keys,
  PascalCase for logical/physical entity names, human names for
  conceptual concepts.

PR: [#97](https://github.com/duckcode-ai/DataLex/pull/97).

## [1.7.2] - 2026-04-29

Patch release polishing the Validation panel.

### Changed

- **Three rules no longer fire on conceptual files where they don't
  apply.** `MISSING_MODEL_SECTION` (diagrams have no `model:` block by
  design), `INVALID_ENTITY_NAME` PascalCase enforcement (concepts use
  human names like "Sales Order"), and `DBT_ENTITY_NO_COLUMNS`
  (concepts describe meaning, not row shape). On the Sales Conceptual
  Model fixture this drops 6 blockers → ~3 and 4 coverage findings →
  0 without changing what the CI gate actually enforces.
- **Per-finding "Why this matters" / "Next step" copy** is now
  rule-specific. 12 new `ISSUE_GUIDANCE` entries replace the
  templated "this issue blocks the model from passing validation"
  boilerplate that was rendering identically under every finding.
- **IssueCard density** — Why and Fix used to render as two stacked
  boxed cards under every finding. Now inline: short labels in
  tertiary tone, text on the same line. Same content, half the
  vertical space.
- **"How to read this"** is a one-line collapsible `<details>`
  ("How to read this panel") instead of a 3-card grid eating the
  first viewport.

PR: [#96](https://github.com/duckcode-ai/DataLex/pull/96).

## [1.7.1] - 2026-04-29

Patch release: clarity polish + a crash fix surfaced during the
1.7.0 walkthrough.

### Changed

- **Renames.** Docs button "Run readiness check" → **"Run CI
  readiness gate"**. Validation panel "Rerun" → **"Rerun gate"**.
  Tooltips/descriptions on both surfaces now cross-reference each
  other in plain English so users stop confusing the per-file
  Validation tab with the project-wide CI gate.

### Fixed

- **DictionaryPanel TypeError on conceptual files.** Opening
  Dictionary on a `kind: diagram` file with object-shape
  relationship endpoints (`from: { entity, field }`) crashed with
  `TypeError: (r.from || "").split is not a function`.
  `EntityCard.relationships` filter now handles both string and
  object endpoint shapes via the same `endpointEntity()` helper used
  in DocsView.

PR: [#95](https://github.com/duckcode-ai/DataLex/pull/95).

## [1.7.0] - 2026-04-29

Major release. **DataLex is now the Git-native authoring tool for
the [Open Semantic Interchange](https://github.com/open-semantic-interchange/OSI)
v0.1.1 standard** finalized January 2026 by Snowflake / dbt Labs /
Salesforce / Atlan / Mistral / ThoughtSpot. None of the OSI
signatories ship a YAML-first authoring experience; that gap is now
the wedge.

Five PRs landed as the launch bundle:

### Added — OSI export & MCP context endpoint (Phase 2a, headline)

- **OSI v0.1.1 bundle export** through three surfaces:
  - HTTP: `GET /api/projects/:id/export/osi`
    (`?validate=1` adds a validation report; `?download=1` triggers
    a Content-Disposition download).
  - MCP: new `osi.export` tool in the existing `datalex-mcp` stdio
    server so Claude Desktop / Cursor / Code can read DataLex
    concepts as native context.
  - Frontend: "Export OSI" button in the Docs header.
- **Honors `visibility:`** — entities and relationships marked
  `internal` are skipped from the export. `shared` (default) and
  `public` are included.
- Mapping: DataLex `entities[]` → OSI `Dataset[]`,
  `relationships[]` → `Relationship[]` with the business verb
  rendered as `ai_context.instructions`, entity `terms[]` →
  `Dataset.ai_context.synonyms`. Provenance carried in
  `custom_extensions[].vendor_name: COMMON`.
- Vendored OSI 0.1.1 schema at `packages/api-server/ai/osi/osi-schema.json`
  + lightweight validator with no extra runtime dep.

PR: [#93](https://github.com/duckcode-ai/DataLex/pull/93).

### Added — Conceptual Build panel becomes workshop-ready (Phase 1A)

- **Inline-edit Selected Concept**: Domain, Owner, Subject area,
  Tags, Glossary terms, Visibility (Internal / Shared / Public),
  Definition. Each commits to YAML on blur via per-field setters in
  `yamlPatch.js`. Six new helpers shipped: `setEntityOwner`,
  `setEntityDomain`, `setEntitySubjectArea`, `setEntityTags`,
  `setEntityTerms`, `setEntityVisibility`.
- **Quick-add concept form** in the Build panel — type a name,
  press Enter, concept lands on the canvas with sensible defaults.
  "More options…" link still opens the full new-concept dialog.
- **Verb autocomplete** on the New Relationship dialog (conceptual
  level): a `<datalist>` of verbs already used in the active file
  + 19 common conceptual-modeling verbs (`places`, `owns`,
  `contains`, `generates`, `depends_on`, …).
- `visibility:` reserved as a YAML field on entities and
  relationships for Phase 2a's OSI gate to consume without a
  breaking schema change.

PR: [#90](https://github.com/duckcode-ai/DataLex/pull/90).

### Added — Bidirectional concept ↔ glossary linking (Phase 1B)

- **Build panel** — Glossary terms appear as clickable purple
  chips. Click jumps to the Dictionary tab.
- **Dictionary panel** — each glossary card shows a "Used by"
  strip listing concepts whose `terms:` reference the term. Click
  selects the concept on the canvas and switches to Build.

PR: [#91](https://github.com/duckcode-ai/DataLex/pull/91).

### Added — Conceptualizer business verbs (Phase 1C)

- AI conceptualizer (Python `core_engine`) replaces the
  "X references Y" tautology with three signals stacked in
  priority: column-name patterns (`created_by` → `created_by`),
  entity-pair lookup (~30 common pairs: Customer × Order =
  `places`, Order × Invoice = `generates`, Order × Payment =
  `is_paid_by`, …), and a passive `is_associated_with` fallback.
- Verbs are now single-token snake_case so they roundtrip cleanly
  with Phase 1A's verb-autocomplete + Phase 1B's glossary layer.

PR: [#92](https://github.com/duckcode-ai/DataLex/pull/92).

### Added — Narrative DocsView for conceptual files (Phase 2b)

- DocsView used to render every YAML file with the same
  field-table layout (designed for physical/logical models). For
  `kind: diagram` and `layer: conceptual` files (or any file
  containing `type: concept` entities), it now renders a
  three-block narrative:
  - **Domain TOC** — concepts grouped by domain with counts and
    anchor links. Hidden when there's only one domain.
  - **Business flow** — numbered list of relationship sentences
    using Phase 1C verbs ("Customer **places** Order. Order
    **contains** Order Line Item.").
  - **Per-concept paragraphs** — name + type + owner +
    visibility pill, editable definition (via the existing
    `EditableDescription`), glossary terms (purple chips matching
    the Build panel TermsField), and tags (green chips).
- The existing physical/logical/dbt renderers stay unchanged — an
  `isConceptual` gate routes between the two paths.

PR: [#94](https://github.com/duckcode-ai/DataLex/pull/94).

## [1.6.1] - 2026-04-29

Patch release: onboarding journey explains the v1.6.0 features.

### Added

- **Three-pillar Welcome card** replaces the single-paragraph
  Welcome step with a visually engaging value layout:
  Layered modeling · Git-native · AI-ready. Each pillar = one
  icon + headline + one-line tagline.
- **New "Read your auto-generated docs" step** between Connect and
  See gaps — walks users through the new Docs view shipped in
  1.6.0.
- **Refreshed validation step copy** mentioning the new red /
  yellow / green status dot on the Validation tab.

### Changed

- `JOURNEY_VERSION` bumped 1 → 2 so existing users re-see the
  journey with the new step.
- `validation:opened` event is now actually emitted (was declared
  in the journey step's `completeOn` but never fired before).

PR: [#89](https://github.com/duckcode-ai/DataLex/pull/89).

## [1.6.0] - 2026-04-29

Major release — bundles AI architecture rebuild, Docs view dbt-shape
rendering, validation panel + status-dot, and a bottom-tab
consolidation.

### Added — AI architecture rebuild

- **Per-intent endpoints + tool registry** under
  `packages/api-server/ai/`: `intent-router.js` (deterministic
  classifier with 6 intents), `tools.js` (12 tools the per-intent
  prefetchers can call), `intent-endpoints.js` (one focused agent
  per intent: `validation_fix`, `explain`, `explore`,
  `create_artifact`, `refactor`).
- **Surgical `patch_yaml` fixes** anchored to the validation
  finding instead of dumping the model into a fresh file.
- **Shared YAML shape classifier** at
  `packages/web-app/src/lib/yamlDocumentKind.js` and
  `packages/api-server/ai/yamlDocumentKind.js`. Recognizes
  DataLex-native, dbt schema.yml, dbt semantic_models / metrics,
  dbt saved_queries.
- **DocsView renders dbt-native YAML shapes** —
  `semantic_models[]`, `metrics[]` (grouped by type), `saved_queries[]`,
  schema.yml `models[]`, `sources[]` (with table+column drilldown),
  `exposures[]`, `snapshots[]`. Closes the "blank Docs page for dbt
  files" gap.
- **AI conceptualizer auto-proposes** entities from staging dbt
  models with verbs and cardinality.

### Added — Validation panel

- **Red / yellow / green status dot** on the Validation bottom tab
  driven by the active file's findings. Severity visible without
  clicking the tab.
- `lintDoc` extended to cover `semantic_models`, `metrics`,
  `saved_queries`, `exposures`, `snapshots` so a fresh dbt-imported
  file always has substantive findings instead of an empty panel.
- `DBT_SCHEMA_DETECTED` advisory filtered out of status (was making
  every dbt file yellow regardless of actual issues).

### Changed — Bottom tab consolidation

- PHYSICAL layer slimmed from 10 tabs to 5: **Validation · Diff ·
  Build · Policy Packs**.
- Studio renamed to **Build** with clarifying eyebrows
  ("Build · Conceptual / Logical / Physical") and improved
  empty-state copy.
- Redundant **dbt** bottom tab removed (DocsView is the canonical
  structured viewer for dbt resources).
- Every tab carries a `description` field rendered as a hover
  tooltip — each tab self-documents.

### Added — AI proposal review modal

- **Zoom + maximize** on the diagram preview (50–250% in 20%
  steps, ESC exits fullscreen).
- **Full AI explanation panel** above the workspace:
  `rationale`, `explanation`, `validation_impact`,
  `source_context`, `questions`.
- **Draggable splitter** between the diagram preview and YAML
  editor (14px hit area, persisted to localStorage,
  double-click to reset).
- Modal body switched from `overflow: hidden` grid to a
  scrollable flex column with a 540px workspace min-height —
  the user can scroll the whole review surface when content
  overflows.

Bundled the in-progress stack of PRs (#84, #85, #86, #87, #88) into
one squash-merge on `main` as commit
[`7c7adbe`](https://github.com/duckcode-ai/DataLex/commit/7c7adbe);
the four lower PRs were closed as superseded.

## [1.5.0] - 2026-04-28

Minor release — pivots the modeling experience around a new top-level
**Docs view**, ships a stdio MCP server so Claude Desktop / Cursor /
Code can drive DataLex directly, and clears a stack of UX papercuts
on the onboarding journey, the Help & Tour pane, and the topbar
icons.

### Added — Top-level Docs view

- **`Docs` workspace tab** next to Diagram / Table / Views / Enums.
  Renders the active YAML model as readable documentation: header
  chips (layer / domain / version / owners), inline-editable model
  description, mermaid ER diagram (drawn client-side from the YAML
  entities, with PK / FK detection), one section per entity with an
  editable description and a fields table whose **Description**
  column is also click-to-edit.
- **Live re-render on AI edits.** The view subscribes to
  `activeFileContent`; AI agents that mutate YAML through
  `updateContent()` (Conceptualizer, AI proposals) show up here
  without any extra wiring. Verified by an `e2e/docs-view.spec.js`
  assertion that injects an `updateContent()` call from outside the
  view and confirms the rendered prose updates with no user
  interaction.
- **Per-entity readiness chips** sourced from `/api/dbt/review` —
  surface "N errors / N warnings" inline so users see exactly which
  entities the gate flags. **Run readiness check** button refreshes
  the review on demand.
- **Suggest with AI** buttons next to every empty description
  (model-, entity-, and field-level). Click opens the existing
  `AiAssistantDialog` with a focused `initialMessage` prefilled
  ("…suggest a 1-2 sentence description grounded in dbt + business
  modeling conventions. Reply with ONLY the description text."), so
  users go from blank to candidate text in two clicks. No new
  endpoints — reuses the existing AI surface.
- **YAML patch helpers** — `setModelDescription` and
  `setEntityDescription` in `design/yamlPatch.js`, used by the
  inline-edit flow. Field-level edits route through the existing
  `patchField`.

### Added — MCP server (`packages/mcp-server`)

- New stdio MCP server, shipped as the `datalex-mcp` console script.
  Plug into Claude Desktop / Cursor / Code with
  `{ "command": "datalex-mcp" }`. Four tools any client can call:
  - `docs.export` — write per-model + per-domain Markdown (with
    mermaid ERDs) for a project.
  - `docs.list` — enumerate recognized DataLex models (path, kind,
    domain, layer, name, entity_count).
  - `dbt.doc_blocks` — list `{% docs %}` blocks scanned from the
    project, or fetch one by name.
  - `dbt.review` — run the readiness gate over a project; return the
    per-file score summary.
- Single source of truth: every tool calls the same `datalex_core`
  functions the CLI and api-server use.

### Added — Optional static-site docs export

- **`datalex docs export --project <root> --out <dir>`** CLI
  subcommand. Walks a project, writes
  `<out>/<domain>/<model>.md` (per-model data dictionary),
  `<out>/<domain>/README.md` (per-domain summary + mermaid ERD), and
  `<out>/README.md` (top-level domain index). Doc-block references
  (`description_ref: { doc: <name> }`) resolve through the existing
  `DocBlockIndex` so prose lands in the MD, not the jinja reference.
- **`POST /api/docs/export`** endpoint mirrors the CLI for the
  api-server. Defaults `out_dir` to `<project_dir>/docs/_generated`.
- Repositioned in the README as "optional static-site publishing"
  rather than the primary surface — the in-app Docs view is the
  default UX; this is for users who want committed `.md` files for
  GitHub Pages, internal wikis, or AI ingestion.

### Added — One-command updater

- **`bash scripts/update.sh`** auto-detects how `datalex-cli` is
  installed in the active Python environment and runs the right
  upgrade: editable source checkout → `git pull` + `pip install -e .`;
  PyPI install → `pip install -U 'datalex-cli[serve]'`; VCS install
  → re-install from `main`. `--from-source` forces the GitHub-main
  path for users on a Python that PyPI hasn't caught up to.
- README `## Update to the latest` section pointing at the script
  with the equivalent one-liner for users who'd rather skip the
  shell wrapper.

### Changed — Topbar icons (lucide-react refresh)

- The previous custom set had real semantic problems flagged by
  users:
  - **Save** and **Save All** both rendered with `Download` (wrong
    meaning, and the same icon for two distinct actions).
  - **Import schema** rotated `Download` 180° as a hack for upload
    semantics.
  - **Settings** rendered as a sun-with-rays, not the gear shape
    every other app uses.
- Switched the topbar action set to lucide-react (already a project
  dep) so each button has a distinct, conventional icon: `Save`
  (floppy), `SaveAll`, `Upload` (Import), `Download` (Import dbt —
  actual download semantics now), `Settings` (real gear),
  `GitCommit`, `Boxes` (New Model), `Database` (Connect),
  `Undo2 / Redo2`, `Play` (Run SQL), `Sparkles` (AI), `FilePlus2`,
  `FolderOpen`. View-switcher tabs: `Layers / FileText / Table /
  Eye / Hash`.
- Domain-specific icons (cardinality, key flags, relationship types)
  stay in `design/icons.jsx` — that namespace continues to own
  modeling glyphs.

### Changed — Docker quickstart promoted up front

- New `### Prefer Docker?` subsection in the README sits right after
  the pip Quickstart, with the build + run commands and the
  volume-mount form. Was previously buried at the start of the
  `## Install` chapter, so users on machines where pip install was
  awkward had to scroll past the entire onboarding journey
  description and tutorial picker to find it. No content moved or
  removed — the `### Docker Fallback (Optional)` section under
  Install stays untouched.

### Changed — Help & Tour disambiguation

- Renamed the two replay buttons in **Settings → Help & Tour** so
  they're impossible to confuse:
  - `Replay onboarding` → **`Replay 6-step onboarding journey`**
  - `Deep feature tour` → **`Legacy spotlight tour (13 steps)`**
- Added an `e2e/replay-onboarding.spec.js` regression that wipes
  `datalex.onboarding.journey` + `datalex.onboarding.seen` and
  reloads, asserts the new journey panel mounts and no driver.js
  popover appears.

### Fixed — Onboarding journey: three blocking bugs

- **Step 4 never auto-completed.** `emitJourneyEvent("entity:created", ...)`
  did `{ name, ...detail }`; every entity-creation call site passed
  `{ kind, name: cleanEntityName }`, so the spread silently
  overwrote the journey event name with the entity name. The journey
  listener never matched; step 4 stayed active even after the entity
  was visibly created on the canvas. Spread order is flipped (event
  name wins) and call sites now use `entityName` for clarity. Fixes
  `core_engine/src/datalex_core/lib/onboardingJourney.js:157` and
  the 4 callers in `NewLogicalEntityDialog.jsx` and
  `NewConceptDialog.jsx`.
- **Step 6 was unreachable when picking the recommended local AI
  provider.** `aiConfigured` checked only
  `localStorage.datalex.ai.apiKey`, but the local provider needs no
  key. Now matches `SettingsDialog`'s existing
  `provider === "local"` OR-condition.
- **At ~1280px the 480px right-rail panel covered the import
  dialog's submit button.** Panel now auto-collapses to its pill
  while any modal is open and re-expands when the modal closes —
  separate from the user's manual-collapse state, so closing a modal
  doesn't re-expand a panel the user hid.

### Fixed — Python 3.14 incompat in `dbt docs reindex`

- The `datalex dbt docs reindex` subparser had
  `help="Rebuild the {% docs %} block index..."`. Python 3.14 added
  stricter validation in `argparse._check_help` that runs the help
  string through `% {}`, and the bare `%` followed later by ` d`
  was read as a `%d` conversion. The CLI failed to start on Python
  3.14 with `ValueError: badly formed help string` — including
  `datalex serve`. Escaped both percents as `%%`. Verified clean on
  Python 3.14.2.

### Added — Playwright coverage

- `e2e/onboarding-journey.spec.js` — full 6-step journey walk
  against jaffle-shop. Catches regressions on event names,
  auto-completion, persistence, and the auto-collapse-on-modal
  behaviour.
- `e2e/docs-view.spec.js` — top-level Docs tab renders next to
  Diagram/Table/Views/Enums; inline description edits round-trip
  through `yamlPatch` → `updateContent` → DocsView re-render; live
  re-render on AI/external `updateContent()`.
- `e2e/replay-onboarding.spec.js` — Settings → Help & Tour replay
  flow doesn't fall back to the legacy driver.js tour.

## [1.4.1] - 2026-04-27

### Changed — First-run onboarding redesigned as an action-oriented journey

- Replaced the small welcome modal + 13-step driver.js spotlight tour
  with a 480px right-rail **OnboardingJourney** panel that walks new
  users through six concrete actions:
  1. Welcome to DataLex (two-line value prop)
  2. Connect your project (Git URL or local folder)
  3. Open the Validation drawer to see readiness gaps
  4. Click `+` to create a first logical / physical entity
  5. Add an LLM provider + API key
  6. Ask AI to draw a conceptual diagram (Conceptualizer)
- Each step has a primary CTA that opens the relevant dialog or
  activates the relevant panel and auto-advances when the underlying
  app event fires (`dbt:import:success`, `entity:created`,
  `ai:settings:saved`, `ai:conceptualize:applied`).
- Larger, more readable typography: 26-28px panel titles, 22px step
  titles, 15px / 1.7 body, 14px/600 CTA buttons at 10×18 padding,
  32px step-number badges with green checks on completion.
- Progress persists in `localStorage.datalex.onboarding.journey` —
  closing the panel preserves position; opening a fresh tab resumes
  at the next incomplete step. A floating "Onboarding · n/6" pill
  collapses the panel without dismissing it.
- The legacy 13-step driver.js spotlight tour stays available behind
  a new **Settings → "Deep feature tour"** button, and **"Replay
  onboarding"** restarts the journey.
- Bumped tour version so existing users see the new journey once.



Minor release — sharpens the dbt modeling moat. Closes the four
highest-leverage gaps competitors win on today (CI/CD enforcement,
non-model resource coverage, contracts, catalog export) and amplifies
the unique conceptual/logical AI surface.

### Added — Sharpen the dbt modeling moat (P0 + P1 + P2)

- **Shared `readiness_engine` package.** The dbt-readiness review (red /
  yellow / green) is extracted into a Python package
  (`packages/readiness_engine`) and shipped as `python -m
  datalex_readiness review`. The api-server now shells out instead of
  duplicating logic in JS, so CI / GitHub Action and `/api/dbt/review`
  share one source of truth.
- **`datalex readiness-gate` CLI + GitHub Action.** New CLI subcommand
  with `--min-score`, `--max-yellow`, `--max-red`, `--allow-errors`,
  `--changed-only`, `--base-ref`, `--sarif`, and `--pr-comment` flags.
  The composite Action under `actions/datalex-gate/` posts a sticky PR
  comment and uploads SARIF to the GitHub Security tab.
- **Doc-block round-trip preservation.** `dbt import → emit` now
  preserves `{{ doc("name") }}` references via a new
  `description_ref: { doc: <name> }` field. The doc-block index lives in
  `core_engine/dbt/doc_blocks.py`, is invalidated on YAML/`.md` writes,
  and is exposed via `GET /api/dbt/doc-blocks` and
  `datalex dbt docs reindex`.
- **Custom policy rules.** Three new rule types — `regex_per_layer`,
  `required_meta_keys`, and `layer_constraint` — plus selector support
  (`{ layer, tag, path_glob }`). Custom packs live under
  `<project>/.datalex/policies/` and inherit a built-in
  `datalex/standards/base.yaml`. Editable from the new **Policy Packs**
  drawer panel and `GET/PUT /api/policy/packs`.
- **Coverage of non-model dbt resources.** Snapshots, seeds, exposures,
  unit tests, and semantic models now round-trip through the importer
  and emit pipeline, and are scored by the readiness engine. New
  read-only **Snapshots**, **Exposures**, and **Unit Tests** drawer
  panels surface them inline. Source freshness without `loaded_at_field`
  is now flagged.
- **Doc-block-aware AI proposals.** `apply` rejects `patch_yaml` changes
  that would clobber a description bound via `description_ref` with a
  422 / `DOC_BLOCK_OVERWRITE` envelope. The AI retrieval index resolves
  doc-block bodies on the fly so BM25 ranks columns by their full prose,
  not the literal jinja string.
- **Contracts & constraints.** New policies `require_contract` and
  `require_data_type_when_contracted`, a pre-flight check on
  `/api/forward/dbt-sync` (returns 409 / `CONTRACT_PREFLIGHT` when
  contract-enforced models have unknown column types), and a bulk-toggle
  endpoint `POST /api/model/contracts/enforce`. The entity inspector now
  shows a contract toggle with a live blocker list of columns missing
  `data_type`.
- **Glossary ↔ column binding + catalog export.** Columns can now declare
  `binding: { glossary_term, status }` (legacy `terms: [...]` and
  `meta.glossary_term` are still accepted). New exporters for Atlan,
  DataHub, and OpenMetadata under
  `packages/core_engine/src/datalex_core/exporters/`, surfaced through
  `datalex emit catalog --target ...` and `POST /api/export/catalog`.
- **AI agents that operate above the SQL line.** Two new deterministic
  agents:
  - **Conceptualizer** (`POST /api/ai/conceptualize`) — clusters staging
    columns into business entities + relationships, with smart domain
    inference and FK extraction from dbt `relationships` tests.
  - **Canonicalizer** (`POST /api/ai/canonicalize`) — promotes columns
    that recur across staging models into a logical canonical entity
    with shared `{% docs %}` blocks emitted alongside the YAML.
  Both are surfaced from the entity inspector empty state and ship as
  proposal changes through the existing `/api/ai/proposals/apply` flow.

## [1.3.7] - 2026-04-26

Patch release - fixes the Docker and local install onboarding path.

### Fixed

- **Docker project auto-attach self-heals stale project registry files.**
  `datalex serve --project-dir ...` now always registers the served
  folder, even when an existing `.dm-projects.json` contains host paths
  that are not visible inside a Docker container.
- **`datalex-cli[serve]` uses the portable Node package that actually
  publishes current Node wheels.** The `serve` extra now depends on
  `nodejs-wheel` and the CLI can find a venv-local `node` executable.

## [1.3.6] - 2026-04-26

Patch release - publishes the simplified replayable onboarding tour to
PyPI.

### Changed

- **Onboarding now starts lighter and teaches step by step.** The first
  welcome modal now says "Welcome to DataLex" with a short product goal,
  while the shared first-run/replay tour walks through the dbt problem,
  the DataLex solution, import, readiness review, modeling layers,
  validation, AI proposals, and reviewed YAML changes.

## [1.3.5] - 2026-04-26

Patch release - adds dbt readiness review and clearer onboarding for
AI-ready analytics modeling.

### Added

- **dbt readiness review for imported projects.** DataLex now scores
  imported dbt/DataLex YAML files red, yellow, or green across metadata,
  dbt quality, modeling, governance, import health, and enterprise
  modeling opportunities. Reviews run after edit-in-place dbt import and
  can be rerun from Explorer or Validation.
- **File-level readiness guidance.** Explorer shows readiness badges on
  YAML files, the import report summarizes readiness counts, and the
  Validation panel shows the active file's findings with rationale,
  suggested YAML fixes, and Ask AI handoff.

### Changed

- **First-run onboarding now explains the product problem first.** The
  welcome flow now frames DataLex around scattered business meaning,
  weak dbt metadata, governance gaps, and AI/semantic answer quality
  before walking users through import, modeling layers, validation, AI
  proposals, and Git review.

## [1.3.4] - 2026-04-25

Patch release - fixes the PyPI `datalex serve` bundle and clarifies the
supported install paths for new users.

### Fixed

- **PyPI wheel now ships the full API server runtime.** The release
  workflow now bundles `packages/api-server/ai/*.js` alongside
  `index.js`, fixing `ERR_MODULE_NOT_FOUND` for
  `datalex_core/_server/ai/providerMeta.js` during `datalex serve`.
- **Docker image build path is corrected.** The Dockerfile now copies
  the checked-in `datalex` CLI shim and sets `DM_CLI` explicitly.
- **Source checkout serving bootstraps API dependencies.** A fresh clone
  can run `datalex serve` without first knowing that
  `packages/api-server` needs `npm install`.

### Changed

- **Onboarding docs now separate three paths:** PyPI install for normal
  users, source checkout for contributors, and Docker as an optional
  fallback for locked-down machines or Python/Node version drift.
- **Jaffle-shop docs now use the DataLex-ready example repo.** The
  getting-started guide, walkthrough, import example, and contributor
  E2E notes point to `duckcode-ai/jaffle-shop-DataLex` instead of the
  generic starter repo.

## [1.3.0] — 2026-04-24

Minor release — adds the first production-oriented agentic modeling
workflow for dbt teams. Ask AI can now use local project context,
skills, memory, and typed dbt/DataLex search to explain models and
propose reviewable YAML changes.

### Added

- **Agentic modeling assistant.** The right-panel AI chat now supports
  OpenAI, Anthropic Claude, Gemini, Ollama-compatible endpoints, and a
  local fallback. Requests are routed to modeling specialists for
  conceptual architecture, logical modeling, physical/dbt development,
  governance review, relationship modeling, and YAML patching.
- **Typed local AI index for dbt/DataLex projects.** Importing a dbt repo
  automatically indexes DataLex YAML, dbt YAML, SQL files, manifest,
  catalog, semantic manifest, run results, validation findings, skills,
  and memory. Retrieval uses structured lookup plus BM25 lexical search
  instead of vector search for code/YAML.
- **Project-local skills and memory.** The UI can create
  `DataLex/Skills/*.md` files with `use_when`, tags, layers, and agent
  modes. Chat history and modeling memory are stored locally under
  `.datalex/agent/` with JSON plus optional SQLite runtime storage.
- **Reviewable AI proposal flow.** AI responses can include structured
  YAML proposals, validation, and apply actions. The new **Review plan**
  button opens the full answer, sources, agents, skills, validation
  impact, and change JSON in the center editor before applying.
- **Contextual Ask AI entry points.** The assistant is available from the
  canvas, right inspector, Explorer files/folders, validation rows,
  selected text, relationships, and selected entities.

### Changed

- **AI chat behaves like a normal chat composer.** `Enter` submits,
  `Shift+Enter` adds a newline, and a small animated status line shows
  what the model is doing while it retrieves context and prepares a
  response.
- **Chat history restores AI result context for new chats.** Opening a
  saved chat now restores sources, agent details, selected skills,
  memory, proposed changes, and the Review plan content when that
  metadata exists.
- **Docs now describe installation, AI setup, skills, local indexing,
  proposal review, and repo import behavior.**

## [1.2.0] — 2026-04-24

Minor release — turns the open-source modeling loop into a clearer
three-layer workbench and cleans up the package/docs path for first-time
users.

### Added

- **Conceptual, logical, and physical now behave like separate modeling
  modes.** Conceptual relationships are entity-level with business
  wording, logical mode has its own entity/details flow, and physical
  mode gets a dbt-YAML picker plus direct drag/drop from the Explorer.
- **Physical dbt import is now discoverable in the UI.** Empty physical
  diagrams show an explicit import/picker flow, and Explorer search +
  drag/drop make it practical to assemble a dbt-backed diagram without
  re-importing a whole repo every time.

### Changed

- **The canonical DataLex workspace is domain-first.** New assets now
  land under `DataLex/<domain>/<conceptual|logical|physical>/...`
  instead of splitting users between separate top-level `diagrams/` and
  `models/` trees.
- **Install and onboarding docs now match the shipped flow.** The PyPI
  README, quickstart, and example walkthroughs now show the current
  package install path, `datalex --version`, and the domain-first
  workspace layout users see in the Explorer.

### Fixed

- **Legacy path writers no longer create mixed folder layouts for new
  files.** Bootstrap scaffolding, physical dbt import, and diagram
  creation now normalize to the same workspace structure instead of
  recreating old `.../Logical`, `.../Physical/postgres`, or split
  diagram/model folders.

## [1.1.1] — 2026-04-22

Patch release — restores a standard CLI affordance that was missing from
the `1.1.0` parser.

### Fixed

- **`datalex --version` now works.** The top-level argparse parser now
  registers a `--version` flag and prints the installed `datalex-cli`
  package version instead of erroring out because a subcommand was
  required. When package metadata is unavailable in a source checkout,
  the CLI falls back to the repo `pyproject.toml` version so local-dev
  runs still behave sensibly.

## [1.1.0] — 2026-04-22

Minor release — the first post-`v1.0.6` workflow drop. This rolls up
the stabilization work already merged on `main` plus the follow-up dbt
import / jaffle-shop / local-E2E changes from this branch.

### Added

- **Autosave + optional auto-commit for project-backed dbt repos.**
  DataLex now debounces file saves in the workspace and can
  automatically create a git commit after a burst of edits when
  `autoCommit.enabled` is turned on in the project config.
- **Import Results panel + unresolved import warnings.** dbt imports now
  surface the sync report directly in the UI before opening the
  workspace, including manifest-only imports, unknown column types, and
  partially resolved relationships.
- **Atomic rename cascade across the project graph.** Renaming an entity
  now rewrites FK shorthands, relationship endpoints, indexes, and
  affected paths through one rollback-safe API instead of leaving the
  user to chase references manually.
- **Apply-to-warehouse dialog and promoted export actions.** The command
  palette can now open a DDL preview/apply flow, and PNG/SVG export is
  easier to reach from the diagram toolbar.
- **Local-dev Playwright E2E coverage against a real jaffle-shop
  checkout.** The new `packages/web-app/e2e/` suite exercises the
  import API and the smoke path of the real browser flow without adding
  that cost to CI.

### Changed

- **The canonical "try it" path now uses a real
  jaffle-shop checkout.** The bundled jaffle-shop fixture and the
  one-click demo affordance are gone; the import dialog now defaults to
  **Git URL**, points users at the public upstream repo, and keeps local
  folder import as the edit-in-place path.
- **Importing from Git or a local folder now lands on the report first,
  then opens the project on demand.** This makes missing warehouse
  metadata, collisions, and unresolved relationships visible before the
  user starts editing.
- **FK shape and diagram warnings are more consistent.** The frontend
  now canonicalizes `foreign_key` metadata to `{entity, field}`, marks
  unresolved relationships in the graph, and avoids a single malformed
  node blanking the whole canvas.
- **Contributor and onboarding docs now match the real shipped flow.**
  `README.md`, `docs/getting-started.md`,
  `docs/tutorials/jaffle-shop-walkthrough.md`, and `CONTRIBUTING.md`
  now describe cloning/importing a real dbt repo plus the local-only E2E
  workflow instead of the removed bundled demo path.

### Fixed

- **Cross-file edits repaint reliably after autosave.** Shape edits now
  bump the model-graph version so diagram state stays in sync after a
  debounced save or blur-triggered write.
- **Bad YAML writes fail as validation errors instead of poisoning the
  workspace state.** `PUT /api/files` now rejects parse/shape failures
  with a 422, which keeps broken bytes from silently persisting.

## [1.0.6] — 2026-04-21

Hotfix release — two correctness bugs users are hitting right now on the
path to open-source launch:

1. Cardinality arrow icons rendered the wrong direction on the legacy
   SVG canvas — selecting **one-to-many** produced a crow's-foot on the
   *one* side instead of the *many* side, and saving round-tripped the
   inverted value so the dropdown flipped to "many-to-one" on reload.
   Every ER diagram rendered by DataLex since v0.x was semantically
   misleading.
2. Importing a dbt repo silently dropped every column-level generic
   test — `relationships`, `not_null`, `unique`, `accepted_values` —
   because `manifest.py` only copied user-authored `tests:` from a prior
   DataLex doc and never parsed the dbt manifest's own test nodes. Users
   who ran `dm dbt import` on a repo with FK tests ended up with zero
   edges on the diagram even when `schema.yml` had full FK coverage.

Both are surgical fixes with new regression tests; the roadmap plan for
the full open-source launch (Phases 1–5: api-server test harness,
structured error envelopes, folder-aware file operations, diagram UX on
imported YAMLs, perf/a11y/docs/CI) follows in v1.1.

### Fixed

- **Cardinality semantics for `one_to_many` / `many_to_one` on the
  legacy canvas.** `cardinalityToEnds` in
  `packages/web-app/src/design/schemaAdapter.js` had the `one_to_many`
  and `many_to_one` switch branches literally swapped — so the crow's-
  foot glyph in `design/Canvas.jsx:drawEnd` ended up on the wrong side
  of the edge, and `design/inspector/RelationsView.jsx` re-derived the
  dropdown value from the already-inverted min/max and displayed the
  opposite cardinality after a reload. The fix swaps the branches back
  to textbook ERD semantics (`one_to_many` → from-side = 1, to-side =
  N), and also replaces the silent default-clause fallback (which used
  to pick a plausible-looking shape for any unknown string) with a
  `null` return + one-time `console.warn`. Downstream, `drawEnd` now
  renders a neutral edge (no crow's-foot, no "one" bar) when
  cardinality is unspecified, so an unknown value reads as
  "unspecified" instead of lying.
  - `packages/web-app/src/design/schemaAdapter.js` — corrected switch
    bodies + `null` default + warn helper.
  - `packages/web-app/src/design/Canvas.jsx:drawEnd` — early-return for
    unspecified cardinality.
  - Existing DataLex YAML files store `cardinality: one_to_many` as a
    string (not pre-computed ends) so no file migration is needed —
    the rendered glyph flips to the correct side on next reload.
- **dbt `relationships` / `not_null` / `unique` tests are now parsed
  on import.** `packages/core_engine/src/datalex_core/dbt/manifest.py`
  builds a test index from the manifest's top-level test nodes (keyed
  by `attached_node` + `column_name`, with a `depends_on` fallback for
  pre-1.5 dbt), and threads it through every column builder. Each
  matched column gets:
  - A `tests:` list in dbt-native shape (`"not_null"`,
    `{"relationships": {"to": "ref('customers')", "field": "id"}}`) so
    `dbt/emit.py` passes them through verbatim on save — round-trip
    becomes lossless.
  - DataLex-native shorthands (`foreign_key: {entity, field}`,
    `nullable: false`, `unique: true`) so the frontend schemaAdapter
    and the schema validation layer don't need to re-parse the
    `tests:` list at read time — FK edges render on the diagram
    immediately after import.
  - Prior user-authored shorthands are preserved: we never overwrite
    `foreign_key` / `nullable` / `unique` if the column already had
    them on a previous import.
  - Added integration test
    `test_import_parses_relationship_tests_into_foreign_key` covering
    the relationships + not_null path end-to-end.

## [1.0.5] — 2026-04-21

Patch release — closes the four gaps reported against v1.0.4. The fixes
that v1.0.4 shipped landed on `components/diagram/DiagramCanvas.jsx`
(ReactFlow), but the Shell still renders the legacy
`design/Canvas.jsx` (SVG) plus `design/inspector/ColumnsView.jsx`, so
none of it was visible in the actual product. v1.0.5 ports those
affordances onto the rendered canvas and inspector, and fixes the
Save All persistence bug that was dropping dirty tabs.

### Fixed

- **Save All now persists every dirty open tab, not just the active
  one.** `saveAllDirty` previously iterated `openTabs` with a no-op
  loop and only queued the `activeFile` path for writing — so edits
  you made on a file, then switched away from before pressing Save
  All, silently disappeared on reload. The loop now compares each
  tab's cached `content` against its `originalContent` and pushes
  every actually-dirty tab into the payload. On a successful write
  the cached `originalContent` is bumped to match `content`, so the
  dirty indicator collapses correctly.
  - `packages/web-app/src/stores/workspaceStore.js` — `saveAllDirty`
    loop + post-save tab reset.
- **Fit / Auto-layout / Export buttons in the canvas header now do
  something.** They were rendered without `onClick` wiring in
  `design/Canvas.jsx` since the original prototype port. The toolbar
  now calls a local `handleFit` that scrolls the `.canvas` viewport
  to the top-left of the tables' bounding box, plus `onAutoLayout`
  (ELK, respecting `manualPosition`) and `onExport` (opens the
  existing `exportDdl` modal). The zoom-bar's small Fit button
  shares the same handler.
  - `packages/web-app/src/design/Canvas.jsx` — button `onClick`
    handlers + `handleFit` implementation.
  - `packages/web-app/src/design/Shell.jsx` — passes
    `handleAutoLayout`, the export modal opener, and the new
    delete handlers into `<Canvas>`.

### Added

- **Keyboard Delete on the rendered SVG canvas.** Pressing Backspace
  or Delete with an entity or relationship selected now confirms and
  routes through the same YAML cascade (`deleteEntityDeep` /
  `deleteRelationship`) the command palette and Inspector already
  use. Ignored while typing in `input` / `textarea` / contentEditable
  so column-name edits in the inspector don't nuke the entity.
  - `packages/web-app/src/design/Canvas.jsx` — `keydown` effect.
  - `packages/web-app/src/design/Shell.jsx` —
    `handleDeleteRelationship` (resolves canvas rel `id` back to the
    YAML `name` before delegating to `yamlRoundTrip`).
- **"Add column" and "Delete column" in the rendered Columns
  inspector.** A `+ Add` action now sits in the "All columns"
  section header (and as the primary action in the empty state), and
  a red "Delete column" button joins "Rename across project…" in the
  Refactor row. Both wrap the existing `appendField` / `deleteField`
  helpers so the YAML write path is shared with the rest of the
  inspector.
  - `packages/web-app/src/design/inspector/ColumnsView.jsx` —
    `handleAddColumn` (invents a non-colliding `new_column` name and
    selects it after the write), `handleDeleteColumn` (confirm +
    move selection to a sibling).

## [1.0.4] — 2026-04-21

Patch release — closes two gaps reported against the v1.0.3 import flow:
deleting entities/relationships from the diagram canvas now has
first-class keyboard + Inspector affordances (not just the right-click
context menu), and dbt import picks up column types from
`target/catalog.json` when `manifest.json` doesn't carry `data_type`.

### Added

- **Keyboard delete on the diagram canvas.** Pressing Backspace or
  Delete on a selected entity or relationship now routes through
  `onBeforeDelete` to show a confirm prompt, then emits the same
  `dl:entity:delete` / `dl:relationship:delete` CustomEvents the
  right-click menu uses — so the YAML mutation lives in one code path
  regardless of how the user triggered it. Annotation and group nodes
  still delete silently (no YAML side effect).
  - `packages/web-app/src/components/diagram/DiagramCanvas.jsx` —
    `onBeforeDelete` / `onNodesDelete` / `onEdgesDelete`.
- **"Delete entity" and "Delete relationship" buttons in the
  Inspector.** A "Danger zone" section now surfaces a destructive
  button in both the Entity and Relationship inspectors, using the
  same confirm-and-dispatch pattern as the canvas shortcut. Hidden
  when the workspace is read-only.
  - `packages/web-app/src/components/inspectors/EntityInspector.jsx`,
    `packages/web-app/src/components/inspectors/RelationshipInspector.jsx`.
- **dbt catalog.json type fallback.** `import_manifest` now accepts
  an optional `catalog_path` and uses it as a fallback when a column
  has no `data_type` in the manifest. This lets projects that run
  `dbt docs generate` (but not `dbt compile`) still import real
  warehouse types into DataLex. `sync_dbt_project` and
  `_cmd_dbt_import` auto-discover `target/catalog.json` alongside the
  manifest — missing catalog is fine; the importer silently falls
  through to the existing "prior type → unknown" chain.
  - New `packages/core_engine/src/datalex_core/dbt/catalog.py`
    (`load_catalog`, `CatalogIndex`, `default_catalog_path`).
  - Type precedence in both model and source column builders:
    manifest `data_type` → catalog `type` → prior user-authored
    type → `"unknown"` sentinel.

## [1.0.3] — 2026-04-21

Patch release — fixes the post-dbt-import landing UX so users land on
a clean "build your first diagram" canvas instead of whichever source
file parses first.

### Changed

- **dbt import seeds an empty overview diagram.** `/api/dbt/import`
  now adds `datalex/diagrams/overview.diagram.yaml` (with
  `entities: []`) to the response tree whenever the import didn't
  already produce a `.diagram.yaml`. In edit-in-place mode the file
  is persisted to disk alongside the other imported YAMLs.
  - `packages/api-server/index.js` — tree-seed after `walk(outDir)`.
- **Both import loaders open the diagram first.** `loadDbtImportTree`
  and `loadDbtImportTreeAsProject` now pick a `.diagram.yaml` file as
  the default tab when one is present, falling back to the old
  staging → marts → anything ordering. The canvas opens empty with
  the Add Entities CTA front-and-center instead of rendering a dbt
  sources file's `tables:` list as if it were a diagram.
  - `packages/web-app/src/stores/workspaceStore.js`.
- **`.diagram.yaml` extension preserved** through the edit-in-place
  path rewrite (previously `.yaml → .yml` was applied globally and
  would have renamed any `.diagram.yaml` the importer produced).
  - Both `packages/api-server/index.js` (server-side rewrite on disk
    write) and `packages/web-app/src/stores/workspaceStore.js`
    (client-side `rewritePath` in `loadDbtImportTreeAsProject`).

## [1.0.2] — 2026-04-21

Patch release — reverts a shim-writer regression from v1.0.1 that
broke diagram creation for every pip-installed user.

### Fixed

- **`datalex/diagrams/` mkdir no longer collides with a file shim.**
  v1.0.1 added a "belt-and-suspenders" change that had the CLI write
  a file named `datalex` next to the project root in addition to the
  existing `dm` shim. But `<project>/datalex/` is the canonical folder
  DataLex uses for diagrams (`datalex/diagrams/*.diagram.yaml`), so
  the file shim blocked `mkdir datalex/diagrams` with `ENOTDIR` when
  the user clicked "new diagram". Fix: only write the `dm` shim; the
  api-server's `dmExec()` helper (fixed in v1.0.1) already handles
  the `datalex → dm → PATH` fallback without needing the file shim.
  - `packages/cli/src/datalex_cli/main.py` — shim-writer no longer
    creates a `datalex` file.
- **Self-heal on upgrade.** If a previous v1.0.1 `datalex serve`
  already wrote the stray file, the CLI now removes it on next start
  (only when it's the shim we wrote — never a real user folder).

## [1.0.1] — 2026-04-21

Patch release — fixes a launch-day regression where dbt project import
and connector pulls failed on any PyPI install because three api-server
subprocess sites bypassed the `dmExec` helper and hardcoded a path
(`<REPO_ROOT>/datalex`) that the CLI shim-writer never created.

### Fixed

- **dbt import / dbt sync / connector pull now work on pip-installed
  setups.** `/api/dbt/import`, `/api/forward/dbt-sync`, and
  `/api/connectors/pull/stream` now use the shared `dmExec()` resolver
  (which correctly falls back through `datalex` → `dm` → PATH) instead
  of `execFileSync(PYTHON, [join(REPO_ROOT, "datalex"), …])`. Symptom
  users saw: `python: can't open file '<project-dir>/datalex': [Errno 2]
  No such file or directory` when importing a jaffle-shop or any dbt
  folder from the UI.
  - `packages/api-server/index.js` — three call sites switched to
    `dmExec()`.
- **CLI writes both `dm` and `datalex` shims** next to the project
  directory on `datalex serve`, so older/cached api-server versions
  hitting the hardcoded path are also rescued.
  - `packages/cli/src/datalex_cli/main.py` — shim-writer loops over
    both names.

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

[Unreleased]: https://github.com/duckcode-ai/DataLex/compare/v1.5.0...HEAD
[1.5.0]: https://github.com/duckcode-ai/DataLex/compare/v1.4.1...v1.5.0
[1.4.1]: https://github.com/duckcode-ai/DataLex/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/duckcode-ai/DataLex/compare/v1.3.7...v1.4.0
[1.3.7]: https://github.com/duckcode-ai/DataLex/compare/v1.3.6...v1.3.7
[1.3.6]: https://github.com/duckcode-ai/DataLex/compare/v1.3.5...v1.3.6
[1.3.5]: https://github.com/duckcode-ai/DataLex/compare/v1.3.4...v1.3.5
[1.3.4]: https://github.com/duckcode-ai/DataLex/compare/v1.3.0...v1.3.4
[1.3.0]: https://github.com/duckcode-ai/DataLex/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/duckcode-ai/DataLex/compare/v1.1.1...v1.2.0
[1.1.1]: https://github.com/duckcode-ai/DataLex/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/duckcode-ai/DataLex/compare/v1.0.6...v1.1.0
[1.0.6]: https://github.com/duckcode-ai/DataLex/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/duckcode-ai/DataLex/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/duckcode-ai/DataLex/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/duckcode-ai/DataLex/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/duckcode-ai/DataLex/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/duckcode-ai/DataLex/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/duckcode-ai/DataLex/compare/v0.5.1...v1.0.0
[0.5.1]: https://github.com/duckcode-ai/DataLex/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/duckcode-ai/DataLex/compare/v0.4.2...v0.5.0
[0.4.2]: https://github.com/duckcode-ai/DataLex/compare/v0.4.1...v0.4.2
[0.4.1]: https://github.com/duckcode-ai/DataLex/compare/v0.4.0...v0.4.1
[0.4.0]: https://github.com/duckcode-ai/DataLex/compare/v0.3.4...v0.4.0
[0.3.4]: https://github.com/duckcode-ai/DataLex/compare/v0.3.3...v0.3.4
[0.3.3]: https://github.com/duckcode-ai/DataLex/compare/v0.3.2...v0.3.3
[0.3.2]: https://github.com/duckcode-ai/DataLex/compare/v0.3.1...v0.3.2
[0.3.1]: https://github.com/duckcode-ai/DataLex/compare/v0.3.0...v0.3.1
[0.3.0]: https://github.com/duckcode-ai/DataLex/compare/v0.2.3...v0.3.0
[0.2.3]: https://github.com/duckcode-ai/DataLex/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/duckcode-ai/DataLex/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/duckcode-ai/DataLex/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/duckcode-ai/DataLex/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/duckcode-ai/DataLex/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/duckcode-ai/DataLex/releases/tag/v0.1.0
