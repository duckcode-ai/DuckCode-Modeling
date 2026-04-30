---
name: "DataLex Modeling Standards"
description: "Core industry standards for conceptual, logical, physical, and dbt modeling."
use_when:
  - "modeling standards"
  - "data architecture"
  - "conceptual logical physical modeling"
  - "dbt yaml governance"
tags:
  - "standards"
  - "governance"
  - "architecture"
layers:
  - "conceptual"
  - "logical"
  - "physical"
agent_modes:
  - "conceptual_architect"
  - "logical_modeler"
  - "physical_dbt_developer"
  - "governance_reviewer"
priority: 2
---

# DataLex Modeling Standards

- Treat DataLex YAML as the source of truth and propose small reviewable changes.
- Preserve existing files, descriptions, tests, tags, relationships, and lineage unless the user explicitly asks to change them.
- Conceptual models capture business meaning: concepts, owners, domains, subject areas, glossary terms, tags, and entity-level relationships.
- Logical models define platform-neutral structure: entities, attributes, candidate keys, optionality, and lineage from concepts.
- Physical models preserve dbt conventions: models, columns, descriptions, tests, constraints, contracts, semantic metadata, and warehouse readiness.
- Ask follow-up questions when a missing business fact would cause invented names, ownership, relationships, or grain.
