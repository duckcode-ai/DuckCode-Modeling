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
