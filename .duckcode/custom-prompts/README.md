# Data Team Custom Prompts

These files live in .duckcode/custom-prompts/ and are used to steer DuckCode toward your team's real-world practices.

## Tech Stack Assumptions
- Data platforms: Snowflake, Databricks
- Transformations: dbt
- IaC: Terraform

## Prompt Files
- data-standards.md
- warehouse-schema.md
- data-apis.md
- data-security.md
- data-testing.md
- model-documentation.md
- platform-dba-run-plan.md

## Notes
- DuckCode auto-loads the *.md files into the system prompt for every chat.
- This README is for humans and is not loaded into the AI context.
- Keep prompts high-signal: rules, defaults, command snippets, and “do/don’t”.