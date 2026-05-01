# Manifest spec

Versioned JSON Schemas + interop docs for the **DataLex** and **DQL**
manifest formats. Treated as an external API: third-party tools (Atlan,
Marquez, Monte Carlo, internal copilots) build on these schemas without
coupling to either language's implementation.

> **Why it lives here.** The spec is small enough today that a separate
> repo would add coordination overhead with little payoff. We can extract
> it later — when external consumers ask for a stable repo URL — without
> changing the schema content. dbt Labs took the same path: the dbt
> manifest schema lived in `dbt-core` for years before the question of a
> separate home came up.

## What's in scope

| Path | Purpose |
|---|---|
| [`v1/datalex-manifest.schema.json`](v1/datalex-manifest.schema.json) | JSON Schema for DataLex manifests |
| [`v1/dql-manifest.schema.json`](v1/dql-manifest.schema.json) | JSON Schema for DQL manifests |
| [`interop.md`](interop.md) | How a DQL block references a DataLex contract by id |
| [`versioning.md`](versioning.md) | SemVer + breaking-change discipline |
| [`examples/datalex/minimal.manifest.json`](examples/datalex/minimal.manifest.json) | Smallest valid DataLex manifest |
| [`examples/dql/minimal.manifest.json`](examples/dql/minimal.manifest.json) | Smallest valid DQL manifest |
| [`CHANGELOG.md`](CHANGELOG.md) | Version history |

## Stable URLs (pin these from external tools)

Once the docs site is published these schemas live at:

- `https://datalex.duckcode.ai/manifest-spec/v1/datalex-manifest.schema.json`
- `https://datalex.duckcode.ai/manifest-spec/v1/dql-manifest.schema.json`

Until the custom domain is wired, the GitHub-Pages-served URLs work too:

- `https://duckcode-ai.github.io/DataLex/manifest-spec/v1/datalex-manifest.schema.json`
- `https://duckcode-ai.github.io/DataLex/manifest-spec/v1/dql-manifest.schema.json`

## Why federation, not unification

DataLex (Python) and DQL (TypeScript) have different audiences, runtimes,
and release cadences. Combining them in one repo would slow both down.
The pattern instead — pioneered by **dbt's `manifest.json`, OpenAPI,
OpenLineage, and JSON Schema itself** — is a **public, versioned interop
spec** that producers and consumers commit to.

## Status

- **v1.0.0** — first published spec. DataLex 1.8.x and DQL 1.5.x emit
  manifests that validate against this version.

## Validating a manifest

```bash
# Python
pip install jsonschema
python -c "
import json, jsonschema, urllib.request
schema_url = 'https://datalex.duckcode.ai/manifest-spec/v1/dql-manifest.schema.json'
schema = json.loads(urllib.request.urlopen(schema_url).read())
manifest = json.load(open('path/to/your/dql-manifest.json'))
jsonschema.Draft202012Validator(schema).validate(manifest)
print('OK')
"

# Node
npm install ajv
node -e "
const Ajv = require('ajv/dist/2020.js').default;
const fetch = (await import('node:fs/promises')).readFile;
const schema = JSON.parse(await fetch('./docs/manifest-spec/v1/dql-manifest.schema.json', 'utf-8'));
const manifest = JSON.parse(await fetch('./path/to/your/dql-manifest.json', 'utf-8'));
const ok = new Ajv({allErrors: true, strict: false}).validate(schema, manifest);
console.log(ok ? 'OK' : 'FAIL');
"
```

## Contributing schema changes

This spec evolves through GitHub Discussions before any schema change
lands. File a Discussion before opening a schema PR. Breaking changes
require an [RFC](https://github.com/duckcode-ai/DataLex/blob/main/docs/rfcs/0000-template.md) and a major version bump.
