# Agentic AI modeling

DataLex AI is a local-first modeling assistant for dbt teams. It is
not a generic chatbot bolted onto the UI: it routes each request to
modeling specialists, retrieves exact project context, proposes YAML
changes for review, and applies approved changes through the same
guarded file APIs used by manual edits.

> **DataLex 1.4** added two **deterministic** AI agents that can run
> with no API key — the **Conceptualizer** and the **Canonicalizer** —
> plus a doc-block-aware retrieval and apply pipeline. See
> [Conceptualizer + Canonicalizer (1.4)](#conceptualizer--canonicalizer-14)
> below.

## Install and open a repo

```bash
pip install -U 'datalex-cli[serve]'
cd ~/path/to/your-dbt-project
datalex serve --project-dir .
```

Then open **Import dbt repo → Local folder**, select the same dbt root,
and keep **Edit in place** enabled. After import, DataLex automatically
rebuilds the AI index for the project.

## Provider setup

Open **Settings → AI** and choose a provider:

| Provider | Notes |
|---|---|
| Local | No API key. Good for smoke tests and deterministic fallback answers. The 1.4 conceptualizer + canonicalizer also run with no provider configured. |
| OpenAI | Enter API key and model name. |
| Anthropic Claude | Enter API key and model name. |
| Gemini | Enter API key and model name. |
| Ollama-compatible | Enter the local or remote base URL and model. |

Provider settings are stored locally in the browser. DataLex never
writes AI-generated YAML until you approve an explicit proposal.

## What the AI can do

Ask AI can:

- Explain a selected concept, logical entity, dbt model, column, file,
  or relationship.
- Reverse-engineer a physical dbt repo into conceptual or logical
  models.
- Propose missing descriptions, owners, glossary links, data types,
  tests, constraints, and relationship fixes.
- Generate new conceptual, logical, physical, diagram, skill, glossary,
  policy, or dbt metadata YAML.
- Review validation rows and explain what is missing, why it matters,
  and what YAML change would fix it.
- **(1.4)** Cluster staging columns into business entities + relationships
  via the *Conceptualize from staging* button.
- **(1.4)** Lift recurring staging columns into a logical canonical
  layer with shared `{% docs %}` blocks via *Canonicalize from staging*.

Ask AI cannot directly run dbt, apply DDL, push to a database, or
write files without approval. It may propose commands or SQL for the
user to run.

## Where to ask

Use Ask AI from:

- The right-panel **AI** tab.
- The canvas floating Ask AI button.
- Entity, concept, table, relationship, Explorer file/folder, and
  validation-row context menus.
- Selected text in the UI.
- The diagram background for workspace-level requests.
- **(1.4)** The entity inspector empty state — two dedicated buttons
  for the deterministic conceptualizer / canonicalizer agents.

The prompt composer behaves like a normal chat input:

- `Enter` sends.
- `Shift+Enter` inserts a newline.
- While the model is running, the chat shows a short live status such
  as "Finding the most relevant dbt and DataLex context."

## Retrieval model

DataLex does not use vector search for YAML/code/model retrieval in
v1. The default retrieval stack is:

```text
selected object context
-> structured DataLex/dbt lookup
-> BM25 lexical search over the typed local index
-> graph and lineage expansion
-> validation findings
-> relevant skills
-> relevant memory
-> AI answer or YAML proposal
```

The local index includes:

- DataLex model and diagram YAML.
- dbt schema/source YAML.
- dbt SQL files.
- `target/manifest.json`.
- `target/catalog.json`.
- `target/semantic_manifest.json`.
- `target/run_results.json`.
- Concepts, entities, tables, columns, data types, tests, relationships,
  diagrams, domains, owners, tags, and glossary terms.
- **(1.4)** Doc-block bodies — when a column declares
  `description_ref: { doc: <name> }`, BM25 ranks it against the full
  resolved prose, not the literal jinja string.
- Validation issues.
- Project-local skills and memory.

Repo-wide prompts such as "reverse engineer this repo" intentionally
expand beyond the active diagram. Specific prompts such as "explain
this column" prioritize the selected object first.

## Doc-block round-trip guardrail (1.4)

When a column or model description is bound via
`description_ref: { doc: <name> }`, the rendered prose lives in a
`.md` file (`{% docs %}` block). The apply path enforces this:

- The AI prompt includes a doc-block contract clause: *"To improve
  such a description, propose an `update_file` change against the
  `.md` file — do NOT overwrite the YAML description directly."*
- If a `patch_yaml` proposal would still try to clobber a bound
  description, the apply API returns 422 / `DOC_BLOCK_OVERWRITE` with
  the offending path + doc name. The UI surfaces this as a clear
  toast pointing the user at the `.md` file.
- The api-server invalidates the doc-block index whenever a YAML or
  `.md` file is written, so the next prompt sees the fresh content.

This means AI-generated improvements to doc-block-bound columns
flow naturally:

1. User asks: *"Tighten the customer_email description with PII
   guidance."*
2. AI returns an `update_file` change against
   `models/docs/_canonical.md`, editing the `{% docs customer_email %}`
   block.
3. The change applies; every column that references the block now
   shows the new prose.

## Conceptualizer + Canonicalizer (1.4)

Two deterministic agents shipped in 1.4. Both produce DataLex proposals
through the existing **Review plan → Validate → Apply** flow; nothing
is written until you accept the change. **No API key required.**

### Conceptualizer

```bash
# CLI
python -m datalex_core.agents conceptualize --project ~/your-dbt-project | jq .

# HTTP
curl -X POST http://localhost:3030/api/ai/conceptualize \
  -H 'Content-Type: application/json' -d '{"projectId": "<your-project-id>"}'

# UI
Entity inspector → empty state → "Conceptualize from staging"
```

What it does:

1. Walks every model whose name matches `stg_*` / `staging_*` / `src_*`
   / `raw_*` (or whose path contains `/staging/`).
2. Strips the prefix and singularizes the noun
   (`stg_orders` → `Order`, `stg_segment_events` → `Event`).
3. Maps domains via a built-in dictionary (customer→crm, order→sales,
   payment→finance, …).
4. Extracts foreign-key relationships from `foreign_key:` /
   `references:` / dbt `relationships:` tests on the staging columns,
   deduped and labelled with a business verb.
5. Returns a `kind: diagram` proposal with entities, relationships,
   and inferred domains — ready to apply through the Review plan.

Acceptance bar: ≥80% precision on a hand-labeled jaffle-shop
ground-truth set.

### Canonicalizer

```bash
# CLI
python -m datalex_core.agents canonicalize --project ~/your-dbt-project --min-recurrence 2 | jq .

# HTTP
curl -X POST http://localhost:3030/api/ai/canonicalize \
  -H 'Content-Type: application/json' -d '{"projectId": "<id>", "minRecurrence": 2}'

# UI
Entity inspector → empty state → "Canonicalize from staging"
```

What it does:

1. Buckets staging models by their **canonical noun** — the last
   token of the stripped name. So `stg_shopify_orders` and
   `stg_stripe_orders` both bucket under `Order`.
2. For each bucket, finds columns recurring in `min-recurrence` or
   more staging models (default 2).
3. Picks the longest description as the canonical, notes divergent
   descriptions and divergent types, picks the first sorted type.
4. **Emits a shared `{% docs %}` block** for each canonical column
   so the round-trip stays lossless.
5. Returns proposal changes: one `create_file` for
   `DataLex/docs/_canonical.md` and one per logical entity
   (`DataLex/logical/<entity>.model.yaml`).

The output is staged through Review plan, so reviewers can scope down
the proposal before applying.

## Skills

Skills are Markdown files under:

```text
DataLex/Skills/*.md
```

Create them from the left **Skills** tab. A skill has frontmatter:

```yaml
---
name: "dbt Testing Standards"
description: "When to use not_null, unique, accepted_values, and relationships tests."
use_when:
  - "dbt tests"
  - "data quality"
tags:
  - "dbt"
  - "governance"
layers:
  - "physical"
agent_modes:
  - "physical_dbt_developer"
  - "governance_reviewer"
priority: 5
---
```

The router auto-selects skills when `use_when`, tags, layers, or
content match the current request. In the chat result, selected
skills can be pinned or disabled for the current request. Commit team
skills to Git when they represent shared standards.

The 1.4 agents register two new modes (`conceptualizer`,
`canonicalizer`) you can target from a skill's `agent_modes` field.

## Memory and history

DataLex stores project-local AI runtime state under:

```text
.datalex/agent/
```

This includes chat history, extracted modeling memory, the typed
index snapshot, and a SQLite/JSON runtime cache. Treat it as local
runtime state unless your team explicitly wants to share it.

New chat history entries preserve:

- Answer text.
- Sources used.
- Agent run details.
- Skills and memory used.
- Proposed YAML changes.
- Review plan content.

## Proposal review and apply flow

AI-generated YAML must behave exactly like user-created YAML. The
apply flow is:

```text
Ask AI
-> answer + proposed changes
-> Review plan in the center editor
-> Validate proposal
-> Apply approved changes
-> refresh file list and content cache
-> open newly created primary artifact
-> rebuild diagram/model graph
-> refresh Explorer and inspector
-> rerun validation + readiness review
-> update physical SQL/DDL previews
-> rebuild AI index (including doc-block index)
```

Every proposed change includes rationale, source context, validation
impact, and review summary. Invalid YAML, unsafe paths, wrong-layer
operations, duplicate relationships, **doc-block overwrites**, and
other blocked changes fail validation before writing.

## Example prompts

```text
Reverse engineer this dbt repo into a business conceptual model.
Create a logical model for customer 360 from the imported dbt models.
Explain what fct_orders is missing before publishing it as a mesh interface.
Find weak relationships between orders, customers, and payments.
Propose focused YAML changes to add descriptions and relationship tests.
Use our naming standards skill and fix only the selected model.
Tighten the {{ doc("customer_email") }} block with PII guidance.
Lift staging columns that recur into a canonical Order entity.
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI only answers from the open diagram | Rebuild the AI index in Settings → AI or re-import the dbt repo. |
| Provider call fails | Check API key, model name, base URL, and local Ollama availability. |
| Proposal cannot apply | Open Review plan, then Validate. The validation result explains the blocked path, YAML parse error, duplicate relationship, doc-block overwrite, or layer mismatch. |
| `DOC_BLOCK_OVERWRITE` on apply | The change targets a description bound to a `{% docs %}` block. Edit the `.md` file instead, or remove the column's `description_ref` first if you really mean to break the binding. |
| Conceptualizer returns 0 entities | Your project has no staging-layer models matching `stg_*` / `staging_*` / `src_*` / `raw_*`. Rename or pass through `Ask AI` with explicit naming context. |
| Canonicalizer returns 0 entities, "no recurring columns" note | Each staging model maps to a unique noun, so there's nothing to lift. Lower `--min-recurrence` to 1 (UI: numeric input) or add sibling staging models. |
| Skills are ignored | Confirm the skill file is under `DataLex/Skills/`, has frontmatter, and includes matching `use_when`, tags, layers, or agent modes. |
| Chat history lacks Review plan | Older chats only stored messages. New chats preserve the full AI result metadata. |
