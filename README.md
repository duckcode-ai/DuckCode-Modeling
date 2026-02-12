<div align="center">
  <a href="https://duckcode.ai/" target="_blank" rel="noopener noreferrer">
    <img src="Assets/DuckCodeModeling.png" alt="DuckCodeModeling by DuckCode AI Labs" width="220" />
  </a>

# DuckCodeModeling

**YAML-first data modeling and metadata intelligence platform**

Open source UI, API, and CLI for modeling, governance, and schema-aware workflows.
</div>

## Why DuckCodeModeling
DuckCodeModeling helps data teams treat data models as versioned code.

- Define models in YAML (`*.model.yaml`)
- Explore entities and relationships in a visual graph UI
- Validate structure, quality, and governance policies
- Track diffs and compatibility gates in CI
- Pull physical schemas from databases into model files

## What Is Included
- `packages/web-app`: React + Vite modeling studio
- `packages/api-server`: Node.js API for project/files/connectors operations
- `packages/core_engine`: Python core engine (validation, policy, docs, importers)
- `packages/cli`: Python CLI (`dm`) entry points and commands
- `model-examples`: sample models and guided scenario walkthroughs
- `schemas`: JSON schema contracts
- `policies`: baseline and strict policy packs
- `docs`: architecture, specs, SLOs, runbooks

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
cd DuckCodeModeling

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

## Example Models
- Showcase model: `model-examples/00-retail-ops-showcase.model.yaml`
- All scenario guides: `model-examples/README.md`

## Documentation Map
- Architecture: `docs/architecture.md`
- API contracts: `docs/api-contracts.md`
- YAML spec v1: `docs/yaml-spec-v1.md`
- YAML spec v2: `docs/yaml-spec-v2.md`
- Governance policy spec: `docs/governance-policy-spec.md`
- Observability SLOs: `docs/observability-slos.md`
- Backup and restore runbook: `docs/backup-restore-runbook.md`

## Open Source
- Contributing guide: `CONTRIBUTING.md`
- Code of Conduct: `CODE_OF_CONDUCT.md`
- Security policy: `SECURITY.md`
- License: `LICENSE`

## Community and Support
- Discord: `https://discord.gg/Dnm6bUvk`
- Issues: `https://github.com/duckcode-ai/DuckCode-Modeling/issues`

## Notes
- Local connector profiles are stored in `.dm-connections.json`.
- Local project registry is stored in `.dm-projects.json`.
- CLI binary remains `dm` for compatibility.
