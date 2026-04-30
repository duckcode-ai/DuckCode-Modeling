---
name: "dbt Test Coverage"
description: "Required dbt tests by field role. Aligns with the readiness gate's red/yellow/green thresholds."
use_when:
  - "test"
  - "coverage"
  - "unique"
  - "not_null"
  - "relationships"
  - "accepted_values"
tags:
  - "tests"
  - "governance"
  - "readiness"
layers:
  - "physical"
agent_modes:
  - "physical_dbt_developer"
  - "governance_reviewer"
  - "yaml_patch_engineer"
priority: 4
---

# dbt Test Coverage

Required test set by field role. The DataLex readiness gate scores
files against these expectations — missing required tests turn the
file yellow; missing PK tests turn it red.

## Primary key columns (`*_pk`, `*_sk`, `*_id` when promoted to PK)

Required: `unique` AND `not_null`.

```yaml
- name: customer_pk
  tests:
    - unique
    - not_null
```

## Foreign keys (`*_fk` and inferred FKs)

Required: `relationships` test pointing at the parent model + column.

```yaml
- name: customer_fk
  tests:
    - relationships:
        to: ref('dim_customers')
        field: customer_pk
```

## Enum-shaped columns (status, type, category, …)

Required: `accepted_values` listing the allowed set.

```yaml
- name: order_status
  tests:
    - accepted_values:
        values: ['placed','shipped','delivered','cancelled']
```

## Cross-field invariants

When two columns must satisfy a relationship (e.g. `start_at < end_at`,
or `total = subtotal + tax`), use `dbt_utils.expression_is_true`.

```yaml
tests:
  - dbt_utils.expression_is_true:
      expression: "total_amount = subtotal + tax_amount"
```

## Don'ts

- Don't propose `unique` on a non-PK column unless the user explicitly asked for it.
- Don't add `not_null` on every column reflexively — only on PKs, FKs, and required business-meaning columns.
- Don't add `relationships` tests against models that don't exist yet; flag the missing parent in `validation_impact` instead.
