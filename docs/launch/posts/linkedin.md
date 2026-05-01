# LinkedIn (founder personal account) — launch-day post

> **Channel norms.** Founder-personal account, not company page (LinkedIn
> rewards personal posts ~10x). Native video upload — LinkedIn punishes
> external video links. Honest narrative about prior failures performs
> dramatically better than "we're announcing X." 3–5 hashtags max.

## Post

```text
Two years ago I shipped DuckCode Observability. Nobody bought it.

The problem wasn't engineering — the code worked. The problem was that
"shift-left observability" required buyer education we didn't have. CDOs
don't have a budget line for "shift-left." They have one for "stop the
3am pages."

A year ago I shipped DuckCode IDE. Nobody bought that either.

Same lesson, sharper this time: IDE choice is a company-wide standard,
not a per-domain one. Cursor and Claude Code had already taken the slot.
Even if our dbt-specific IDE was better at dbt, "do we add another IDE
just for the data team?" answers itself.

Both products are archived now.

Here's what those failures taught us, baked into what we shipped today:

→ Don't pick a category that needs buyer education. Solve a pain people
already have a budget line for.

→ Don't compete where company-wide standards live. Meet users in their
existing tools.

So we built two new OSS languages targeting one specific pain we keep
hearing from data leaders in 2026: AI agents give different answers to
the same business question. CFOs and boards are asking "can we trust the
AI numbers?" — and right now the answer is no.

📦 DataLex → YAML business contracts above dbt
📦 DQL → YAML certified analytics below dbt
📦 manifest-spec → the public JSON Schemas that bind them

Together: when an AI agent queries your data through our MCP server, it
gets a certified answer with full column-level lineage back to source.
One question, one answer — every time.

Both languages stay 100% open source forever (Apache 2.0). dbt unchanged.
We sit above and below.

60-second demo on this post ↓

Honest about prior failures because that's what taught us this. If
you've felt the AI-numbers-don't-match pain, I'd love to hear how
you're handling it today. Open to thoughts, pushback, war stories.

#dbt #analyticsengineering #opensource #datacontracts #ai
```

## Native video

Upload the 60-second demo directly to LinkedIn (do **not** use a YouTube
link — LinkedIn deprioritizes external links to ~10% the reach).

## Engagement plan

- Reply to every comment in the first 24 hours
- "Like" thoughtful comments to surface them in others' feeds
- Tag specific people only when there's genuine context (Tristan Handy,
  Benn Stancil, Brij Patel, etc.) — never spammy
- Repost with a fresh take on day 3 and day 7 if the original underperforms
