<div align="center">
  <a href="https://duckcode.ai/" target="_blank" rel="noopener noreferrer">
    <img src="Assets/DuckCodeModeling.png" alt="DuckCodeModeling by DuckCode AI Labs" width="220" />
  </a>

# DuckCodeModeling

**YAML-first data modeling and metadata intelligence platform**

Open source UI, API, and CLI for modeling, governance, and schema-aware workflows.

<p align="center">
  <a href="https://github.com/duckcode-ai/DuckCode-Modeling/blob/main/LICENSE">
    <img src="https://img.shields.io/github/license/duckcode-ai/DuckCode-Modeling?style=for-the-badge&color=22c55e" alt="MIT License" />
  </a>
  <a href="https://discord.gg/Dnm6bUvk">
    <img src="https://img.shields.io/badge/Discord-Join%20Community-5865F2?style=for-the-badge&logo=discord&logoColor=white" alt="Discord Community" />
  </a>
  <a href="https://github.com/duckcode-ai/DuckCode-Modeling/stargazers">
    <img src="https://img.shields.io/github/stars/duckcode-ai/DuckCode-Modeling?style=for-the-badge&color=f59e0b" alt="GitHub Stars" />
  </a>
  <a href="https://github.com/duckcode-ai/DuckCode-Modeling/issues">
    <img src="https://img.shields.io/github/issues/duckcode-ai/DuckCode-Modeling?style=for-the-badge&color=0ea5e9" alt="Open Issues" />
  </a>
</p>
</div>

## Why DuckCodeModeling
DuckCodeModeling helps data teams treat data models as versioned code.

- Define models in YAML (`*.model.yaml`)
- Explore entities and relationships in a visual graph UI
- Validate structure, quality, and governance policies
- Track diffs and compatibility gates in CI
- Pull physical schemas from databases into model files
- Generate baseline DDL (`.sql`) as an artifact for GitOps-based deployments

## What Is Included
- `packages/web-app`: React + Vite modeling studio
- `packages/api-server`: Node.js API for project/files/connectors operations
- `packages/core_engine`: Python core engine (validation, policy, docs, importers)
- `packages/cli`: Python CLI (`dm`) entry points and commands
- `model-examples`: sample models and guided scenario walkthroughs
- `schemas`: JSON schema contracts
- `policies`: baseline and strict policy packs
- `docs`: architecture, specs, SLOs, runbooks

## Supported Connectors
### Available Now
<p>
  <img src="https://img.shields.io/badge/Snowflake-29B5E8?style=for-the-badge&logo=snowflake&logoColor=white" alt="Snowflake" />
  <img src="https://img.shields.io/badge/Databricks-EF3E42?style=for-the-badge&logo=databricks&logoColor=white" alt="Databricks" />
  <img src="https://img.shields.io/badge/dbt-FF694B?style=for-the-badge&logo=dbt&logoColor=white" alt="dbt Local Project" />
  <img src="https://img.shields.io/badge/BigQuery-4285F4?style=for-the-badge&logo=googlebigquery&logoColor=white" alt="BigQuery" />
  <img src="https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" />
  <img src="https://img.shields.io/badge/MySQL-4479A1?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL" />
  <img src="https://img.shields.io/badge/SQL%20Server-CC2927?style=for-the-badge&logo=microsoftsqlserver&logoColor=white" alt="SQL Server" />
  <img src="https://img.shields.io/badge/Azure%20SQL-0078D4?style=for-the-badge&logo=microsoftazure&logoColor=white" alt="Azure SQL" />
  <img src="https://img.shields.io/badge/Redshift-8C4FFF?style=for-the-badge&logo=amazonredshift&logoColor=white" alt="Amazon Redshift" />
  <img src="https://img.shields.io/badge/Microsoft%20Fabric-0078D4?style=for-the-badge&logo=microsoftfabric&logoColor=white" alt="Microsoft Fabric" />
</p>

## Screenshots
![DuckCodeModeling Overview](screenshots/overview.png)
![DuckCodeModeling Search](screenshots/search.png)

## Repository Structure
```text
DuckCodeModeling/
  packages/
    api-server/
    web-app/
    cli/
    core_engine/
  docs/
  model-examples/
  policies/
  schemas/
  tests/
```

## Prerequisites
- Node.js 18+
- npm 9+
- Python 3.9+
- Git
- Docker (optional)

## Quick Start (Local Recommended)
Local setup gives the best experience because the app can access your folders directly.

```bash
git clone https://github.com/duckcode-ai/DuckCode-Modeling.git
cd DuckCode-Modeling

npm --prefix packages/api-server install
npm --prefix packages/web-app install

python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Run in two terminals:

Terminal 1:
```bash
npm --prefix packages/api-server run dev
```

Terminal 2:
```bash
npm --prefix packages/web-app run dev
```

Open:
- Web UI: `http://localhost:5173`
- API: `http://localhost:3001`

## GitOps Workflow (Recommended)
DuckCodeModeling is intentionally Git-first: it generates code artifacts and you deploy them via your existing CI/CD.

1. Create/select a project folder (a normal git repo works best).
2. Pull from a connector (or import) to generate `models/*.model.yaml`.
3. Edit models in the UI:
   - Add tables, add columns, rename tables/columns, update metadata and constraints.
4. Save (`Cmd+S` / `Ctrl+S`):
   - Saves the YAML file.
   - Auto-generates baseline DDL into `ddl/<dialect>/<model>.sql` (defaults to `snowflake` if unset).
5. Commit + push from the built-in Diff & Git panel, or from your terminal.
6. Deploy with CI/CD by applying the generated `.sql` artifacts in your warehouse (Snowflake/Databricks/BigQuery).

Project config lives in `.duckcodemodeling/project.json` (folders + `defaultDialect`).

## Quick Start (Docker)
```bash
docker build -t duckcodemodeling:latest .
docker run --rm -p 3001:3001 duckcodemodeling:latest
```

Open: `http://localhost:3001`

If running in Docker, mount host paths so project folders are visible to the container:

```bash
docker run --rm -p 3001:3001 \
  -v /Users/<you>:/workspace/host \
  duckcodemodeling:latest
```

## CLI Quick Start
```bash
source .venv/bin/activate

./dm validate model-examples/starter-commerce.model.yaml
./dm stats model-examples/starter-commerce.model.yaml
./dm import sql model-examples/schema.sql --out model-examples/imported.model.yaml
./dm docs model-examples/starter-commerce.model.yaml --out docs-site
```

## End-to-End Modeling Template
Use this to scaffold source, transform, reporting, and dictionary workflows in one repo structure.

```bash
./dm init --path my-modeling-repo --template end-to-end

cd my-modeling-repo
dm validate-all --glob "models/**/*.model.yaml"
dm policy-check models/report/commerce_reporting.model.yaml --policy policies/end_to_end_dictionary.policy.yaml --inherit
dm resolve-project models
dm generate docs models/report/commerce_reporting.model.yaml --format html --out docs/dictionary/reporting-dictionary.html
```

## Example Models
- Showcase model: `model-examples/00-retail-ops-showcase.model.yaml`
- End-to-end dictionary example: `model-examples/end-to-end-dictionary/README.md`
- All scenario guides: `model-examples/README.md`

## Documentation Map
- Architecture: `docs/architecture.md`
- API contracts: `docs/api-contracts.md`
- YAML spec v1: `docs/yaml-spec-v1.md`
- YAML spec v2: `docs/yaml-spec-v2.md`
- Governance policy spec: `docs/governance-policy-spec.md`
- End-to-end modeling dictionary blueprint: `docs/end-to-end-modeling-dictionary.md`
- Observability SLOs: `docs/observability-slos.md`
- Backup and restore runbook: `docs/backup-restore-runbook.md`

## Open Source
- Contributing guide: `CONTRIBUTING.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- License: [![MIT License](https://img.shields.io/badge/License-MIT-22c55e?style=flat-square)](LICENSE)

## Community and Support
- Discord: [![Join Discord](https://img.shields.io/badge/Discord-Join%20DuckCode%20AI-5865F2?logo=discord&logoColor=white)](https://discord.gg/Dnm6bUvk)
- Issues: [![GitHub Issues](https://img.shields.io/badge/Issues-Report%20or%20Request-0ea5e9)](https://github.com/duckcode-ai/DuckCode-Modeling/issues)

## Notes
- Local connector profiles are stored in `.dm-connections.json`.
- Local project registry is stored in `.dm-projects.json`.
- CLI binary remains `dm` for compatibility.
