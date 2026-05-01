# Getting help with DataLex

There's no wrong question. Pick whichever channel matches what you need:

| What you need | Where to go |
|---|---|
| **A quick chat or "is this a bug?"** | [DataLex Discord](https://discord.gg/Dnm6bUvk) |
| **File a reproducible bug** | [Open a bug report](https://github.com/duckcode-ai/DataLex/issues/new?template=bug_report.yml) |
| **Request a feature** | [Open a feature request](https://github.com/duckcode-ai/DataLex/issues/new?template=feature_request.yml) |
| **Propose a language or schema change** | RFC under [`docs/rfcs/`](docs/rfcs/) — see the [template](docs/rfcs/0000-template.md) |
| **Report a security issue** | Follow [SECURITY.md](SECURITY.md) (do **not** open a public issue) |
| **Manifest-spec interop questions** | [duckcode-ai/manifest-spec](https://github.com/duckcode-ai/manifest-spec) |

## Triage SLA

We aim to acknowledge new issues within **3 business days** and apply a triage label (`bug`, `enhancement`, `question`, `needs-info`, `wontfix`) within **7 business days**. The schedule below sets expectations — it is not a hard guarantee for a small OSS team.

| Severity | First response | Status update | Resolution target |
|---|---|---|---|
| `severity:critical` (data loss, broken release) | <24h | every 48h | within 1 week |
| `severity:high` (blocks core flows, regression) | <72h | weekly | next minor release |
| `severity:normal` | <7 days | as needed | best-effort |
| `severity:low` / `enhancement` | <14 days | quarterly | community PRs welcome |

## Office Hours

Biweekly community office hours are announced in the [Discord](https://discord.gg/Dnm6bUvk) `#announcements` channel. Drop in with questions, designs in progress, or just to chat with the team.

## What we'll **not** do here

- Discuss closed-source / commercial product details — that's a separate venue.
- Provide tax, legal, financial, or compliance advice based on your data — DataLex is a tool; you own the call.
- Triage issues filed against archived repos (`duckcode-observability`, `duck-code`) — those are unmaintained.
