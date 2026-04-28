# dbt Mesh Interfaces and catalog export

DataLex mesh support is a standards gate for shared dbt models and a
glossary export for external catalogs. It does **not** create a new
model artifact — a dbt model opts in to Interface governance with
`meta.datalex.interface`, and DataLex checks whether that model is
ready to be consumed as a stable contract.

Use this when a model is meant to be reused outside its owning team,
for example a shared `dim_customers` or `fct_orders` model.

## What 1.4 added

- `require_contract` and `require_data_type_when_contracted` policy
  rules so the readiness gate flags Interfaces that aren't fully
  contracted.
- A pre-flight check on `POST /api/forward/dbt-sync` that returns
  409 / `CONTRACT_PREFLIGHT` when contract-enforced models have
  columns with `type: unknown`.
- A bulk-toggle endpoint `POST /api/model/contracts/enforce` to set
  `contract.enforced` across selected files or layers from the UI.
- **Catalog export** via `datalex emit catalog --target ...` for
  Atlan, DataHub, and OpenMetadata.
- A first-class glossary binding shape: `binding: { glossary_term,
  status }` on columns. Legacy `terms: [...]` is still accepted.

## Mark a dbt model as an Interface

Add Interface metadata under the model's `meta.datalex.interface`
block:

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
        description: '{{ doc("customer_id") }}'   # 1.4 — doc-block round-trip
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

The command exits non-zero when strict Interface readiness checks
produce errors or when the project has loader errors.

## What DataLex checks

For Interface-enabled dbt models, DataLex validates:

- `owner`, `domain`, `version`, `description`, `unique_key`,
  `freshness`, `status`, and `stability`
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

## Pair with the readiness gate (1.4)

The shared dbt-readiness engine (`packages/readiness_engine`) scores
the same project red / yellow / green and flags Interface gaps
through dedicated finding codes. Run it alongside `mesh check`:

```bash
datalex readiness-gate --project /path/to/dbt-repo \
  --min-score 80 --max-red 0 \
  --sarif datalex-readiness.sarif --pr-comment datalex-readiness.md
```

→ Wire it into CI: [Tutorial: CI readiness gate](./tutorials/ci-readiness-gate.md).

## Bulk-toggle contract enforcement (1.4)

Use the Contracts toggle in the entity inspector, or the bulk endpoint
for whole layers:

```bash
curl -X POST http://localhost:3030/api/model/contracts/enforce \
  -H 'Content-Type: application/json' \
  -d '{"projectId": "<id>", "selectors": {"layer": "fct"}, "enforce": true}'
```

The endpoint sets both `contract.enforced: true` (the dbt-native
field) and `meta.datalex.contracts: enforced` (the DataLex-side hint
the readiness engine uses). Run a `policy-check` afterward to confirm
every contract has concrete `data_type` set:

```bash
datalex policy-check models/marts/fct_orders.yml \
  --policy datalex/standards/base.yaml \
  --inherit
```

## Catalog export (1.4)

Once columns carry glossary bindings, DataLex emits payloads for the
three most-asked-for catalogs:

```bash
datalex emit catalog --target atlan        --model DataLex/glossary.model.yaml --out out/
datalex emit catalog --target datahub      --model DataLex/glossary.model.yaml --out out/
datalex emit catalog --target openmetadata --model DataLex/glossary.model.yaml --out out/
```

Output is one JSON file per target. Each file carries:

- The glossary itself (name, domain, description)
- One entry per glossary term (term, definition, tags, synonyms)
- The list of columns bound to each term — keyed by qualifiedName
  (Atlan), schemaField URN (DataHub), or fully qualified table name
  (OpenMetadata)

Operators import the JSON via the catalog's bulk-loader API. Re-export
is idempotent: same input → same output bytes.

### Bind a column to a glossary term

```yaml
columns:
  - name: customer_email
    type: string
    tags: [pii]
    binding:
      glossary_term: customer_email
      status: approved          # proposed | approved
```

The legacy `terms: [...]` and `meta.glossary_term:` shapes still work
— the exporters normalize them to the same payload — but new code
should use `binding:` so reviewers see status (proposed vs approved)
on the column.

## Example repo

The
[`jaffle-shop-DataLex`](https://github.com/duckcode-ai/jaffle-shop-DataLex)
example marks `dim_customers` and `fct_orders` as shared Interfaces,
keeps `order_items` internal, ships a glossary at
`DataLex/commerce/_glossary.model.yaml`, and binds three columns
(`Customer.customer_key`, `Customer.customer_email`,
`Sales Order.order_total`) on the logical diagram.

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex /tmp/jaffle
cd /tmp/jaffle && make setup && make build

datalex datalex mesh check . --strict
make emit-catalog
ls out/catalog/
# atlan-commerce.json
# datahub-commerce.json
# openmetadata-commerce.json
```

## See also

- [Tutorial: CI readiness gate](./tutorials/ci-readiness-gate.md) (1.4)
- [Tutorial: Custom policy packs](./tutorials/policy-packs.md) (1.4)
- [Agentic AI modeling](./ai-agentic-modeling.md) — including the
  conceptualizer + canonicalizer agents that ship glossary-aware
  proposals
