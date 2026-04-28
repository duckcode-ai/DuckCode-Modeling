# Tutorial: Custom policy packs

Author org-specific rules — naming conventions, required `meta` keys,
contract enforcement, layer-specific materialization — without forking
the policy engine. Custom packs live with the dbt project they govern,
inherit a built-in baseline, and run anywhere the readiness gate runs
(UI, CLI, GitHub Action).

You'll end with:

- A policy pack at `<project>/.datalex/policies/my-org.yaml`
- A handful of layer-aware rules using the new 1.4 rule types
- The same rules visible in the **Policy Packs** drawer panel and
  enforced by `datalex readiness-gate` in CI

**Time:** 7 minutes. **Prerequisites:**

- DataLex 1.4.0 or newer
- A dbt project with `stg_*` / `fct_*` / `dim_*` model names

> Shipped in **DataLex 1.4.0**. Custom packs join the existing
> `datalex policy-check` flow and the readiness-gate scoring.

---

## Why a separate file?

Custom rules live in YAML next to the dbt project. That means:

- **Reviewers see the rules in PR diffs** alongside the model changes.
- **CI runs the same rules** as editors — no SaaS-only enforcement.
- **`pack.extends` lets you reuse** the bundled
  `datalex/standards/base.yaml` baseline so your pack only declares
  the deltas.

---

## Step 1 — Drop a pack into `.datalex/policies/`

The folder is auto-discovered. Create one file per pack:

```bash
mkdir -p .datalex/policies
cat > .datalex/policies/my-org.yaml <<'EOF'
pack:
  name: my-org-standards
  version: 0.1.0
  description: Naming + meta + contract conventions for the analytics team.
  extends: datalex/standards/base.yaml

policies:
  - id: stg_naming
    type: regex_per_layer
    severity: warn
    params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"
        int: "^int_[a-z][a-z0-9_]*$"
        fct: "^fct_[a-z][a-z0-9_]*$"
        dim: "^dim_[a-z][a-z0-9_]*$"
EOF
```

Run it locally:

```bash
datalex policy-check models/staging/stg_orders.yml \
  --policy .datalex/policies/my-org.yaml \
  --inherit
```

`--inherit` resolves `pack.extends` so you also get the bundled
baseline rules (`require_field_descriptions`, `naming_convention`, …).

> **Tip — make sure `.datalex/policies/` is committed.** The default
> DataLex `.gitignore` template excludes `.datalex/` (runtime cache).
> Add an exception for the policies folder so CI sees the same files.
> The example repo's [`.gitignore`](https://github.com/duckcode-ai/jaffle-shop-DataLex/blob/main/.gitignore)
> shows the canonical pattern.

## Step 2 — Use selectors to scope rules

Every 1.4 rule supports an optional `selectors` block:

```yaml
selectors:
  layer: fct          # match by inferred or declared layer
  tag: pii            # match entities carrying this tag
  path_glob: "*/marts/**"   # fnmatch against entity.meta.source_path
```

Layer is inferred from the entity name prefix
(`stg_` / `int_` / `fct_` / `dim_` / `mart_`). You can also declare
`layer:` explicitly on the entity.

```yaml
- id: marts_require_owner_and_grain
  type: required_meta_keys
  severity: warn
  params:
    keys: [owner, grain]
    selectors:
      layer: fct
```

Only `fct_*` entities are checked; everything else is ignored.

## Step 3 — Tour the new 1.4 rule types

### `regex_per_layer`

Enforce naming patterns per layer. Layers without a pattern are
ignored.

```yaml
- id: layer_naming
  type: regex_per_layer
  severity: warn
  params:
    patterns:
      stg: "^stg_[a-z][a-z0-9_]*$"
      fct: "^fct_[a-z][a-z0-9_]*$"
      dim: "^dim_[a-z][a-z0-9_]*$"
```

Bad regex syntax surfaces as a `MISCONFIGURED` finding so you don't
silently miss every model.

### `required_meta_keys`

Require entities to declare specific keys in `meta`.

```yaml
- id: pii_columns_must_be_classified
  type: required_meta_keys
  severity: error
  params:
    keys: [classification]
    selectors:
      tag: pii
```

The check runs on every selected entity; missing keys produce one
finding per entity with the missing key list sorted.

### `layer_constraint`

Per-layer constraints on entity attributes.

```yaml
- id: staging_materialization
  type: layer_constraint
  severity: warn
  params:
    layers:
      stg:
        materialization: ["view", "ephemeral"]
      fct:
        requires: [grain]
```

`materialization` accepts a list of allowed values; `requires` lists
fields that must be present (or present in `meta`).

### `require_contract`

Require selected entities to enforce a dbt contract (`contract.enforced:
true`, or `meta.datalex.contracts: enforced`).

```yaml
- id: marts_require_contract
  type: require_contract
  severity: warn
  params:
    selectors:
      layer: fct
```

### `require_data_type_when_contracted`

Once a contract is enforced, every column needs a concrete `data_type`
(not `unknown`).

```yaml
- id: marts_require_concrete_types
  type: require_data_type_when_contracted
  severity: error
```

Pair this with the `Contracts` toggle in the entity inspector — it
shows the same blocker list interactively.

### Pre-1.4 rule types still work

`require_entity_tags`, `require_field_descriptions`,
`classification_required_for_tags`, `naming_convention`,
`require_indexes`, `require_owner`, `require_sla`, `deprecation_check`,
`custom_expression`, `modeling_convention`, `rule_target_required` are
all unchanged. The full schema lives at
[`schemas/policy.schema.json`](../../schemas/policy.schema.json).

## Step 4 — Edit packs from the UI

Open the **Policy Packs** drawer tab (logical or physical layer).

- Left rail lists every pack under `<project>/.datalex/policies/`.
- Center editor is a YAML textarea — edit, save, the file lands at
  `PUT /api/policy/packs?projectId=…`.
- "New pack" creates a starter file that already extends
  `datalex/standards/base.yaml`.

Edits are flushed to disk immediately so `git status` shows them.

## Step 5 — Wire packs into CI

The `actions/datalex-gate` Action automatically picks up
`<project>/.datalex/policies/*.yaml`. No additional Action inputs
needed.

```yaml
# .github/workflows/datalex-readiness.yml
- uses: duckcode-ai/DataLex/actions/datalex-gate@main
  with:
    project-path: .
    min-score: 80
```

Custom rules contribute to the per-file score the gate enforces. Set
`severity: error` on any rule you want to drive the gate red on
violation; `warn` rules contribute toward the score but won't fail by
themselves.

→ Walk through the full CI rollout in
[Tutorial: CI readiness gate](ci-readiness-gate.md).

## Step 6 — Stack multiple packs

Pass `--policy` more than once on the CLI to merge:

```bash
datalex policy-check models/marts/fct_orders.yml \
  --policy datalex/standards/base.yaml \
  --policy .datalex/policies/my-org.yaml \
  --policy .datalex/policies/finance.yaml \
  --inherit
```

Packs merge by `id`: later packs override earlier ones for the same
rule id, and unique ids accumulate. Use this to layer org-wide rules
on top of the baseline, then team-specific rules on top of org-wide.

## Example: full pack from the jaffle-shop demo

```yaml
pack:
  name: jaffle-shop-standards
  version: 0.1.0
  description: Naming + meta + contract conventions for the jaffle-shop dbt project.
  extends: datalex/standards/base.yaml

policies:
  - id: layer_naming_conventions
    type: regex_per_layer
    severity: warn
    params:
      patterns:
        stg: "^stg_[a-z][a-z0-9_]*$"
        fct: "^fct_[a-z][a-z0-9_]*$"
        dim: "^dim_[a-z][a-z0-9_]*$"

  - id: marts_require_owner_and_grain
    type: required_meta_keys
    severity: warn
    params:
      keys: [owner, grain]
      selectors:
        layer: fct

  - id: pii_columns_must_be_classified
    type: required_meta_keys
    severity: error
    params:
      keys: [classification]
      selectors:
        tag: pii

  - id: marts_require_contract
    type: require_contract
    severity: warn
    params:
      selectors:
        layer: fct

  - id: marts_require_concrete_types
    type: require_data_type_when_contracted
    severity: error
```

Full source:
[jaffle.policy.yaml](https://github.com/duckcode-ai/jaffle-shop-DataLex/blob/main/.datalex/policies/jaffle.policy.yaml).

## Troubleshooting

| Symptom | Fix |
|---|---|
| Pack ignored entirely | Confirm the file ends in `.yaml` or `.yml` and lives directly under `.datalex/policies/` (no subfolders). The discovery is non-recursive. |
| Pack fails schema validation | `datalex policy-check` reports the path in the JSON-schema error. Run with `--inherit` if the failure references a missing `pack.extends` source. |
| Custom rule flagged as `UNKNOWN_TYPE` | The `type:` value isn't one of the registered handlers. Check
[`schemas/policy.schema.json`](../../schemas/policy.schema.json) for the current set. |
| Selectors don't match | `path_glob` requires `entity.meta.source_path` to be present (DataLex sets this on import). Layer / tag selectors work on every entity. |
| `MISCONFIGURED` on `regex_per_layer` | Bad regex; the error message includes the failing pattern. Test in a Python REPL: `import re; re.compile(your_pattern)`. |
| Pack changes don't show up in CI | Confirm `.datalex/policies/` isn't gitignored. Default DataLex projects exclude `.datalex/` — add `!.datalex/policies/` and `!.datalex/policies/**` exceptions. |
| `--policy` is repeating without merging | The CLI accepts repeated `--policy` flags and merges by rule id. If you only see the last pack's rules, check that each pack has a unique `pack.name`; same names with different rules still work but make logs confusing. |

## See also

- [docs/cli.md](../cli.md) — full `policy-check` flag reference
- [Tutorial: CI readiness gate](ci-readiness-gate.md) — wire packs into PRs
- [`schemas/policy.schema.json`](../../schemas/policy.schema.json) — JSON schema for packs
- [`packages/core_engine/src/datalex_core/policy.py`](../../packages/core_engine/src/datalex_core/policy.py) — the rule engine
