# Integration Contracts (Prototype)

## 1. Scope
The prototype exposes integration contracts through CLI commands rather than a hosted API service.

## 2. Import Contracts

### 2.1 SQL Import
Command:
```bash
dm import sql <schema.sql> --out imported.model.yaml
```
Contract:
1. Input: SQL DDL with `CREATE TABLE` statements.
2. Output: YAML model conforming to `schemas/model.schema.json`.
3. Relationship mapping: FK -> one-to-many relationship.

### 2.2 DBML Import
Command:
```bash
dm import dbml <schema.dbml> --out imported.model.yaml
```
Contract:
1. Input: DBML table/ref declarations.
2. Output: YAML model conforming to `schemas/model.schema.json`.

## 3. Generation Contracts

### 3.1 SQL DDL Generation
```bash
dm generate sql model.yaml --dialect postgres --out model.sql
```
Output:
- SQL create table statements
- FK constraints derived from relationships

### 3.2 dbt Scaffold Generation
```bash
dm generate dbt model.yaml --out-dir ./dbt
```
Output files:
1. `dbt_project.yml`
2. `models/staging/*.sql`
3. `models/staging/schema.yml`
4. `models/sources.yml`

### 3.3 Metadata Export
```bash
dm generate metadata model.yaml --out metadata.json
```
Output:
- canonical model metadata JSON for external system ingestion.

### 3.4 Migration SQL Generation
```bash
dm migrate old.model.yaml new.model.yaml --dialect snowflake --out migration.sql
```
Output:
- ordered migration SQL (CREATE/DROP/ALTER/INDEX)
- header with model version transition and dialect

### 3.5 Apply to Warehouse (Forward Engineering)
```bash
# Optional direct apply command (typically CI/CD-only)
dm apply snowflake --sql-file migration.sql --dry-run
```
Output:
- execution summary (statement count, migration name, checksum)
- optional migration ledger entry in `duckcodemodeling_migrations`
- in product mode, apply is expected through Git-hosted CI/CD pipelines

## 5. Local API Contracts (Forward Engineering)

### 5.1 Generate SQL
`POST /api/forward/generate-sql`
- body: `{ model_path, dialect, out? }`

### 5.2 Generate Migration SQL
`POST /api/forward/migrate`
- body: `{ old_model, new_model, dialect, out? }`

### 5.3 Apply SQL / Migration
`POST /api/forward/apply`
- disabled by default in product GitOps mode
- enable only with env: `DM_ENABLE_DIRECT_APPLY=true`
- when enabled, body supports exactly one input mode:
  - `{ connector, dialect?, sql_file, ...connectionParams }`
  - `{ connector, dialect?, sql, ...connectionParams }`
  - `{ connector, dialect?, old_model, new_model, model_schema?, ...connectionParams }`
- options: `dry_run`, `skip_ledger`, `ledger_table`, `migration_name`, `allow_destructive`
- policy preflight: `policy_pack`, `skip_policy_check` (model-diff mode)
- observability/artifacts: `output_json`, `report_json`, `write_sql`


### 5.4 GitOps Automation Endpoints
- `POST /api/git/branch/create`
  - body: `{ projectId, branch, from? }`
  - creates branch or checks out existing branch
- `POST /api/git/push`
  - body: `{ projectId, branch?, remote?, set_upstream? }`
  - pushes branch to remote (defaults to `origin`)
- `POST /api/git/github/pr`
  - body: `{ projectId, token, title, body?, base?, head?, draft? }`
  - opens a GitHub pull request using the project remote

## 4. Quality Contracts

### 4.1 Validation
```bash
dm validate model.yaml
```
Exit codes:
1. `0`: pass
2. `1`: validation errors

### 4.2 Policy Check
```bash
dm policy-check model.yaml --policy policies/default.policy.yaml
```
Exit codes:
1. `0`: no error-severity policy violations
2. `1`: policy errors or invalid model/policy pack

### 4.3 Gate
```bash
dm gate old.yaml new.yaml
```
Exit codes:
1. `0`: pass
2. `1`: validation failure
3. `2`: breaking changes (without override)
