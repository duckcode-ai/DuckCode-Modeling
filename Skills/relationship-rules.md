---
name: "Relationship Rules"
description: "Relationship semantics, business verbs, cardinality, crow-foot meaning, and physical FK guidance."
use_when:
  - "relationship"
  - "cardinality"
  - "foreign key"
  - "crow foot"
  - "one to many"
  - "many to one"
tags:
  - "relationships"
  - "cardinality"
  - "foreign_key"
agent_modes:
  - "relationship_modeler"
  - "yaml_patch_engineer"
priority: 5
---

# Relationship Rules

- Conceptual relationships are entity-level and should include business wording and optional cardinality.
- Do not return isolated boxes for flow requests. A flow diagram must have at least one relationship, and normally enough relationships to connect the main concepts into a readable business story.
- Logical relationships clarify optionality, cardinality, and candidate key implications.
- Physical relationships require field endpoints and should align with dbt relationships tests or explicit constraint metadata.
- Keep relationship direction meaningful: `from` is the source/dependent side when field-level foreign keys exist; conceptual direction should read naturally as a business sentence.
- When changing cardinality, update both YAML definition and visual notation semantics.
