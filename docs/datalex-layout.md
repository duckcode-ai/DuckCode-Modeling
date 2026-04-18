# DataLex project layout

Every DataLex project is a directory tree with one YAML file per object. The
file's `kind:` key dispatches it to the right parser. This page is the
reference for what each `kind:` looks like and how the loader discovers them.

> **Migrating from v1/v2 `*.model.yaml`?** Use `datalex datalex migrate
> to-datalex-layout path/to/legacy.model.yaml` to explode a legacy file into
> this layout. See also [archive/yaml-spec-v2.md](./archive/yaml-spec-v2.md).

## Shape of a project

```text
my-project/
  datalex.yaml                         # kind: project
  models/
    conceptual/customer.yaml           # kind: entity, layer: conceptual
    logical/customer.yaml              # kind: entity, layer: logical
    physical/postgres/customer.yaml    # kind: entity, layer: physical
  sources/
    jaffle_shop_raw.yaml               # kind: source  (imported via dbt sync)
  models/dbt/
    stg_customers.yaml                 # kind: model   (imported via dbt sync)
  glossary/
    customer.yaml                      # kind: term
  domains/
    sales.yaml                         # kind: domain
  policies/
    require_owner.yaml                 # kind: policy
  .datalex/
    snippets/audit_columns.yaml        # kind: snippet
    lock.yaml                          # package lockfile (from resolve)
```

All paths are discoverable via globs configured in `datalex.yaml`; defaults
match the tree above.

## `kind: project` — the manifest

`datalex.yaml` at the root declares the project and optional globs/imports.

```yaml
kind: project
name: my_project
version: '1'
dialects: [postgres, snowflake]
default_dialect: postgres
# Optional globs — defaults shown
# models:    models/**/*.yaml
# sources:   sources/**/*.yaml
# glossary:  glossary/**/*.yaml
# snippets:  .datalex/snippets/**/*.yaml
# policies:  policies/**/*.yaml
imports:
  - package: acme/warehouse-core@1.4.0
    git: https://github.com/acme/warehouse-core.git
    ref: v1.4.0
    alias: wc
```

Schema: [`schemas/datalex/project.schema.json`](../schemas/datalex/project.schema.json).

## `kind: entity` — tables and views in three layers

Entities come in three `layer:` values that you may use independently or as a
traceable conceptual → logical → physical chain.

```yaml
kind: entity
layer: physical
dialect: postgres
name: customer
physical_name: dim_customer      # optional override for DDL
logical: customer                # optional back-reference to logical layer
description: One row per customer.
owner: growth
domain: sales
tags: [core, pii]
columns:
  - name: id
    type: bigint
    constraints: [{type: primary_key}]
  - name: email
    type: string(255)
    nullable: false
    sensitivity: pii
  - name: home_region_id
    type: int
    references:
      entity: region
      column: id
indexes:
  - name: idx_customer_email
    columns: [email]
    unique: true
```

Notable fields:

- `previous_name:` — explicit rename tracking; `datalex datalex diff` prefers
  explicit renames over heuristics.
- `physical:` on a column — per-dialect type overrides:
  ```yaml
  - name: body
    type: string
    physical:
      snowflake: { type: VARCHAR(16777216) }
      postgres:  { type: text }
  ```
- `raw_ddl:` — preserved for vendor-specific hints emitters can't round-trip.
- `meta.datalex.*` — emitter-owned namespace; user `meta` fields anywhere
  else are preserved across import/emit.

Schema: [`schemas/datalex/entity.schema.json`](../schemas/datalex/entity.schema.json).

## `kind: source` — external data (dbt sources)

One file per dbt source group, with nested tables:

```yaml
kind: source
name: jaffle_shop_raw
database: warehouse
schema: main
tables:
  - name: raw_customers
    description: Raw customer feed.
    columns:
      - name: id
        type: bigint
        nullable: false
        description: Primary key.
      - name: email
        type: string
    meta:
      datalex:
        dbt:
          unique_id: source.jaffle_shop.jaffle_shop_raw.raw_customers
```

Populated by `datalex datalex dbt sync`; emitted back to `sources.yml` by
`datalex datalex dbt emit`.

Schema: [`schemas/datalex/source.schema.json`](../schemas/datalex/source.schema.json).

## `kind: model` — derived tables (dbt models)

```yaml
kind: model
name: stg_customers
materialization: view
description: Staged customers, one row per customer.
depends_on:
  - source: {source: jaffle_shop_raw, name: raw_customers}
columns:
  - name: customer_id
    type: bigint
    description: Unique customer identifier.
    tests: [unique, not_null]
```

Emits with `contract.enforced: true` when the DataLex columns carry
`data_type`, so `dbt parse` passes without edits.

Schema: [`schemas/datalex/model.schema.json`](../schemas/datalex/model.schema.json).

## `kind: term` — glossary entries

```yaml
kind: term
name: customer
definition: A person or organization that has placed at least one order.
synonyms: [buyer, account]
steward: growth
```

Columns reference terms via `terms: [term:customer]`. Terms are loaded
independently of entities, so you can build the glossary incrementally.

## `kind: domain` — subject-area grouping

```yaml
kind: domain
name: sales
description: Everything orders, revenue, and pipeline.
entities: [customer, order, invoice]
color: "#3b82f6"
```

Drives grouping in the UI and per-domain batch exports.

## `kind: policy` — governance rules

```yaml
kind: policy
name: require_owner
rule: require_owner
severity: error
applies_to: [entity]
```

The validator enforces policies during `datalex datalex validate`. See
[governance-policy-spec in archive](./archive/governance-policy-spec.md) for
rule semantics (still accurate; the wrapper changed, the rules didn't).

## `kind: snippet` — reusable fragments

```yaml
kind: snippet
name: audit_columns
description: Standard created_at / updated_at columns.
targets: [entity]
apply:
  columns:
    - name: created_at
      type: timestamp
      default: now()
    - name: updated_at
      type: timestamp
```

Entities opt in via `columns: - use: audit_columns`. Preview the expanded
output with `datalex datalex expand <root>`.

Schema: [`schemas/datalex/snippet.schema.json`](../schemas/datalex/snippet.schema.json).

## How the loader works

1. Reads `datalex.yaml` for the project manifest and glob overrides.
2. Resolves imports (see [Cross-repo imports](#cross-repo-imports) below).
3. Walks each configured glob, streaming one file at a time (no
   whole-project `yaml.safe_load`).
4. Dispatches on `kind:` to the per-kind parser/validator.
5. Caches parsed docs by `sha256(content)` under `build/.cache/` or
   `~/.datalex/cache/` so unchanged files don't re-parse on the next run.

Errors carry `file`, `line`, `column`, and a `suggested_fix` where the
parser can produce one.

## Cross-repo imports

`imports:` in `datalex.yaml` lets one project consume another:

```yaml
imports:
  - package: acme/warehouse-core@1.4.0
    git: https://github.com/acme/warehouse-core.git
    ref: v1.4.0
    alias: wc
  - package: local/shared
    path: ../shared-models
```

`datalex datalex packages resolve` fetches, caches (under `~/.datalex/packages/`
by default), and writes a content-hashed lockfile at `.datalex/lock.yaml`.
Later loads reject drift unless you re-run with `--update`.

Imported entities are namespaced under their alias: `@wc.shared_dim`
resolves the imported `shared_dim` entity without colliding with a local
entity of the same name.

## Conventions

- **Names** match `^[a-z][a-z0-9_]*$` — snake_case identifiers.
- **Tags** match `^[a-z][a-z0-9-]*$` — kebab-case allowed.
- **`meta.datalex.*`** is owned by DataLex emitters/importers; never write
  into it by hand. Any other `meta.*` is yours and survives round-trip.

## See also

- [Tutorial: dbt sync in 5 minutes](./tutorial-dbt-sync.md)
- [CLI cheat sheet](./cli.md)
- [Architecture](./architecture.md)
- [JSON Schemas](../schemas/datalex/) — machine-readable reference
