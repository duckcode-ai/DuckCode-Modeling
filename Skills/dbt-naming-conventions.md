---
name: "dbt Naming Conventions"
description: "Project-wide dbt model and field naming rules. Used by the physical_dbt_developer and yaml_patch_engineer agents."
use_when:
  - "naming"
  - "rename"
  - "model name"
  - "column name"
  - "convention"
tags:
  - "naming"
  - "dbt"
  - "convention"
layers:
  - "physical"
agent_modes:
  - "physical_dbt_developer"
  - "yaml_patch_engineer"
  - "governance_reviewer"
priority: 4
---

# dbt Naming Conventions

Hard rules. Apply consistently across every model the agent proposes.

## Model name prefixes

- `stg_<source>__<entity>` — staging layer (one-to-one with a source table). Double underscore separates source from entity.
- `int_<purpose>` — intermediate transformations between staging and marts.
- `dim_<entity>` — dimensions in the marts layer.
- `fct_<event>` — fact tables capturing measurable business events.
- `agg_<grain>__<measure>` — aggregations / rollups.
- `bdg_<left>__<right>` — bridge tables for many-to-many.

Anything outside these prefixes needs an explicit reason in the proposal's `rationale`.

## Field name suffixes

- `_id` — natural / source-system identifier (string or integer from the source).
- `_pk` — primary key on the model (often a hash or surrogate).
- `_fk` — foreign key reference into another model.
- `_sk` — surrogate key.
- `_at` — UTC timestamp (datetime / timestamp_ntz).
- `_date` — calendar date without time.
- `_amount`, `_count`, `_pct` — numeric measures with implied units.
- `is_*`, `has_*` — boolean flags. Always not-null with a clear false default.

## General

- **snake_case** for: column / field names, dbt model file slugs, file paths, YAML keys, metric names, glossary term names. Never camelCase here.
- **PascalCase** for: DataLex `entities[].name` on logical and physical layers (these become dbt model class identifiers and CI artifact names — `SalesOrder` not `sales_order`).
- **Human names** (with spaces, capitals, punctuation) for: conceptual `entities[].name` when `type: concept`. The Validation panel suppresses `INVALID_ENTITY_NAME` for these in v1.7.2+ — names like "Sales Order", "Loyalty Program" are intentional.
- Plural for source tables (`raw.customers`), singular for dimensions (`dim_customer`). dbt convention varies — pick one per project and stay consistent.
- No abbreviations a new hire would miss (`cust`, `ord`, `usr` → `customer`, `order`, `user`).
