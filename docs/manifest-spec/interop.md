# Interop: DataLex contracts ↔ DQL blocks

This document specifies how a DQL block references a DataLex contract by id,
and what compilers do with that reference.

## The problem

Without a public binding, "DQL block X uses contract Y" is a comment in
prose. Tools can't verify it, AI agents can't trust it, and contracts drift
from the analytics that supposedly enforce them.

## The contract

A DQL block declares the DataLex contract it implements via a top-level
`datalex_contract` field that holds an opaque, stable id of the form
`<domain>.<entity>.<contract_name>`:

```dql
block "Monthly Active Customers" {
    domain = "customer"
    type = "custom"
    status = "certified"
    datalex_contract = "commerce.Customer.monthly_active_customers"
    description = "..."
    query = """ ... """
}
```

The matching DataLex contract:

```yaml
# DataLex/commerce.model.yaml
model:
  name: commerce
  domain: commerce
  ...
entities:
  - name: Customer
    contracts:
      - name: monthly_active_customers
        id: commerce.Customer.monthly_active_customers
        description: Customers who placed at least one order in the calendar month.
        signature:
          inputs:
            - name: order_month
              type: date
          outputs:
            - name: monthly_active_customers
              type: integer
              constraints: ["positive"]
        version: 1
```

## Resolution rules

A consuming tool — including the DQL compiler from 1.6 onward — MUST resolve
the reference as follows:

1. The DataLex manifest emitted by the DataLex compiler is the source of
   truth. Reading the YAML directly is permitted but the manifest is
   canonical (see [`v1/datalex-manifest.schema.json`](v1/datalex-manifest.schema.json) — published at `https://datalex.duckcode.ai/manifest-spec/v1/datalex-manifest.schema.json` for external consumers to pin).
2. The DQL compiler MUST locate a contract whose `id` exactly matches the
   block's `datalex_contract` value. If no contract is found, compilation
   MUST fail with a clear error.
3. The DQL compiler MUST verify that every `outputs[*].name` declared by
   the contract appears in the block's SQL output (column-level lineage in
   the DQL manifest provides the evidence). If a column is missing,
   compilation MUST fail.
4. The DQL compiler MAY warn (not fail) when the block produces extra
   columns not declared in the contract.
5. A block MAY declare `datalex_contract` while its `status` is `review` or
   `draft`. In those statuses, compilers MUST NOT block the developer; the
   contract reference becomes a hard requirement only when `status` reaches
   `certified`.

## Versioning

DataLex contracts carry an integer `version`. When a contract version
increments, downstream DQL blocks pin a major version like
`commerce.Customer.monthly_active_customers@1`. Pinning is REQUIRED once
DataLex contract versioning ships (DataLex 2.0); until then, blocks
reference unversioned ids and the producing compiler emits a warning.

## Lineage events

Manifests at both ends emit OpenLineage events describing the binding (see
the producing repos for the event schema). A DataLex contract change with a
breaking signature SHOULD raise an OpenLineage `failed` event downstream so
consumers (catalogs, observability tools) can surface impact without polling
the spec repo.

## Compatibility table

| spec version | DataLex range | DQL range | Status |
|---|---|---|---|
| v1.0.0 | 1.8.x — 1.x | 1.5.x — 1.x | current |
