# Contributing to DuckCodeModeling

Thanks for contributing. This project includes a React web app, a Node API server, and a Python core/CLI.

## Development Setup
1. Clone the repository and enter the project root.
2. Install Node dependencies:
   - `npm --prefix packages/api-server install`
   - `npm --prefix packages/web-app install`
3. Create Python venv and install requirements:
   - `python3 -m venv .venv`
   - `source .venv/bin/activate`
   - `pip install -r requirements.txt`

## Run Locally
- API: `npm --prefix packages/api-server run dev`
- Web: `npm --prefix packages/web-app run dev`
- CLI example: `./dm validate model-examples/starter-commerce.model.yaml`

## Branch and PR Flow
1. Create a branch from `main`.
2. Keep changes focused and atomic.
3. Add or update tests for behavior changes.
4. Run relevant checks before opening PR.
5. Open PR with clear summary, impact, and test evidence.

## Recommended Checks
- Python unit tests:
  - `python3 -m unittest -v tests/test_mvp.py tests/test_cli_dx.py tests/test_policy_engine_v2.py`
- Web tests:
  - `npm --prefix packages/web-app test`
- Validate example models:
  - `./dm validate-all --schema schemas/model.schema.json`

## Commit Style
- Use short, imperative commit messages.
- Include scope when helpful, for example: `docs: update security policy`.

## Coding Expectations
- Keep changes backward compatible unless a breaking change is explicitly discussed.
- Update docs/examples when behavior or CLI output changes.
- Avoid committing secrets, credentials, or local environment files.

## Reporting Bugs and Requesting Features
- Open a GitHub issue with reproduction steps and expected behavior.
- For connector issues, include connector type, redacted config, and failing command/log excerpt.
