# Contributing to DataLex

Thanks for contributing. This project is a monorepo with three pieces:

- `packages/core_engine/` — Python loader, dialects, dbt integration, packages
- `packages/api-server/` — Node.js API the web UI talks to
- `packages/web-app/` — React/Vite studio (Zustand + React Flow)
- `packages/cli/` — `datalex` entry point

## Development setup

### Prerequisites

- **Python 3.9+** with `pip` and `venv`
- **Node 20+** (`nvm use 20` if you use nvm)
- **Git**

### One-time bootstrap

```bash
git clone https://github.com/duckcode-ai/DataLex.git
cd DataLex
python3 -m venv .venv && source .venv/bin/activate
pip install -e '.[serve,duckdb]'      # core_engine + CLI + connector
npm --prefix packages/api-server install
npm --prefix packages/web-app install
```

`pip install -e '.[serve,duckdb]'` installs `datalex_core` + the `datalex`
CLI in editable mode and pulls the bundled Node runtime used by
`datalex serve`. Add more connector extras as needed:
`'.[serve,postgres,snowflake,bigquery,databricks]'`.

## Running locally

Two supported modes:

### Single-command (production-like)

```bash
datalex serve --project-dir .
```

Serves the API and the pre-built web bundle together on
`http://localhost:3030`. Uses the portable Node that `[serve]`
installed. Good for smoke-testing a change in a real browser.

### Hot-reload (for UI work)

Two terminals:

```bash
# Terminal 1 — API on :3006
npm --prefix packages/api-server run dev

# Terminal 2 — Vite dev server on :5173 with HMR
#   (vite.config.js proxies /api → :3006 for you)
npm --prefix packages/web-app run dev
```

Open `http://localhost:5173`. The Vite proxy forwards every `/api/*`
call to the api-server, so the UI talks to the live backend while
HMR rebuilds React components on save.

CLI during development (for package-level hacks): `./datalex <cmd>`.

## Testing

### Python (core_engine + datalex)

```bash
python3 -m unittest -v tests/test_mvp.py tests/test_cli_dx.py tests/test_policy_engine_v2.py
./datalex validate-all --schema schemas/model.schema.json
```

### API server

```bash
npm --prefix packages/api-server test
```

### Web app — unit tests (fast, no browser)

```bash
npm --prefix packages/web-app test
```

Runs everything in `packages/web-app/tests/*.test.js` via Node's
built-in test runner.

### Web app — Playwright end-to-end (local-dev only)

```bash
# One-time: install browsers
npx --prefix packages/web-app playwright install chromium

# Clone + parse the DataLex-ready jaffle-shop fixture once (needs dbt-duckdb)
cd packages/web-app/test-results/jaffle-shop   # created by global-setup
pip install dbt-duckdb && dbt deps && dbt parse --profiles-dir .

# Run the suite (starts api + vite via Playwright webServer)
npm --prefix packages/web-app run test:e2e
```

The E2E suite clones `https://github.com/duckcode-ai/jaffle-shop-DataLex` into
`packages/web-app/test-results/jaffle-shop/` on first run and reuses
the checkout afterwards. It drives the real user journey: import →
diagram → (with `E2E_FULL=1`) rename cascade → autosave → auto-commit
→ dry-run apply.

**CI does not run this suite.** It requires dbt-core + a parsed
manifest on disk, which is too heavy and too flaky for every PR. The
backend contracts are already covered by api-server unit tests; the
Playwright suite is a local-dev regression tool for UI changes.
See [packages/web-app/e2e/README.md](packages/web-app/e2e/README.md).

## Branch and PR flow

1. Create a branch from `main`.
2. Keep changes focused and atomic.
3. Add or update tests for behavior changes (unit **and** E2E when the
   change affects the UI loop).
4. Run the relevant test suites locally before opening the PR.
5. Open the PR with a clear summary, user-visible impact, and test
   evidence.

CI runs on every PR:

- `api-server-tests.yml` — `packages/api-server/` unit tests
- `model-quality.yml` — core_engine unit tests + policy checks
- `datalex.yml` — `datalex validate` / `diff` / `dbt emit` on touched
  DataLex projects

Playwright E2E is **not** in CI — run it locally before opening a PR
that changes import, canvas, or save-path behavior.

## Commit style

- Short, imperative commit messages.
- Include scope when helpful: `docs: update contributing guide`,
  `web-app: drop bundled jaffle-shop fixture`.

## Coding expectations

- Keep changes backward compatible unless a breaking change is
  explicitly discussed.
- Update docs/examples when behavior or CLI output changes.
- Avoid committing secrets, credentials, or local environment files.

## Reporting bugs / requesting features

- Open a GitHub issue with reproduction steps and expected behavior.
- For connector issues, include connector type, redacted config, and
  the failing command/log excerpt.

## Cutting a release

See [RELEASING.md](RELEASING.md) for the full process. Short version:
bump `project.version` in `pyproject.toml`, move items from
`[Unreleased]` into a new dated section in `CHANGELOG.md`, merge, then
push a signed `vX.Y.Z` tag. CI publishes to PyPI automatically.
