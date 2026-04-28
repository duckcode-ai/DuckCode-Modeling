# Jaffle-shop end-to-end walkthrough

The fastest way to see every DataLex feature is the dedicated
[`duckcode-ai/jaffle-shop-DataLex`](https://github.com/duckcode-ai/jaffle-shop-DataLex)
repository. It keeps the familiar jaffle-shop domain, but adds the
pieces needed to exercise DataLex end-to-end:

- DuckDB seeds + dbt staging and marts
- Semantic models + a metricflow time spine
- Conceptual / logical / physical diagrams under
  `DataLex/commerce/`
- **`{% docs %}` block round-trip** — `models/docs/_canonical.md`
  shared across `stg_customers.yml` and `fct_orders.yml`
- **A custom policy pack** at `.datalex/policies/jaffle.policy.yaml`
- **Snapshots / exposures / unit tests** wired into the new drawer panels
- **Glossary bindings** ready for `datalex emit catalog`
- A GitHub Actions workflow that runs `actions/datalex-gate` on every PR

You'll end with:

- A browser tab showing dbt files, DataLex diagrams, generated SQL, and
  project skills in one tree
- Conceptual, logical, and physical diagrams that demonstrate the three
  modeling layers
- Red / yellow / green readiness badges on every YAML file
- Interface readiness checks on shared dbt models
  (`dim_customers`, `fct_orders`)
- A real `.git` history of your edits

**Time:** 8 minutes. **Prerequisites:** Python 3.11 or 3.12 for dbt,
Git, and network access to `github.com`.

---

## Step 1 — Install and clone

The example repo's `make setup` target installs everything in one go.
That includes `datalex-cli >= 1.4.0` plus dbt-core / dbt-duckdb.

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex ~/src/jaffle-shop-DataLex
cd ~/src/jaffle-shop-DataLex
make setup        # creates .venv with dbt + datalex-cli
make doctor       # prints Python / dbt / datalex versions
```

Use Python 3.11 or 3.12 for this dbt example. Python 3.13+ currently
breaks in dbt's serializer stack; if you can't manage Python versions
locally, use **Step 1 (alt)** below instead.

### Step 1 (alt) — Docker

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex ~/src/jaffle-shop-DataLex
cd ~/src/jaffle-shop-DataLex
make docker-up    # builds the image, runs dbt + datalex serve in a container
```

Open `http://localhost:3030`. Skip to step 3.

## Step 2 — Build the warehouse and start the server

```bash
make seed         # dbt seed --profiles-dir .
make build        # dbt build --profiles-dir .  → jaffle_shop.duckdb
make serve        # datalex serve --project-dir .
```

A browser tab opens on `http://localhost:3030`. The Explorer should
show this project shape:

```
.
├── .datalex/
│   └── policies/jaffle.policy.yaml          ◀ custom rule pack (1.4)
├── DataLex/
│   └── commerce/
│       ├── _glossary.model.yaml             ◀ glossary + bindings (1.4)
│       ├── Conceptual/commerce_concepts.diagram.yaml
│       ├── Logical/commerce_logical.diagram.yaml
│       └── Physical/duckdb/commerce_physical.diagram.yaml
├── models/
│   ├── docs/_canonical.md                   ◀ {% docs %} blocks (1.4)
│   ├── exposures.yml                        ◀ exposures (1.4)
│   ├── staging/jaffle_shop/
│   ├── marts/core/
│   │   └── _unit_tests.yml                  ◀ dbt 1.8+ unit tests (1.4)
│   └── semantic/
└── snapshots/                               ◀ SCD-2 snapshot (1.4)
    ├── customers_snapshot.sql
    └── snapshots.yml
```

## Step 3 — Run a readiness review

The readiness review scores every YAML file red / yellow / green and
surfaces fixable findings. It's the first thing to do on a new project.

1. Top bar → **Run readiness review**.
2. Wait ~2-3 seconds. The Explorer now shows a colored badge next to
   every file.
3. The status bar shows the rollup: e.g. `4 red · 11 yellow · 14 green`
   on a fresh clone.

Click any file with a yellow or red badge to open the **Validation**
drawer. Each finding has:

- A category (`metadata`, `dbt_quality`, `governance`, `import_health`,
  `enterprise_modeling`)
- The rationale and a suggested fix
- An **Ask AI** button that hands the finding to a focused AI fix flow

Run the same gate from the CLI:

```bash
make readiness-gate
# or
.venv/bin/datalex readiness-gate --project . --min-score 70 \
  --sarif datalex-readiness.sarif \
  --pr-comment datalex-readiness.md
```

## Step 4 — Walk the three modeling layers

The example repo includes diagrams for all three layers.

1. **Conceptual** —
   `DataLex/commerce/Conceptual/commerce_concepts.diagram.yaml`. Uses
   business concepts and verbs: Customer places Order, Order contains
   Order Item, Product describes Order Item, Supply supports Product.
2. **Logical** —
   `DataLex/commerce/Logical/commerce_logical.diagram.yaml`. Adds
   attributes, candidate keys, business keys, and the Order Line
   associative entity. Three columns now carry
   `binding: { glossary_term, status }` references.
3. **Physical** —
   `DataLex/commerce/Physical/duckdb/commerce_physical.diagram.yaml`.
   References dbt YAML files under `models/`, shows real DuckDB column
   types, and maps relationships to dbt/database intent.

## Step 5 — Inspect a model with doc-block round-trip

Click `models/marts/core/fct_orders.yml` in the Explorer.

- **Centre canvas** renders `fct_orders` as an ER node with columns
  inline and FK edges to `stg_customers` / `stg_orders`.
- **Right panel** shows the Inspector — Columns, Relationships,
  Indexes, Tests.
- The **Contract** card (1.4) is on. The toggle is green and lists no
  blockers because every column has a concrete `data_type`. Toggle it
  off and back on to see the live blocker list.
- The `customer_id`, `order_id`, `order_total`, and `ordered_at`
  columns are bound to the `{% docs %}` blocks in
  `models/docs/_canonical.md`. The inspector shows the rendered
  description **and** a small `📝 doc("customer_id")` indicator.
- Open the `.md` file, edit the body of `{% docs customer_id %}` —
  every column bound to it (in `stg_customers.yml`, `fct_orders.yml`,
  and `snapshots.yml`) refreshes its rendered description on next save.

Round-trip the project to confirm the references are preserved:

```bash
make docs-reindex    # rebuilds the {% docs %} index
```

## Step 6 — Open the new drawer panels

The bottom drawer in the physical layer ships four 1.4-specific tabs.

- **Snapshots** — opens `snapshots/snapshots.yml`. Shows the SCD-2
  strategy + unique_key + check_cols card for `customers_snapshot`.
- **Exposures** — opens `models/exposures.yml`. Shows two cards (exec
  dashboard, marketing notebook) with owner.email + maturity pills.
- **Unit Tests** — opens `models/marts/core/_unit_tests.yml`. Shows
  `test_fct_orders_subtotal_rollup` with given/expect counts.
- **Policy Packs** — lists `.datalex/policies/jaffle.policy.yaml`.
  Click it to inspect or edit the rule pack inline.

## Step 7 — Run the custom policy pack

```bash
make policy-check
# or
.venv/bin/datalex policy-check models/marts/core/fct_orders.yml \
  --policy .datalex/policies/jaffle.policy.yaml \
  --inherit
```

The pack inherits `datalex/standards/base.yaml` and adds:

- Layer naming (`stg_*`, `fct_*`, `dim_*`)
- Required meta keys for marts (`owner`, `grain`)
- A PII classification rule (`error` severity)
- Contract enforcement on `fct_*` models
- Concrete `data_type` when contract is enforced

Try editing the pack from the **Policy Packs** drawer panel — change
the severity of `marts_require_contract` from `warn` to `error` and
re-run the gate to see `fct_orders` go red if you remove its contract.

## Step 8 — Try the Conceptualizer + Canonicalizer agents

Open the entity inspector (right panel, Box icon) with **no entity
selected**. Two new buttons appear:

- **Conceptualize from staging** — clusters the four staging models
  (`stg_customers`, `stg_orders`, `stg_order_items`, `stg_products`)
  into business entities + relationships. On the demo: 5 entities
  (Customer→crm, Order→sales, OrderItem→sales, Product→catalog,
  Supply).
- **Canonicalize from staging** — detects columns that recur across
  staging models and lifts them into a logical canonical layer with
  shared `{% docs %}` blocks. On the demo it (intentionally) returns
  zero entities because each staging model maps to a different noun;
  drop a duplicate staging model in (e.g. `stg_shopify_orders`) to see
  it kick in.

Both agents are deterministic — no API key required. Output flows
through the existing **Review plan → Validate → Apply** flow, so
nothing is written until you accept the proposal.

## Step 9 — Export the glossary to a catalog (1.4)

```bash
make emit-catalog
```

Produces three JSON files under `out/catalog/`:

- `atlan-commerce.json` — bulk import for Atlan
- `datahub-commerce.json` — list of DataHub MCPs
- `openmetadata-commerce.json` — OpenMetadata glossary import

Each file carries the four glossary terms (`customer_id`,
`customer_email`, `order_total`, `ordered_at`) with their bound
columns from the logical diagram.

## Step 10 — Mesh Interface readiness

Open `models/marts/core/dim_customers.yml` and
`models/marts/core/fct_orders.yml`. Both are marked as shared DataLex
Interfaces under `meta.datalex.interface`.

```bash
.venv/bin/datalex datalex mesh check . --strict
```

Expected:

```text
DataLex mesh Interface check: /Users/.../jaffle-shop-DataLex
  strict: yes
  interfaces: ready
```

## Step 11 — Turn on auto-commit (optional)

1. Open the Commit dialog (`⌘⇧G` or the branch icon in the Chrome
   header).
2. Enable **Auto-commit on save**.
3. Back in the inspector, change three field descriptions in quick
   succession. Auto-commit debounces bursty saves: within ~3s you'll
   see **exactly one** new commit in `git log`.

## Step 12 — See the readiness gate run on a PR

The repo ships `.github/workflows/datalex.yml` that runs
`actions/datalex-gate` on every PR. To exercise it:

1. `git checkout -b touch-readiness`
2. Add a sloppy line to a YAML file (e.g. delete a `description`).
3. Push and open a PR.
4. The Action posts a sticky readiness comment, uploads SARIF to the
   Security tab, and fails when the score drops below 70.

📖 See [Tutorial: CI readiness gate](ci-readiness-gate.md) for the full
rollout — including how to ratchet `min-score` up over time.

## What to do next

- **Wire CI on your own repo →** [CI readiness gate](ci-readiness-gate.md)
- **Author your own rules →** [Custom policy packs](policy-packs.md)
- **Try the live warehouse flow →** [Pull a warehouse schema](warehouse-pull.md)
- **Use your own dbt repo →** [Import an existing dbt project](import-existing-dbt.md)
- **Ask AI deeper →** [Agentic AI modeling](../ai-agentic-modeling.md)

## Troubleshooting

| Symptom                                     | Fix                                                                |
|---------------------------------------------|--------------------------------------------------------------------|
| Clone fails with a network error            | Check GitHub access, firewalls, proxies, or clone the repo through your normal Git credentials. |
| `dbt build` cannot find a profile           | Run dbt commands from the repo root and include `--profiles-dir .`; the example ships a DuckDB `profiles.yml`. |
| Readiness review shows `red` everywhere     | The repo ships at ~78/100. If yours is much worse, run `make doctor` to confirm dbt has built — `target/manifest.json` and `target/catalog.json` both feed into the score. |
| `DOC_BLOCK_OVERWRITE` when applying an AI proposal on `customer_id` | Doc-block-bound descriptions live in `models/docs/_canonical.md`. Edit the `{% docs %}` body, not the YAML description. |
| `CONTRACT_PREFLIGHT` on `make` push to dbt-sync | A column in `fct_orders` is showing `type: unknown`. Run `make build` to repopulate types from the warehouse. |
| Diff panel keeps showing changes after save | Stale editor state — hit `⌘R`. The in-flight Zustand store and the on-disk bytes should match. |
| Auto-commit produces no commit              | Check `git config user.email` inside the cloned repo. The Chrome status bar shows the last auto-commit error as a toast. |
| `ERR_MODULE_NOT_FOUND ... providerMeta.js` during `datalex serve` | Upgrade to `datalex-cli` 1.4.0 or newer. |
