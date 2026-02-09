# DataLex Architecture (Prototype MVP)

## 1. System Overview
DataLex is a YAML-first data modeling platform with three runtime surfaces:
1. CLI (`dm`) for validation, linting, diffing, policy checks, generation, and imports.
2. Core engine (`packages/core_engine`) for deterministic model processing.
3. Web UI (`packages/web-app`) for visual modeling, quality gate review, and change tracking.

## 2. Core Planes

### 2.1 Authoring Plane
- Source of truth: `*.model.yaml` files.
- Authoring channels:
  - direct YAML editing
  - visual node-focused property editing (round-trip into YAML)
- Workspace supports multi-file current/baseline comparisons.

### 2.2 Validation and Compile Plane
- Structural validation: JSON Schema (`schemas/model.schema.json`).
- Semantic validation: duplicate names, PK rules, reference integrity, governance checks.
- Canonical compiler: deterministic ordering for entities/fields/relationships.
- Diff engine: change summary + breaking-change detection.

### 2.3 Governance and Policy Plane
- Policy packs in YAML (`policies/*.policy.yaml`).
- Policy schema (`schemas/policy.schema.json`).
- Policy evaluation command: `dm policy-check`.
- CI gate can combine schema + semantic + policy enforcement.

### 2.4 Visualization Plane
- React Flow renderer for entity-relationship graph.
- View controls:
  - layout mode (`grid`, `layered`, `circle`)
  - density (`compact`, `normal`, `wide`)
  - scope filters (entity type, tag)
  - search/focus, edge style, field density, label toggles
- Property panel updates selected entity directly in YAML (safe subset).

### 2.5 Integration Plane
- Import:
  - SQL DDL -> YAML (`dm import sql`)
  - DBML -> YAML (`dm import dbml`)
- Generate:
  - SQL DDL (`dm generate sql`)
  - dbt scaffold (`dm generate dbt`)
  - metadata JSON export (`dm generate metadata`)

## 3. End-to-End Data Flow
1. User edits/imports YAML.
2. CLI/UI runs structural + semantic checks.
3. Canonical model is compiled for deterministic diff and generation.
4. Policy pack is evaluated for governance rules.
5. Outputs:
   - UI diagram + gate report
   - SQL/dbt/metadata artifacts
   - CI pass/fail result

## 4. Non-Enterprise Prototype Boundaries
Excluded in this prototype scope:
- SSO/OIDC/SAML
- RBAC and workspace isolation services
- audit log service and approval workflow backend

These remain for the enterprise platform phase.
