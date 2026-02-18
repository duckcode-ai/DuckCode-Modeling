# YAML Spec v2

## Purpose
Define data models in a strict, readable YAML format with enterprise-grade schema richness for real data warehouse teams. Backward compatible with v1.

## Top-Level Structure
```yaml
model: {}
entities: []
relationships: []
indexes: []
governance: {}
glossary: []
metrics: []
rules: []
display: {}
```

## Required Sections
1. `model`
2. `entities`

## `model`
Required keys:
1. `name` (string, lowercase with underscores)
2. `version` (SemVer string)
3. `domain` (string)
4. `owners` (list of email-like strings)
5. `state` (`draft` | `approved` | `deprecated`)

Optional keys:
1. `spec_version` (integer, `1` or `2`, default `2`)
2. `description` (string)
3. `imports` (array of import references for multi-model projects)
4. `layer` (`source` | `transform` | `report`) — logical modeling layer used for stricter linting.

### `model.imports`
Cross-model imports enable multi-file projects where entities from one model can be referenced in another.

```yaml
model:
  name: orders
  imports:
    - model: customers          # model.name of the target file
      alias: cust               # short alias for disambiguation
      entities: [Customer, Address]  # optional: specific entities (omit for all)
      path: ../shared/customers.model.yaml  # optional: explicit relative path
```

Each import entry:
- **`model`** (required) — name matching the `model.name` field in the target file
- **`alias`** (optional) — short alias for referencing imported entities
- **`entities`** (optional) — list of specific entity names to import; if omitted, all entities are imported
- **`path`** (optional) — relative file path to the model; if omitted, resolved by scanning the project directory for `<model_name>.model.yaml`

Resolution rules:
1. Imports are resolved recursively (transitive imports are supported)
2. Circular imports are detected and reported as errors
3. Duplicate entity names across models produce warnings
4. Use `dm resolve <model>` to verify import resolution
5. Use `dm resolve-project <dir>` to verify all models in a project

## `entities`
Each entity requires:
1. `name` (PascalCase)
2. `type` (`table` | `view` | `materialized_view` | `external_table` | `snapshot`)
3. `fields` (array)

Optional entity keys:
1. `description` (string)
2. `tags` (string array)
3. `schema` (string) — database schema or dataset name
4. `database` (string) — database or catalog name
5. `subject_area` (string) — logical domain grouping for diagrams
6. `owner` (string) — entity-level owner email or team
7. `sla` (object) — data SLA with `freshness` (string) and `quality_score` (number 0–100)
8. `grain` (string array) — explicit uniqueness grain for the entity.

### `fields`
Each field requires:
1. `name` (snake_case)
2. `type` (string)

Optional field keys:
1. `nullable` (boolean, default true)
2. `primary_key` (boolean)
3. `unique` (boolean)
4. `foreign_key` (boolean) — marks field as FK
5. `description` (string)
6. `tags` (string array)
7. `default` (string | number | boolean | null) — default column value
8. `check` (string) — check constraint expression
9. `computed` (boolean) — whether this is a computed/virtual column
10. `computed_expression` (string) — SQL expression for computed columns
11. `sensitivity` (`public` | `internal` | `confidential` | `restricted`) — field-level data classification
12. `examples` (array of string | number | boolean | null) — example values for documentation
13. `deprecated` (boolean) — whether this field is deprecated
14. `deprecated_message` (string) — migration guidance for deprecated fields

## `relationships`
Each relationship requires:
1. `name`
2. `from` (`Entity.field`)
3. `to` (`Entity.field`)
4. `cardinality` (`one_to_one` | `one_to_many` | `many_to_one` | `many_to_many`)

Optional relationship keys:
1. `on_delete` (`restrict` | `cascade` | `set_null` | `no_action`)
2. `on_update` (`restrict` | `cascade` | `set_null` | `no_action`)
3. `description` (string)

## `indexes` (new in v2)
Each index requires:
1. `name` (snake_case)
2. `entity` (PascalCase entity name)
3. `fields` (array of snake_case field names)

Optional index keys:
1. `unique` (boolean, default false)
2. `type` (`btree` | `hash` | `gin` | `gist` | `brin`, default `btree`)
3. `description` (string)

## `governance`
Optional keys:
1. `classification`: map of `Entity.field -> PUBLIC|INTERNAL|CONFIDENTIAL|PII|PCI|PHI`
2. `stewards`: map of domain/team -> owner email
3. `retention`: object with `period` (string) and `policy` (string)

## `glossary` (new in v2)
Each glossary term requires:
1. `term` (string)
2. `definition` (string)

Optional glossary term keys:
1. `abbreviation` (string)
2. `owner` (string)
3. `related_fields` (array of `Entity.field` references)
4. `tags` (string array)

## `metrics` (new in v2)
Each metric requires:
1. `name` (snake_case)
2. `entity` (PascalCase entity name)
3. `expression` (string)
4. `aggregation` (`sum` | `count` | `count_distinct` | `avg` | `min` | `max` | `custom`)
5. `grain` (array of field names defined in the metric entity)

Optional metric keys:
1. `description` (string)
2. `dimensions` (array of field names in metric entity)
3. `time_dimension` (field name in metric entity)
4. `owner` (string)
5. `tags` (string array)
6. `deprecated` (boolean)
7. `deprecated_message` (string)

## `rules`
Each rule requires:
1. `name`
2. `target` (`Entity.field`)
3. `expression` (string)
4. `severity` (`info` | `warn` | `error`)

## Semantic Rules Enforced by Linter
1. Entity names must be unique.
2. Field names must be unique within an entity.
3. Every `table` must contain at least one `primary_key: true` field.
4. `view`, `materialized_view`, `external_table`, and `snapshot` do not require primary keys.
5. `relationships.from` and `relationships.to` must reference existing fields.
6. `indexes.entity` must reference an existing entity.
7. `indexes.fields` must reference existing fields within the index entity.
8. `glossary.related_fields` must reference existing entity fields.
9. `computed: true` fields should have a `computed_expression`.
10. `deprecated: true` fields are reported as warnings.
11. Circular relationships are allowed but reported as warnings.
12. In `transform` and `report` layer models, entities of type `table`/`view`/`materialized_view` must declare `grain`.
13. `entity.grain` fields must exist in that entity.
14. Metric names must be unique.
15. `metrics.entity` must reference an existing entity.
16. Metric `grain` and `dimensions` fields must exist in the metric entity.
17. Metric `time_dimension` must exist in the metric entity.
18. In `report` layer models, at least one metric is required.

## Example v2 Model
```yaml
model:
  name: enterprise_dwh
  spec_version: 2
  version: 1.0.0
  domain: analytics
  owners:
    - data-platform@company.com
  state: draft
  layer: report
  description: Enterprise data warehouse model

entities:
  - name: Customer
    type: table
    description: Customer master record
    tags: [PII, GOLD]
    schema: analytics
    database: warehouse
    subject_area: customer_domain
    owner: customer-team@company.com
    grain: [customer_id]
    sla:
      freshness: 24h
      quality_score: 99.5
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
        description: Unique customer identifier
      - name: email
        type: string
        nullable: false
        unique: true
        sensitivity: confidential
        check: "length(value) > 0"
        examples: ["alice@example.com"]
      - name: lifetime_value
        type: decimal(12,2)
        nullable: true
        default: "0.00"
        description: Total revenue from customer
      - name: legacy_status
        type: string
        nullable: true
        deprecated: true
        deprecated_message: "Use customer_status instead"

  - name: CustomerSummary
    type: materialized_view
    description: Pre-aggregated customer metrics
    subject_area: customer_domain
    grain: [customer_id]
    fields:
      - name: customer_id
        type: integer
        nullable: false
      - name: total_orders
        type: integer
        computed: true
        computed_expression: "COUNT(orders.order_id)"

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many
    on_delete: cascade
    on_update: no_action
    description: Customer places orders

indexes:
  - name: idx_customer_email
    entity: Customer
    fields: [email]
    unique: true
  - name: idx_customer_status
    entity: Customer
    fields: [customer_status]
    type: btree

governance:
  classification:
    Customer.email: PII
  stewards:
    customer_domain: customer-team@company.com
  retention:
    period: 7y
    policy: GDPR

glossary:
  - term: Customer Lifetime Value
    abbreviation: CLV
    definition: Total revenue attributed to a customer over their entire relationship
    owner: analytics-team@company.com
    related_fields:
      - Customer.lifetime_value
    tags: [KPI, FINANCE]

metrics:
  - name: customer_lifetime_value
    entity: Customer
    expression: lifetime_value
    aggregation: sum
    grain: [customer_id]
    dimensions: [customer_id]
    time_dimension: created_at
    owner: analytics-team@company.com
    tags: [KPI, FINANCE]

rules:
  - name: lifetime_value_non_negative
    target: Customer.lifetime_value
    expression: "value >= 0"
    severity: error
```
