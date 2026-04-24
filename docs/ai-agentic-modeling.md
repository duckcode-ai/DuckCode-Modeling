# Agentic AI modeling

DataLex AI is a local-first modeling assistant for dbt teams. It is not a
generic chatbot bolted onto the UI: it routes each request to modeling
specialists, retrieves exact project context, proposes YAML changes for
review, and applies approved changes through the same guarded file APIs
used by manual edits.

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
| Local | No API key. Good for smoke tests and deterministic fallback answers. |
| OpenAI | Enter API key and model name. |
| Anthropic Claude | Enter API key and model name. |
| Gemini | Enter API key and model name. |
| Ollama-compatible | Enter the local or remote base URL and model. |

Provider settings are stored locally in the browser. DataLex never writes
AI-generated YAML until you approve an explicit proposal.

## What the AI can do

Ask AI can:

- Explain a selected concept, logical entity, dbt model, column, file, or
  relationship.
- Reverse-engineer a physical dbt repo into conceptual or logical
  models.
- Propose missing descriptions, owners, glossary links, data types,
  tests, constraints, and relationship fixes.
- Generate new conceptual, logical, physical, diagram, skill, glossary,
  policy, or dbt metadata YAML.
- Review validation rows and explain what is missing, why it matters, and
  what YAML change would fix it.

Ask AI cannot directly run dbt, apply DDL, push to a database, or write
files without approval. It may propose commands or SQL for the user to
run.

## Where to ask

Use Ask AI from:

- The right-panel **AI** tab.
- The canvas floating Ask AI button.
- Entity, concept, table, relationship, Explorer file/folder, and
  validation-row context menus.
- Selected text in the UI.
- The diagram background for workspace-level requests.

The prompt composer behaves like a normal chat input:

- `Enter` sends.
- `Shift+Enter` inserts a newline.
- While the model is running, the chat shows a short live status such as
  "Finding the most relevant dbt and DataLex context."

## Retrieval model

DataLex does not use vector search for YAML/code/model retrieval in v1.
The default retrieval stack is:

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
- Validation issues.
- Project-local skills and memory.

Repo-wide prompts such as "reverse engineer this repo" intentionally
expand beyond the active diagram. Specific prompts such as "explain this
column" prioritize the selected object first.

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

The router auto-selects skills when `use_when`, tags, layers, or content
match the current request. In the chat result, selected skills can be
pinned or disabled for the current request. Commit team skills to Git
when they represent shared standards.

## Memory and history

DataLex stores project-local AI runtime state under:

```text
.datalex/agent/
```

This includes chat history, extracted modeling memory, the typed index
snapshot, and a SQLite/JSON runtime cache. Treat it as local runtime
state unless your team explicitly wants to share it.

New chat history entries preserve:

- Answer text.
- Sources used.
- Agent run details.
- Skills and memory used.
- Proposed YAML changes.
- Review plan content.

Older chats created before this metadata existed show only message text.

## Proposal review and apply flow

AI-generated YAML must behave exactly like user-created YAML. The apply
flow is:

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
-> rerun validation
-> update physical SQL/DDL previews
-> rebuild AI index
```

Every proposed change includes rationale, source context, validation
impact, and review summary. Invalid YAML, unsafe paths, wrong-layer
operations, duplicate relationships, and other blocked changes fail
validation before writing.

## Example prompts

```text
Reverse engineer this dbt repo into a business conceptual model.
Create a logical model for customer 360 from the imported dbt models.
Explain what fct_orders is missing before publishing it as a mesh interface.
Find weak relationships between orders, customers, and payments.
Propose focused YAML changes to add descriptions and relationship tests.
Use our naming standards skill and fix only the selected model.
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| AI only answers from the open diagram | Rebuild the AI index in Settings → AI or re-import the dbt repo. |
| Provider call fails | Check API key, model name, base URL, and local Ollama availability. |
| Proposal cannot apply | Open Review plan, then Validate. The validation result explains the blocked path, YAML parse error, duplicate relationship, or layer mismatch. |
| Skills are ignored | Confirm the skill file is under `DataLex/Skills/`, has frontmatter, and includes matching `use_when`, tags, layers, or agent modes. |
| Chat history lacks Review plan | Older chats only stored messages. New chats preserve the full AI result metadata. |
