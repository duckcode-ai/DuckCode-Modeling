# DataLex Readiness Gate

Score a dbt project against DataLex modeling standards on every pull request.
Posts a sticky PR comment with the red/yellow/green breakdown, uploads SARIF
to the GitHub Security tab, and fails the build when thresholds are breached.

## Quick start

```yaml
# .github/workflows/datalex-readiness.yml
name: DataLex Readiness
on:
  pull_request:
permissions:
  contents: read
  issues: write           # for sticky PR comments
  pull-requests: write
  security-events: write  # for SARIF upload
jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: duckcode-ai/DataLex/actions/datalex-gate@main
        with:
          project-path: .
          min-score: 85
          changed-only: true
          base-ref: origin/${{ github.base_ref }}
```

## Inputs

| Name | Default | Description |
|---|---|---|
| `project-path` | `.` | Path to the dbt project root. |
| `python-version` | `3.11` | Python interpreter for the gate. |
| `min-score` | _(unset)_ | Fail when project score falls below this value. |
| `max-yellow` | _(unset)_ | Fail when yellow file count exceeds this value. |
| `max-red` | `0` | Fail when red file count exceeds this value. |
| `allow-errors` | `false` | Don't fail on error-severity findings. |
| `changed-only` | `false` | Only score files changed vs `base-ref`. |
| `base-ref` | `origin/main` | Base ref for `changed-only`. |
| `upload-sarif` | `true` | Upload SARIF results to the Security tab. |
| `pr-comment` | `true` | Post a sticky PR comment summary. |
| `datalex-version` | _(latest)_ | Pin a specific `datalex-cli` version. |

## Outputs

- `score` — project readiness score (0-100)
- `status` — `green` | `yellow` | `red`
- `sarif-path` — path to the generated SARIF file

## Local equivalent

The same scoring logic runs in your terminal:

```bash
pip install datalex-cli
datalex readiness-gate --project . --min-score 85 \
  --sarif out.sarif --pr-comment out.md
```
