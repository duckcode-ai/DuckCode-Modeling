<div align="center">
  <a href="https://duckcode.ai/" target="_blank" rel="noopener noreferrer">
    <img src="Assets/DataLex.png" alt="DataLex by DuckCode AI Labs" width="180" />
  </a>

# DataLex

**Enterprise data modeling and metadata intelligence platform**

Built by [DuckCode AI Labs](https://duckcode.ai/).  
Official repository for DataLex UI, API, and CLI.

Design, validate, and govern data models with a visual UI and a Python CLI.
</div>

## Purpose
DataLex helps data teams treat models as code.

- Define models in YAML (`*.model.yaml`)
- Explore relationships in an interactive diagram
- Validate quality and governance rules
- Track changes with Git workflows
- Pull schemas from databases into model files

## What You Get
- React web app for modeling and exploration
- Node API server for file/project operations and connector endpoints
- Python CLI (`dm`) for validation, import, generation, and schema pull

## Product Screenshots
### Overview
![DataLex Overview](screenshots/overview.png)

### Search
![DataLex Search](screenshots/search.png)

## Prerequisites
- Node.js 18+
- npm 9+
- Python 3.9+
- Git
- Docker (optional, for container install)

## Local Install (Recommended for Development)
### 1. Clone
```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
```

### 2. Install Node dependencies
```bash
npm --prefix packages/api-server install
npm --prefix packages/web-app install
```

### 3. Create Python virtual environment
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

### 4. Run the app locally
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

### Recommended showcase model
Open this model to explore a complete real scenario with dictionary/governance/indexes/views/snapshots:

`model-examples/00-retail-ops-showcase.model.yaml`

### Example guides (step-by-step)
Per-example review guides are available for every sample YAML file:

`model-examples/README.md`

## Docker Install (Simple Single-Container Run)
The Docker image builds the web UI and serves it from the API server.

### 1. Build image
```bash
docker build -t datalex:latest .
```

### 2. Run container
```bash
docker run --rm -p 3001:3001 datalex:latest
```

Open: `http://localhost:3001`

### Optional: mount your model folder
If you want to browse host model files from inside the container:
```bash
docker run --rm -p 3001:3001 \
  -v /absolute/path/to/your/models:/workspace/models \
  datalex:latest
```
Then add project path `/workspace/models` from the UI.

## CLI Quick Start
Activate venv first:
```bash
source .venv/bin/activate
```

Examples:
```bash
./dm validate model-examples/starter-commerce.model.yaml
./dm stats model-examples/starter-commerce.model.yaml
./dm import sql model-examples/schema.sql --out model-examples/imported.model.yaml
```

## Notes
- Local connector profiles are stored in `.dm-connections.json`.
- Local project registry is stored in `.dm-projects.json`.
- `.claude`, `.vscode`, `.idea`, and local runtime files are git-ignored.
- Support community (Discord): `https://discord.gg/Dnm6bUvk`

## License
MIT. See `LICENSE`.
