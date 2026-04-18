# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security vulnerabilities.**

Email `security@duckcode.ai` with:

- A description of the issue and its impact.
- Steps to reproduce (a minimal repro case is ideal).
- The DataLex version (`datalex --version` if available, or the commit SHA).
- Your name and affiliation if you would like credit in the fix's release notes.

We will acknowledge receipt within **2 business days**, share our initial
assessment within **7 days**, and aim to ship a fix for confirmed
high-severity issues within **30 days**. For lower-severity issues we
will coordinate a timeline with the reporter.

## Supported versions

DataLex is pre-1.0 and under active development. Security fixes land on
`main` and the most recent tagged release. Older tags are not patched.

| Version | Supported          |
|---------|--------------------|
| 0.1.x   | :white_check_mark: |
| < 0.1   | :x:                |

## Scope

In-scope:

- The DataLex CLI (`datalex`) and Python packages (`datalex_core`,
  `datalex_cli`).
- The web API server (`packages/api-server`) and Visual Studio UI
  (`packages/web-app`).
- CI reusable GitHub Action (`.github/actions/datalex`).
- JSON Schemas shipped under `schemas/datalex/`.

Out of scope:

- Vulnerabilities in third-party dependencies (report upstream; we will
  roll forward once a fix is available).
- Issues that require the attacker to already have filesystem write
  access to the DataLex project directory.

Thank you for helping keep DataLex and its users safe.
