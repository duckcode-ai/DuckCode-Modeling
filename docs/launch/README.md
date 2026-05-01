# Launch HQ

Coordinated launch of **DataLex + DQL + manifest-spec** as the certified
analytics stack for the AI era. This folder is the canonical artifact set —
checklist, waterfall, and channel-specific post drafts — that the
maintainers run on launch day.

## Readiness checklist

Every item here is a prerequisite. The launch does not get scheduled until
all are green.

### Repos public, polished, runnable

- [ ] `duckcode-ai/DataLex` README headline + demo video embed
- [ ] `duckcode-ai/duckcode-dql` README headline + demo video embed
- [ ] `duckcode-ai/manifest-spec` v1.0.0 published, schemas validate examples
- [ ] `duckcode-ai/jaffle-shop-DataLex` README cross-link to `jaffle-shop-dql`
- [ ] `duckcode-ai/jaffle-shop-dql` README cross-link to `jaffle-shop-DataLex`
- [ ] Both jaffle-shop repos run cleanly from a fresh `git clone` on a clean
      machine (assume nothing pre-installed beyond Python, Node, and Docker)

### Wedge demo

- [ ] 60-second demo recorded, narrated, uploaded to YouTube (unlisted
      until launch day, public at T-0)
- [ ] Demo embedded in both repo READMEs and the manifest-spec README
- [ ] Demo shows: dbt parse → `datalex draft` → contract reviewed →
      `dql compile` certifies → MCP serves the certified answer to Cursor /
      Claude Code → lineage trail visible

### Community infrastructure

- [ ] Discord live, invite link in DataLex README, `#announcements`,
      `#datalex`, `#dql`, `#manifest-spec` channels created
- [ ] GitHub Discussions enabled on both repos with categories: General,
      Q&A, RFCs, Show & tell
- [ ] CONTRIBUTING.md, CODE_OF_CONDUCT.md, SECURITY.md, SUPPORT.md present
      in both DataLex and DQL
- [ ] RFC template at `docs/rfcs/0000-template.md` in both repos
- [ ] At least 3 sample questions answered in pinned GitHub Discussions
      (so newcomers see the project alive)

### Distribution

- [ ] DataLex 2.0 (or 1.9 with `datalex draft`) published to PyPI
- [ ] All DQL 1.5.x packages published to npm under `@duckcodeailabs/*`
- [ ] manifest-spec v1.0.0 tag pushed
- [ ] (Optional but valuable) VS Code Marketplace listings live for both
      LSPs

### Pre-warm

- [ ] 2 weeks of subtle "building something" tease posts on founder
      accounts (no spelling out — just curiosity)
- [ ] Outreach drafted to: Modern Data Stack newsletter (Brij Patel),
      Locally Optimistic, Benn Stancil, dbt Community Newsletter

## Launch-day waterfall (single Tuesday or Wednesday morning ET)

| Time (ET) | Channel | Post |
|---|---|---|
| 09:00 | Hacker News | [posts/hacker-news.md](posts/hacker-news.md) |
| 09:15 | dbt Community Slack `#i-made-this` | [posts/dbt-slack.md](posts/dbt-slack.md) |
| 09:30 | LinkedIn (founder personal) | [posts/linkedin.md](posts/linkedin.md) |
| 10:00 | X / Twitter (thread, founder) | [posts/twitter-thread.md](posts/twitter-thread.md) |
| 10:30 | Reddit r/dataengineering | [posts/reddit-dataengineering.md](posts/reddit-dataengineering.md) |
| 11:00 | Newsletter outreach sent | (Brij, Locally Optimistic, Benn, dbt) |
| All day | Engagement | Reply to every HN comment, every Slack reply, every LinkedIn comment, every Twitter mention. **Founder presence is what converts curious browsers into stargazers.** |

### Timing constraints

- Tuesday or Wednesday morning ET only. Avoid Mondays (catch-up day) and
  Fridays (momentum dies over weekend).
- Avoid major announcement weeks: dbt Labs / Snowflake / Databricks
  events, Anthropic/OpenAI model releases, AWS re:Invent.
- Aim for a launch window in a week with no large data conferences.

## Post-launch sustained cadence (8 weeks)

One technical deep-dive blog post per week. Cross-publish each to: founder
LinkedIn, X thread, dbt Slack `#tools-and-integrations` (only when
genuinely on-topic), and r/dataengineering occasionally.

| Week | Topic |
|---|---|
| 1 | Compile-time certification — how it works, why it matters |
| 2 | AI-assisted authoring with `datalex draft` — the prompt, few-shot pack, edge cases |
| 3 | The MCP for certified AI analytics — Cursor + Claude Code integration walkthrough |
| 4 | Column-level lineage from DQL block to source — under the hood |
| 5 | The manifest interop spec — why federation beats unification |
| 6 | OpenLineage emission — slotting into Marquez, Atlan, Monte Carlo |
| 7 | LSP authoring — autocomplete and diagnostics for AI agents |
| 8 | Architecture deep-dive — the unified metadata graph |

## Success metrics

| Metric | Week 1 | Month 1 |
|---|---|---|
| GitHub stars (DataLex) | 100 | 500 |
| GitHub stars (DQL) | 100 | 500 |
| HN ranking | Front page (top 30) | — |
| Demo video views | 500 | 2,000 |
| Discord members | 25 | 150 |
| Newsletter features | 0 | 2+ |
| External blog mentions | 0 | 3+ |
| Inbound contributor PRs | 0 | 2+ |

If Week 1 metrics underperform substantially (e.g., HN buries the post,
dbt Slack engagement is muted), pause the post-launch cadence for 1 week
and diagnose: is the framing wrong, is the demo unclear, did launch
timing collide with a bigger announcement? Course-correct before
continuing the 8-week content cadence.

## What NOT to do

- **Do not pay-promote in dbt Slack.** Community will turn against the
  project. Permanent damage.
- **Do not cold-DM influencers** asking for shares. Desperation signal.
- **Do not use "dbt killer" or "Atlan alternative" framing.** Position
  complementarily; dbt and Cube communities are large and friendly when
  not threatened.
- **Do not launch without the demo video.** Words alone don't sell OSS
  in 2026.
- **Do not launch DataLex one week and DQL the next.** Same day, or
  wait.
- **Do not paste identical content to every channel.** Each channel has
  its voice; tailor.
- **Do not respond defensively to negative HN comments.** Engage
  substantively, concede valid points, redirect on framing errors.
- **Do not over-claim** about features that aren't built. AI-twitter
  spots vapor immediately.
