# customers.model.yaml

## Purpose
Customer-domain module in the multi-model import chain demo.

- Model: `customers`
- Version: `1.0.0`
- Domain: `customer`
- YAML file: `model-examples/multi-model-demo/customers.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/multi-model-demo/customers.model.yaml`.
3. Get model statistics: `./dm stats model-examples/multi-model-demo/customers.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/multi-model-demo`.
5. Load `customers.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: customers v1.0.0
Entities: 3  (3 table)
Fields: 15  (PK: 3, FK: 1, nullable: 1)
Relationships: 1
Indexes: 2
Glossary terms: 1
Rules: 0
Description coverage: 1/15 (7%)
Subject areas: customer_domain
Tags: GOLD, PII
```
