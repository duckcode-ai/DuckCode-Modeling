# dbt Community Slack `#i-made-this` — launch-day post

> **Channel norms.** Conversational. Peer-level. Lead with respect for
> dbt — frame as complementary, never competitive. No marketing speak.
> Quick demo, ask for feedback. **Do not cross-post to multiple channels.**
> Founder available to engage replies for the rest of the day.

## Post

```text
Hey folks 👋 — wanted to share something we've been building on top of dbt
that addresses a problem I've heard a lot in this Slack: the same business
question answered different ways by AI tools (ChatGPT, copilots, internal
agents) gives different numbers, even when everyone's pointing at the same
dbt project.

We took a shot at fixing it with two new OSS languages:

• **DataLex** sits above dbt. YAML conceptual model + contracts: "monthly
  active customers means X, calculated from these dbt models." Compiles
  to a manifest.

• **DQL** sits below the dbt mart layer. YAML certified blocks + apps:
  every block references a DataLex contract id. The DQL compiler
  enforces the binding — uncertified blocks can't be served to AI
  agents via the MCP.

dbt is unchanged. We read your manifest, never write into your dbt project.
The whole point is to give your existing dbt work a contract layer above
and a certified-analytics layer below, so AI tools query through both and
return one answer per question with full column-level lineage back to your
source.

60-sec demo: <link>
Code (Apache 2.0):
- github.com/duckcode-ai/DataLex
- github.com/duckcode-ai/dql
- github.com/duckcode-ai/manifest-spec (the public JSON Schemas)

Tutorial repos that wire dbt + DuckDB end-to-end:
- github.com/duckcode-ai/jaffle-shop-DataLex (Stage 1: contracts)
- github.com/duckcode-ai/jaffle-shop-dql (Stage 2: certified blocks +
  Apps + AI chat)

Genuinely curious for feedback. The wedge we're betting on is that AI
giving inconsistent numbers is a real, growing pain — and the fix is
contracts that AI agents can't bypass. If that resonates, or if it
doesn't, please tell me. Drop a thread comment or DM me here.

Happy to dig into the manifest spec, the MCP server, the LSP, the
column-level lineage emitter — whatever's useful.
```

## Engagement plan

- Reply within 30 minutes to every thread comment for the rest of the day
- Use threads, not new top-level posts
- If someone says "this overlaps with X (dbt feature)", thank them and
  explain the specific gap honestly
- Do not promote in `#tools-and-integrations` for at least a week —
  that channel is for follow-up content, not launch announcements
- Save Slack DMs for one-on-ones, not pitches
