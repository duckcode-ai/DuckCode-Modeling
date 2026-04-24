# dbt Mesh Interfaces

DataLex mesh support is a standards gate for shared dbt models. It does
not create a new model artifact. Instead, a dbt model opts into Interface
governance with `meta.datalex.interface`, and DataLex checks whether that
model is ready to be consumed as a stable contract.

Use this when a model is meant to be reused outside its owning team, for
example a shared `dim_customers` or `fct_orders` model.

## Mark a dbt model as an Interface

Add Interface metadata under the model's `meta.datalex.interface` block:

```yaml
version: 2

models:
  - name: dim_customers
    description: Shared customer dimension for analytics consumers.
    config:
      materialized: table
      contract:
        enforced: true
    meta:
      datalex:
        interface:
          enabled: true
          owner: analytics
          domain: commerce
          status: active
          version: v1
          description: Customer-level contract for downstream reporting.
          unique_key: customer_id
          freshness:
            warn_after:
              count: 1
              period: day
          stability: shared
    columns:
      - name: customer_id
        description: Stable customer identifier.
        data_type: integer
        tests:
          - unique
          - not_null
      - name: customer_name
        description: Customer display name.
        data_type: string
```

`stability: shared` or `stability: contracted` also enables Interface
checks, even if `enabled: true` is omitted.

## Run the check

From a DataLex source checkout:

```bash
cd /Users/Kranthi_1/DataLex
.venv/bin/python ./datalex datalex mesh check /path/to/dbt-repo --strict
```

From a PyPI install:

```bash
pip install -U datalex-cli
datalex datalex mesh check /path/to/dbt-repo --strict
```

Expected successful output:

```text
DataLex mesh Interface check: /path/to/dbt-repo
  strict: yes
  interfaces: ready
```

For CI or automation, use JSON:

```bash
datalex datalex mesh check /path/to/dbt-repo --strict --output-json
```

The command exits non-zero when strict Interface readiness checks produce
errors or when the project has loader errors.

## What DataLex checks

For Interface-enabled dbt models, DataLex validates:

- `owner`, `domain`, `version`, `description`, `unique_key`, `freshness`,
  `status`, and `stability`
- valid `status`: `draft`, `active`, or `deprecated`
- valid `stability`: `internal`, `shared`, or `contracted`
- stable dbt materialization, not `ephemeral`
- `contract.enforced: true` for contracted Interfaces
- `unique_key` references a real column
- unique-key columns have `unique` and `not_null` tests
- shared/contracted Interface columns have descriptions
- foreign-key-like columns have relationship tests where required

Presentation or reporting-layer models should not be marked as shared
Interfaces. DataLex reports those as Interface readiness issues.

## Example repo

The `jaffle-shop-DataLex` example marks `dim_customers` and `fct_orders`
as shared Interfaces and keeps `order_items` internal.

```bash
cd /Users/Kranthi_1/DataLex
.venv/bin/python ./datalex datalex mesh check /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex --strict
```

Expected result:

```text
DataLex mesh Interface check: /Users/Kranthi_1/DuckCode-DQL/jaffle-shop-DataLex
  strict: yes
  interfaces: ready
```
