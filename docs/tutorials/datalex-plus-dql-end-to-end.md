# DataLex + DQL: end-to-end in 5 minutes

The wedge — *one question, one answer, fully traced* — is best understood by running it. This tutorial walks you through the full DataLex + DQL flow on the bundled Jaffle Shop example. No setup beyond Docker + Git.

By the end you'll have:

1. A dbt project building cleanly into a local DuckDB.
2. A DataLex contract for `monthly_active_customers` that the DQL compiler enforces.
3. A certified DQL block bound to that contract, executable by an AI agent through the DQL MCP.
4. End-to-end column-level lineage from a chart all the way to `fct_orders.customer_id`.

Each stage is its own separate repo — both with their own README and tutorials — so you can stop after Stage 1 if you only need governance, or skip Stage 1 if you only need analytics. The wedge happens when you do both.

---

## Prerequisites

- Docker (or Docker Desktop)
- Git
- An LLM client that speaks MCP — Cursor, Claude Code, Claude Desktop, or your own (only needed for Stage 3; the rest works without one)

---

## Stage 1 — Author DataLex contracts (≈2 min)

Stage 1 happens in [`jaffle-shop-DataLex`](https://github.com/duckcode-ai/jaffle-shop-DataLex). It builds dbt models against DuckDB, then layers DataLex governance on top.

```bash
git clone https://github.com/duckcode-ai/jaffle-shop-DataLex.git
cd jaffle-shop-DataLex
make docker-up        # builds dbt + opens DataLex on http://localhost:3030
```

What to do in DataLex:

1. **Walk the diagrams.** Conceptual / Logical / Physical for the `commerce` domain. Notice how `Customer`, `Order`, and `OrderItem` connect — that's the conceptual model.
2. **Open the AI proposals tab.** The `datalex draft` command produced reviewable starter contracts from the dbt manifest. Reject anything that's wrong, accept what fits.
3. **Look at `DataLex/commerce/_glossary.model.yaml`.** Every glossary term binds to a logical column via the `binding` block. Atlan, DataHub, OpenMetadata can read this same artifact.
4. **Inspect the `monthly_active_customers` contract.** It declares the inputs, outputs, and constraints that DQL will enforce in Stage 2.

```yaml
# DataLex/commerce/customer.model.yaml (excerpt)
entities:
  - name: Customer
    contracts:
      - id: commerce.Customer.monthly_active_customers
        name: monthly_active_customers
        version: 1
        description: |
          Distinct customers who placed at least one order in a calendar month.
          Computed from fct_orders.customer_id grouped by DATE_TRUNC('month', ordered_at).
        signature:
          inputs:
            - name: order_month
              type: date
          outputs:
            - name: monthly_active_customers
              type: integer
              constraints: ["positive"]
```

`datalex compile` produces `datalex-manifest.json`. That's the artifact DQL will consume in Stage 2.

> **Stop here if all you needed was governance.** DataLex on its own is useful — readiness checks, AI-reviewable YAML proposals, conceptual / logical / physical diagrams, dbt round-trip. The wedge gets sharper when DQL joins.

---

## Stage 2 — Certify DQL blocks against the contract (≈2 min)

Stage 2 happens in [`jaffle-shop-dql`](https://github.com/duckcode-ai/jaffle-shop-dql). Same dbt models, same DuckDB warehouse, plus DQL blocks that reference the DataLex contract by id.

```bash
cd ..
git clone https://github.com/duckcode-ai/jaffle-shop-dql.git
cd jaffle-shop-dql
docker compose up     # opens DQL Notebook on http://localhost:3474
```

Drop the DataLex manifest from Stage 1 into the DQL project root so the compiler can resolve contract refs:

```bash
cp ../jaffle-shop-DataLex/datalex-manifest.json .
```

Open `blocks/customer/monthly_active_customers.dql`. It declares the binding:

```dql
block "Monthly Active Customers" {
  type = "custom"
  status = "certified"
  datalex_contract = "commerce.Customer.monthly_active_customers@1"
  description = "Count of distinct customers who placed ≥1 order each calendar month."
  query = """
    SELECT DATE_TRUNC('month', ordered_at) AS order_month,
           COUNT(DISTINCT customer_id)     AS monthly_active_customers
    FROM   fct_orders
    GROUP  BY 1
    ORDER  BY 1
  """
}
```

Now run the compiler:

```bash
dql compile
```

Three things happen on a clean run:

- The DQL compiler finds `commerce.Customer.monthly_active_customers@1` in the DataLex manifest. ✅
- The output `monthly_active_customers` matches the contract signature. ✅
- The compiled `dql-manifest.json` includes column-level lineage: every output column points at the upstream `dbt.fct_orders.<column>` it derives from.

Try breaking it: edit the block to reference `commerce.Customer.does_not_exist`. Re-run `dql compile`. You'll get:

```
ERROR: Block "Monthly Active Customers" datalex_contract = "commerce.Customer.does_not_exist" not found in the loaded DataLex manifest.
```

**That's the wedge.** Compilation fails before an uncertified block can ever be served. Now revert your edit and recompile.

> **Stop here if all you needed was certified analytics.** The blocks, notebooks, and Apps in `jaffle-shop-dql` work standalone — DataLex contracts are an enhancement, not a requirement.

---

## Stage 3 — Serve certified answers to an AI agent (≈1 min)

Now point an AI agent at the DQL MCP server. Cursor and Claude Desktop both speak [Model Context Protocol](https://modelcontextprotocol.io) natively.

```bash
dql mcp serve --project /path/to/jaffle-shop-dql
```

Configure your MCP client. For Claude Desktop, add to `~/Library/Application Support/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "jaffle-shop-dql": {
      "command": "dql",
      "args": ["mcp", "serve", "--project", "/path/to/jaffle-shop-dql"]
    }
  }
}
```

Restart your agent and ask in plain English:

> *"How many active customers did Jaffle Shop have last month?"*

The agent calls the MCP `query_via_block` tool. The tool:

1. Locates the certified block named `Monthly Active Customers`.
2. Verifies its `datalex_contract` resolves in the loaded DataLex manifest.
3. Refuses to serve any block whose status is anything other than `certified`.
4. Refuses to serve any certified block whose contract reference is broken.
5. Executes the SQL against your local DuckDB and returns the rows.

The answer is the same answer the dashboard shows. Always.

Try the experiment that makes the wedge real: ask the same question two different ways, in two different sessions, on two different days. **You always get the same answer.** The dashboard, the AI agent, and the audit log all cite the same contract id.

---

## Stage 4 — what happens when the AI gets a question with no certified block? (≈1 min)

Real AI usage doesn't always have a certified block ready. Watch what happens for a question we never built a contract for. Ask:

> *"What's the average order total per customer type in Jaffle Shop?"*

There's no `commerce.Customer.avg_order_total_per_customer_type` contract. The agent calls `query_via_block` first → no match → falls back to `query_via_metadata` (Tier 2). The result returns **with the `uncertified: true` flag visible** so you know the answer wasn't backed by a certified contract — and the proposal is auto-saved as a draft block under `blocks/_drafts/`.

Inspect the draft:

```bash
ls jaffle-shop-dql/blocks/_drafts/
# avg_order_total_per_customer_type.dql

cat jaffle-shop-dql/blocks/_drafts/avg_order_total_per_customer_type.dql
# block "avg_order_total_per_customer_type" {
#     domain = "customer"
#     status = "draft"
#     description = """What's the average order total per customer type?"""
#     datalex_contract = ""        # ← human fills this in during certify
#     _proposed {
#         asked_times = 1          # ← increments if the question is re-asked
#         proposed_contract_id = "customer.Customer.avg_order_total_per_customer_type"
#         ...
#     }
#     query = """SELECT customer_type, AVG(order_total) ..."""
# }
```

Promote it to certified — one command:

```bash
dql certify --from-draft blocks/_drafts/avg_order_total_per_customer_type.dql \
            --domain customer \
            --contract customer.Customer.avg_order_total_per_customer_type@1 \
            --owner growth@example.com
```

That:

1. Moves the file to `blocks/customer/avg_order_total_per_customer_type.dql`.
2. Flips `status` to `certified` and sets `datalex_contract`.
3. Drops the `_proposed { ... }` provenance block.
4. Prints the patch you need to apply to `datalex-manifest.json` (the contract entry that needs to land for the reference to resolve).

Apply that patch, run `dql compile`, restart your AI agent, and ask the same question again. **Same answer, this time certified.** The wedge just learned a new contract.

That's the **promotion loop**: every uncertified question becomes a candidate for governance. Questions asked repeatedly bubble to the top of the review queue (`mcp call list_proposals --asked-at-least-times 3`). Read [DQL's graduated-trust doc](https://duckcode-ai.github.io/dql/architecture/graduated-trust/) for the full architecture.

---

## What you just proved

| Without DataLex + DQL | With DataLex + DQL |
|---|---|
| AI gives different numbers for the same question | Same answer to same question, always |
| "Where does this MAU number come from?" — nobody knows | Lineage trail: chart → DQL block → SQL → dbt model → source column |
| New analyst's query disagrees with finance's dashboard | Both query through the same contract; disagreement is impossible |
| Contract drift (someone renames a dbt column) goes unnoticed | DQL compile fails immediately; AI agents stop serving stale answers |

That's the AI-era data-trust problem solved end-to-end, all in YAML, all version-controlled, all open source.

---

## Where to go next

- **Author your own contracts** — [`datalex draft`](../getting-started.md#scenario-1--clone-jaffle-shop) generates AI-reviewable starter YAML from any dbt project.
- **Wire CI** — the [readiness gate tutorial](ci-readiness-gate.md) blocks PRs that introduce uncertified blocks or break contracts.
- **Hydrate Marquez** — the [DQL OpenLineage emitter](https://github.com/duckcode-ai/dql/blob/main/packages/dql-openlineage/README.md#project-snapshot-from-a-compiled-manifest) sends one snapshot of the lineage graph in <1s.
- **Editor support** — install the [`@duckcodeailabs/datalex-lsp`](https://github.com/duckcode-ai/dql/tree/main/packages/datalex-lsp) and [`@duckcodeailabs/dql-lsp`](https://github.com/duckcode-ai/dql/tree/main/packages/dql-lsp) packages for VS Code / Cursor / Neovim diagnostics.
- **Read the manifest spec** — [`duckcode-ai/manifest-spec`](https://github.com/duckcode-ai/manifest-spec) is the public bridge that lets third-party tools (Atlan, Marquez, Monte Carlo, internal copilots) speak the same lineage language.

If you'd rather skip ahead and feel the wedge in 60 seconds, the [DataLex + DQL stack overview](../datalex-and-dql.md) page has the same architecture diagram with less hand-holding.
