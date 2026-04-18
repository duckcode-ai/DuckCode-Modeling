# fintech-risk-baseline.model.yaml

## Purpose
Baseline fintech risk model used to evaluate policy and schema drift.

- Model: `fintech_risk`
- Version: `1.0.0`
- Domain: `financial_services`
- YAML file: `model-examples/real-scenarios/fintech-risk-baseline.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/real-scenarios/fintech-risk-baseline.model.yaml`.
3. Get model statistics: `./dm stats model-examples/real-scenarios/fintech-risk-baseline.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/real-scenarios`.
5. Load `fintech-risk-baseline.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: fintech_risk v1.0.0
Entities: 11  (11 table)
Fields: 117  (PK: 11, FK: 0, nullable: 27)
Relationships: 13
Indexes: 0
Glossary terms: 0
Rules: 4
Description coverage: 0/117 (0%)
Tags: GOLD, PII
```
