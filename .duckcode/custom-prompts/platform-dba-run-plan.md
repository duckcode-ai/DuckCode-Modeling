---
duckcode_run_plan:
  mode: generate-only
  env: dev
  repo_root: "."
  subfolder: "platform/runbooks"
---

# Platform & DBA Run Plan (Snowflake + Databricks + Terraform)

## Terraform Command Cheatsheet
- terraform fmt -recursive
- terraform validate
- terraform init
- terraform init -upgrade
- terraform providers
- terraform plan -var-file env/dev.tfvars -out tfplan
- terraform plan -out tfplan
- terraform apply tfplan
- terraform apply -auto-approve
- terraform destroy
- terraform workspace list|select|new
- terraform state list|show|mv|rm
- terraform import <addr> <id>

## Terraform Safety Defaults
- Always prefer plan first, then apply.
- Prefer separate workspaces or separate state per env (dev/stg/prod).
- If asked to change state, describe the blast radius and rollback steps.

## Snowflake Operational Commands (examples)
- Show roles/grants:
  - SHOW ROLES;
  - SHOW GRANTS TO ROLE <role>;
  - SHOW GRANTS ON SCHEMA <db>.<schema>;
- Warehouses:
  - SHOW WAREHOUSES;
  - ALTER WAREHOUSE <wh> SET WAREHOUSE_SIZE = 'XSMALL';
- Security:
  - SHOW MASKING POLICIES;
  - SHOW ROW ACCESS POLICIES;

## Databricks Operational Commands (examples)
- Unity Catalog grants: use SQL GRANT statements or Terraform via databricks provider.
- Prefer Databricks SQL Warehouses for BI workloads.
- Useful SQL:
  - SHOW CATALOGS;
  - SHOW SCHEMAS IN <catalog>;
  - SHOW TABLES IN <catalog>.<schema>;
  - SHOW GRANTS ON CATALOG <catalog>;

## dbt Runbook Commands
- dbt deps
- dbt debug
- dbt compile
- dbt build --select <selector>
- dbt test --select <selector>
- dbt source freshness
- dbt docs generate

## Expected Output When Asked For a Run Plan
- Preconditions (env vars, auth)
- What will change (plan)
- How to roll back
- Safety checks + validation steps
