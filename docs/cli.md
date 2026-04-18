# `dm datalex` CLI cheat sheet

Every subcommand on one page. Global flags: `--help` on any command prints
its full option list.

## dbt integration

| Command | What it does |
|---|---|
| `dm datalex dbt sync <project> --out-root <dir>` | Reads `target/manifest.json` + profiles.yml, introspects live warehouse columns, merges into DataLex YAML. Idempotent: user edits survive re-sync. |
| `dm datalex dbt emit <root> --out-dir <dir>` | Emits dbt `sources.yml` + `models/_schema.yml` with `contract.enforced: true` and `data_type:` per column. |
| `dm datalex dbt import <manifest.json> --out-root <dir>` | One-shot import without warehouse introspection (manifest `data_type` only). |

**Common flags for `sync`:**
- `--profile <name>` — pick a non-default target from the profile
- `--profiles-dir <dir>` — override profiles.yml search
- `--manifest <path>` — explicit manifest.json location
- `--skip-warehouse` — use manifest `data_type` only (offline / no creds)
- `--output-json` — machine-readable report

→ Full walkthrough: [Tutorial: dbt sync in 5 minutes](./tutorial-dbt-sync.md).

## Validation and project summary

| Command | What it does |
|---|---|
| `dm datalex validate <root>` | Load the project, run schema + policy validation, exit non-zero on error. |
| `dm datalex info <root>` | Entity-by-layer counts, physical-by-dialect breakdown, term/domain/policy counts. |
| `dm datalex expand <root>` | Preview a project with snippets inlined (doesn't mutate files). |

**Flags:** `--output-json` on all three. `validate` also supports
`--non-strict` (don't exit non-zero; print errors and continue).

## DDL emission

| Command | What it does |
|---|---|
| `dm datalex emit ddl <root> --dialect <name>` | Emit per-dialect DDL for every physical entity. `--out <file>` writes to disk; stdout otherwise. |

Currently registered dialects: `postgres`, `snowflake`. The registry is
pluggable — see `packages/core_engine/src/dm_core/dialects/`.

## Semantic diff

| Command | What it does |
|---|---|
| `dm datalex diff <old-root> <new-root>` | Detect added / removed / renamed / changed entities and columns. |

**Flags:**
- `--output-json` — structured diff (good for CI pipes)
- `--exit-on-breaking` — exit non-zero if any change is breaking

Renames are tracked via `previous_name:`; the diff prefers explicit renames
to heuristic match.

## Cross-repo packages

| Command | What it does |
|---|---|
| `dm datalex packages resolve <root>` | Resolve `imports:` in `datalex.yaml`, fetch packages, write `.datalex/lock.yaml`. |
| `dm datalex packages list <root>` | Show resolved packages and their cached paths. |

**`resolve` flags:** `--update` forces re-fetch, `--cache-root <dir>`
overrides `~/.datalex/packages/`, `--output-json` for JSON output.

Drift detection: if the lockfile's `content_hash` disagrees with the cached
copy, the next `load_imports_for` call errors out. Re-run
`packages resolve --update` to refresh.

## Layout migration

| Command | What it does |
|---|---|
| `dm datalex migrate to-datalex-layout <legacy.model.yaml>` | Explode a v1/v2 `*.model.yaml` into the per-`kind:` DataLex tree. |

**Flags:** `--output-root <dir>`, `--dialect <name>` (default `postgres`),
`--dry-run` to preview writes, `--output-json` for machine report.

## Common patterns

**CI gate — fail on breaking changes:**
```bash
git checkout main -- datalex/
./dm datalex diff datalex/ ../new/datalex/ --exit-on-breaking
```

**Round-trip sanity check — dbt sync, emit, parse:**
```bash
./dm datalex dbt sync my-dbt-project --out-root datalex/
./dm datalex dbt emit datalex/ --out-dir dbt-emitted/
cd my-dbt-project && cp -r ../dbt-emitted/models ../dbt-emitted/sources . && dbt parse
```

**Preview sync against a new warehouse without touching it:**
```bash
./dm datalex dbt sync my-dbt-project --out-root datalex/ --skip-warehouse
```

**Inspect a project without opening every file:**
```bash
./dm datalex info datalex/ --output-json | jq .
```

## See also

- [Tutorial: dbt sync in 5 minutes](./tutorial-dbt-sync.md)
- [DataLex layout reference](./datalex-layout.md)
- [Architecture](./architecture.md)
