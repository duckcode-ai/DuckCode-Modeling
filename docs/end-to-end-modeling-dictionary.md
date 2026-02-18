# End-to-End Modeling Dictionary Blueprint

This blueprint provides an out-of-the-box YAML-first structure for modeling source,
transformation, and reporting layers while keeping dictionary metadata in the same system.

## Recommended Repository Structure

```text
models/
  source/
    source_sales_raw.model.yaml
  transform/
    commerce_transform.model.yaml
  report/
    commerce_reporting.model.yaml
policies/
  end_to_end_dictionary.policy.yaml
docs/
  dictionary/
    README.md
schemas/
  model.schema.json
  policy.schema.json
dm.config.yaml
```

## Modeling Contract by Layer

1. Source layer (`models/source`): physical/raw contracts and ingestion semantics.
2. Transform layer (`models/transform`): conformed entities, relationships, and standardized business logic.
3. Report layer (`models/report`): KPI contracts, computed metric fields, glossary terms, and report-facing rules.

## Mandatory Sections in Every Model

1. `model`: ownership, lifecycle, domain, version.
2. `entities`: technical schema + business metadata.
3. `grain` on each transform/report entity.
4. `governance`: classification, stewardship, retention.
5. `glossary`: business dictionary terms connected to fields.
6. `rules`: enforceable logic checks that fail validation when violated.
7. `metrics` (for report layer): metric contracts with `aggregation`, `grain`, and `dimensions`.

## Where to Keep Metrics

Use top-level `metrics` in report models with:
1. `entity` reference.
2. `aggregation` and `expression`.
3. explicit `grain` and optional `dimensions`.
4. clear `description` and `tags`.

This keeps metrics and dictionary metadata in the same YAML model and enables one review surface.

## Required Validation Flow

```bash
dm validate-all --glob "models/**/*.model.yaml"
dm policy-check models/source/source_sales_raw.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/transform/commerce_transform.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm policy-check models/report/commerce_reporting.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm resolve-project models
```

## Dictionary Artifact Generation

```bash
dm generate docs models/report/commerce_reporting.model.yaml --format html --out docs/dictionary/reporting-dictionary.html
```

The generated artifact becomes your human-readable data dictionary for reporting metrics,
owners, glossary terms, and business rules.
