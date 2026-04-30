---
name: "Description Writing"
description: "Concise prose for entity, model, and field descriptions in dbt + DataLex YAML."
use_when:
  - "description"
  - "document"
  - "summary"
  - "explain entity"
  - "what does this column mean"
tags:
  - "prose"
  - "docs"
  - "description"
agent_modes:
  - "description_writer"
  - "governance_reviewer"
priority: 5
---

# Description Writing

Used by the `description_writer` agent and the inline ✨ AI buttons in
the Docs view. Keep prose tight, business-first, and grounded in dbt
+ DataLex modeling conventions.

## Length and shape

- Models / entities: 1–2 sentences. Lead with the **business concept**, follow with the **dbt source / grain** if useful.
- Fields: a single noun phrase. End with the unit / nullability hint when it isn't obvious from the type.
- Never wrap descriptions in quotes. Never start with `Description:` or `This `. Never include the entity name in its own description (`Customer is a customer record` ← bad).

## Good examples

- Entity: `One row per customer that has placed at least one order. Mirrors the staging customer dimension; PII fields are governed by the data-stewardship policy.`
- Entity: `Header-level order event placed by a customer. Joins to the order_line entity for product detail.`
- Field: `Surrogate key minted by the customer-master pipeline. Stable across all downstream models.`
- Field: `Total order amount in USD, gross of refunds. Not null.`
- Field: `Foreign key to dim_products. Nullable for sample / promo line items.`

## Bad examples (and why)

- `This is the customer table.` — restates the obvious; no business meaning.
- `id` field: `The id of the customer.` — restates the column name.
- `Description: One row per customer.` — never include the literal `Description:` prefix.
- `"One row per customer."` — never wrap in quotes.
- `A customer is a customer who buys things from us as a customer.` — repetition; no information.

## When to refuse

If the entity / field name and surrounding fields don't justify a confident description (e.g. a single column named `flag_2` with no neighbors), reply with the empty string. The system treats that as `confidence: 0` and surfaces the field for the user to write by hand.
