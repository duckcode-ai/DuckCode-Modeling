# End-to-End Modeling + Dictionary Example

This example shows how to keep source modeling, transformation modeling, reporting metrics,
and dictionary metadata in one YAML-first workflow.

## Files

1. `source_sales_raw.model.yaml`: raw/source contract.
2. `commerce_transform.model.yaml`: curated transform contract.
3. `commerce_reporting.model.yaml`: KPI/reporting contract + glossary + rules.

## Why This Pattern

1. Business logic is enforced in `rules`.
2. Dictionary definitions are enforced in `glossary`.
3. Ownership, tags, SLA, and classification are attached to entities/fields.
4. Reporting metrics are explicit in top-level `metrics` with required `aggregation`, `grain`, and dimensions.

## Run

```bash
dm validate-all --glob "model-examples/end-to-end-dictionary/*.model.yaml"
dm resolve-project model-examples/end-to-end-dictionary
dm generate docs model-examples/end-to-end-dictionary/commerce_reporting.model.yaml --format html --out docs-site/reporting-dictionary.html
```

## Suggested CI Gate

```bash
dm validate-all --glob "models/**/*.model.yaml"
dm policy-check models/source/source_sales_raw.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/transform/commerce_transform.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/report/commerce_reporting.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm resolve-project models
```
