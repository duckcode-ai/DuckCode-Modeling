import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Set, Tuple

from dm_core.issues import Issue

PASCAL_CASE = re.compile(r"^[A-Z][A-Za-z0-9]*$")
SNAKE_CASE = re.compile(r"^[a-z][a-z0-9_]*$")
REL_REF = re.compile(r"^[A-Z][A-Za-z0-9]*\.[a-z][a-z0-9_]*$")
ALLOWED_CLASSIFICATIONS = {"PUBLIC", "INTERNAL", "CONFIDENTIAL", "PII", "PCI", "PHI"}
ALLOWED_SENSITIVITY = {"public", "internal", "confidential", "restricted"}
PK_REQUIRED_TYPES = {"table", "fact_table", "dimension_table"}

# Field name patterns that imply financial/sensitive values
_FINANCIAL_PATTERN = re.compile(r"(amount|revenue|cost|price|fee|salary|balance|total|gross|net)", re.IGNORECASE)
_PII_TAGS = {"PII", "PHI", "PCI", "pii", "phi", "pci"}
_SENSITIVE_VALUES = {"restricted", "confidential"}
_AUDIT_TIMESTAMP_CREATED = re.compile(r"^created_(at|on|date|time)$")
_AUDIT_TIMESTAMP_UPDATED = re.compile(r"^updated_(at|on|date|time)$|^modified_(at|on|date|time)$")

# ── Completeness scoring ───────────────────────────────────────────────────────

# Weights must sum to 100
_COMPLETENESS_WEIGHTS: Dict[str, int] = {
    "description": 15,        # Entity has a non-empty description
    "owner": 10,              # Entity has an owner assigned
    "grain": 15,              # Entity has at least one grain field
    "field_descriptions": 20, # ≥80% of fields have descriptions
    "classification": 10,     # Fields with sensitivity have classification, or entity has classified fields
    "glossary_linked": 10,    # At least one glossary term cross-references this entity
    "tags": 5,                # Entity has at least one tag
    "layer": 5,               # Parent model declares a layer
    "sla": 10,                # Entity has SLA defined (freshness or quality_score)
}


@dataclass
class EntityCompleteness:
    """Completeness report for a single entity."""
    entity_name: str
    score: int                          # 0-100
    dimensions: Dict[str, bool]        # Which dimensions passed
    missing: List[str]                 # Human-readable missing items
    field_description_pct: int         # Percentage of fields with descriptions


@dataclass
class ModelCompleteness:
    """Aggregated completeness report for an entire model."""
    model_name: str
    model_score: int                    # Average score across all entities
    entities: List[EntityCompleteness]
    total_entities: int
    fully_complete: int                 # Entities at 100%
    needs_attention: List[str]          # Entity names below 60%


def _entity_completeness(
    entity: Dict[str, Any],
    model: Dict[str, Any],
    glossary_entity_refs: Set[str],
) -> EntityCompleteness:
    """Score a single entity against the completeness dimensions."""
    name = entity.get("name", "")
    entity_type = entity.get("type", "table")
    fields = entity.get("fields", [])
    model_layer = str(model.get("model", {}).get("layer", "")).lower().strip()

    # -- dimension: description
    has_description = bool(entity.get("description", "").strip())

    # -- dimension: owner
    has_owner = bool(entity.get("owner", "").strip())

    # -- dimension: grain (tables/views/MVs should define grain)
    grain = entity.get("grain", [])
    has_grain = isinstance(grain, list) and len(grain) > 0
    # Views, external_table, and dimension_table are exempt from grain requirement
    # (dimension tables use a surrogate key as PK, not a declared grain)
    if entity_type in {"view", "external_table", "dimension_table"}:
        has_grain = True  # Not penalised

    # -- dimension: field descriptions (80% threshold)
    field_count = len(fields)
    described_count = sum(1 for f in fields if f.get("description", "").strip())
    if field_count == 0:
        field_desc_pct = 100
        has_field_descriptions = True
    else:
        field_desc_pct = int(described_count / field_count * 100)
        has_field_descriptions = field_desc_pct >= 80

    # -- dimension: classification
    # Pass if any field has a sensitivity label OR the governance section covers a field in this entity
    gov_classification = model.get("governance", {}).get("classification", {})
    entity_gov_refs = {k for k in gov_classification if k.startswith(f"{name}.")}
    field_sensitivities = [f for f in fields if f.get("sensitivity")]
    has_classification = bool(entity_gov_refs) or bool(field_sensitivities)
    # If no sensitive fields at all, grant the point (no classification needed)
    needs_classification = any(
        f.get("sensitivity") in _SENSITIVE_VALUES
        or any(t in _PII_TAGS for t in (f.get("tags") or []))
        for f in fields
    )
    if not needs_classification:
        has_classification = True

    # -- dimension: glossary linked
    has_glossary_linked = name in glossary_entity_refs

    # -- dimension: tags
    has_tags = bool(entity.get("tags"))

    # -- dimension: layer
    has_layer = bool(model_layer)

    # -- dimension: sla
    sla = entity.get("sla", {})
    has_sla = bool(sla.get("freshness") or sla.get("quality_score"))

    dimensions = {
        "description": has_description,
        "owner": has_owner,
        "grain": has_grain,
        "field_descriptions": has_field_descriptions,
        "classification": has_classification,
        "glossary_linked": has_glossary_linked,
        "tags": has_tags,
        "layer": has_layer,
        "sla": has_sla,
    }

    score = sum(
        _COMPLETENESS_WEIGHTS[dim]
        for dim, passed in dimensions.items()
        if passed
    )

    missing_labels = {
        "description": "entity description",
        "owner": "owner",
        "grain": "grain definition",
        "field_descriptions": f"field descriptions ({field_desc_pct}% covered, need ≥80%)",
        "classification": "sensitivity classification on sensitive fields",
        "glossary_linked": "glossary term cross-reference",
        "tags": "tags",
        "layer": "model layer (source/transform/report)",
        "sla": "SLA (freshness or quality_score)",
    }
    missing = [missing_labels[dim] for dim, passed in dimensions.items() if not passed]

    return EntityCompleteness(
        entity_name=name,
        score=score,
        dimensions=dimensions,
        missing=missing,
        field_description_pct=field_desc_pct,
    )


def _glossary_entity_refs(model: Dict[str, Any]) -> Set[str]:
    """Return the set of entity names referenced in any glossary term's related_fields."""
    refs: Set[str] = set()
    for term in model.get("glossary", []):
        for field_ref in term.get("related_fields", []):
            if "." in str(field_ref):
                entity = str(field_ref).split(".", 1)[0]
                refs.add(entity)
    return refs


def completeness_report(model: Dict[str, Any]) -> ModelCompleteness:
    """Return a full completeness report for the model."""
    model_name = model.get("model", {}).get("name", "unknown")
    entities = model.get("entities", [])
    glossary_refs = _glossary_entity_refs(model)

    entity_scores = [
        _entity_completeness(e, model, glossary_refs)
        for e in entities
    ]

    avg_score = int(sum(e.score for e in entity_scores) / len(entity_scores)) if entity_scores else 0
    fully_complete = sum(1 for e in entity_scores if e.score == 100)
    needs_attention = [e.entity_name for e in entity_scores if e.score < 60]

    return ModelCompleteness(
        model_name=model_name,
        model_score=avg_score,
        entities=entity_scores,
        total_entities=len(entity_scores),
        fully_complete=fully_complete,
        needs_attention=needs_attention,
    )


def completeness_as_dict(report: ModelCompleteness) -> Dict[str, Any]:
    """Serialise a ModelCompleteness report to a plain dict (JSON-safe)."""
    return {
        "model_name": report.model_name,
        "model_score": report.model_score,
        "total_entities": report.total_entities,
        "fully_complete": report.fully_complete,
        "needs_attention": report.needs_attention,
        "weights": _COMPLETENESS_WEIGHTS,
        "entities": [
            {
                "name": e.entity_name,
                "score": e.score,
                "field_description_pct": e.field_description_pct,
                "dimensions": e.dimensions,
                "missing": e.missing,
            }
            for e in report.entities
        ],
    }


def _entity_field_refs(model: Dict[str, Any]) -> Set[str]:
    refs: Set[str] = set()
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if entity_name and field_name:
                refs.add(f"{entity_name}.{field_name}")
    return refs


def _entity_names(model: Dict[str, Any]) -> Set[str]:
    return {entity.get("name", "") for entity in model.get("entities", []) if entity.get("name")}


def _entity_field_names(model: Dict[str, Any]) -> Dict[str, Set[str]]:
    result: Dict[str, Set[str]] = {}
    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        if not entity_name:
            continue
        names: Set[str] = set()
        for field in entity.get("fields", []):
            field_name = field.get("name", "")
            if field_name:
                names.add(field_name)
        result[entity_name] = names
    return result


def _relationship_graph(model: Dict[str, Any]) -> Dict[str, Set[str]]:
    graph: Dict[str, Set[str]] = {}
    for rel in model.get("relationships", []):
        from_ref = rel.get("from", "")
        to_ref = rel.get("to", "")
        if "." not in from_ref or "." not in to_ref:
            continue
        src = from_ref.split(".", 1)[0]
        dst = to_ref.split(".", 1)[0]
        graph.setdefault(src, set()).add(dst)
        graph.setdefault(dst, set())
    return graph


def _has_cycle(graph: Dict[str, Set[str]]) -> bool:
    state: Dict[str, int] = {node: 0 for node in graph}

    def visit(node: str) -> bool:
        if state[node] == 1:
            return True
        if state[node] == 2:
            return False
        state[node] = 1
        for nxt in graph.get(node, set()):
            if visit(nxt):
                return True
        state[node] = 2
        return False

    for node in graph:
        if state[node] == 0 and visit(node):
            return True
    return False


def _lint_indexes(model: Dict[str, Any], entity_field_map: Dict[str, Set[str]]) -> List[Issue]:
    issues: List[Issue] = []
    seen_index_names: Set[str] = set()

    for idx_def in model.get("indexes", []):
        idx_name = idx_def.get("name", "")
        entity_name = idx_def.get("entity", "")
        idx_fields = idx_def.get("fields", [])

        if idx_name in seen_index_names:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_INDEX",
                    message=f"Duplicate index name '{idx_name}'.",
                    path="/indexes",
                )
            )
        else:
            seen_index_names.add(idx_name)

        if entity_name and entity_name not in entity_field_map:
            issues.append(
                Issue(
                    severity="error",
                    code="INDEX_ENTITY_NOT_FOUND",
                    message=f"Index '{idx_name}' references non-existent entity '{entity_name}'.",
                    path="/indexes",
                )
            )
            continue

        entity_fields = entity_field_map.get(entity_name, set())
        for field_name in idx_fields:
            if field_name and field_name not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="INDEX_FIELD_NOT_FOUND",
                        message=f"Index '{idx_name}' references non-existent field '{entity_name}.{field_name}'.",
                        path="/indexes",
                    )
                )

    return issues


def _lint_glossary(model: Dict[str, Any], refs: Set[str]) -> List[Issue]:
    issues: List[Issue] = []
    seen_terms: Set[str] = set()

    for term_def in model.get("glossary", []):
        term = term_def.get("term", "")

        if term in seen_terms:
            issues.append(
                Issue(
                    severity="warn",
                    code="DUPLICATE_GLOSSARY_TERM",
                    message=f"Duplicate glossary term '{term}'.",
                    path="/glossary",
                )
            )
        else:
            seen_terms.add(term)

        for field_ref in term_def.get("related_fields", []):
            if field_ref and field_ref not in refs:
                issues.append(
                    Issue(
                        severity="error",
                        code="GLOSSARY_REF_NOT_FOUND",
                        message=f"Glossary term '{term}' references non-existent field '{field_ref}'.",
                        path="/glossary",
                    )
                )

    return issues


def _lint_grain_and_metrics(
    model: Dict[str, Any],
    entity_field_map: Dict[str, Set[str]],
) -> List[Issue]:
    issues: List[Issue] = []
    model_layer = str(model.get("model", {}).get("layer", "")).lower().strip()
    requires_grain = model_layer in {"transform", "report"}

    # Entity grain checks
    for entity in model.get("entities", []):
        entity_name = str(entity.get("name", ""))
        entity_type = str(entity.get("type", "table"))
        grain = entity.get("grain", []) if isinstance(entity.get("grain"), list) else []
        entity_fields = entity_field_map.get(entity_name, set())

        if requires_grain and entity_type in {"table", "view", "materialized_view", "fact_table"} and not grain:
            issues.append(
                Issue(
                    severity="error",
                    code="MISSING_GRAIN",
                    message=f"Entity '{entity_name}' must declare grain in '{model_layer}' layer models.",
                    path=f"/entities/{entity_name}",
                )
            )

        seen_grain: Set[str] = set()
        for field_name in grain:
            if field_name in seen_grain:
                issues.append(
                    Issue(
                        severity="error",
                        code="DUPLICATE_GRAIN_FIELD",
                        message=f"Entity '{entity_name}' grain contains duplicate field '{field_name}'.",
                        path=f"/entities/{entity_name}/grain",
                    )
                )
            seen_grain.add(field_name)

            if field_name not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="GRAIN_FIELD_NOT_FOUND",
                        message=f"Entity '{entity_name}' grain references non-existent field '{field_name}'.",
                        path=f"/entities/{entity_name}/grain",
                    )
                )

    # Metric checks
    metrics = model.get("metrics", [])
    if model_layer == "report" and not metrics:
        issues.append(
            Issue(
                severity="error",
                code="MISSING_METRICS",
                message="Report layer models must define at least one metric.",
                path="/metrics",
            )
        )

    seen_metric_names: Set[str] = set()
    for metric in metrics:
        name = str(metric.get("name", ""))
        entity_name = str(metric.get("entity", ""))
        entity_fields = entity_field_map.get(entity_name, set())

        if name in seen_metric_names:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_METRIC",
                    message=f"Duplicate metric name '{name}'.",
                    path="/metrics",
                )
            )
        else:
            seen_metric_names.add(name)

        if entity_name not in entity_field_map:
            issues.append(
                Issue(
                    severity="error",
                    code="METRIC_ENTITY_NOT_FOUND",
                    message=f"Metric '{name}' references non-existent entity '{entity_name}'.",
                    path="/metrics",
                )
            )
            continue

        for grain_field in metric.get("grain", []) if isinstance(metric.get("grain"), list) else []:
            if grain_field not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="METRIC_GRAIN_FIELD_NOT_FOUND",
                        message=f"Metric '{name}' grain field '{entity_name}.{grain_field}' does not exist.",
                        path=f"/metrics/{name}",
                    )
                )

        for dim_field in metric.get("dimensions", []) if isinstance(metric.get("dimensions"), list) else []:
            if dim_field not in entity_fields:
                issues.append(
                    Issue(
                        severity="error",
                        code="METRIC_DIMENSION_NOT_FOUND",
                        message=f"Metric '{name}' dimension field '{entity_name}.{dim_field}' does not exist.",
                        path=f"/metrics/{name}",
                    )
                )

        time_dim = str(metric.get("time_dimension", "")).strip()
        if time_dim and time_dim not in entity_fields:
            issues.append(
                Issue(
                    severity="error",
                    code="METRIC_TIME_DIMENSION_NOT_FOUND",
                    message=f"Metric '{name}' time_dimension '{entity_name}.{time_dim}' does not exist.",
                    path=f"/metrics/{name}",
                )
            )

        if metric.get("deprecated") is True and not metric.get("deprecated_message"):
            issues.append(
                Issue(
                    severity="warn",
                    code="METRIC_DEPRECATED_WITHOUT_MESSAGE",
                    message=f"Metric '{name}' is deprecated but missing deprecated_message.",
                    path=f"/metrics/{name}",
                )
            )

    return issues


def _lint_smart_nudges(
    model: Dict[str, Any],
    entity_field_map: Dict[str, Set[str]],
    refs: Set[str],
) -> List[Issue]:
    """
    Context-aware gap detection rules that surface missing best-practice
    metadata before hard validation catches structural errors.  All issues
    are severity='warn' so they never block CI on their own.
    """
    issues: List[Issue] = []
    model_layer = str(model.get("model", {}).get("layer", "")).lower().strip()
    gov_classification: Dict[str, str] = model.get("governance", {}).get("classification", {}) or {}
    glossary_terms = model.get("glossary", [])
    relationships = model.get("relationships", [])
    imports = model.get("model", {}).get("imports", [])

    # Collect entity names referenced from relationships
    rel_entity_names: Set[str] = set()
    for rel in relationships:
        for side in ("from", "to"):
            ref = rel.get(side, "")
            if "." in ref:
                rel_entity_names.add(ref.split(".", 1)[0])

    # Collect entity names that glossary terms point to
    glossary_entity_refs = _glossary_entity_refs(model)

    # Collect all imported entity names
    imported_entity_names: Set[str] = set()
    for imp in imports:
        for ent in imp.get("entities", []):
            imported_entity_names.add(str(ent))

    for entity in model.get("entities", []):
        entity_name = entity.get("name", "")
        entity_type = entity.get("type", "table")
        fields = entity.get("fields", [])
        field_count = len(fields)
        path = f"/entities/{entity_name}"

        # ── Nudge 1: Missing entity description ───────────────────────────────
        if not entity.get("description", "").strip():
            issues.append(Issue(
                severity="warn",
                code="MISSING_ENTITY_DESCRIPTION",
                message=(
                    f"Entity '{entity_name}' has no description. "
                    "Add a business-facing description so consumers know what this entity represents."
                ),
                path=path,
            ))

        # ── Nudge 2: Missing entity owner ─────────────────────────────────────
        if not entity.get("owner", "").strip():
            issues.append(Issue(
                severity="warn",
                code="MISSING_ENTITY_OWNER",
                message=(
                    f"Entity '{entity_name}' has no owner. "
                    "Assign an owner (email or team alias) for accountability and stewardship."
                ),
                path=path,
            ))

        # ── Nudge 3: Source-layer table missing grain ─────────────────────────
        # transform/report is already an error via _lint_grain_and_metrics;
        # source layer should also declare grain as a best practice.
        if (
            model_layer == "source"
            and entity_type in {"table", "materialized_view"}
            and not entity.get("grain")
        ):
            issues.append(Issue(
                severity="warn",
                code="MISSING_GRAIN_SOURCE_LAYER",
                message=(
                    f"Entity '{entity_name}' in a source-layer model has no grain defined. "
                    "Declaring grain clarifies the unit of observation and prevents downstream metric errors."
                ),
                path=path,
            ))

        # ── Nudge 4: Sensitive field tag without governance classification ─────
        for f in fields:
            fname = f.get("name", "")
            field_tags = [str(t) for t in (f.get("tags") or [])]
            field_ref = f"{entity_name}.{fname}"
            has_pii_tag = any(t in _PII_TAGS for t in field_tags)
            if has_pii_tag and field_ref not in gov_classification:
                issues.append(Issue(
                    severity="warn",
                    code="PII_TAG_WITHOUT_CLASSIFICATION",
                    message=(
                        f"Field '{field_ref}' has a PII/PHI/PCI tag but no governance.classification entry. "
                        "Add a classification so policy checks and data contracts can enforce access controls."
                    ),
                    path=f"{path}/fields/{fname}",
                ))

        # ── Nudge 5: sensitivity=restricted/confidential without classification
        for f in fields:
            fname = f.get("name", "")
            sensitivity = str(f.get("sensitivity", "")).lower()
            field_ref = f"{entity_name}.{fname}"
            if sensitivity in _SENSITIVE_VALUES and field_ref not in gov_classification:
                issues.append(Issue(
                    severity="warn",
                    code="SENSITIVITY_WITHOUT_CLASSIFICATION",
                    message=(
                        f"Field '{field_ref}' has sensitivity='{sensitivity}' but no governance.classification. "
                        "Pair sensitivity labels with an explicit classification (PII, PCI, PHI, CONFIDENTIAL)."
                    ),
                    path=f"{path}/fields/{fname}",
                ))

        # ── Nudge 6: Financial/amount fields with no examples ─────────────────
        for f in fields:
            fname = f.get("name", "")
            if _FINANCIAL_PATTERN.search(fname) and not f.get("examples"):
                issues.append(Issue(
                    severity="warn",
                    code="FINANCIAL_FIELD_NO_EXAMPLES",
                    message=(
                        f"Field '{entity_name}.{fname}' looks like a financial value but has no examples. "
                        "Add examples (e.g. unit, currency, scale) so consumers interpret it correctly."
                    ),
                    path=f"{path}/fields/{fname}",
                ))

        # ── Nudge 7: created_at present but no updated_at ─────────────────────
        field_names_list = [f.get("name", "") for f in fields]
        has_created = any(_AUDIT_TIMESTAMP_CREATED.match(n) for n in field_names_list)
        has_updated = any(_AUDIT_TIMESTAMP_UPDATED.match(n) for n in field_names_list)
        if has_created and not has_updated and entity_type == "table":
            issues.append(Issue(
                severity="warn",
                code="CREATED_WITHOUT_UPDATED",
                message=(
                    f"Entity '{entity_name}' has a created_at timestamp but no updated_at equivalent. "
                    "If records are mutable, add an updated_at field to support incremental loads."
                ),
                path=path,
            ))

        # ── Nudge 8: Low field description coverage (<50%) ────────────────────
        if field_count > 0:
            described = sum(1 for f in fields if f.get("description", "").strip())
            pct = described / field_count * 100
            if pct < 50:
                issues.append(Issue(
                    severity="warn",
                    code="LOW_FIELD_DESCRIPTION_COVERAGE",
                    message=(
                        f"Entity '{entity_name}' has only {pct:.0f}% of fields described "
                        f"({described}/{field_count}). "
                        "Add descriptions to make this entity usable as a single source of truth."
                    ),
                    path=path,
                ))

        # ── Nudge 9: Large entity (>10 fields) with no indexes ────────────────
        if field_count > 10 and entity_type == "table":
            entity_indexes = [
                idx for idx in model.get("indexes", [])
                if idx.get("entity") == entity_name
            ]
            if not entity_indexes:
                issues.append(Issue(
                    severity="warn",
                    code="LARGE_ENTITY_NO_INDEXES",
                    message=(
                        f"Entity '{entity_name}' has {field_count} fields but no indexes defined. "
                        "Consider adding indexes on frequently queried or join columns."
                    ),
                    path=path,
                ))

        # ── Nudge 10: Report-layer entity not covered by any metric ───────────
        if model_layer == "report" and entity_type in {"table", "materialized_view"}:
            entity_metrics = [
                m for m in model.get("metrics", [])
                if m.get("entity") == entity_name
            ]
            if not entity_metrics:
                issues.append(Issue(
                    severity="warn",
                    code="REPORT_ENTITY_NO_METRICS",
                    message=(
                        f"Entity '{entity_name}' is in a report-layer model but has no metrics defined for it. "
                        "Report entities should expose at least one metric (KPI, aggregate, or measure)."
                    ),
                    path=path,
                ))

        # ── Nudge 13: fact_table without dimension_refs ───────────────────────
        if entity_type == "fact_table":
            dim_refs = entity.get("dimension_refs", [])
            if not isinstance(dim_refs, list) or not dim_refs:
                issues.append(Issue(
                    severity="warn",
                    code="FACT_WITHOUT_DIMENSION_REFS",
                    message=(
                        f"Fact table '{entity_name}' has no dimension_refs defined. "
                        "Declare which dimensions this fact references for star schema clarity and auto-layout."
                    ),
                    path=path,
                ))

        # ── Nudge 14: dimension_table without natural_key ─────────────────────
        if entity_type == "dimension_table" and not entity.get("natural_key", "").strip():
            issues.append(Issue(
                severity="warn",
                code="DIM_WITHOUT_NATURAL_KEY",
                message=(
                    f"Dimension table '{entity_name}' has no natural_key defined. "
                    "Declare the business key so SCD tracking and deduplication work correctly."
                ),
                path=path,
            ))

        # ── Nudge 15: SCD Type 2 dimension missing system fields ──────────────
        if entity_type == "dimension_table" and entity.get("scd_type") == 2:
            field_names_set = {f.get("name", "") for f in fields}
            scd2_required = {"effective_from", "effective_to", "is_current"}
            missing_scd2 = scd2_required - field_names_set
            if missing_scd2:
                missing_str = ", ".join(sorted(missing_scd2))
                issues.append(Issue(
                    severity="warn",
                    code="SCD2_MISSING_SYSTEM_FIELDS",
                    message=(
                        f"SCD Type 2 dimension '{entity_name}' is missing system fields: {missing_str}. "
                        "Add effective_from (DATE), effective_to (DATE), and is_current (BOOLEAN) to track historical validity."
                    ),
                    path=path,
                ))

        # ── Nudge 16: fact_table in report layer with no metrics ──────────────
        if entity_type == "fact_table" and model_layer == "report":
            entity_metrics = [m for m in model.get("metrics", []) if m.get("entity") == entity_name]
            if not entity_metrics:
                issues.append(Issue(
                    severity="warn",
                    code="FACT_TABLE_NO_METRICS",
                    message=(
                        f"Fact table '{entity_name}' is in a report-layer model but has no metrics defined. "
                        "Define at least one metric (measure/KPI) on this fact table."
                    ),
                    path=path,
                ))

    # ── Model-level nudges ────────────────────────────────────────────────────

    # ── Nudge 11: Glossary defined but no terms cross-reference any field ─────
    if glossary_terms:
        any_refs = any(term.get("related_fields") for term in glossary_terms)
        if not any_refs:
            issues.append(Issue(
                severity="warn",
                code="GLOSSARY_NO_FIELD_REFS",
                message=(
                    "The glossary has terms defined but none have related_fields cross-references. "
                    "Link terms to physical fields so the business dictionary connects to the data model."
                ),
                path="/glossary",
            ))

    # ── Nudge 12: Imports declared but imported entities unused in relationships
    if imported_entity_names:
        used_in_rels = rel_entity_names & imported_entity_names
        unused_imports = imported_entity_names - used_in_rels
        # Also check if they appear as FK targets in field-level refs (in refs set)
        unused_imports = {
            e for e in unused_imports
            if not any(ref.startswith(f"{e}.") for ref in refs)
        }
        # Remove locally-defined entities from the check
        local_entities = {ent.get("name", "") for ent in model.get("entities", [])}
        unused_imports -= local_entities
        for ent_name in sorted(unused_imports):
            issues.append(Issue(
                severity="warn",
                code="ORPHAN_IMPORT_ENTITY",
                message=(
                    f"Imported entity '{ent_name}' is never referenced in relationships or foreign keys. "
                    "Either use it in a relationship definition or remove the import to keep the model clean."
                ),
                path="/model/imports",
            ))

    return issues


def lint_issues(model: Dict[str, Any]) -> List[Issue]:
    issues: List[Issue] = []

    entities = model.get("entities", [])
    seen_entities: Set[str] = set()
    refs = _entity_field_refs(model)
    entity_field_map = _entity_field_names(model)

    for entity in entities:
        entity_name = entity.get("name", "")

        if entity_name in seen_entities:
            issues.append(
                Issue(
                    severity="error",
                    code="DUPLICATE_ENTITY",
                    message=f"Duplicate entity name '{entity_name}'.",
                    path="/entities",
                )
            )
        else:
            seen_entities.add(entity_name)

        if entity_name and not PASCAL_CASE.match(entity_name):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_ENTITY_NAME",
                    message=f"Entity '{entity_name}' must be PascalCase.",
                    path="/entities",
                )
            )

        fields = entity.get("fields", [])
        field_names: Set[str] = set()
        has_pk = False

        for field in fields:
            name = field.get("name", "")
            if name in field_names:
                issues.append(
                    Issue(
                        severity="error",
                        code="DUPLICATE_FIELD",
                        message=f"Duplicate field '{name}' in entity '{entity_name}'.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )
            else:
                field_names.add(name)

            if name and not SNAKE_CASE.match(name):
                issues.append(
                    Issue(
                        severity="error",
                        code="INVALID_FIELD_NAME",
                        message=f"Field '{entity_name}.{name}' must be snake_case.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )

            if field.get("primary_key") is True:
                has_pk = True

            if field.get("computed") is True and not field.get("computed_expression"):
                issues.append(
                    Issue(
                        severity="warn",
                        code="MISSING_COMPUTED_EXPRESSION",
                        message=f"Computed field '{entity_name}.{name}' should have a computed_expression.",
                        path=f"/entities/{entity_name}/fields",
                    )
                )

            if field.get("deprecated") is True:
                issues.append(
                    Issue(
                        severity="warn",
                        code="DEPRECATED_FIELD",
                        message=f"Field '{entity_name}.{name}' is deprecated."
                        + (f" {field['deprecated_message']}" if field.get("deprecated_message") else ""),
                        path=f"/entities/{entity_name}/fields",
                    )
                )

        entity_type = entity.get("type", "table")
        if entity_type in PK_REQUIRED_TYPES and not has_pk:
            issues.append(
                Issue(
                    severity="warn",
                    code="MISSING_PRIMARY_KEY",
                    message=f"Table '{entity_name}' must have at least one primary key field.",
                    path=f"/entities/{entity_name}",
                )
            )

        # dimension_refs: warn if a referenced dimension entity is not in this model
        dim_refs = entity.get("dimension_refs", [])
        has_imports = bool(model.get("model", {}).get("imports"))
        if isinstance(dim_refs, list):
            for ref_name in dim_refs:
                if ref_name and ref_name not in entity_field_map:
                    issues.append(
                        Issue(
                            severity="warn",
                            code="DIMENSION_REF_NOT_FOUND",
                            message=(
                                f"Fact table '{entity_name}' references dimension '{ref_name}' "
                                f"which is not defined in this model."
                                + (" (may be in an imported model)" if has_imports else "")
                            ),
                            path=f"/entities/{entity_name}/dimension_refs",
                        )
                    )

    for rel in model.get("relationships", []):
        from_ref = rel.get("from", "")
        to_ref = rel.get("to", "")
        name = rel.get("name", "<unnamed>")

        if from_ref and not REL_REF.match(from_ref):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_RELATIONSHIP_REF",
                    message=f"Relationship '{name}' has invalid 'from' reference '{from_ref}'.",
                    path="/relationships",
                )
            )
        if to_ref and not REL_REF.match(to_ref):
            issues.append(
                Issue(
                    severity="error",
                    code="INVALID_RELATIONSHIP_REF",
                    message=f"Relationship '{name}' has invalid 'to' reference '{to_ref}'.",
                    path="/relationships",
                )
            )
        if from_ref and from_ref not in refs:
            issues.append(
                Issue(
                    severity="error",
                    code="RELATIONSHIP_REF_NOT_FOUND",
                    message=f"Relationship '{name}' from reference '{from_ref}' does not exist.",
                    path="/relationships",
                )
            )
        if to_ref and to_ref not in refs:
            issues.append(
                Issue(
                    severity="error",
                    code="RELATIONSHIP_REF_NOT_FOUND",
                    message=f"Relationship '{name}' to reference '{to_ref}' does not exist.",
                    path="/relationships",
                )
            )

    classification = model.get("governance", {}).get("classification", {})
    if isinstance(classification, dict):
        for target, value in classification.items():
            if target not in refs:
                issues.append(
                    Issue(
                        severity="error",
                        code="CLASSIFICATION_REF_NOT_FOUND",
                        message=f"Classification target '{target}' does not exist.",
                        path="/governance/classification",
                    )
                )
            if value not in ALLOWED_CLASSIFICATIONS:
                issues.append(
                    Issue(
                        severity="error",
                        code="INVALID_CLASSIFICATION",
                        message=f"Classification '{value}' is not allowed.",
                        path="/governance/classification",
                    )
                )

    issues.extend(_lint_indexes(model, entity_field_map))
    issues.extend(_lint_glossary(model, refs))
    issues.extend(_lint_grain_and_metrics(model, entity_field_map))
    issues.extend(_lint_smart_nudges(model, entity_field_map, refs))

    graph = _relationship_graph(model)
    if graph and _has_cycle(graph):
        issues.append(
            Issue(
                severity="warn",
                code="CIRCULAR_RELATIONSHIPS",
                message="Circular entity relationships detected.",
                path="/relationships",
            )
        )

    return issues
