# Tutorial: CI readiness gate

Wire DataLex's red / yellow / green readiness review into your CI so
every PR gets a sticky comment with the score, SARIF results in the
GitHub Security tab, and a build that fails when the project regresses.

You'll end with:

- A `.github/workflows/datalex-readiness.yml` workflow that posts a
  PR comment + uploads SARIF
- A `datalex readiness-gate` command you can run locally to reproduce
  the same scoring
- Confidence that the rules in CI match the rules editors run in the
  Validation drawer (single source of truth, shared
  `packages/readiness_engine` Python package)

**Time:** 5 minutes. **Prerequisites:**

- Python 3.9+ (3.11 recommended in CI for dbt compatibility)
- A GitHub repository with Actions enabled
- A dbt project with at least a few `.yml` files in it

> Shipped in **DataLex 1.4.0**. The CLI and the Action share scoring
> with the api-server's `/api/dbt/review` endpoint, so the badges in
> Explorer match what CI sees.

---

## What gets scored

Each YAML file gets a per-file score (0-100) and a status (`red` <60
or any error · `yellow` <85 or any warning · `green` ≥85). The project
score is the average. Findings come from these categories:

| Category              | Examples |
|-----------------------|----------|
| `metadata`            | Missing model description, owner, domain, column descriptions |
| `dbt_quality`         | Missing identity tests, FK tests, contract review nudges |
| `governance`          | Sensitive (PII/PHI/PCI) columns without classification |
| `import_health`       | YAML parse errors, no columns, unknown column types |
| `modeling`            | Fact model without grain, staging materialization mismatch |
| `enterprise_modeling` | Unclassified YAML, no semantic_models opportunity |

Custom rule packs in `<project>/.datalex/policies/*.yaml` add their own
findings on top — see [Tutorial: Custom policy packs](policy-packs.md).

---

## Step 1 — Install the CLI locally and reproduce the score

```bash
pip install -U 'datalex-cli'
cd ~/path/to/your-dbt-project
datalex readiness-gate --project . --output-json | jq '.summary'
```

You should see something like:

```json
{
  "total_files": 29,
  "red": 4,
  "yellow": 11,
  "green": 14,
  "findings": 158,
  "errors": 4,
  "warnings": 41,
  "infos": 113,
  "score": 78
}
```

Inspect the worst-offending files:

```bash
datalex readiness-gate --project . --output-json \
  | jq '.files | sort_by(.score) | .[:5] | .[] | {status, score, path}'
```

Pick a `min-score` value that's **at or just below** today's score so
the first PR doesn't regress. You can ratchet it up over time as the
project improves.

## Step 2 — Drop in the GitHub Action

Create `.github/workflows/datalex-readiness.yml`:

```yaml
name: DataLex readiness
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: read
  issues: write           # sticky PR comment
  pull-requests: write
  security-events: write  # SARIF upload

jobs:
  readiness:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0          # required for --changed-only

      - uses: duckcode-ai/DataLex/actions/datalex-gate@main
        with:
          project-path: .
          min-score: 78           # today's baseline; ratchet up later
          changed-only: true
          base-ref: origin/${{ github.base_ref || 'main' }}
```

Commit, push, open a PR. Within ~30 seconds the workflow:

1. Checks out the repo with full history.
2. Installs `datalex-cli` from PyPI.
3. Runs `datalex readiness-gate --project . --sarif … --pr-comment …`.
4. Posts a sticky PR comment with the red/yellow/green table.
5. Uploads SARIF so the GitHub Security tab and PR file annotations
   light up the offending lines.
6. Fails the job if any threshold is breached.

## Step 3 — Inspect the sticky PR comment

The Action posts (or updates) a comment that looks like:

```markdown
## DataLex readiness 🟢

**Score:** 92 · red 0 · yellow 1 · green 4
**Findings:** 0 error(s), 1 warning(s), 3 info

| Status | File                           | Score | Errors | Warnings |
|--------|--------------------------------|-------|--------|----------|
| 🟡     | `models/marts/fct_revenue.yml` | 85    | 0      | 1        |
| 🟢     | `models/staging/stg_orders.yml`| 100   | 0      | 0        |
| …
```

The comment is sticky on the marker `<!-- datalex-readiness-gate -->`
so subsequent pushes to the PR update the same comment instead of
piling up. Reviewers can ignore the workflow re-runs and just read the
latest comment.

## Step 4 — Ratchet the threshold

Once the team has a few PRs at score X with no regressions, raise
`min-score` toward 85+. The Action's `min-score` is a **floor**, not a
target — anything above it is fine, anything below fails. A typical
adoption curve:

| Week | min-score | What's expected                                |
|------|-----------|------------------------------------------------|
| 1    | 70        | Today's score. Just stop the bleeding.         |
| 2-3  | 78        | Fix red files. Yellow is fine.                 |
| 4-6  | 85        | Most files green. Yellow needs a story.        |
| 7+   | 90        | Green-by-default. Yellow is an exception.      |

Combine with `--max-red 0` to fail fast on any red file, regardless
of the average score.

## Step 5 — Add the CLI to your local pre-commit (optional)

If you want the same score before pushing:

```bash
# Run on changed files only, fail fast if score drops below 78
datalex readiness-gate --project . \
  --changed-only --base-ref origin/main \
  --min-score 78
```

Add a `Makefile` target so reviewers can reproduce CI locally:

```makefile
readiness-gate:
	datalex readiness-gate --project . --min-score 78 \
	  --sarif datalex-readiness.sarif \
	  --pr-comment datalex-readiness.md
```

Run with `make readiness-gate`.

## Step 6 — Pull SARIF into the GitHub Security tab

The Action's `upload-sarif: true` (default) pushes the
`datalex-readiness.sarif` file to GitHub's code-scanning feature. Your
**Security → Code scanning** tab now shows DataLex findings alongside
CodeQL / Snyk / etc. — useful for reviewers who already live in that
view.

If your repo doesn't allow `security-events: write`, set
`upload-sarif: false` and rely on the PR comment alone.

## Step 7 — Combine with custom rules

The readiness gate respects `<project>/.datalex/policies/*.yaml`. Drop
a pack with org-specific rules in there and CI picks them up
automatically — no Action input needed:

```yaml
# .datalex/policies/my-org.yaml
pack:
  name: my-org-standards
  version: 0.1.0
  extends: datalex/standards/base.yaml

policies:
  - id: stg_naming
    type: regex_per_layer
    severity: warn
    params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"

  - id: marts_meta
    type: required_meta_keys
    severity: error
    params:
      keys: [owner, grain]
      selectors:
        layer: fct
```

→ Full reference: [Custom policy packs](policy-packs.md).

## Common patterns

**Different floor for `main` push vs PR:**
```yaml
- uses: duckcode-ai/DataLex/actions/datalex-gate@main
  with:
    project-path: .
    min-score: ${{ github.event_name == 'pull_request' && 78 || 85 }}
    changed-only: ${{ github.event_name == 'pull_request' }}
```

**Skip the gate for docs-only changes:**
```yaml
on:
  pull_request:
    paths-ignore:
      - 'docs/**'
      - '*.md'
```

**Pin the `datalex-cli` version explicitly:**
```yaml
- uses: duckcode-ai/DataLex/actions/datalex-gate@main
  with:
    project-path: .
    datalex-version: '1.4.0'
```

## Action inputs reference

| Name | Default | Description |
|------|---------|-------------|
| `project-path` | `.` | Path to the dbt project root. |
| `python-version` | `3.11` | Python interpreter for the gate. |
| `min-score` | _(unset)_ | Fail when project score falls below this value. |
| `max-yellow` | _(unset)_ | Fail when yellow file count exceeds this value. |
| `max-red` | `0` | Fail when red file count exceeds this value. |
| `allow-errors` | `false` | Don't fail on error-severity findings. |
| `changed-only` | `false` | Only score files changed vs `base-ref`. |
| `base-ref` | `origin/main` | Base ref for `changed-only`. |
| `upload-sarif` | `true` | Upload SARIF to the Security tab. |
| `pr-comment` | `true` | Post a sticky PR comment summary. |
| `datalex-version` | _(latest)_ | Pin a specific `datalex-cli` version. |

| Output | Description |
|--------|-------------|
| `score` | Project readiness score 0-100. |
| `status` | Aggregate status: `green` / `yellow` / `red`. |
| `sarif-path` | Path to the generated SARIF file. |

## Troubleshooting

| Symptom | Fix |
|---|---|
| Action fails: "fatal: bad revision 'origin/main...HEAD'" | The checkout didn't fetch enough history. Set `fetch-depth: 0` in the `actions/checkout@v4` step. |
| "datalex_readiness is not installed" | The `datalex-cli` install step failed; check the Python version and pip output above the gate step. |
| Sticky PR comment isn't updating | The job needs `permissions: issues: write` and `pull-requests: write`. |
| SARIF upload fails | The job needs `permissions: security-events: write`. Set `upload-sarif: false` if your repo can't grant that. |
| Local CLI score doesn't match CI | CI runs against `origin/main` history. Run with the same `--changed-only --base-ref origin/main` flags locally to compare. |
| Findings disagree with the UI Validation drawer | The api-server and the CLI both shell out to `python -m datalex_readiness review`. If they diverge, file a bug — it's a parity regression. |

## See also

- [docs/cli.md](../cli.md) — full `readiness-gate` flag reference
- [Tutorial: Custom policy packs](policy-packs.md) — author org-specific rules
- [`actions/datalex-gate/`](../../actions/datalex-gate/) — the composite Action source
