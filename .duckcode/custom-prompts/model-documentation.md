# Model Documentation Standards (dbt)

## Goal
Generate documentation that matches how we actually operate with dbt on Snowflake and Databricks.

## Output Format Defaults
- If asked for dbt YAML, output valid YAML only.
- Otherwise, prefer short sections with bullet points.

## What to Include (when documenting a model)
- What the model represents (business meaning)
- Grain (what one row represents)
- Primary keys / unique constraints (explicit)
- Incremental strategy if applicable (merge keys, partitions, clustering)
- SLAs: freshness expectations and critical downstream consumers

## dbt Conventions
- Follow dbt layer naming:
  - stg_ for source-staging
  - int_ for intermediate
  - dim_ / fct_ for marts
- Prefer ref() and source() with explicit schema.yml entries.

## Required YAML Fields (when asked)
- model description
- column descriptions for business-critical columns
- tests for keys and relationships (see data-testing.md)

## Guardrails
- Do not invent columns/tests.
- If uncertainty exists, ask for the model SQL + schema.yml context.
