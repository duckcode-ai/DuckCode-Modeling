# enterprise-dwh.model.yaml

## Purpose
Enterprise DWH reference model with broad domain coverage, governance controls, and warehouse-style patterns.

- Model: `enterprise_dwh`
- Version: `1.0.0`
- Domain: `analytics`
- YAML file: `model-examples/enterprise-dwh.model.yaml`

## Step-by-Step Review
1. Activate Python environment: `source .venv/bin/activate`.
2. Validate schema and rules: `./dm validate model-examples/enterprise-dwh.model.yaml`.
3. Get model statistics: `./dm stats model-examples/enterprise-dwh.model.yaml`.
4. Open the DataLex UI and add/open project folder `model-examples`.
5. Load `enterprise-dwh.model.yaml`, run Search with business terms, and inspect entities/relationships in the diagram.
6. Open the bottom panel to review properties, business descriptions, governance, and data dictionary/glossary entries when present.

## Current CLI Snapshot
```text
Model: enterprise_dwh v1.0.0
Entities: 19  (15 table, 1 materialized_view, 1 view, 1 external_table, 1 snapshot)
Fields: 151  (PK: 15, FK: 15, nullable: 49)
Relationships: 15
Indexes: 17
Glossary terms: 5
Rules: 5
Description coverage: 11/151 (7%)
Deprecated fields: 1
Subject areas: analytics_domain, customer_domain, marketing_domain, order_domain, platform_domain, product_domain, supply_chain_domain
Tags: GOLD, PCI, PII
```
