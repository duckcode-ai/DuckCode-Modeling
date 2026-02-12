# DuckCodeModeling - Enterprise Project Plan (YAML-First, Program-Based)

## 1. Vision
Build the default platform for modern data teams to define, review, and evolve data models as code using structured YAML, with an enterprise-grade visual experience and Git-native workflow.

## 1.1 Prototype Status (Current)
Completed in prototype scope (excluding enterprise platform):
1. YAML v1 spec + model schema + deterministic compiler/diff.
2. CLI quality workflow (`validate`, `lint`, `compile`, `diff`, `validate-all`, `gate`).
3. UI workspace, quality gate, scenario runner, history, and enhanced visualization controls.
4. UI round-trip safe editing for selected entity properties and fields.
5. SQL/DBML import and SQL/dbt/metadata generation commands.
6. Policy packs with schema + `policy-check` command + CI integration.
7. Performance and integration test coverage with runnable fixtures.
8. Architecture/policy/contracts/operations documentation.

Deferred intentionally:
1. Enterprise platform modules (SSO/RBAC/workspace isolation/audit/approval backend).

## 2. Product Positioning
Current tools are mostly UI-first. This product will be:
1. Program-first (YAML as source of truth)
2. Visual-first for consumption and collaboration
3. Enterprise-ready from initial release, not as an afterthought

## 3. Product Principles
1. No new complex language. Use strict, readable YAML.
2. Deterministic compiler and deterministic diffs.
3. Visual editor and YAML stay in sync.
4. Git pull request workflow is primary collaboration model.
5. Enterprise controls are built in from v1.
6. Out-of-the-box onboarding must work in less than 30 minutes.

## 4. Enterprise Feature Baseline (Must-Have in v1)
1. SSO (OIDC/SAML) and role-based access control.
2. Audit logs for model changes, approvals, and publish actions.
3. Multi-workspace or multi-project isolation.
4. Approval gates for breaking schema changes.
5. Policy packs (naming, tags, ownership, PII) enforced in CI.
6. Encryption in transit and at rest.
7. Backup and restore for metadata store.
8. Usage metrics and operational observability.

## 5. Out-of-the-Box Experience Requirements
1. `dm init` creates starter repository structure and sample model.
2. `dm validate` and `dm lint` work immediately with clear errors.
3. Web app loads sample YAML and renders full ER diagram instantly.
4. One-click GitHub/GitLab CI template generation.
5. Ready-made policy templates for common data governance rules.
6. Built-in import path from SQL DDL and dbdiagram/DBML.

## 6. Architecture Blueprint

### 6.1 Authoring Plane
1. YAML files in repo (`*.model.yaml`).
2. Assisted editor with schema-aware autocomplete.
3. Visual editor with safe subset editing and YAML round-trip.

### 6.2 Compile and Validation Plane
1. YAML parser.
2. JSON Schema structural validation.
3. Semantic validation engine.
4. Canonical model builder.
5. Semantic diff engine.

### 6.3 Collaboration and Governance Plane
1. Git integration (branches, PR checks, release tags).
2. Policy engine for governance rules.
3. Approval workflow and change classification.
4. Audit events pipeline.

### 6.4 Visualization Plane
1. React Flow rendering engine.
2. ELK.js layout for large graphs.
3. Node/edge styling by entity type, tags, ownership, sensitivity.
4. Domain/subject-area scoped views.

### 6.5 Integration Plane
1. SQL DDL generation.
2. dbt project artifact generation.
3. Metadata export APIs/webhooks.
4. Catalog integrations (DataHub/OpenMetadata) in later phase.

## 7. YAML Standard (v1)

### 7.1 Core Sections
1. `model`: name, version, domain, owners, lifecycle state.
2. `entities`: table/view definitions.
3. `fields`: type, nullability, keys, constraints, tags.
4. `relationships`: cardinality and references.
5. `rules`: business checks and quality checks.
6. `governance`: classification, retention, stewards.
7. `display`: optional diagram hints.

### 7.2 Example v1 YAML
```yaml
model:
  name: commerce
  version: 1.0.0
  domain: sales
  owners:
    - data-platform@company.com
  state: draft

entities:
  - name: Customer
    type: table
    description: Customer master record
    tags: [PII, GOLD]
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
        unique: true

  - name: Order
    type: table
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
      - name: total_amount
        type: decimal(12,2)
        nullable: false

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many

governance:
  classification:
    Customer.email: PII
  stewards:
    sales: owner-sales@company.com

rules:
  - name: order_total_non_negative
    target: Order.total_amount
    expression: "value >= 0"
    severity: error
```

### 7.3 Strict Validation Rules
1. Entity names unique.
2. Field names unique inside each entity.
3. Every table requires primary key.
4. Every relationship endpoint must resolve.
5. Cardinality enum is strict.
6. Governance classification values must be from approved set.
7. Breaking changes require explicit migration annotation.

## 8. Repository Layout
```text
DuckCodeModeling/
  PROJECT_PLAN.md
  docs/
    architecture.md
    yaml-spec-v1.md
    governance-policy-spec.md
    api-contracts.md
  schemas/
    model.schema.json
    policy.schema.json
  model-examples/
    starter-commerce.model.yaml
    starter-finance.model.yaml
  packages/
    core-engine/
      src/parser/
      src/validator/
      src/semantics/
      src/canonical/
      src/diff/
      src/policy/
    cli/
      src/commands/
    web-app/
      src/editor/
      src/diagram/
      src/review/
      src/admin/
    api/
      src/auth/
      src/audit/
      src/workspaces/
      src/integrations/
  .github/
    workflows/
```

## 9. Delivery Roadmap (24 Weeks)

## Phase 0 - Foundation and Contracts (Week 1-2)
### Scope
1. Lock YAML v1 grammar and schema boundaries.
2. Define canonical model format and diff contract.
3. Define enterprise non-functional requirements.
4. Finalize UX for authoring, review, and approval flows.

### Deliverables
1. `docs/yaml-spec-v1.md`
2. `schemas/model.schema.json` (draft)
3. `docs/architecture.md`
4. prioritized backlog with estimates

### Exit Criteria
1. Schema and API contracts signed off.
2. P0 backlog frozen for first release.

## Phase 1 - Core Engine and CLI (Week 3-6)
### Scope
1. Parser and schema validator.
2. Semantic validator and policy checks.
3. Canonical compiler and semantic diff engine.
4. CLI commands:
   - `dm init`
   - `dm validate`
   - `dm lint`
   - `dm compile`
   - `dm diff`

### Deliverables
1. `packages/core-engine`
2. `packages/cli`
3. fixtures and golden outputs

### Exit Criteria
1. Deterministic compile outputs.
2. Machine-readable errors with line/column.
3. 90%+ coverage on parser and validator paths.

## Phase 2 - Visual Modeling and Round-Trip Sync (Week 7-10)
### Scope
1. React Flow diagram renderer.
2. ELK.js auto layout with fallback layout strategy.
3. YAML-to-diagram live sync.
4. Diagram-to-YAML safe edit sync.
5. Search, filter, and domain scope views.

### Deliverables
1. `packages/web-app` diagram module
2. editable property panel
3. styling and legend system

### Exit Criteria
1. Supports 200+ entities with acceptable interaction latency.
2. Round-trip edits are deterministic for supported fields.

## Phase 3 - Enterprise Controls (Week 11-14)
### Scope
1. Authentication (OIDC/SAML).
2. RBAC roles (`admin`, `modeler`, `reviewer`, `viewer`).
3. Workspace/project isolation.
4. Audit logging and event export.
5. Approval gates for high-impact changes.

### Deliverables
1. `packages/api` auth and workspace modules
2. admin UI for roles and workspace settings
3. audit log viewer

### Exit Criteria
1. Unauthorized actions blocked.
2. Audit logs complete for critical operations.
3. Approval gates enforced in both UI and CI.

## Phase 4 - Integrations and Governance Automation (Week 15-19)
### Scope
1. SQL generation (Postgres and Snowflake).
2. dbt scaffold generation.
3. Governance policy packs and severity handling.
4. CI templates and PR comment summaries.

### Deliverables
1. `dm generate sql`
2. `dm generate dbt`
3. policy template library
4. GitHub/GitLab integration guides

### Exit Criteria
1. Generated SQL validated against fixture databases.
2. CI policy enforcement proven on sample repos.

## Phase 5 - GA Hardening and Scale (Week 20-24)
### Scope
1. Performance optimization for large graphs.
2. Backup and restore automation.
3. Observability dashboards and SLOs.
4. Migration assistant for legacy tools.

### Deliverables
1. load/performance test suite
2. DR runbook
3. production readiness checklist

### Exit Criteria
1. Meets SLO targets.
2. Passes security and reliability readiness review.
3. GA decision approved.

## 10. Workstreams and Owners
1. Language and compiler workstream.
2. Visual editor and UX workstream.
3. Enterprise platform workstream.
4. Integrations and ecosystem workstream.
5. Quality, performance, and release engineering workstream.

## 11. Step-by-Step Build Scope (Execution Order)
1. Create monorepo skeleton and package boundaries.
2. Write YAML spec and JSON schema.
3. Implement parser and structural validation.
4. Implement semantic validation and diff.
5. Ship CLI with `init/validate/lint/compile/diff`.
6. Build React Flow renderer from canonical model.
7. Add YAML live editor and round-trip sync.
8. Add auth, RBAC, and workspace model.
9. Add audit logs and approval workflow.
10. Add SQL and dbt generators.
11. Add CI templates and policy packs.
12. Run scale, security, and recovery tests.

## 12. Priority Backlog

## P0 - Mandatory
1. YAML schema and compiler.
2. Semantic validation and diff.
3. React Flow visualization.
4. CLI and CI validation flow.
5. RBAC, SSO, workspace isolation.
6. Audit logs and approval gates.

## P1 - Strongly Recommended
1. dbt scaffold generation.
2. SQL import to YAML bootstrap.
3. Policy template marketplace.
4. Domain-level diagram views.

## P2 - Later
1. AI-assisted authoring.
2. Catalog sync adapters.
3. Advanced impact analysis.

## 13. Non-Functional Targets
1. Compile time for 500-entity model under 10 seconds.
2. Diagram load for 500 entities under 3 seconds on standard laptop.
3. 99.9% API availability target for hosted deployment.
4. Full audit retention configurable by policy.
5. Deterministic output across environments.

## 14. Security and Compliance Plan
1. Threat model and security review before Phase 3 completion.
2. Dependency and container scanning in CI.
3. Least-privilege service accounts.
4. Encryption keys managed via cloud KMS.
5. Audit evidence export for SOC2/ISO workflows.

## 15. Quality Strategy
1. Unit tests for parser, validator, policy checks.
2. Golden snapshot tests for canonical output and diff.
3. Integration tests for YAML-to-render round trip.
4. End-to-end tests for submit-review-approve flow.
5. Performance regressions in CI for large fixture models.

## 16. Success Metrics
1. Time to first model under 30 minutes.
2. PR review time reduced by at least 30%.
3. Validation defect escape rate under defined threshold.
4. Enterprise adoption measured by active workspaces.
5. Percentage of models under policy enforcement above 90%.

## 17. Risks and Mitigation
1. Risk: YAML becomes too complex for non-engineers.
   - Mitigation: guided templates, starter models, schema-aware editor.
2. Risk: Round-trip sync introduces drift.
   - Mitigation: canonical model as single transform source and golden tests.
3. Risk: Enterprise features slow early release.
   - Mitigation: define strict v1 baseline and defer optional integrations.
4. Risk: Performance issues with very large models.
   - Mitigation: scoped views, lazy rendering, async layout computation.

## 18. Immediate Next Sprint Plan (2 Weeks)
1. Create `docs/yaml-spec-v1.md` with exact grammar.
2. Create `schemas/model.schema.json` draft and fixture tests.
3. Bootstrap `packages/core-engine` and `packages/cli`.
4. Implement `dm validate` and `dm lint` commands.
5. Create `model-examples/starter-commerce.model.yaml`.
6. Set up CI workflow for validate/lint/test.

## 19. Build Start Decision
This plan is implementation-ready. Start with Phase 0 and Phase 1 immediately, while locking enterprise baseline requirements as non-negotiable for release.
