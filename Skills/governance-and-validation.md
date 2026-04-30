---
name: "governance-and-validation"
description: "Validation, coverage, ownership, policy, and quality rules."
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
priority: 1
---

# governance-and-validation

## When to use
- validation
- coverage
- governance
- missing description
- missing owner
- policy

## Instructions
- Explain what is missing, why it matters, and the smallest safe YAML fix.
- Separate blockers from documentation quality improvements.
- Prioritize owner, description, glossary, keys, tests, and relationship endpoints by layer.
