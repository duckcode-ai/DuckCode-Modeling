# Validation fix recipes

How DataLex AI agents resolve validation findings emitted by the Validation
panel and the dbt readiness gate.

The Validation panel groups findings into **blockers**, **model quality**, and
**coverage** sections. Each finding has a stable `code`, e.g.
`MISSING_MODEL_SECTION`. This document is the rule-by-rule recipe the agent
should follow when the user clicks **Ask AI** on a finding.

## Output contract

Every fix returns one of three statuses:

- `patch_yaml` — a JSON-patch on the existing file. **Default.** Use when the
  fix is a deterministic edit (rename, add a missing field, reorder, etc.).
- `needs_user_input` — when the fix requires human-only data (an email, a
  project name, a list of columns). Ask the smallest set of questions.
- `no_patch_needed` — when the finding is a false positive on this file.

Never propose `create_diagram` / `create_model` / `create_file` /
`delete_file` / `rename_file` from a validation fix. Validation fixes are
in-place edits.

## Recipes

### `MISSING_MODEL_SECTION`

**Trigger.** A `kind: model` file (or one missing a `kind:` declaration) has
no top-level `model:` block. Suppressed for `kind: diagram` files in v1.7.2+.

**Outcome.** `needs_user_input`. The block needs `name`, `version`, `domain`,
and `owners` — none of which the agent can invent.

**Questions to ask:**
1. What slug should `model.name` use? (lowercase snake_case)
2. What domain owns this model? (sales, finance, marketing, …)
3. Which emails are the model owners?

If the user wanted a layout-only file rather than a model file, ask whether to
add `kind: diagram` at the root instead.

### `INVALID_MODEL_NAME` / `INVALID_MODEL_VERSION` / `INVALID_MODEL_DOMAIN`

**Outcome.** `needs_user_input`. Each is a single-question form:

- `INVALID_MODEL_NAME` → ask for a snake_case slug.
- `INVALID_MODEL_VERSION` → suggest `1.0.0`, ask the user to confirm.
- `INVALID_MODEL_DOMAIN` → ask for the bounded context.

### `INVALID_MODEL_OWNERS` / `INVALID_OWNER_EMAIL`

**Outcome.** `needs_user_input`. Ask for one or more email addresses to
populate `model.owners`. Don't invent placeholder emails.

### `INVALID_ENTITY_NAME` (PascalCase)

**Trigger.** A logical / physical entity name isn't `[A-Z][A-Za-z0-9]*`.
Suppressed for conceptual concepts in v1.7.2+ (those keep human names).

**Outcome.** `patch_yaml`. **This is a renaming fix that also rewrites every
reference to the old name.** Single patch, multiple ops:

1. `replace /entities/<idx>/name` → new PascalCase name.
2. For every `relationships[]` entry where `.from` or `.to` references the
   old name, `replace` that endpoint with the new name. Endpoints can be
   strings (`"OldName.field"`) or objects (`{ entity: "OldName", field: ... }`).
3. For every `entities[].fields[].foreign_key.entity` matching the old name,
   `replace` with the new name.

If the user provided a target name in the prompt, use it; otherwise pick a
PascalCase slug from the existing name (e.g. `"Sales Order"` → `SalesOrder`).

### `INVALID_ENTITY_TYPE`

**Outcome.** `patch_yaml`. Replace with the closest valid type from
`concept | logical_entity | table | view | materialized_view | external_table |
snapshot | fact_table | dimension_table | bridge_table | hub | link |
satellite`. If the user's intent is ambiguous (the existing type is a typo of
several), ask via `needs_user_input`.

### `INVALID_ENTITIES`

**Trigger.** A `kind: model` file has an empty or missing `entities` array.
Suppressed for `kind: diagram` files in v1.7.2+.

**Outcome.** `needs_user_input`. The agent can't invent business entities for
the user. Ask: "What entities should this model contain?"

### `DBT_ENTITY_NO_COLUMNS`

**Trigger.** A logical / physical entity has no `fields` / `columns`.
Suppressed for concept-type entities in v1.7.2+.

**Outcome.** `needs_user_input`. The agent doesn't know the schema. Ask:
"What columns should `<entity>` have? At minimum each needs name + data_type."

### `DBT_ENTITY_NO_DESCRIPTION` / `DBT_COLUMN_NO_DESCRIPTION`

**Outcome.** `patch_yaml` — but **prefer the suggest pipeline** over a
single-shot fix. The agent should propose a one-sentence business-meaning
description. If the entity is unfamiliar (no clear name pattern, no nearby
context), drop to `needs_user_input` and ask the user to summarize.

### `DBT_COLUMN_NO_TYPE`

**Outcome.** `needs_user_input`. data_type matters for contracts; the agent
shouldn't guess. Ask: "What data_type for `<entity>.<column>`? (varchar,
integer, timestamp, decimal, …)"

### `MISSING_GRAIN`

**Outcome.** `patch_yaml` if the entity has a clear single-field PK (use that
field as the grain). Else `needs_user_input` asking which field(s) define the
business grain.

### `MISSING_PRIMARY_KEY`

**Outcome.** `patch_yaml` — set `primary_key: true` on the field most likely
to be the PK (`<entity_name>_id`, `id`, `pk`). If no candidate exists,
`needs_user_input`.

### `RELATIONSHIP_REF_NOT_FOUND` / `INVALID_RELATIONSHIP_FROM` / `INVALID_RELATIONSHIP_TO`

**Outcome.** `patch_yaml`. Repair the endpoint to the closest existing entity
+ field (Levenshtein on the names). If no close match, `needs_user_input`
asking which entity the relationship should target.

### `DIMENSION_REF_NOT_FOUND`

**Outcome.** `needs_user_input`. The agent can't add a missing dimension —
ask whether the user wants to import it or rename the ref.

### `FACT_TABLE_NO_METRICS`

**Outcome.** `needs_user_input`. Ask: "What metrics should `<fact>` expose?
(name + aggregation + column)."

### `MISSING_ENTITY_DESCRIPTION` / `MISSING_ENTITY_OWNER`

**Outcome.** `patch_yaml`. For description, draft a one-sentence business
meaning. For owner, drop to `needs_user_input` (ownership is a human
decision).

### Conceptual rules — `CONCEPTUAL_*`

| Code | Outcome | Action |
|---|---|---|
| `CONCEPTUAL_MISSING_DESCRIPTION` | `patch_yaml` | Draft a one-sentence definition. |
| `CONCEPTUAL_MISSING_OWNER` | `needs_user_input` | Ask which team owns the concept. |
| `CONCEPTUAL_MISSING_SUBJECT_AREA` | `needs_user_input` | Ask the bounded context. |
| `CONCEPTUAL_MISSING_GLOSSARY_LINK` | `needs_user_input` | Ask which glossary terms link to the concept. |
| `CONCEPTUAL_ORPHAN_CONCEPT` | `patch_yaml` if obvious neighbors exist | Otherwise `needs_user_input`. |
| `CONCEPTUAL_CROSS_DOMAIN_REL_NO_DESCRIPTION` | `patch_yaml` | Draft a 1-sentence description explaining why the contexts connect. |
| `CONCEPTUAL_WEAK_RELATIONSHIP_VERB` | `patch_yaml` | Use the entity-pair lookup from the conceptualizer (`places`, `contains`, `generates`, …). Fallback to `is_associated_with` if no match. |
| `CONCEPTUAL_MISSING_DOMAIN` | `needs_user_input` | Ask which bounded context. |

### Logical rules — `LOGICAL_*`

| Code | Outcome | Action |
|---|---|---|
| `LOGICAL_MISSING_CANDIDATE_KEY` | `patch_yaml` | Use the field marked `primary_key: true` as the candidate key. If none, `needs_user_input`. |
| `LOGICAL_MANY_TO_MANY_NEEDS_ASSOCIATIVE_ENTITY` | `needs_user_input` | Ask whether to add an associative entity, and what to name it. |
| `LOGICAL_UNRESOLVED_TYPE` | `needs_user_input` | Ask for the logical type (string, number, date, timestamp, boolean, identifier, money). |

### Physical rules — `PHYSICAL_*`

| Code | Outcome | Action |
|---|---|---|
| `PHYSICAL_MISSING_DBT_SOURCE` | `needs_user_input` | Ask which dbt model/source YAML files the user wants to drop on the diagram. |
| `PHYSICAL_MISSING_SQL_OUTPUT` | `needs_user_input` | Ask whether to generate SQL now or link existing output. |

### Other coverage / nudges

`LOW_FIELD_DESCRIPTION_COVERAGE`, `REPORT_ENTITY_NO_METRICS`,
`GLOSSARY_NO_FIELD_REFS` — these aren't single-finding fixes; they're broad
coverage gaps. Drop to `needs_user_input` summarizing the gap and offering to
batch-draft descriptions / batch-link terms / batch-add metrics on request.

## Single-rule guarantees

These guarantees apply to every recipe above:

1. **One file per fix.** Validation fixes touch the file the user opened. If
   the recipe needs to update another file (e.g. a referenced glossary), use
   `needs_user_input` and surface that as a question.
2. **Smallest patch.** Use the minimum JSON-patch ops to satisfy the rule.
3. **No silent renames.** Any rename op is paired with reference rewrites in
   the same patch (see `INVALID_ENTITY_NAME`).
4. **Honor `visibility:`.** Don't move concepts from `internal` to `shared` /
   `public` as a side effect of a fix.
5. **No invented data.** Emails, project names, schemas, owners, business
   meaning of unknown entities — all `needs_user_input`.
