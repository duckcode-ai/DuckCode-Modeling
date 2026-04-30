---
name: "Logical Modeling Standards"
description: "Platform-neutral logical entity, attribute, key, and lineage guidance."
use_when:
  - "logical model"
  - "attribute"
  - "candidate key"
  - "normalization"
  - "promote to logical"
tags:
  - "logical"
  - "attributes"
  - "keys"
layers:
  - "logical"
agent_modes:
  - "logical_modeler"
  - "yaml_patch_engineer"
priority: 4
---

# Logical Modeling Standards

- Preserve conceptual lineage with derived_from or mapped_from metadata where possible.
- Define attributes with business names and descriptions before warehouse datatypes.
- Identify candidate keys, natural keys, optionality, and relationship cardinality from business meaning.
- Avoid physical-only choices such as clustering, materialization, warehouse-specific types, indexes, and SQL unless promoting to physical.
- Propose normalization or denormalization rationale explicitly when model shape changes.
