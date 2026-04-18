# products.model.yaml

## Purpose
Product-domain module demonstrating transitive import resolution.

- Model: `products`
- Version: `1.0.0`
- Domain: `catalog`
- YAML file: `model-examples/multi-model-demo/products.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/multi-model-demo/products.model.yaml`.
3. Get model statistics: `./dm stats model-examples/multi-model-demo/products.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples/multi-model-demo`.
5. Load `products.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.
7. Resolve imports to verify cross-model references: `./dm resolve model-examples/multi-model-demo/products.model.yaml`.

## Current CLI Snapshot
```text
Model: products v1.0.0
Entities: 4  (3 table, 1 materialized_view)
Fields: 19  (PK: 3, FK: 2, nullable: 4)
Relationships: 3
Indexes: 2
Glossary terms: 2
Rules: 1
Description coverage: 1/19 (5%)
Subject areas: product_domain, supply_chain_domain
Tags: GOLD
```
