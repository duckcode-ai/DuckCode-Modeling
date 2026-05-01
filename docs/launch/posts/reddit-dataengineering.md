# Reddit r/dataengineering — launch-day post

> **Channel norms.** Show, don't sell. Technical depth wins. Open with the
> problem, not the product. Founder available to engage replies. Mods will
> remove anything that smells like marketing — write the post like you'd
> write a forum reply.

## Title

```
Built two OSS languages to fix "AI gives different answers to the same question" in data — feedback wanted
```

## Body

```text
TL;DR: shipped DataLex (YAML business contracts above dbt) + DQL (YAML
certified analytics below dbt) + manifest-spec (the JSON Schemas that
bind them). Apache 2.0. Posting here because the wedge is technical and
I want pushback from people who actually run dbt in anger.

The problem we're targeting:

Anyone in your company can now ask any AI tool a business question in
English and get a confident, plausibly-wrong answer. Two queries that
should return the same number return different numbers. The 1990s
metric-drift problem multiplied 100x by AI agents that don't know your
business definitions.

What we built:

DataLex compiles YAML conceptual models — domains, entities, contracts —
into a manifest. A "contract" is a versioned, machine-checkable promise:
"monthly active customers means distinct customers with ≥1 order per
calendar month, computed from fct_orders.customer_id." Sits above dbt.
Reads your manifest.json. Doesn't modify your dbt project.

DQL compiles YAML certified blocks (think: SQL with metadata) into a
manifest. A block can reference a DataLex contract by id
(commerce.Customer.monthly_active_customers@1). The DQL compiler enforces
the binding at compile time — uncertified blocks can't be served via the
MCP. AI agents only see certified results.

manifest-spec is a separate repo that holds the public JSON Schemas for
both manifests + the resolution rules. Versioned, treated as an external
API. Catalogs and observability tools (Atlan, Marquez, Monte Carlo) can
read it without depending on either compiler's internals.

What this is NOT:

- A dbt killer. We don't replace dbt. We extend it above (contracts) and
  below (certified analytics).
- A BI tool. We don't replace Hex or Sigma. DQL Apps are an OSS
  consumption surface, not a SaaS competitor.
- An IDE. Users stay in Cursor / VS Code / Claude Code. We ship the LSP
  and the MCP.
- AI-native marketing speak. The bet is specifically that contracts have
  to be machine-enforced, not "the AI is smarter."

Repos:
- github.com/duckcode-ai/DataLex
- github.com/duckcode-ai/dql
- github.com/duckcode-ai/manifest-spec

Tutorials (jaffle-shop end-to-end, dbt + DuckDB, runs in Docker):
- github.com/duckcode-ai/jaffle-shop-DataLex
- github.com/duckcode-ai/jaffle-shop-dql

60-second demo: <link>

Honest about prior attempts:

I shipped two prior products that didn't sell. duckcode-observability
("shift-left observability" — category needed buyer education we didn't
have). duckcode-ide (agentic dbt IDE — Cursor and Claude Code had
already taken the company-wide IDE slot). Both archived. This attempt
specifically avoids those two failure modes — solving an existing pain
with a budget, and meeting users in their existing tools.

What I'm asking for:

If you run dbt and have felt the AI-inconsistency pain, I'd really like
to hear how you're handling it today. The wedge only works if the pain
is real — please tell me if it isn't, or if our framing misses something
obvious. Pushback wanted.

Happy to dig into the certification semantics, the manifest spec, the
LSP/MCP design, the column-level lineage emitter, the OpenLineage
integration plan, or anything else.
```

## Engagement plan

- Reply within 30 minutes to every comment for the first 4 hours
- Concede every valid critique in the same comment thread
- Do not edit the post except to add `EDIT:` blocks at the bottom
- Stay in r/dataengineering only — do not cross-post to r/analytics,
  r/MachineLearning, etc. (mods of multiple data subs talk to each
  other; cross-posting reads as marketing)
