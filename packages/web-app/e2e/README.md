# DataLex web-app E2E tests (local-dev only)

Playwright end-to-end suite that exercises the real user journey against
a real cloned dbt project (by default [duckcode-ai/jaffle-shop-DataLex][jaffle]).
**This suite does not run in CI** — it needs dbt-core installed and a
parsed `target/manifest.json` on disk, which is too heavy and too flaky
for every PR. It stays in the tree as a local-dev tool for changes that
touch the import or canvas flow.

[jaffle]: https://github.com/duckcode-ai/jaffle-shop-DataLex

## What runs

- `global-setup.js` clones jaffle-shop DataLex into
  `packages/web-app/test-results/jaffle-shop/` once per machine, cached
  on subsequent runs.
- Before you run the spec, **you must parse the dbt project once** so
  `target/manifest.json` exists:
  ```bash
  cd packages/web-app/test-results/jaffle-shop
  pip install dbt-duckdb
  dbt deps
  dbt parse --profiles-dir .   # or point DBT_PROFILES_DIR at your own
  ```
- `critical-path.spec.js` drives the loop: import local folder → open
  project → (with `E2E_FULL=1`) rename cascade, autosave, auto-commit,
  Apply-to-Warehouse dry run.
- `import-api.spec.js` hits `/api/dbt/import` directly — no DOM — for a
  cheap regression gate on the importer contract.

## Running locally

```bash
# From repo root, one-time:
npm --prefix packages/web-app install
npx --prefix packages/web-app playwright install chromium

# Run the full suite (starts api + web via Playwright webServer):
npm --prefix packages/web-app run test:e2e

# Interactive mode:
npm --prefix packages/web-app run test:e2e:ui

# Full rename/autosave/commit/apply-ddl loop (selectors flagged as TODO):
E2E_FULL=1 npm --prefix packages/web-app run test:e2e
```

## Offline / air-gapped

`OFFLINE=1 npm run test:e2e` short-circuits the clone so the rest of
the test tooling still compiles. You'll need a real parsed checkout for
the critical-path spec to pass — there's no local fallback by design.

## Why this isn't in CI

Running the full suite in CI would require: (1) a live network clone
of jaffle-shop DataLex, (2) a Python dbt-core install, (3) `dbt parse` to emit
`manifest.json`, (4) a Playwright browser install, (5) a real webServer
boot. That's multiple minutes of setup per PR plus flakiness on any
link in the chain. The backend contract it guards is already covered by
the api-server unit tests; the UI path it guards is caught faster by
dev-local runs while iterating. If we later want a CI-safe smoke, the
right move is to check in a tiny pre-parsed fixture instead of pulling
from the network.
