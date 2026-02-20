# Data Standards (Snowflake + Databricks + dbt)

## Tech Stack Defaults
- Transformations: dbt (SQL-first)
- Warehouses: Snowflake, Databricks SQL (Unity Catalog)
- IaC: Terraform for roles, grants, warehouses, catalogs/schemas, service principals

## Naming Conventions (dbt)
- Models: snake_case
- Layers:
  - stg_<source>__<table>
  - int_<domain>__<purpose>
  - dim_<entity>
  - fct_<process>
- Columns:
  - snake_case
  - timestamps: *_at, *_ts
  - booleans: is_*, has_*
- Keep business logic deterministic: avoid non-deterministic functions unless explicitly needed.
- Prefer explicit casts for join keys and timestamp comparisons.

## SQL Style
- Prefer CTEs over nested subqueries.
- Avoid SELECT * in marts (allow in staging only with explicit star-expansion patterns).
- Always qualify ambiguous columns.
- Prefer explicit joins over implicit joins.

## Incremental Patterns
- dbt incremental should be deterministic and idempotent.
- Prefer merge-based incrementals with stable unique keys.
- For Snowflake: consider clustering keys for very large tables.
- For Databricks: consider partitioning + ZORDER where appropriate.
- Always document the unique_key and incremental predicate assumptions.

## Operational Defaults
- No hardcoded credentials.
- Prefer environment-specific configs (dev/stg/prod) via profiles/targets.
- When asked for commands, assume dbt unless user explicitly wants raw SQL runs.
