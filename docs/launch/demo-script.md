# 60-second demo script

The launch artifact every channel post depends on (HN, dbt Slack, LinkedIn,
X, Reddit). Goal: a viewer who's never heard of DataLex or DQL understands
the wedge in 60 seconds and wants to try it.

## Constraints

| | |
|---|---|
| Duration | **55–65 seconds** (final cut) |
| Aspect | 16:9, 1920×1080, 30fps |
| Voiceover | Required. Subtitles required. (LinkedIn auto-plays muted; Twitter caps captions.) |
| Captures | macOS screen recording at 1080p. QuickTime (Cmd+Shift+5) or Loom or OBS — whichever you're fastest in. |
| Music | None. Voice + UI only. Music distracts on dev demos. |
| Cursor | Show pointer. Hide all menubar clutter (`Hidden Bar` or just full-screen the apps). |

## Pre-recording checklist

- [ ] Browser windows: 1280px wide, no extensions visible
- [ ] Terminal: dark theme, font ≥ 16pt, prompt set to a single `$` (no path noise)
- [ ] All bookmarks bar / dev-tool sidebars hidden
- [ ] Notifications silenced (DND on)
- [ ] `jaffle-shop-DataLex` and `jaffle-shop-dql` cloned and `dbt build` already done so we don't waste seconds on dbt downloading
- [ ] Cursor (or Claude Desktop) configured to point at `dql mcp serve` running in jaffle-shop-dql
- [ ] DataLex's `datalex serve` running on :3030 in another window, hidden until needed
- [ ] Read the script aloud once for timing — adjust if it runs long

## The script — six shots, ~10s each

> Total runtime budget: 60s. Voiceover times listed assume neutral pace
> (~155 words/min). Tighten by 5% if you record at 165 wpm.

### Shot 1 — The problem (0:00 → 0:08)

**Visual.** Cursor or Claude Desktop chat window. Type live:
*"What was monthly active customers last quarter?"*  Hit return. AI streams a number — say **4,821**. Then in a fresh chat tab type *"Q1 active customers, distinct count"*. Different number — say **5,304**. Both numbers visible side-by-side.

**Voiceover (~17 words / 7s):**
> Ask an AI agent the same question two different ways, get two different
> numbers. CFOs don't trust the dashboards.

### Shot 2 — The fix in YAML (0:08 → 0:18)

**Visual.** VS Code with two split panes:
- Left: `jaffle-shop-DataLex/DataLex/commerce/contracts.model.yaml` — highlight the `commerce.Customer.monthly_active_customers` block with the signature.
- Right: `jaffle-shop-dql/blocks/customer/monthly_active_customers.dql` — highlight `datalex_contract = "commerce.Customer.monthly_active_customers@1"`.

**Voiceover (~25 words / 10s):**
> DataLex codifies the definition once, in YAML. DQL blocks reference the
> contract by id. Two open-source languages, federated through a public
> manifest spec.

### Shot 3 — Compile-time enforcement (0:18 → 0:30)

**Visual.** Terminal. Run `dql compile`. Show clean output. Then **edit the
DQL block live** — change `monthly_active_customers@1` to `monthly_active_customers@99`. Re-run `dql compile`. Show the error in red:
*"Block 'Monthly Active Customers' datalex_contract = '…@99' pinned version
is missing (available: 1)."*  Revert, recompile clean.

**Voiceover (~30 words / 12s):**
> The DQL compiler resolves every reference against the DataLex manifest.
> Drift the version, mistype the id, break a signature — compilation fails.
> The wedge is *certification with teeth.*

### Shot 4 — Certified MCP serves the AI agent (0:30 → 0:42)

**Visual.** Switch back to Cursor / Claude Desktop. Same first chat tab as
Shot 1. New question:
*"How many active customers did Jaffle Shop have last month?"* The agent
calls the MCP `query_via_block` tool — show the tool-call breadcrumb in the
UI. Result returns. Same number that the dashboard would show. Show the
breadcrumb expanded so the contract id `commerce.Customer.monthly_active_customers@1` is visible in the response.

**Voiceover (~28 words / 12s):**
> The DQL MCP refuses to serve any block that doesn't resolve to a
> certified contract. Cursor, Claude Code, your own copilot — all answer
> through the same gate.

### Shot 5 — End-to-end lineage (0:42 → 0:52)

**Visual.** Switch to DataLex's web UI on :3030. Click into the
`Monthly Active Customers` block. Lineage graph renders: chart → DQL block
→ DataLex contract → dbt model `fct_orders` → source column
`fct_orders.customer_id`. Highlight the path with a quick mouse hover.

**Voiceover (~22 words / 9s):**
> Every output column traces back through the contract, through dbt, all
> the way to a source column. End-to-end lineage you can audit.

### Shot 6 — Call to action (0:52 → 0:60)

**Visual.** Title card. White on dark, no logo. Three lines stacked:

```
DataLex + DQL
github.com/duckcode-ai/DataLex
github.com/duckcode-ai/dql
```

**Voiceover (~14 words / 7s):**
> Open source today. Apache 2.0. Star it on GitHub if this is the wedge
> you've been waiting for.

## Editing notes

- Cut every dead frame. If your hand fumbles a keystroke, splice past it.
- Don't crossfade. Hard cuts feel snappier on dev demos.
- Voice levels: -16 LUFS integrated, -1 dBTP true peak. Music notwithstanding.
- Burn captions in (don't rely on auto-generated for any platform). Use
  the voiceover text above verbatim.
- Export H.264, MP4, max bitrate ~10 Mbps. File should be < 50 MB so it
  plays inline on every channel including LinkedIn.

## Where to upload

| Channel | Format |
|---|---|
| YouTube | Unlisted at first; flip public on launch day. The README and HN post link to the YouTube URL. |
| LinkedIn | **Native upload** of the same MP4. LinkedIn punishes external links to ~10% reach. |
| X / Twitter | Embed the MP4 in the second tweet of the thread; first tweet is the hook. |
| dbt Slack | Drop the YouTube link in `#i-made-this`. Don't upload a video file directly. |

## After recording

- [ ] Watch back at 1.5× — anything boring at 1.5× is boring at 1× too. Cut.
- [ ] Send the rough cut to one person who's never heard of DataLex. If they
      can't articulate the wedge after watching once, re-cut.
- [ ] Embed the video in `docs/index.md` and `jaffle-shop-{DataLex,dql}/README.md`.
- [ ] Update the launch checklist in [`launch/README.md`](README.md):
      change "Demo recorded, narrated, uploaded to YouTube" from `[ ]` to `[x]`.

## When the wedge changes, the demo changes

This script targets the specific April-2026 product surface. If the next
release adds (e.g.) automatic AI agent re-routing on contract drift,
re-cut Shot 3 to show that. **Don't let the demo go stale; a stale demo
loses every prospect on first impression.**
