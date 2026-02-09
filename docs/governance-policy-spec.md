# Governance Policy Spec v1 (Prototype)

## 1. Purpose
Policy packs let teams enforce governance and modeling standards as code.

## 2. File Format
Policy packs are YAML documents validated by `schemas/policy.schema.json`.

```yaml
pack:
  name: default_governance
  version: 1.0.0
  description: Optional text

policies:
  - id: FIELD_DESCRIPTION_REQUIRED
    enabled: true
    type: require_field_descriptions
    severity: warn
    params:
      exempt_primary_key: true
```

## 3. Supported Policy Types

### 3.1 `require_entity_tags`
Requires entity tags to include configured tags.
- `params.tags`: required tags (list)
- `params.mode`: `any` or `all`

### 3.2 `require_field_descriptions`
Requires non-empty `description` on fields.
- `params.exempt_primary_key`: bool

### 3.3 `classification_required_for_tags`
Requires governance classification for sensitive fields.
- Trigger by:
  - `params.field_tags` intersection
  - `params.field_name_regex` match
- Optional allowed set:
  - `params.allowed_classifications`

### 3.4 `rule_target_required`
Requires rule entries for target field types.
- `params.field_types`: list of field types

## 4. Severity Behavior
- `error`: fails `dm policy-check`
- `warn`: reported, does not fail
- `info`: reported, does not fail

## 5. Commands
1. Validate/evaluate policy:
   - `dm policy-check model.yaml --policy policies/default.policy.yaml`
2. Print policy schema:
   - `dm print-policy-schema`

## 6. Bundled Packs
1. `policies/default.policy.yaml`
2. `policies/strict.policy.yaml`
