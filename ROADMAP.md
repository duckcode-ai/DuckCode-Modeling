# DataLex public roadmap

This roadmap is the public source of truth for what's shipping next in
DataLex. It tracks the OSS plan; cloud and commercial work is tracked
separately and is not promised here.

Last updated: 2026-05-01

## Now (in flight)

- **AI-assisted starter** (`datalex draft`) — turns a dbt project into a
  starter `*.model.yaml` you review and commit. Reviewable AI output. Lands
  in 1.9.x.
- **Compile-time enforcement of contract references** in DQL via the
  `datalex_contract` field. Validation lives in `dql-core`; the contract
  shape is published in [`manifest-spec`](https://github.com/duckcode-ai/manifest-spec).
- **Manifest-spec v1.0** — separate OSS repo with versioned JSON Schemas
  for both DataLex and DQL manifests. Shipping 1.0 alongside DataLex 1.9.x.

## Next (Phase 2)

- **Column-level lineage in compiled output** — every binding traces back
  to a dbt source column.
- **AI-as-author plumbing** — LSP completions tuned for AI agents
  (Cursor, Claude Code, Copilot) writing DataLex YAML on a user's behalf.
- **OpenLineage emission** — DataLex contract changes emit OpenLineage
  events so existing observability tools (Marquez, Atlan, Monte Carlo)
  see contract drift without polling.

## Later (Phase 3)

- **VS Code Marketplace listing** for the DataLex LSP.
- **Public docs site** at `docs.datalex.dev` (or equivalent), built from
  the `docs/` folder.
- **More example projects** beyond jaffle-shop — fintech, e-commerce,
  healthcare (de-identified).

## Not on this roadmap (out of scope)

- Hosted multi-tenant DataLex Cloud (separate plan, separate repo).
- Authentication / SSO / OKTA / RBAC inside the OSS repo.
- Closed-source language features. None — DataLex stays 100% OSS.
- A standalone IDE. Users stay in Cursor/VS Code/Claude Code; we ship
  the LSP and the MCP, not an editor.

## How to influence the roadmap

- File a [feature request](https://github.com/duckcode-ai/DataLex/issues/new?template=feature_request.yml).
- Open a [GitHub Discussion](https://github.com/duckcode-ai/DataLex/discussions)
  for design conversations.
- For non-trivial proposals, write an RFC under [`docs/rfcs/`](docs/rfcs/).
- Show up at biweekly Office Hours (announced in [Discord](https://discord.gg/Dnm6bUvk)).

## How releases work

DataLex follows SemVer. Major versions are rare and announced via the
RFC process. Minor versions ship monthly when there's something worth
shipping. Patches ship as needed.

The compatibility window for the previous major is at least 12 months.
The manifest-spec major version is pinned in each DataLex release; see
the [manifest-spec compatibility table](https://github.com/duckcode-ai/manifest-spec/blob/main/docs/interop.md#compatibility-table).
