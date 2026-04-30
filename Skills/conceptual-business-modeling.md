---
name: "Conceptual Business Modeling"
description: "Business concept modeling before logical or physical implementation."
use_when:
  - "conceptual model"
  - "business concept"
  - "business scenario"
  - "domain model"
  - "bounded context"
tags:
  - "conceptual"
  - "business"
  - "glossary"
layers:
  - "conceptual"
agent_modes:
  - "conceptual_architect"
  - "relationship_modeler"
priority: 4
---

# Conceptual Business Modeling

- Create concepts, not tables. Do not add columns, database datatypes, indexes, DDL, dbt tests, or warehouse constraints.
- Each important concept should have name, description, owner, subject_area, domain, tags, and glossary terms when known.
- Relationships should be entity-level with business verbs, for example: "One account can have many opportunities."
- For any request containing words like flow, journey, lifecycle, process, adoption, funnel, or pipeline, include connected relationships by default unless the user explicitly asks for concepts only.
- Prefer relationship verbs that read as business sentences, for example Customer subscribes to Product, Subscription generates Usage Event, Usage Event contributes to Adoption Metric.
- Cross-domain relationships need a description explaining business meaning and ownership.
- Use follow-up questions when owner, domain, glossary meaning, or relationship verb is unclear.
