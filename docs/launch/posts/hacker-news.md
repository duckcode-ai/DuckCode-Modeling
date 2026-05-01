# Hacker News (Show HN) — launch-day post

> **Channel norms.** Plain text. No marketing speak. Lead with the problem.
> One shot — if it gets buried, do not repost. Founder online and engaging
> in comments for at least 4 hours after submit.

## Title (≤ 80 chars)

```
Show HN: DataLex + DQL – analytics-as-code with compile-time AI certification
```

## URL

`https://github.com/duckcode-ai/DataLex` (or wherever the demo video lands)

## Body

```text
Hi HN — over the last year of shipping data tools we kept running into the
same problem: ask an AI agent the same business question two different ways,
get two different numbers. CFOs and data leads are starting to ask "can we
trust the AI numbers?" and the honest answer right now is "no."

DataLex (https://github.com/duckcode-ai/DataLex) and DQL
(https://github.com/duckcode-ai/dql) are our attempt at a stack that fixes
this end-to-end:

- DataLex is a YAML-first language for business contracts: domains,
  entities, calculations, governance. Compiles to a manifest. Sits above
  dbt.
- DQL is a YAML-first analytics language: blocks, notebooks, apps with
  full column-level lineage. Compiles to a manifest. Sits where Hex /
  Cube would.
- A separate manifest-spec repo holds the public JSON Schemas plus the
  contract that says how a DQL block references a DataLex contract by id.
- The DQL MCP server (https://modelcontextprotocol.io) refuses to serve
  any block that doesn't reference a certified DataLex contract. Cursor /
  Claude Code / Copilot / your internal copilot get only certified
  answers, with the lineage trail traceable from chart back to source
  column.

This is dbt Labs / Cube Inc / Astronomer playbook structurally — OSS
languages stay free and open, hosting will eventually live in a separate
private repo. Both languages already work standalone if you only want
one half.

60-second demo: <link>
Code: github.com/duckcode-ai/DataLex and github.com/duckcode-ai/dql
Manifest spec: github.com/duckcode-ai/manifest-spec

Honest about prior attempts: we shipped duckcode-observability ("shift-
left observability") which didn't land — the category needed buyer
education we didn't have. We shipped duckcode-ide (agentic dbt IDE) which
didn't land — Cursor and Claude Code already won the IDE-with-agent slot
at the company-wide standard layer. Both are archived. The lesson we took
from #1 was "don't pick a category that needs explaining." The lesson
from #2 was "stay out of the IDE-with-agent space; ship LSP + MCP
instead."

Happy to dig into the certification semantics, the manifest spec, the
LSP/MCP design, or anything else. Comments open.
```

## Engagement plan

- First 4 hours: respond to every comment substantively
- Concede valid criticism in-thread; do not delete anything
- Pin the demo video in a top-level reply
- Have these counter-arguments ready:
  - "Doesn't dbt already do this?" — dbt has contracts; we add
    business-conceptual modeling above and certified-block analytics
    below, plus the manifest-spec bridge. Read the interop doc.
  - "Why two YAML languages?" — different audiences, different release
    cadences. Federation via spec is the right structure (cite dbt
    manifest, OpenAPI, OpenLineage as precedent).
  - "Aren't you reinventing Cube?" — Cube is a semantic layer; we sit
    above it (DataLex contracts) and below it (DQL blocks). Cube can
    consume our manifests if it wants to.
  - "Yet another YAML DSL?" — Yes. The bet is that AI agents writing
    YAML is the 2026 distribution mechanic. The LSP + MCP design is
    optimized for AI authorship.

## Forbidden tone

- "Disrupting" / "killing" / "the future of"
- Capitalized buzzwords ("AI-Native", "Game-Changing")
- Marketing speak in general — HN sniffs it instantly
