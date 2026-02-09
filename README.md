<div align="center">

# DataLex

**YAML-first, Git-native data modeling platform with an interactive visual diagram editor**

Define your data models in YAML. Visualize them as interactive ER diagrams.
Validate, diff, and govern — all from your browser or CLI.

[![GitHub Stars](https://img.shields.io/github/stars/duckcode-ai/DataLex?style=social)](https://github.com/duckcode-ai/DataLex)
[![Node.js](https://img.shields.io/badge/Node.js-18%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![Python](https://img.shields.io/badge/Python-3.9%2B-3776AB?logo=python&logoColor=white)](https://python.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)](https://react.dev/)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

[Getting Started](#quick-start) &bull; [Features](#features) &bull; [Web UI Guide](#web-ui-guide) &bull; [CLI Reference](#cli-reference) &bull; [Contributing](#contributing)

</div>

---

## Table of Contents

- [Overview](#overview)
- [Screenshots](#screenshots)
- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Web UI Guide](#web-ui-guide)
- [CLI Reference](#cli-reference)
- [YAML Model Format](#yaml-model-format)
- [Policy Packs](#policy-packs)
- [Project Structure](#project-structure)
- [Testing](#testing)
- [Troubleshooting](#troubleshooting)
- [Contributing](#contributing)

---

## Overview

**DataLex** is an open-source data modeling platform for teams that manage data models as code. Instead of using proprietary GUI tools, you define your entities, relationships, and governance rules in plain YAML files that live in Git alongside your code.

The platform provides:

- **Visual Web UI** — A React-based IDE with a split-pane YAML editor and interactive ER diagram
- **CLI toolchain** — Validate, lint, diff, compile, and generate SQL/dbt from the command line
- **Governance engine** — Policy packs enforce naming conventions, classification rules, and breaking change gates
- **Git-native workflow** — Models are plain files; use branches, PRs, and CI pipelines as usual

---

## Screenshots

> **Coming soon** — Screenshots of the visual diagram editor, lineage view, split-pane editor, and review panels will be added here.
>
> To see DataLex in action now, follow the [Quick Start](#quick-start) guide — it takes under 2 minutes.

<!--
Add screenshots here after launch:
![DataLex Diagram Editor](docs/screenshots/diagram-editor.png)
![Lineage View](docs/screenshots/lineage-view.png)
![YAML Editor + Diagram](docs/screenshots/split-pane.png)
-->

---

## Features

### Visual Diagram Editor
- **Interactive ER diagrams** powered by React Flow with ELK.js auto-layout
- **Fullscreen mode** — Expand the diagram to fill your entire screen for presentations or deep exploration
- **Lineage view** — Select any entity and explore upstream/downstream relationships with configurable depth (1–10 hops)
- **Entity count control** — Start with a manageable number of entities (e.g. 5) and expand incrementally with +/- buttons; most-connected entities appear first
- **Relationship color legend** — Visual key showing cardinality types (1:1, 1:N, N:1, N:N) with distinct colors
- **Search with autocomplete** — Find entities instantly across large models
- **Smart dimming** — Unrelated entities fade when you select one, highlighting the neighborhood
- **Zoom range 0.05x–3x** — Navigate models with 200+ entities comfortably
- **MiniMap** — Always-visible overview for orientation in large diagrams

### Split-Pane Editor
- **CodeMirror 6 YAML editor** with syntax highlighting, line numbers, and bracket matching
- **Live preview** — Diagram updates as you type
- **Resizable panes** — Drag the divider to allocate space between editor and diagram

### Entity Nodes
- **Color-coded by type** (table, view, etc.)
- **Field badges** — PK (primary key), FK (foreign key), UQ (unique) indicators
- **Governance tags** — PII, GOLD, and custom classification badges
- **Collapsible fields** — Show all fields, keys only, or top 8

### Review Panels
- **Entity Properties** — View and edit entity details, fields, and tags
- **Validation** — Real-time model quality checks with error/warning/info severity
- **Diff & Gate** — Semantic diff between model versions with breaking change detection
- **Impact Analysis** — Upstream/downstream dependency analysis
- **History** — Track changes within your editing session

### Toolbar Controls (All in One Place)
- View mode toggle (All / Lineage)
- Entity count +/- stepper
- Lineage depth control
- Type and tag filters
- Layout algorithm (ELK auto / Grid)
- Layout density (Compact / Normal / Wide)
- Field visibility (All / Keys Only / Top 8)
- Edge label toggle
- Dim unrelated toggle
- Relationship color legend
- Fullscreen toggle

### CLI Toolchain
- Validate, lint, and compile YAML models
- Semantic diff between model versions
- Quality gate for CI pipelines (block breaking changes)
- Generate SQL (Postgres/Snowflake), dbt models, and metadata JSON
- Import from SQL DDL and DBML formats
- Policy-based governance checks

### Other
- **Offline mode** — Works without the API server using browser localStorage
- **Keyboard shortcuts** — `Cmd+S` / `Ctrl+S` to save
- **Local project folders** — Point to any folder containing `*.model.yaml` files

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| **Node.js** | 18+ | Web UI and API server |
| **npm** | 9+ | Package management (comes with Node.js) |
| **Python** | 3.9+ | CLI toolchain (optional, only needed for CLI) |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
```

### 2. Install the Web UI dependencies

```bash
# API server
cd packages/api-server
npm install

# Web app
cd ../web-app
npm install
```

### 3. Install CLI dependencies (optional)

```bash
# From the project root
pip install -r requirements.txt
```

---

## Quick Start

### Option A: One-command startup (recommended)

```bash
chmod +x start-dev.sh
./start-dev.sh
```

This starts both the API server (port 3001) and the web app (port 5173).

### Option B: Manual startup

**Terminal 1 — API Server:**
```bash
cd packages/api-server
npm run dev
```

**Terminal 2 — Web App:**
```bash
cd packages/web-app
npm run dev
```

### 3. Open the app

Navigate to **http://localhost:5173** in your browser.

The app ships with example models in `model-examples/` that load automatically. Click any `.model.yaml` file in the sidebar to see the YAML editor and interactive diagram side by side.

---

## Web UI Guide

### Getting Started

1. **Open a model file** — Click a `.model.yaml` file in the left sidebar
2. **Explore the diagram** — The right pane shows an interactive ER diagram
3. **Edit YAML** — Changes in the editor update the diagram in real-time
4. **Save** — Press `Cmd+S` (Mac) or `Ctrl+S` (Windows/Linux)

### Diagram Navigation

| Action | How |
|--------|-----|
| **Pan** | Click and drag on empty canvas |
| **Zoom** | Scroll wheel or pinch gesture |
| **Fit to view** | Click the fit-view button in bottom-left controls |
| **Select entity** | Click any entity node |
| **Deselect** | Click empty canvas |
| **Fullscreen** | Click the expand icon (top-right of toolbar) |
| **Exit fullscreen** | Press `Escape` or click the minimize icon |

### Lineage View

1. Click **"Lineage"** in the toolbar to switch to lineage mode
2. Click any entity node — only related entities within N hops are shown
3. Use the **Depth +/-** control to expand from 1 to 10 hops
4. Click **"All"** to return to the full diagram view

### Entity Count Control

For large models with many entities:

1. Use the **−** button to reduce visible entities (decrements by 5)
2. Use the **+** button to show more entities (increments by 5)
3. Entities are sorted by relationship count — most connected appear first
4. Click **"All"** to show every entity

### Adding a Project Folder

1. Click the **"+"** button next to "Projects" in the sidebar
2. Enter the absolute path to a folder containing `*.model.yaml` files
3. The folder's YAML files appear in the sidebar file tree

### Review Panels

Click the tabs at the bottom of the screen:

- **Properties** — Entity details, fields, relationships, governance info
- **Validation** — Real-time quality checks (errors, warnings, info)
- **Diff & Gate** — Compare baseline vs. current model, detect breaking changes
- **Impact** — Upstream/downstream dependency graph
- **History** — Session change log

---

## CLI Reference

The `dm` CLI provides command-line access to all modeling operations. Run from the project root:

```bash
# Make the CLI executable (first time only)
chmod +x dm
```

### Core Commands

```bash
# Validate a model against the schema
./dm validate model-examples/starter-commerce.model.yaml

# Lint for best practices
./dm lint model-examples/starter-commerce.model.yaml

# Compile to canonical JSON
./dm compile model-examples/starter-commerce.model.yaml --out /tmp/canonical.json

# Semantic diff between two model versions
./dm diff model-examples/real-scenarios/fintech-risk-baseline.model.yaml \
         model-examples/real-scenarios/fintech-risk-change.model.yaml

# Quality gate (fails on breaking changes — use in CI)
./dm gate model-examples/real-scenarios/fintech-risk-baseline.model.yaml \
          model-examples/real-scenarios/fintech-risk-change.model.yaml
```

### Code Generation

```bash
# Generate SQL DDL (Postgres or Snowflake)
./dm generate sql model-examples/starter-commerce.model.yaml --dialect postgres --out model.sql

# Generate dbt models
./dm generate dbt model-examples/starter-commerce.model.yaml --out-dir ./dbt

# Generate metadata JSON
./dm generate metadata model-examples/starter-commerce.model.yaml --out metadata.json
```

### Import

```bash
# Import from SQL DDL
./dm import sql schema.sql --out imported.model.yaml

# Import from DBML
./dm import dbml schema.dbml --out imported.model.yaml
```

### Governance

```bash
# Check against a policy pack
./dm policy-check model-examples/starter-commerce.model.yaml \
  --policy policies/default.policy.yaml

# Validate all models in a directory
./dm validate-all --glob "**/*.model.yaml"
```

### Full Command List

| Command | Description |
|---------|-------------|
| `dm init --path .` | Initialize a new model project |
| `dm validate <model>` | Validate against schema |
| `dm lint <model>` | Lint for best practices |
| `dm compile <model>` | Compile to canonical JSON |
| `dm diff <old> <new>` | Semantic diff between versions |
| `dm gate <old> <new>` | Quality gate (CI-friendly) |
| `dm validate-all` | Validate all models in a directory |
| `dm policy-check <model>` | Check governance policies |
| `dm generate sql <model>` | Generate SQL DDL |
| `dm generate dbt <model>` | Generate dbt models |
| `dm generate metadata <model>` | Generate metadata JSON |
| `dm import sql <file>` | Import from SQL DDL |
| `dm import dbml <file>` | Import from DBML |
| `dm print-schema` | Print the model JSON schema |
| `dm print-policy-schema` | Print the policy JSON schema |

---

## YAML Model Format

Models are defined in `.model.yaml` files. Here's a minimal example:

```yaml
model:
  name: commerce
  version: 1.0.0
  domain: sales
  owners:
    - data-platform@company.com
  state: draft

entities:
  - name: Customer
    type: table
    description: Customer master record
    tags: [PII, GOLD]
    fields:
      - name: customer_id
        type: integer
        primary_key: true
        nullable: false
      - name: email
        type: string
        nullable: false
        unique: true

  - name: Order
    type: table
    fields:
      - name: order_id
        type: integer
        primary_key: true
        nullable: false
      - name: customer_id
        type: integer
        nullable: false
      - name: total_amount
        type: decimal(12,2)
        nullable: false

relationships:
  - name: customer_orders
    from: Customer.customer_id
    to: Order.customer_id
    cardinality: one_to_many

governance:
  classification:
    Customer.email: PII
  stewards:
    sales: owner-sales@company.com

rules:
  - name: order_total_non_negative
    target: Order.total_amount
    expression: "value >= 0"
    severity: error
```

### Supported Field Types

`string`, `integer`, `bigint`, `decimal(p,s)`, `boolean`, `date`, `timestamp`, `json`, `uuid`, `text`, `float`, `double`, `binary`, `array`, `map`

### Cardinality Types

| Value | Meaning |
|-------|---------|
| `one_to_one` | 1:1 relationship |
| `one_to_many` | 1:N relationship |
| `many_to_one` | N:1 relationship |
| `many_to_many` | N:N relationship |

For the full YAML specification, see [`docs/yaml-spec-v1.md`](docs/yaml-spec-v1.md).

---

## Policy Packs

Policy packs define governance rules that are checked against your models:

| Policy | Description |
|--------|-------------|
| `policies/default.policy.yaml` | Baseline governance (naming conventions, required fields) |
| `policies/strict.policy.yaml` | Stricter production rules (classification required, no nullable PKs) |

Policy schema: `schemas/policy.schema.json`

See [`docs/governance-policy-spec.md`](docs/governance-policy-spec.md) for details.

---

## Project Structure

```
DataLex/
├── packages/
│   ├── api-server/              # Express.js API server (port 3001)
│   │   ├── index.js             # Server entry point
│   │   └── package.json
│   ├── web-app/                 # React 18 web application (port 5173)
│   │   ├── src/
│   │   │   ├── App.jsx          # Main application layout
│   │   │   ├── components/
│   │   │   │   ├── diagram/     # DiagramCanvas, DiagramToolbar, EntityNode
│   │   │   │   ├── editor/      # YamlEditor (CodeMirror 6)
│   │   │   │   ├── layout/      # Sidebar, TopBar, StatusBar
│   │   │   │   ├── panels/      # EntityPanel, ValidationPanel, DiffPanel,
│   │   │   │   │                #   ImpactPanel, HistoryPanel
│   │   │   │   └── shared/      # Reusable UI components
│   │   │   ├── stores/          # Zustand state management
│   │   │   │   ├── diagramStore.js    # Diagram nodes, edges, viz settings
│   │   │   │   ├── uiStore.js         # UI layout, modals, fullscreen
│   │   │   │   └── workspaceStore.js  # Projects, files, content
│   │   │   ├── lib/             # elkLayout.js, api.js
│   │   │   ├── modelQuality.js  # Validation, diff, gate engine
│   │   │   ├── modelToFlow.js   # YAML model → React Flow conversion
│   │   │   └── styles/          # Tailwind CSS globals
│   │   ├── vite.config.js
│   │   └── package.json
│   ├── core_engine/             # Python core: parser, linter, compiler, diff
│   └── cli/                     # Python CLI entry point
├── model-examples/              # Example YAML models
│   ├── starter-commerce.model.yaml
│   └── real-scenarios/          # Complex fintech & retail models
├── schemas/                     # JSON schemas for validation
│   ├── model.schema.json
│   └── policy.schema.json
├── policies/                    # Governance policy packs
│   ├── default.policy.yaml
│   └── strict.policy.yaml
├── docs/                        # Documentation
│   ├── yaml-spec-v1.md
│   ├── architecture.md
│   ├── governance-policy-spec.md
│   └── api-contracts.md
├── tests/                       # Python test suite
├── dm                           # CLI entry point
├── start-dev.sh                 # One-command dev startup
└── requirements.txt             # Python dependencies
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| **Frontend** | React 18, Vite 5, Tailwind CSS 4 |
| **Diagram** | React Flow (@xyflow/react), ELK.js |
| **Editor** | CodeMirror 6 (@uiw/react-codemirror) |
| **State** | Zustand 5 |
| **Icons** | Lucide React |
| **Layout** | Allotment (resizable panes) |
| **API Server** | Express.js 4 |
| **CLI** | Python 3.9+, PyYAML, jsonschema |

---

## Testing

### Python tests (CLI and core engine)

```bash
python3 -m unittest -q \
  tests/test_mvp.py \
  tests/test_real_scenarios.py \
  tests/test_integrations.py \
  tests/test_performance.py
```

### Web app build check

```bash
cd packages/web-app
npm run build
```

### CI Pipeline

The project includes a GitHub Actions workflow (`.github/workflows/model-quality.yml`) that runs validation and quality gates on every push.

---

## Troubleshooting

### "Cannot connect to API server"

The web app falls back to **offline mode** (localStorage) if the API server isn't running. To use file-based projects:

```bash
cd packages/api-server
npm install
npm run dev
```

Verify it's running: `curl http://localhost:3001/api/projects`

### Diagram not showing

1. Make sure you have a valid `.model.yaml` file open (check the Validation panel for errors)
2. The model must have at least one entity with fields
3. Try clicking **"All"** in the entity count control to reset any limit

### Port conflicts

- API server default: **3001** (configured in `packages/api-server/index.js`)
- Web app default: **5173** (configured by Vite)

If port 3001 is in use, the web app's Vite proxy (`/api → localhost:3001`) won't connect. Kill the conflicting process or change the port.

### Node.js version

This project requires **Node.js 18+** for the `--watch` flag used in the API server dev mode. Check your version:

```bash
node --version
```

---

## Contributing

We welcome contributions! DataLex is built by the community, for the community.

1. **Fork** the repository
2. **Create a branch** for your feature: `git checkout -b feature/my-feature`
3. **Make changes** — the web app supports hot module replacement (HMR), so changes appear instantly
4. **Test** — Run the Python test suite and verify the web app builds
5. **Submit a PR** with a clear description of what changed and why

### Development workflow

```bash
# Start both servers with hot reload
./start-dev.sh

# The web app auto-reloads on file changes
# The API server auto-restarts with --watch flag

# Build check before committing
cd packages/web-app && npm run build
```

### Adding a new example model

1. Create a `.model.yaml` file in `model-examples/`
2. Follow the format in `model-examples/starter-commerce.model.yaml`
3. The file will automatically appear in the UI sidebar

### Ideas for contributions

- Additional code generators (e.g. BigQuery, Redshift, Spark)
- New import formats (e.g. Avro, Protobuf, JSON Schema)
- Dark theme toggle
- Collaborative editing support
- Additional layout algorithms
- More example models for different industries

---

## License

This project is licensed under the [MIT License](LICENSE).

---

<div align="center">

**If you find DataLex useful, please consider giving it a star!**

[![GitHub Stars](https://img.shields.io/github/stars/duckcode-ai/DataLex?style=social)](https://github.com/duckcode-ai/DataLex)

Built with React, React Flow, CodeMirror, ELK.js, and Tailwind CSS

Made with care by [duckcode.ai](https://github.com/duckcode-ai)

</div>
