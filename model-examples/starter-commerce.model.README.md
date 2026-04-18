# starter-commerce.model.yaml

## Purpose
Minimal starter model for first-time users to learn core concepts quickly.

- Model: `commerce`
- Version: `1.0.0`
- Domain: `sales`
- YAML file: `model-examples/starter-commerce.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/starter-commerce.model.yaml`.
3. Get model statistics: `./dm stats model-examples/starter-commerce.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples`.
5. Load `starter-commerce.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: commerce v1.0.0
Entities: 2  (2 table)
Fields: 5  (PK: 2, FK: 0, nullable: 0)
Relationships: 1
Indexes: 0
Glossary terms: 0
Rules: 1
Description coverage: 0/5 (0%)
Tags: GOLD, PII
```
