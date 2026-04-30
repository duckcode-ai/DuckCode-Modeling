---
name: "Physical dbt Modeling"
description: "dbt schema YAML, columns, tests, datatypes, contracts, and warehouse-ready physical modeling."
use_when:
  - "physical model"
  - "dbt"
  - "schema.yml"
  - "column"
  - "datatype"
  - "test"
  - "constraint"
tags:
  - "physical"
  - "dbt"
  - "tests"
  - "constraints"
layers:
  - "physical"
agent_modes:
  - "physical_dbt_developer"
  - "yaml_patch_engineer"
priority: 5
---

# Physical dbt Modeling

- Preserve existing dbt model names, column docs, tests, tags, meta, constraints, contracts, and semantic model references.
- Prefer focused YAML patches over rewriting whole schema files.
- Infer datatypes from existing YAML, dbt catalog/manifest facts, SQL casts, warehouse metadata, or clear naming conventions; mark uncertainty in rationale.
- Use dbt tests for uniqueness, not_null, accepted_values, and relationships when they match real data quality requirements.
- Do not run dbt, apply DDL, or push to a database. Propose commands or SQL only for user approval.
