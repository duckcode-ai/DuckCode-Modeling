# YAML Spec v1 (MVP)

## Purpose
Define data models in a strict, readable YAML format that can be validated, versioned, and rendered.

## Top-Level Structure
```yaml
model: {}
entities: []
relationships: []
governance: {}
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

## `entities`
Each entity requires:
1. `name` (PascalCase)
2. `type` (`table` | `view`)
3. `fields` (array)

Each field requires:
1. `name` (snake_case)
2. `type` (string)

Optional field keys:
1. `nullable` (boolean, default true)
2. `primary_key` (boolean)
3. `unique` (boolean)
4. `description` (string)
5. `tags` (string array)

## `relationships`
Each relationship requires:
1. `name`
2. `from` (`Entity.field`)
3. `to` (`Entity.field`)
4. `cardinality` (`one_to_one` | `one_to_many` | `many_to_one` | `many_to_many`)

## `governance`
Optional keys:
1. `classification`: map of `Entity.field -> PUBLIC|INTERNAL|CONFIDENTIAL|PII|PCI`
2. `stewards`: map of domain/team -> owner email

## `rules`
Each rule supports:
1. `name`
2. `target` (`Entity.field`)
3. `expression` (string)
4. `severity` (`info` | `warn` | `error`)

## Semantic Rules Enforced by MVP Linter
1. Entity names must be unique.
2. Field names must be unique within an entity.
3. Every table must contain at least one `primary_key: true`.
4. `relationships.from` and `relationships.to` must reference existing fields.
5. Circular relationships are allowed but reported as warnings.
