# Data Security (Snowflake + Databricks)

## Classification
- PII: names, emails, phone, address, identifiers
- Sensitive: financial, HR, credentials, tokens

## Snowflake Controls
- Use roles (RBAC) and least privilege.
- Use masking policies + row access policies for sensitive data.
- Use separate warehouses by workload (bi, etl, ad_hoc).

## Databricks Controls
- Unity Catalog grants for catalogs/schemas/tables/views.
- Use service principals for automation.
- Use secrets scopes for credentials.

## Terraform Expectations
- Prefer Terraform-managed roles/grants (repeatable, reviewable).
- Do not suggest manual grants as the final answer unless asked.
- For Snowflake Terraform, assume role-based grants (no direct user grants) unless user asks.
- For Databricks Terraform, assume Unity Catalog grants and service principals.
