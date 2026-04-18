# orders.model.yaml

## Purpose
Order-domain module demonstrating cross-model references to customers.

- Model: `orders`
- Version: `1.0.0`
- Domain: `sales`
- YAML file: `model-examples/multi-model-demo/orders.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/multi-model-demo/orders.model.yaml`.
3. Get model statistics: `./dm stats model-examples/multi-model-demo/orders.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/multi-model-demo`.
5. Load `orders.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.
7. Resolve imports to verify cross-model references: `./dm resolve model-examples/multi-model-demo/orders.model.yaml`.

## Current CLI Snapshot
```text
Model: orders v1.0.0
Entities: 3  (3 table)
Fields: 22  (PK: 3, FK: 5, nullable: 2)
Relationships: 4
Indexes: 5
Glossary terms: 0
Rules: 2
Description coverage: 3/22 (14%)
Subject areas: order_domain
Tags: GOLD, PCI
```
