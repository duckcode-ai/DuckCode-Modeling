# DuckCodeModeling Architecture

## 1. System Overview
DuckCodeModeling is a YAML-first data modeling platform (Schema v2) with three runtime surfaces:
1. CLI (`dm`) for validation, linting, diffing, formatting, stats, policy checks, generation, and imports.
2. Core engine (`packages/core_engine`) for deterministic model processing.
3. Web UI (`packages/web-app`) for visual modeling, quality gate review, and change tracking.

## 2. Core Planes

### 2.1 Authoring Plane
- Source of truth: `*.model.yaml` files.
- Authoring channels:
  - direct YAML editing
  - visual node-focused property editing (round-trip into YAML)
- Workspace supports multi-file current/baseline comparisons.

### 2.2 Validation and Compile Plane
- Structural validation: JSON Schema v2 (`schemas/model.schema.json`).
- Semantic validation: duplicate names, PK rules (tables only — views/materialized_views/external_tables/snapshots exempt), reference integrity, index validation, glossary validation, deprecated field warnings, computed field checks, governance checks.
- Canonical compiler: deterministic ordering for entities/fields/relationships/indexes/glossary.
- Diff engine: change summary + breaking-change detection including index removal tracking.

### 2.3 Governance and Policy Plane
- Policy packs in YAML (`policies/*.policy.yaml`).
- Policy schema (`schemas/policy.schema.json`).
- Policy evaluation command: `dm policy-check`.
- CI gate can combine schema + semantic + policy enforcement.

### 2.4 Visualization Plane
- React Flow renderer for entity-relationship graph.
- View controls:
  - layout mode (`grid`, `layered`, `circle`)
  - density (`compact`, `normal`, `wide`)
  - scope filters (entity type, tag)
  - search/focus, edge style, field density, label toggles
- Property panel updates selected entity directly in YAML (safe subset).

### 2.5 Integration Plane
- Import:
  - SQL DDL -> YAML (`dm import sql`)
  - DBML -> YAML (`dm import dbml`)
- Generate:
  - SQL DDL (`dm generate sql --dialect postgres|snowflake|bigquery|databricks`)
  - dbt scaffold with v2 metadata (`dm generate dbt`)
  - metadata JSON export (`dm generate metadata`)
- Utilities:
  - Auto-format YAML to canonical style (`dm fmt`)
  - Model statistics (`dm stats`)

### 2.6 Advanced Import & Reverse Engineering Plane
- Enhanced SQL DDL importer (`dm_core/importers.py`): CREATE VIEW, CREATE MATERIALIZED VIEW, CREATE INDEX (unique detection), DEFAULT values, CHECK constraints, schema-qualified table names, foreign_key field flag.
- JSON Schema / OpenAPI importer: `$defs`, `definitions`, `components.schemas` → entities with type mapping, enum → CHECK, format detection (uuid, date-time, email, int64), nullable union types, custom extensions (x-sensitivity, x-subject-area).
- dbt manifest importer: models/seeds/snapshots → entities with materialized type mapping, column tests → PK/UQ/NN detection, sensitivity metadata, schema/database/tags, optional catalog.json for column types.
- Spark schema importer: StructType JSON files from `df.schema.json()`, Databricks catalog exports, and arrays of named table schemas. Type mapping for all Spark types including decimal, complex types (array/map/struct → json), metadata comments, and sensitivity.
- **Database connectors** (`dm_core/connectors/`): Pull schema directly from live databases via `information_schema` / catalog introspection.
  - PostgreSQL (`psycopg2`): tables, columns, PKs, FKs, unique constraints, indexes from `information_schema` + `pg_indexes`.
  - MySQL (`mysql-connector-python`): tables, columns (with PK/UNI from COLUMN_KEY), FKs, indexes from `information_schema`.
  - Snowflake (`snowflake-connector-python`): tables, columns, PKs via `SHOW PRIMARY KEYS`, FKs via `SHOW IMPORTED KEYS`.
  - BigQuery (`google-cloud-bigquery`): tables, columns, PKs, FKs from `INFORMATION_SCHEMA` views.
  - Databricks (`databricks-sql-connector`): tables via `SHOW TABLES`, columns via `DESCRIBE TABLE`, PKs/FKs from Unity Catalog `information_schema`.
  - Connector framework: `BaseConnector` ABC, `ConnectorConfig` dataclass, `ConnectorResult` with summary, driver check, table include/exclude filters, registry with `get_connector()` / `list_connectors()`.
- CLI commands:
  - `dm import sql <file>` — import SQL DDL
  - `dm import dbml <file>` — import DBML
  - `dm import spark-schema <file>` — import Spark schema JSON
  - `dm pull <connector>` — pull schema from a live database (postgres, mysql, snowflake, bigquery, databricks)
  - `dm connectors` — list available connectors and driver status
- Web UI: Import panel with drag-and-drop file upload, format auto-detection, and YAML preview.
- API server: `POST /api/import` endpoint for web UI file import.

### 2.7 Documentation & Data Dictionary Plane
- HTML data dictionary generator (`dm_core/docs_generator.py`): self-contained single-page site with entity catalog, field details, relationship map, indexes, glossary, data classifications, and client-side search.
- Markdown export for GitHub wiki / Confluence integration.
- Auto-changelog generation from semantic diffs between model versions.
- CLI commands:
  - `dm generate docs <model>` — generate HTML or Markdown data dictionary (`--format html|markdown`)
  - `dm generate changelog <old> <new>` — generate changelog from model diff
- Web UI: Dictionary panel with expandable entity cards, field tables, inline search across entities/fields/tags/glossary.

### 2.8 Multi-Model Resolution Plane
- Cross-file imports via `model.imports` with alias, entity filtering, and path resolution.
- Resolver (`dm_core/resolver.py`): recursive import resolution, cycle detection, duplicate entity warnings.
- Unified entity/relationship/index graph across all imported models.
- Project-level resolution: scan all `*.model.yaml` files in a directory.
- Project-level diff: compare two model directories for added/removed/changed models.
- CLI commands:
  - `dm resolve <model>` — resolve a single model and its imports
  - `dm resolve-project <dir>` — resolve all models in a project
  - `dm diff-all <old-dir> <new-dir>` — project-level semantic diff
  - `dm init --multi-model` — scaffold a multi-model project structure
- Web UI: Model Graph panel for visualizing cross-model dependencies and cross-model relationship badges in EntityPanel.
- API server: `/api/projects/:id/model-graph` endpoint for project-wide model dependency graph.

### 2.9 Web UI Enterprise Features Plane
- **Subject area grouping**: ELK layout groups entities by `subject_area` into compound nodes with color-coded dashed borders and labels. Toggle via toolbar button. 8 distinct color palettes for visual separation.
- **Enhanced entity nodes**: SLA indicator badge in entity header alongside subject area label. Full badge set: PK, FK, UQ, IDX, COMP, CHK, DEF, sensitivity, deprecated strikethrough.
- **Diagram export**: PNG export (2× pixel ratio) and SVG export via `html-to-image`. Download buttons in diagram toolbar.
- **Dark mode**: Full dark theme with CSS custom properties (`[data-theme="dark"]`). Toggle via Moon/Sun button in TopBar. Persisted to `localStorage`. Covers editor, diagram, panels, and all UI surfaces.
- **Schema-aware YAML autocomplete**: Context-sensitive completions for model keys, entity properties, field properties, types, cardinalities, states, sensitivity levels, and boolean values. Powered by CodeMirror `autocompletion` extension.
- **Inline validation errors**: Real-time lint diagnostics in the editor gutter via CodeMirror `linter` extension. Maps validation issues to source lines with error/warning severity markers.
- **Global search**: Bottom panel tab searching across entities, fields, tags, descriptions, and glossary terms. Category filter pills with counts. Click-to-navigate selects entity in diagram.
- **Diagram annotations**: Draggable sticky-note nodes with 5 color variants. Inline text editing, delete on hover. Added via toolbar "Note" button.
- **Keyboard shortcuts**: `⌘+S` save, `⌘+K` global search, `⌘+\` toggle sidebar, `⌘+J` toggle bottom panel, `⌘+D` toggle dark mode, `?` shortcuts panel. Full shortcuts reference modal with grouped categories.
- **Large model scaling (1000+ tables)**:
  - **Virtual rendering**: `onlyRenderVisibleElements` on React Flow — only DOM-renders nodes in viewport.
  - **Force layout**: Auto-switches ELK from `layered` to `force` algorithm for >200 nodes (O(n log n) vs O(n²)).
  - **Auto-tune**: Models with >100 entities auto-set to top-50 visible, keys-only fields, compact density, no edge labels.
  - **Compact dot mode**: >200 visible nodes render as 140px mini-cards (name + type badge + field/rel counts only).
  - **Schema overview mode**: New "Overview" view shows schemas/subject_areas as clickable summary cards with entity counts. Click to drill into a schema.
  - **Entity list panel**: Sidebar panel with searchable, sortable entity list. Click to select + center in diagram. Filter by schema, sort by name/fields/relationships.
  - **Large model banner**: Dismissible info bar with "Show All" and "Overview" quick actions.

### 2.10 Policy Engine & Governance Maturity Plane
- **Policy schema v2** (`schemas/policy.schema.json`): 10 policy types (4 original + 6 new), `pack.extends` for inheritance.
- **New policy types** (`dm_core/policy.py`):
  - `naming_convention` — Regex patterns for entity, field, relationship, and index names. Fullmatch validation with configurable patterns per object type.
  - `require_indexes` — Tables with ≥ N fields (default 5) must have at least one index. Configurable `min_fields` and `entity_types` filter.
  - `require_owner` — Every entity must have an `owner` field. Optional `require_email` validation and `entity_types` filter.
  - `require_sla` — Entities must define SLA with freshness/quality_score. Filterable by `entity_types` and `required_tags` (e.g. only GOLD-tagged tables).
  - `deprecation_check` — Deprecated fields must have `deprecated_message`. Optionally checks relationships and indexes for references to deprecated fields.
  - `custom_expression` — User-defined Python expressions evaluated against entity, field, or model context. Supports `{name}` message templates. Scopes: `entity`, `field`, `model`.
- **Policy inheritance** (`merge_policy_packs`, `load_policy_pack_with_inheritance`): Compose policy packs via `pack.extends` (string or array). Policies merged by `id` — later definitions override earlier ones. Transitive resolution supported.
- **CLI**: `dm policy-check --inherit` flag resolves `pack.extends` chain before evaluation.
- **CI integration templates** (`ci-templates/`):
  - `github-actions.yml` — GitHub Actions workflow: validate, policy-check, PR gate
  - `gitlab-ci.yml` — GitLab CI pipeline: validate, policy, gate stages
  - `bitbucket-pipelines.yml` — Bitbucket Pipelines: validate, policy, PR gate
  - `pr-comment-bot.yml` — GitHub Actions PR comment bot: auto-posts diff summary, validation results, policy results, and breaking change detection as a sticky PR comment

### 2.11 CLI & Developer Experience Plane
- **`dm doctor`** (`dm_core/doctor.py`): Project health diagnostics — checks schema files, policy schema, model files, policy packs, Python dependencies, CLI entry point, requirements.txt. Human-readable output with ✓/✗/! icons and summary. JSON output via `--output-json`.
- **`dm migrate`** (`dm_core/migrate.py`): SQL migration script generator between two model versions. Produces ALTER TABLE (ADD/DROP/ALTER COLUMN), CREATE TABLE, DROP TABLE, CREATE/DROP INDEX statements. Supports Postgres, Snowflake, BigQuery, Databricks dialects. Skips views, materialized views, external tables, snapshots. Version header in output. File output via `--out`.
- **`dm apply`** (`dm_cli/main.py`): Forward-engineering execution command for Snowflake, Databricks, and BigQuery. Supports `--sql-file` or `--old/--new` migration generation, `--dry-run`, policy preflight checks, destructive-change guardrails, migration ledger writes, and JSON execution reports. In product mode this is intended for CI/CD runners, not interactive UI apply.
- **`dm completion`** (`dm_core/completion.py`): Shell completion generators for bash, zsh, and fish. Covers all commands, subcommands (generate/import), dialects, and file type filters. Usage: `eval "$(dm completion bash)"`.
- **`dm watch`**: File watcher that polls for `*.model.yaml` changes and runs schema + semantic validation on each change. Configurable glob pattern and poll interval. Zero-dependency (uses `stat()` polling).
- **JSON output**: `--output-json` flag on `doctor`, `stats`, `policy-check`, `gate`, `diff`, `diff-all`, `resolve`, `resolve-project` commands.

### 2.12 Forward Engineering API
- `POST /api/forward/generate-sql` -> wraps `dm generate sql`
- `POST /api/forward/migrate` -> wraps `dm migrate`
- `POST /api/forward/apply` -> wraps `dm apply` for Snowflake/Databricks/BigQuery (disabled by default; enable with `DM_ENABLE_DIRECT_APPLY=true`)
- `POST /api/git/branch/create` -> create/checkout feature branch in project repo
- `POST /api/git/push` -> push branch to remote origin
- `POST /api/git/github/pr` -> open GitHub pull request from feature branch to base branch

## 3. End-to-End Data Flow
1. User edits/imports YAML (single or multi-model project).
2. CLI/UI runs structural + semantic checks.
3. For multi-model projects, resolver builds unified graph from imports.
4. Canonical model is compiled for deterministic diff and generation.
5. Policy pack is evaluated for governance rules.
6. Outputs:
   - UI diagram + gate report (with cross-model annotations)
   - SQL/dbt/metadata artifacts
   - CI pass/fail result
   - Project-level diff reports

## 4. Non-Enterprise Prototype Boundaries
Excluded in this prototype scope:
- SSO/OIDC/SAML
- RBAC and workspace isolation services
- audit log service and approval workflow backend

These remain for the enterprise platform phase.
