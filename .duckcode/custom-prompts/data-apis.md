# Data APIs (Data Products)

## Principles
- Prefer governed access via views/tables in Snowflake/Databricks over custom services when possible.
- If building an API, treat it like a product: versioned, documented schema, SLAs.

## Snowflake Patterns
- Prefer:
  - secure views
  - shares (Snowflake Secure Data Sharing)
  - UDFs / external functions only when needed

## Databricks Patterns
- Prefer:
  - Databricks SQL endpoints
  - Delta Sharing for external consumers
  - Views in Unity Catalog with grants

## Output Expectations (when asked to design an API)
- Endpoint definition
- Request/response schema
- AuthN/AuthZ model (roles/scopes)
- Data freshness + caching strategy
- Versioning strategy (how breaking changes are handled)
- Observability (logging, query auditing, lineage pointers)
