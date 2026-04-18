# retail-analytics-baseline.model.yaml

## Purpose
Baseline enterprise retail analytics model used for change/gate comparisons.

- Model: `retail_analytics`
- Version: `1.0.0`
- Domain: `commerce`
- YAML file: `model-examples/real-scenarios/retail-analytics-baseline.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/real-scenarios/retail-analytics-baseline.model.yaml`.
3. Get model statistics: `./dm stats model-examples/real-scenarios/retail-analytics-baseline.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/real-scenarios`.
5. Load `retail-analytics-baseline.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: retail_analytics v1.0.0
Entities: 10  (10 table)
Fields: 124  (PK: 10, FK: 0, nullable: 31)
Relationships: 11
Indexes: 0
Glossary terms: 0
Rules: 4
Description coverage: 0/124 (0%)
Tags: GOLD, PII
```
