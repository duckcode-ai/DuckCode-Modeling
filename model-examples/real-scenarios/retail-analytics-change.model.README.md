# retail-analytics-change.model.yaml

## Purpose
Changed retail analytics model containing intentional breaking changes for gate testing.

- Model: `retail_analytics`
- Version: `2.0.0`
- Domain: `commerce`
- YAML file: `model-examples/real-scenarios/retail-analytics-change.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/real-scenarios/retail-analytics-change.model.yaml`.
3. Get model statistics: `./dm stats model-examples/real-scenarios/retail-analytics-change.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/real-scenarios`.
5. Load `retail-analytics-change.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.
7. Compare with baseline using gate: `./dm gate model-examples/real-scenarios/retail-analytics-baseline.model.yaml model-examples/real-scenarios/retail-analytics-change.model.yaml`.

## Current CLI Snapshot
```text
Model: retail_analytics v2.0.0
Entities: 12  (12 table)
Fields: 143  (PK: 12, FK: 0, nullable: 35)
Relationships: 14
Indexes: 0
Glossary terms: 0
Rules: 4
Description coverage: 0/143 (0%)
Tags: GOLD, PII
```
