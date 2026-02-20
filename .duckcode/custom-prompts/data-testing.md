# Data Testing (dbt)

## Default dbt Test Strategy
- Always test:
  - not_null + unique on primary keys
  - relationships for core foreign keys
  - accepted_values for small enums
- Add freshness checks for critical sources.

## Commands (local)
- dbt deps
- dbt ls
- dbt compile
- dbt seed
- dbt snapshot
- dbt build
- dbt test
- dbt source freshness
- dbt docs generate
- dbt docs serve

## Common Selection Patterns
- Build a model and its parents/children:
  - dbt build --select +fct_orders+
- Run only critical tests:
  - dbt test --select tag:critical
- Exclude expensive tests:
  - dbt test --exclude tag:expensive
- Fail fast when debugging:
  - dbt build --fail-fast

## CI / Slim CI (preferred)
- Use state-based selection when possible:
  - dbt build --select state:modified+ --defer --state <path_to_state>
- Use selectors to keep CI fast and targeted.
- Recommended CI order:
  - dbt deps
  - dbt build --select state:modified+ --defer --state <path_to_state>
  - dbt source freshness (for critical sources)

## Warehouse-Specific Notes
- Snowflake: watch warehouse sizing and concurrency; avoid long-running tests in shared warehouses.
- Databricks: tests run on SQL warehouse / cluster; watch cost + compute sizing.
