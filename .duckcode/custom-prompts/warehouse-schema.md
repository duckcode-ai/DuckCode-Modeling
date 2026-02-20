# Warehouse Schema Standards

## Snowflake
- Databases: <ENV>_<DOMAIN> (example: PROD_FINANCE)
- Schemas: STAGING, INTERMEDIATE, MARTS (or domain-based)
- Prefer secure views for governed sharing.
- Use masking policies / row access policies for sensitive data.

## Databricks (Unity Catalog)
- Catalogs: <env>_<domain> (example: prod_finance)
- Schemas: staging / intermediate / marts
- Tables: Delta tables with explicit partitions where justified.

## Dimensional Modeling (dbt)
- dim_* and fct_* naming
- Always define grain explicitly
- Prefer surrogate keys where multiple sources exist
- Prefer a stable primary key (unique + not_null) and define it in schema.yml tests.
- For surrogate keys in dbt, prefer a consistent hashing approach (team standard macro).

## Cross-Platform Guardrails
- Avoid vendor-specific SQL in marts unless required; isolate platform-specific logic in staging/intermediate.
- Document any Snowflake-only or Databricks-only behavior in model docs.
- Keep dbt model materializations explicit (view/table/incremental) and environment-aware.
