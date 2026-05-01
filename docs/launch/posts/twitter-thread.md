# X / Twitter thread (founder personal) — launch-day

> **Channel norms.** Thread, not single tweet. Hook tweet = the problem.
> 5–8 follow-ups building through demo screenshots. Final tweet = GitHub
> links. Pin to profile. Tag dbt Labs / Tristan Handy / Cube / Benn
> Stancil only when the tag is genuine context — never spammy.

## Tweet 1 (hook — copy this exactly)

```
Ask an AI agent for "monthly revenue last quarter."

Then ask "Q1 gross revenue."

Same question. Different number.

This is the problem nobody's solved in 2026 AI analytics — and it's why
CFOs don't trust the dashboards yet.

Today we're shipping a fix.
```

## Tweet 2

```
The fix isn't a smarter prompt. It's a **contract layer** that AI agents
can't bypass.

Two new OSS languages, Apache 2.0:

🔹 DataLex — YAML business contracts above dbt
🔹 DQL — YAML certified analytics below dbt

dbt is unchanged. We sit above and below.
```

## Tweet 3 (screenshot of contract YAML)

```
DataLex defines the contract:

"Monthly active customers means: distinct customers who placed ≥ 1 order
in the calendar month, computed from fct_orders.customer_id"

Domain. Owner. Version. Calculation. All in YAML, all in git.
```

## Tweet 4 (screenshot of DQL block referencing contract id)

```
DQL blocks reference the contract by id:

  datalex_contract = "commerce.Customer.monthly_active_customers@1"

Compile-time check: if the contract doesn't exist, or the block's
output doesn't match the contract signature, compilation FAILS.

That's the wedge — certification with teeth.
```

## Tweet 5 (screenshot of MCP serving certified result to Cursor / Claude)

```
The DQL MCP server refuses to serve any block that isn't certified.

Plug it into Cursor / Claude Code / Copilot. Now your AI agent's answer
is the SAME answer as the dashboard — with column-level lineage back to
source.

One question, one answer.
```

## Tweet 6

```
Why two languages instead of one?

Because dbt Labs, Cube, Sigma, Hex all bet on a single language and got
trapped by their own scope. Federation via a public manifest spec is the
pattern that's actually worked: dbt's manifest, OpenAPI, OpenLineage.

We did the same.
```

## Tweet 7

```
Both languages stay 100% OSS forever. No closed-source language features.
Hosting / multi-tenant / RBAC ships in a separate private repo later
(open-core, dbt Labs / Cube Inc / Astronomer playbook).

Repos:
- github.com/duckcode-ai/DataLex
- github.com/duckcode-ai/dql
- github.com/duckcode-ai/manifest-spec
```

## Tweet 8 (close)

```
60-second demo: <link>

Honest: we shipped two products before this that didn't sell. Wrote about
why and what changed on LinkedIn.

If you've felt the AI-numbers-don't-match pain, would love to hear how
you're handling it today.
```

## Hashtags

Don't add hashtags to the thread itself (Twitter algorithm now penalizes
hashtag-heavy posts). If you must, add `#dbt` to the final tweet only.

## Engagement plan

- Quote-retweet ONE thoughtful response per hour for the first 4 hours
- Reply to every reply in the first 24 hours
- Pin the thread to profile for at least 2 weeks
