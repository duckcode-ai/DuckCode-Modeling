# `datalex` CLI cheat sheet

Every subcommand on one page. Global flags: `--help` on any command
prints its full option list. The CLI installs as both `datalex` and
`dm` — they're the same script. Examples below use `datalex`.

> **DataLex 1.4** added five new commands: `readiness-gate`,
> `dbt docs reindex`, `emit catalog`, plus richer `policy-check` (now
> accepts multiple `--policy` flags). They're called out below.

## CI / readiness — new in 1.4

| Command | What it does |
|---|---|
| `datalex readiness-gate --project <dir>` | Run the dbt-readiness engine on a project and fail on threshold breaches. Same scoring as `/api/dbt/review` and the `actions/datalex-gate` GitHub Action. |

**Common flags:**
- `--min-score <n>` — fail when project score < n
- `--max-yellow <n>` / `--max-red <n>` — fail when file counts exceed
- `--allow-errors` — don't fail on error-severity findings
- `--changed-only --base-ref <ref>` — only score files changed vs base ref (uses `git diff`)
- `--sarif <path>` — write SARIF 2.1.0 for GitHub code-scanning upload
- `--pr-comment <path>` — write a sticky PR-comment markdown summary
- `--output-json` — print the full review JSON

→ Full walkthrough: [Tutorial: CI readiness gate](./tutorials/ci-readiness-gate.md).

## dbt integration

| Command | What it does |
|---|---|
| `datalex dbt sync <project> --out-root <dir>` | Reads `target/manifest.json` + profiles.yml, introspects live warehouse columns, merges into DataLex YAML. Idempotent: user edits survive re-sync. Doc-block references are preserved. |
| `datalex dbt emit <root> --out-dir <dir>` | Emits dbt `sources.yml` + `models/_schema.yml` with `contract.enforced: true` and `data_type:` per column. Re-emits `{{ doc("name") }}` whenever a column carries `description_ref`. |
| `datalex dbt import <manifest.json> --out-root <dir>` | One-shot import without warehouse introspection (manifest `data_type` only). Captures snapshots / seeds / exposures / unit tests / semantic models in 1.4. |
| `datalex dbt docs reindex --project-dir <dir>` | **(1.4)** Rebuild the `{% docs %}` block index used by AI retrieval, the inspector, and the round-trip emitter. Prints resolved names + body previews. |

**Common flags for `sync`:**
- `--profile <name>` — pick a non-default target from the profile
- `--profiles-dir <dir>` — override profiles.yml search
- `--manifest <path>` — explicit manifest.json location
- `--skip-warehouse` — use manifest `data_type` only (offline / no creds)
- `--output-json` — machine-readable report

→ Full walkthrough: [Tutorial: dbt sync in 5 minutes](./tutorial-dbt-sync.md).

## Validation, policies, and project summary

| Command | What it does |
|---|---|
| `datalex validate <root>` | Load the project, run schema + policy validation, exit non-zero on error. |
| `datalex lint <root>` | Semantic / dimensional-modeling rules (warnings) — companion to `validate`. |
| `datalex policy-check <model> --policy <pack> [--policy <pack>...]` | Evaluate one or more model files against one or more policy packs. **(1.4)** Pass `--policy` multiple times to merge packs. Use `--inherit` to resolve `pack.extends`. |
| `datalex info <root>` | Entity-by-layer counts, physical-by-dialect breakdown, term/domain/policy counts. |
| `datalex expand <root>` | Preview a project with snippets inlined (doesn't mutate files). |

**Flags:** `--output-json` on all of them. `validate` also supports
`--non-strict` (don't exit non-zero; print errors and continue).

→ Custom rule packs: [Tutorial: Policy packs](./tutorials/policy-packs.md) (1.4).

### Built-in standards pack

```bash
datalex policy-check models/marts/fct_orders.yml \
  --policy datalex/standards/base.yaml \
  --policy .datalex/policies/my-org.yaml \
  --inherit
```

Policy packs live under `<project>/.datalex/policies/` and inherit
from the bundled `datalex/standards/base.yaml`. New 1.4 rule types:
`regex_per_layer`, `required_meta_keys`, `layer_constraint`,
`require_contract`, `require_data_type_when_contracted`. All support a
`selectors: { layer, tag, path_glob }` block to scope the rule.

## Catalog export — new in 1.4

| Command | What it does |
|---|---|
| `datalex emit catalog --target <atlan\|datahub\|openmetadata> --model <model.yaml> --out <dir>` | Emit the glossary + column-binding payload for an external catalog. Output is one JSON file per model named `<target>-<model_name>.json`. |

Bindings come from columns that declare
`binding: { glossary_term, status }` (or the legacy `terms: [...]` /
`meta.glossary_term` shapes). Operators import the JSON via the
catalog's bulk-loader API.

## DDL emission

| Command | What it does |
|---|---|
| `datalex emit ddl <root> --dialect <name>` | Emit per-dialect DDL for every physical entity. `--out <file>` writes to disk; stdout otherwise. |

Currently registered dialects: `postgres`, `snowflake`. The registry
is pluggable — see `packages/core_engine/src/datalex_core/dialects/`.

## Semantic diff

| Command | What it does |
|---|---|
| `datalex diff <old-root> <new-root>` | Detect added / removed / renamed / changed entities and columns. |
| `datalex gate old.yml new.yml` | PR breaking-change gate: validate both files and fail on breaking diffs. Different from `readiness-gate` (which scores quality of one project). |

**Flags:**
- `--output-json` — structured diff (good for CI pipes)
- `--exit-on-breaking` — exit non-zero if any change is breaking

Renames are tracked via `previous_name:`; the diff prefers explicit
renames to heuristic match.

## Cross-repo packages

| Command | What it does |
|---|---|
| `datalex packages resolve <root>` | Resolve `imports:` in `datalex.yaml`, fetch packages, write `.datalex/lock.yaml`. |
| `datalex packages list <root>` | Show resolved packages and their cached paths. |

**`resolve` flags:** `--update` forces re-fetch, `--cache-root <dir>`
overrides `~/.datalex/packages/`, `--output-json` for JSON output.

## Layout migration

| Command | What it does |
|---|---|
| `datalex migrate to-datalex-layout <legacy.model.yaml>` | Explode a v1/v2 `*.model.yaml` into the per-`kind:` DataLex tree. |

**Flags:** `--output-root <dir>`, `--dialect <name>` (default `postgres`),
`--dry-run` to preview writes, `--output-json` for machine report.

## Common patterns

**CI readiness gate — fail on red/score regressions (1.4):**
```bash
datalex readiness-gate --project . \
  --min-score 80 --max-red 0 \
  --changed-only --base-ref origin/main \
  --sarif datalex-readiness.sarif \
  --pr-comment datalex-readiness.md
```

**CI breaking-change gate — fail on schema regressions:**
```bash
git checkout main -- datalex/
datalex diff datalex/ ../new/datalex/ --exit-on-breaking
```

**Round-trip sanity check — dbt sync, emit, parse:**
```bash
datalex dbt sync my-dbt-project --out-root datalex/
datalex dbt emit datalex/ --out-dir dbt-emitted/
cd my-dbt-project && cp -r ../dbt-emitted/models ../dbt-emitted/sources . && dbt parse
```

**Preview sync against a new warehouse without touching it:**
```bash
datalex dbt sync my-dbt-project --out-root datalex/ --skip-warehouse
```

**Inspect a project without opening every file:**
```bash
datalex info datalex/ --output-json | jq .
```

**Reindex doc-blocks after editing `.md` files (1.4):**
```bash
datalex dbt docs reindex --project-dir .
```

**Run an org policy pack on top of the built-in baseline (1.4):**
```bash
datalex policy-check models/marts/fct_orders.yml \
  --policy datalex/standards/base.yaml \
  --policy .datalex/policies/my-org.yaml \
  --inherit
```

**Export the glossary to Atlan, DataHub, and OpenMetadata (1.4):**
```bash
datalex emit catalog --target atlan        --model DataLex/glossary.model.yaml --out out/
datalex emit catalog --target datahub      --model DataLex/glossary.model.yaml --out out/
datalex emit catalog --target openmetadata --model DataLex/glossary.model.yaml --out out/
```

## See also

- [Tutorial: dbt sync in 5 minutes](./tutorial-dbt-sync.md)
- [Tutorial: CI readiness gate](./tutorials/ci-readiness-gate.md) (1.4)
- [Tutorial: Custom policy packs](./tutorials/policy-packs.md) (1.4)
- [DataLex layout reference](./datalex-layout.md)
- [Architecture](./architecture.md)
