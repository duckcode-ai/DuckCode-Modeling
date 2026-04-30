---
name: "YAML Proposal Safety"
description: "Rules for safe AI-generated DataLex YAML patches and proposal review."
use_when:
  - "yaml"
  - "patch"
  - "proposal"
  - "update file"
  - "generate yaml"
tags:
  - "yaml"
  - "safety"
  - "proposal"
agent_modes:
  - "yaml_patch_engineer"
priority: 5
---

# YAML Proposal Safety

- All changes must be proposed, never claimed as already applied.
- Prefer `patch_yaml` or small `create_diagram` / `create_model` changes over full-file rewrites.
- Every proposal needs rationale, source_context, validation_impact, and review_summary.
- Keep paths inside the DataLex workspace and use the domain-first layout.
- If a proposal might delete or rename user files, describe impact clearly and require user approval.
