---
name: "Governance and Validation"
description: "Documentation, ownership, standards, validation, policy, and completeness guidance."
use_when:
  - "validation"
  - "coverage"
  - "governance"
  - "missing description"
  - "missing owner"
  - "policy"
tags:
  - "governance"
  - "validation"
  - "quality"
layers:
  - "conceptual"
  - "logical"
  - "physical"
agent_modes:
  - "governance_reviewer"
  - "yaml_patch_engineer"
priority: 4
---

# Governance and Validation

- Explain every issue as: what is missing, why it matters, and the smallest safe YAML fix.
- Separate blocking semantic/physical readiness issues from documentation coverage improvements.
- Conceptual coverage prioritizes owner, description, domain, subject area, glossary terms, tags, and orphan concepts.
- Logical coverage prioritizes candidate keys, attribute meaning, relationship optionality, and lineage.
- Physical coverage prioritizes column docs, datatypes, tests, constraints, relationship endpoints, and dbt readiness.
