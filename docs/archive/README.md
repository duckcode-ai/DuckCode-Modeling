# Archived docs

These files describe the pre-DataLex shape of the project (single
`*.model.yaml` files, v1/v2 YAML schemas, the original governance blueprint).
They're kept for reference — and so external links don't 404 — but do **not**
describe the current layout.

For current docs, start here:

- **[Tutorial: dbt sync in 5 minutes](../tutorial-dbt-sync.md)** — the fastest
  way to see the tool work.
- **[DataLex layout reference](../datalex-layout.md)** — replaces
  `yaml-spec-v1.md` and `yaml-spec-v2.md`.
- **[CLI cheat sheet](../cli.md)** — every `datalex datalex …` subcommand.
- **[Architecture](../architecture.md)** — updated for the DataLex substrate.

## What's here

| File | Status | Replaced by |
|---|---|---|
| [yaml-spec-v1.md](./yaml-spec-v1.md) | deprecated | [datalex-layout.md](../datalex-layout.md) |
| [yaml-spec-v2.md](./yaml-spec-v2.md) | deprecated | [datalex-layout.md](../datalex-layout.md) |
| [end-to-end-modeling-dictionary.md](./end-to-end-modeling-dictionary.md) | pre-DataLex blueprint | [tutorial-dbt-sync.md](../tutorial-dbt-sync.md) + [datalex-layout.md](../datalex-layout.md) |
| [governance-policy-spec.md](./governance-policy-spec.md) | rule semantics still accurate; wrapper layout is not | [datalex-layout.md § `kind: policy`](../datalex-layout.md#kind-policy--governance-rules) |

## Migrating a legacy project

```bash
./datalex datalex migrate to-datalex-layout path/to/legacy.model.yaml \
    --output-root path/to/new-datalex-project \
    --dialect postgres
```

See `datalex datalex migrate to-datalex-layout --help` for options
(`--dry-run`, `--output-json`).
