# 00-retail-ops-showcase.model.yaml

## Purpose
Comprehensive enterprise showcase covering data dictionary, governance, rules, relationships, and mixed entity types.

- Model: `retail_ops_showcase`
- Version: `1.0.0`
- Domain: `retail_operations`
- YAML file: `model-examples/00-retail-ops-showcase.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/00-retail-ops-showcase.model.yaml`.
3. Get model statistics: `./dm stats model-examples/00-retail-ops-showcase.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples`.
5. Load `00-retail-ops-showcase.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: retail_ops_showcase v1.0.0
Entities: 10  (6 table, 1 external_table, 1 materialized_view, 1 snapshot, 1 view)
Fields: 55  (PK: 8, FK: 10, nullable: 14)
Relationships: 11
Indexes: 7
Glossary terms: 5
Rules: 2
Description coverage: 55/55 (100%)
Deprecated fields: 1
Subject areas: Commerce, Customer, Finance, Operations, Product, Supply
Tags: GOLD, INTERNAL, PCI, PII
```
