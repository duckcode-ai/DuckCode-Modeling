"""DataLex dbt-readiness scoring.

Direct port of the JS implementation in `packages/api-server/index.js`
(reviewHasValue → reviewAddDocumentFindings → summarizeReviewFile →
buildDbtReadinessReview). JSON output must remain byte-identical because
the api-server shells out to this engine for `/api/dbt/review`.
"""

from __future__ import annotations

import re
import secrets
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple

import yaml

from .finding import Finding, finding, finding_to_dict
from .walker import (
    load_dbt_artifact_presence,
    load_project_structure,
    to_posix_path,
    walk_yaml_files,
)


# ---------------------------------------------------------------------------
# Primitives — review_* helpers


def review_has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return value.strip() != ""
    if isinstance(value, (list, tuple, set)):
        return len(value) > 0
    if isinstance(value, dict):
        return len(value) > 0
    return bool(value)


def review_array(value: Any) -> List[Any]:
    return list(value) if isinstance(value, list) else []


def review_columns(entity: Any) -> List[Any]:
    if not isinstance(entity, dict):
        return []
    if isinstance(entity.get("columns"), list):
        return entity["columns"]
    if isinstance(entity.get("fields"), list):
        return entity["fields"]
    return []


def review_entity_name(entity: Any, fallback: str = "model") -> str:
    if not isinstance(entity, dict):
        return fallback
    return str(entity.get("name") or entity.get("entity") or entity.get("table") or fallback)


def review_tests(column: Any) -> List[Any]:
    if not isinstance(column, dict):
        return []
    tests = column.get("tests") if isinstance(column.get("tests"), list) else column.get("data_tests")
    return list(tests) if isinstance(tests, list) else []


def review_test_name(test: Any) -> str:
    if isinstance(test, str):
        return test
    if isinstance(test, dict) and test:
        return next(iter(test.keys()))
    return ""


def review_has_test(column: Any, name: str) -> bool:
    expected = str(name or "").lower()
    return any(review_test_name(t).lower() == expected for t in review_tests(column))


def review_has_relationship_test(column: Any) -> bool:
    return any(review_test_name(t).lower() == "relationships" for t in review_tests(column))


def review_is_pk(column: Any) -> bool:
    if not isinstance(column, dict):
        return False
    if column.get("primary_key") or column.get("primaryKey") or column.get("is_primary_key"):
        return True
    for c in review_array(column.get("constraints")):
        ctype = str((c.get("type") if isinstance(c, dict) else c) or "").lower()
        if ctype == "primary_key":
            return True
    for tag in review_array(column.get("tags")):
        if str(tag).lower() == "primary_key":
            return True
    return False


_SENSITIVE_RE = re.compile(
    r"\b(pii|phi|pci|email|phone|ssn|passport|address|dob|birth|salary|confidential|restricted)\b",
    re.IGNORECASE,
)


def review_is_sensitive(column: Any) -> bool:
    if not isinstance(column, dict):
        return False
    parts = [
        column.get("name"),
        column.get("description"),
        column.get("sensitivity"),
        column.get("classification"),
        *review_array(column.get("tags")),
    ]
    text = " ".join("" if p is None else str(p) for p in parts).lower()
    return bool(_SENSITIVE_RE.search(text))


def review_materialization(entity: Any) -> str:
    if not isinstance(entity, dict):
        return ""
    cfg = entity.get("config") or {}
    meta = entity.get("meta") or {}
    return str(
        (cfg.get("materialized") if isinstance(cfg, dict) else None)
        or entity.get("materialized")
        or entity.get("materialization")
        or (meta.get("materialized") if isinstance(meta, dict) else None)
        or ""
    )


def review_file_kind(path: Any, doc: Any) -> str:
    p = str(path or "").lower()
    if isinstance(doc, dict):
        if (
            isinstance(doc.get("models"), list)
            or isinstance(doc.get("sources"), list)
            or isinstance(doc.get("exposures"), list)
            or isinstance(doc.get("metrics"), list)
        ):
            return "dbt"
        if doc.get("kind") in ("model", "source"):
            return "dbt-imported"
        if doc.get("kind") == "diagram" or re.search(r"\.diagram\.ya?ml$", p, re.IGNORECASE):
            return "diagram"
        if doc.get("model") or isinstance(doc.get("entities"), list):
            model = doc.get("model") or {}
            return str(
                (model.get("kind") if isinstance(model, dict) else "")
                or doc.get("layer")
                or "datalex"
            ).lower()
    if re.search(r"\.diagram\.ya?ml$", p, re.IGNORECASE):
        return "diagram"
    return "yaml"


def review_collect_entities(doc: Any) -> List[Dict[str, Any]]:
    entities: List[Dict[str, Any]] = []
    if not isinstance(doc, dict):
        return entities
    if isinstance(doc.get("models"), list):
        for model in doc["models"]:
            entities.append({"entity": model, "resourceType": "model", "container": None})
    if isinstance(doc.get("sources"), list):
        for source in doc["sources"]:
            for table in review_array((source or {}).get("tables")):
                entities.append({"entity": table, "resourceType": "source", "container": source})
    # dbt v2 also surfaces non-model resource arrays in schema.yml. Score
    # them so the readiness gate doesn't go silent on snapshots/seeds/
    # exposures/unit tests/semantic models.
    if isinstance(doc.get("snapshots"), list):
        for snap in doc["snapshots"]:
            entities.append({"entity": snap, "resourceType": "snapshot", "container": None})
    if isinstance(doc.get("seeds"), list):
        for seed in doc["seeds"]:
            entities.append({"entity": seed, "resourceType": "seed", "container": None})
    if isinstance(doc.get("exposures"), list):
        for exp in doc["exposures"]:
            entities.append({"entity": exp, "resourceType": "exposure", "container": None})
    if isinstance(doc.get("unit_tests"), list):
        for ut in doc["unit_tests"]:
            entities.append({"entity": ut, "resourceType": "unit_test", "container": None})
    if isinstance(doc.get("semantic_models"), list):
        for sm in doc["semantic_models"]:
            entities.append({"entity": sm, "resourceType": "semantic_model", "container": None})
    kind = doc.get("kind")
    if kind == "model":
        entities.append({"entity": doc, "resourceType": "model", "container": None})
    if kind == "source":
        if isinstance(doc.get("tables"), list):
            for table in doc["tables"]:
                entities.append({"entity": table, "resourceType": "source", "container": doc})
        else:
            entities.append({"entity": doc, "resourceType": "source", "container": None})
    if kind in ("snapshot", "seed", "exposure", "unit_test", "semantic_model"):
        entities.append({"entity": doc, "resourceType": kind, "container": None})
    if isinstance(doc.get("entities"), list):
        for entity in doc["entities"]:
            if isinstance(entity, dict) and entity.get("file"):
                continue
            entities.append({"entity": entity, "resourceType": "entity", "container": None})
    return entities


# ---------------------------------------------------------------------------
# Entity findings — port of reviewAddEntityFindings


_FACT_RE = re.compile(r"(^fct_|fact|_fact$|mart|marts)")
_STAGING_RE = re.compile(r"^stg_|/staging/")
_FK_COL_RE = re.compile(r"_id$")
_PUBLISHABLE_RE = re.compile(r"(^fct_|^dim_|mart|interface)")


def _entity_owner(entity: Dict[str, Any], container: Optional[Dict[str, Any]]) -> Any:
    cfg = entity.get("config") or {}
    cfg_meta = cfg.get("meta") if isinstance(cfg, dict) else None
    container = container or {}
    container_meta = container.get("meta") if isinstance(container, dict) else None
    return (
        entity.get("owner")
        or (entity.get("meta") or {}).get("owner")
        or ((cfg_meta or {}).get("owner") if isinstance(cfg_meta, dict) else None)
        or container.get("owner")
        or ((container_meta or {}).get("owner") if isinstance(container_meta, dict) else None)
    )


def _entity_domain(entity: Dict[str, Any], container: Optional[Dict[str, Any]], doc: Any) -> Any:
    cfg = entity.get("config") or {}
    cfg_meta = cfg.get("meta") if isinstance(cfg, dict) else None
    container = container or {}
    container_meta = container.get("meta") if isinstance(container, dict) else None
    doc_model = (doc or {}).get("model") if isinstance(doc, dict) else None
    return (
        entity.get("domain")
        or (entity.get("meta") or {}).get("domain")
        or ((cfg_meta or {}).get("domain") if isinstance(cfg_meta, dict) else None)
        or ((doc_model or {}).get("domain") if isinstance(doc_model, dict) else None)
        or (doc.get("domain") if isinstance(doc, dict) else None)
        or container.get("domain")
        or ((container_meta or {}).get("domain") if isinstance(container_meta, dict) else None)
    )


_NO_COLUMNS_RESOURCES = {"exposure", "unit_test", "semantic_model"}


def _review_add_exposure_findings(
    findings: List[Finding], name: str, entity: Dict[str, Any], base: str
) -> None:
    """Surface findings on exposures.

    Exposures rot fast — owners leave, dashboards get deprecated. The
    DataLex review nudges teams to keep maturity + owner.email current.
    """
    owner = entity.get("owner") or {}
    email = owner.get("email") if isinstance(owner, dict) else None
    if not review_has_value(email):
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_EXPOSURE_OWNER_EMAIL_MISSING",
                path=f"{base}/owner",
                target=name,
                message=f"Exposure '{name}' has no owner.email — alerts will not route.",
                rationale="Exposures are the primary signal of downstream consumers; without an owner email, ownership decays silently.",
                suggested_fix="Add owner: {name: ..., email: ...} to the exposure entry.",
                weight=6,
            )
        )
    maturity = str(entity.get("maturity") or "").lower()
    if not maturity:
        findings.append(
            finding(
                severity="info",
                category="metadata",
                code="DBT_READINESS_EXPOSURE_MATURITY_MISSING",
                path=f"{base}/maturity",
                target=name,
                message=f"Exposure '{name}' has no maturity (low | medium | high).",
                rationale="Maturity helps consumers calibrate trust before relying on the exposure.",
                suggested_fix="Set maturity to one of low | medium | high.",
                weight=2,
            )
        )
    if not review_has_value(entity.get("description")):
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_EXPOSURE_DESCRIPTION_MISSING",
                path=base,
                target=name,
                message=f"Exposure '{name}' has no description.",
                rationale="Exposure descriptions explain who consumes the data and why.",
                suggested_fix="Add a short description capturing the consumer + use case.",
                weight=4,
            )
        )


def _freshness_value(node: Dict[str, Any], key: str) -> Any:
    if not isinstance(node, dict):
        return None
    f = node.get("freshness")
    if isinstance(f, dict) and f.get(key):
        return f[key]
    return None


def _review_add_source_freshness_findings(
    findings: List[Finding],
    name: str,
    entity: Dict[str, Any],
    container: Any,
    base: str,
) -> None:
    """Source tables with freshness windows must declare loaded_at_field."""
    has_warn = _freshness_value(entity, "warn_after") or _freshness_value(container, "warn_after")
    has_error = _freshness_value(entity, "error_after") or _freshness_value(container, "error_after")
    if not (has_warn or has_error):
        return
    loaded_at = entity.get("loaded_at_field") or (
        container.get("loaded_at_field") if isinstance(container, dict) else None
    )
    if not review_has_value(loaded_at):
        findings.append(
            finding(
                category="dbt_quality",
                code="DBT_READINESS_FRESHNESS_WITHOUT_LOADED_AT",
                path=f"{base}/freshness",
                target=name,
                message=f"Source '{name}' declares freshness but has no loaded_at_field.",
                rationale="dbt freshness checks need a timestamp column or `current_timestamp` to compute lag.",
                suggested_fix="Add loaded_at_field (or set freshness to null) on the source/table.",
                weight=6,
            )
        )


def review_add_entity_findings(
    findings: List[Finding],
    file_path: str,
    item: Dict[str, Any],
    doc: Any,
) -> None:
    entity = item.get("entity") or {}
    container = item.get("container")
    resource_type = item.get("resourceType") or "model"
    name = review_entity_name(entity)
    base = f"/{resource_type}s/{name}"

    if resource_type == "exposure":
        _review_add_exposure_findings(findings, name, entity, base)
        return
    if resource_type in {"unit_test", "semantic_model"}:
        # Description is the main quality signal we score for now; deeper
        # checks land in P2.
        if not review_has_value(entity.get("description") if isinstance(entity, dict) else None):
            findings.append(
                finding(
                    severity="info",
                    category="metadata",
                    code=f"DBT_READINESS_MISSING_{resource_type.upper()}_DESCRIPTION",
                    path=base,
                    target=name,
                    message=f"{resource_type} '{name}' has no description.",
                    rationale="Descriptions help reviewers understand intent without reading the SQL.",
                    suggested_fix=f"Add a description to the {resource_type} entry.",
                    weight=2,
                )
            )
        return

    if resource_type == "source":
        _review_add_source_freshness_findings(findings, name, entity, container, base)
    columns = review_columns(entity)
    materialization = str(review_materialization(entity)).lower()
    type_text = str(
        (entity.get("type") if isinstance(entity, dict) else None)
        or (entity.get("resource_type") if isinstance(entity, dict) else None)
        or resource_type
        or ""
    ).lower()
    owner = _entity_owner(entity, container) if isinstance(entity, dict) else None
    domain = _entity_domain(entity, container, doc) if isinstance(entity, dict) else None

    if not review_has_value(entity.get("description") if isinstance(entity, dict) else None):
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_MISSING_MODEL_DESCRIPTION",
                path=base,
                target=name,
                message=f"{name} is missing a model-level description.",
                rationale="Model descriptions are the first trust signal consumers see in dbt docs, catalogs, and DataLex reviews.",
                suggested_fix="Add a concise business-facing description that explains the model purpose, grain, and intended consumers.",
                weight=8,
            )
        )
    if not review_has_value(owner):
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_MISSING_OWNER",
                path=f"{base}/owner",
                target=name,
                message=f"{name} has no owner or steward metadata.",
                rationale="Ownership is required for issue routing, access decisions, freshness accountability, and enterprise governance.",
                suggested_fix="Add owner metadata using the project convention, such as owner, meta.owner, or config.meta.owner.",
                weight=6,
            )
        )
    if not review_has_value(domain):
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_MISSING_DOMAIN",
                path=f"{base}/domain",
                target=name,
                message=f"{name} is not mapped to a domain or subject area.",
                rationale="Enterprise model review needs domain context so conceptual and logical models can be generated with the right bounded context.",
                suggested_fix="Add domain or meta.domain metadata, or place the model under the appropriate DataLex domain folder.",
                weight=4,
            )
        )

    if not columns:
        findings.append(
            finding(
                severity="error",
                category="import_health",
                code="DBT_READINESS_NO_COLUMNS",
                path=f"{base}/columns",
                target=name,
                message=f"{name} has no declared columns or fields.",
                rationale="Column metadata is required to assess contracts, tests, data dictionary coverage, and physical-to-logical mapping.",
                suggested_fix="Run dbt parse/docs generation or add column metadata to the YAML file.",
                weight=18,
            )
        )
        return

    described = sum(1 for c in columns if review_has_value(c.get("description") if isinstance(c, dict) else None))
    coverage = round((described / len(columns)) * 100)
    if coverage < 80:
        findings.append(
            finding(
                category="metadata",
                code="DBT_READINESS_LOW_COLUMN_DESCRIPTION_COVERAGE",
                path=f"{base}/columns",
                target=name,
                message=f"{name} has {coverage}% column description coverage; enterprise readiness expects at least 80%.",
                rationale="Sparse column descriptions slow reuse, weaken AI context, and make downstream semantic modeling harder.",
                suggested_fix="Fill descriptions for key, metric, date, status, and consumer-facing columns first, then complete the remaining columns.",
                weight=12 if coverage < 40 else 7,
            )
        )

    has_pk = any(review_is_pk(c) for c in columns)
    has_unique = any(review_has_test(c, "unique") for c in columns)
    if not has_pk and not has_unique and type_text not in ("view", "ephemeral") and materialization != "ephemeral":
        findings.append(
            finding(
                category="dbt_quality",
                code="DBT_READINESS_NO_IDENTITY_TEST",
                path=f"{base}/columns",
                target=name,
                message=f"{name} has no primary key marker or unique test.",
                rationale="Identity checks anchor joins, relationship tests, duplicate detection, and conceptual/logical entity mapping.",
                suggested_fix="Mark the primary key column and add unique plus not_null tests where the model grain is known.",
                weight=9,
            )
        )

    grain = (
        entity.get("grain")
        or (entity.get("meta") or {}).get("grain")
        or ((entity.get("config") or {}).get("meta") or {}).get("grain")
    )
    name_lower = name.lower()
    if not review_has_value(grain) and _FACT_RE.search(name_lower):
        findings.append(
            finding(
                category="modeling",
                code="DBT_READINESS_FACT_GRAIN_MISSING",
                path=f"{base}/grain",
                target=name,
                message=f"{name} looks like a fact or mart model but has no grain definition.",
                rationale="Fact model grain is the most important modeling contract for reliable metrics and joins.",
                suggested_fix="Add grain metadata that states what one row represents, using the identifying column or business event.",
                weight=10,
            )
        )

    if _STAGING_RE.search(name_lower) and materialization and materialization not in ("view", "ephemeral"):
        findings.append(
            finding(
                severity="info",
                category="modeling",
                code="DBT_READINESS_STAGING_MATERIALIZATION_REVIEW",
                path=f"{base}/config/materialized",
                target=name,
                message=f"{name} is staging-like but materialized as {materialization}.",
                rationale="Many teams keep staging models lightweight. This is not always wrong, but it should be intentional.",
                suggested_fix="Confirm the materialization is intentional, or set staging conventions in project/team standards.",
                weight=2,
            )
        )

    for column in columns:
        if not isinstance(column, dict):
            continue
        column_name = str(column.get("name") or "column")
        col_path = f"{base}/columns/{column_name}"
        data_type = column.get("data_type") or column.get("type")
        if not review_has_value(column.get("description")):
            findings.append(
                finding(
                    severity="info",
                    category="metadata",
                    code="DBT_READINESS_MISSING_COLUMN_DESCRIPTION",
                    path=f"{col_path}/description",
                    target=f"{name}.{column_name}",
                    message=f"{name}.{column_name} has no description.",
                    rationale="Column descriptions are needed for catalog trust, data dictionary reuse, and AI-assisted modeling.",
                    suggested_fix="Add a business-facing column description that explains meaning, format, and key caveats.",
                    weight=2,
                )
            )
        if not review_has_value(data_type) or str(data_type).lower() == "unknown":
            findings.append(
                finding(
                    category="import_health",
                    code="DBT_READINESS_UNKNOWN_COLUMN_TYPE",
                    path=f"{col_path}/data_type",
                    target=f"{name}.{column_name}",
                    message=f"{name}.{column_name} has an unknown or missing data type.",
                    rationale="Types are required for contracts, DDL generation, physical model review, and logical type mapping.",
                    suggested_fix="Run dbt compile/docs with catalog metadata or add data_type/type to the column YAML.",
                    weight=7,
                )
            )
        if review_is_pk(column) and not (review_has_test(column, "unique") and review_has_test(column, "not_null")):
            findings.append(
                finding(
                    category="dbt_quality",
                    code="DBT_READINESS_PK_TESTS_MISSING",
                    path=f"{col_path}/tests",
                    target=f"{name}.{column_name}",
                    message=f"{name}.{column_name} is marked as identity but does not have both unique and not_null tests.",
                    rationale="Primary key metadata without enforcement leaves duplicate and null identity failures undetected.",
                    suggested_fix="Add unique and not_null tests to the primary key column.",
                    weight=8,
                )
            )
        if _FK_COL_RE.search(column_name) and not review_is_pk(column) and not review_has_relationship_test(column):
            findings.append(
                finding(
                    severity="info",
                    category="dbt_quality",
                    code="DBT_READINESS_RELATIONSHIP_TEST_MISSING",
                    path=f"{col_path}/tests",
                    target=f"{name}.{column_name}",
                    message=f"{name}.{column_name} looks like a foreign key but has no relationships test.",
                    rationale="Relationship tests make lineage and join assumptions executable instead of tribal knowledge.",
                    suggested_fix="Add a relationships test to the referenced dimension/source when the parent model is known.",
                    weight=3,
                )
            )
        col_meta = column.get("meta") if isinstance(column.get("meta"), dict) else {}
        if (
            review_is_sensitive(column)
            and not review_has_value(column.get("sensitivity"))
            and not review_has_value(column.get("classification"))
            and not review_has_value(col_meta.get("classification"))
        ):
            findings.append(
                finding(
                    category="governance",
                    code="DBT_READINESS_SENSITIVE_COLUMN_UNCLASSIFIED",
                    path=f"{col_path}/classification",
                    target=f"{name}.{column_name}",
                    message=f"{name}.{column_name} appears sensitive but has no classification metadata.",
                    rationale="Sensitive columns need explicit classification before enterprise publication or AI-assisted reuse.",
                    suggested_fix="Add sensitivity/classification metadata using the project governance convention.",
                    weight=9,
                )
            )

    contract = entity.get("contract") or {}
    cfg = entity.get("config") or {}
    cfg_contract = cfg.get("contract") if isinstance(cfg, dict) else None
    contract_enforced = (contract.get("enforced") if isinstance(contract, dict) else None) or (
        cfg_contract.get("enforced") if isinstance(cfg_contract, dict) else None
    )
    if not review_has_value(contract_enforced) and (has_pk or has_unique or _PUBLISHABLE_RE.search(name_lower)):
        findings.append(
            finding(
                severity="info",
                category="dbt_quality",
                code="DBT_READINESS_CONTRACT_REVIEW",
                path=f"{base}/contract",
                target=name,
                message=f"{name} may be a publishable model but does not enforce a dbt contract.",
                rationale="Contracts are an enterprise promotion signal for shared models, marts, and mesh interfaces.",
                suggested_fix="Consider enabling contract.enforced after data types, required columns, and tests are reviewed.",
                weight=2,
            )
        )


# ---------------------------------------------------------------------------
# Document-level findings — port of reviewAddDocumentFindings


_SEMANTIC_LAYER_RE = re.compile(r"semantic_models\s*:|metrics\s*:|exposures\s*:", re.IGNORECASE)


def review_add_document_findings(
    findings: List[Finding],
    file_record: Dict[str, Any],
    doc: Any,
    content: str,
    dbt_artifacts: Optional[Dict[str, bool]] = None,
) -> None:
    artifacts = dbt_artifacts or {}
    file_path = file_record.get("path") or ""
    kind = review_file_kind(file_path, doc)
    if kind == "yaml":
        findings.append(
            finding(
                severity="info",
                category="enterprise_modeling",
                code="DBT_READINESS_UNCLASSIFIED_YAML",
                path="/",
                target=file_path,
                message=f"{file_path} is YAML but was not recognized as dbt or DataLex modeling metadata.",
                rationale="Unclassified YAML may be valid project configuration, but it is not part of the model readiness score.",
                suggested_fix="No action needed unless this file should define models, sources, diagrams, or DataLex entities.",
                weight=1,
            )
        )
    entities = review_collect_entities(doc)
    for item in entities:
        review_add_entity_findings(findings, file_path, item, doc)

    has_models = isinstance(doc, dict) and (
        isinstance(doc.get("models"), list) or doc.get("kind") == "model"
    )
    if has_models and not artifacts.get("catalog"):
        findings.append(
            finding(
                severity="info",
                category="import_health",
                code="DBT_READINESS_CATALOG_NOT_FOUND",
                path="/",
                target=file_path,
                message="No dbt catalog artifact was found for this project.",
                rationale="Without catalog metadata, DataLex may not be able to verify warehouse column types after import.",
                suggested_fix="Run dbt docs generate or provide target/catalog.json before import/review.",
                weight=2,
            )
        )

    has_models_or_sources = isinstance(doc, dict) and (
        isinstance(doc.get("models"), list)
        or isinstance(doc.get("sources"), list)
        or doc.get("kind") in ("model", "source")
    )
    if has_models_or_sources and not artifacts.get("manifest"):
        findings.append(
            finding(
                severity="info",
                category="import_health",
                code="DBT_READINESS_MANIFEST_NOT_FOUND",
                path="/",
                target=file_path,
                message="No dbt manifest artifact was found for this project.",
                rationale="Without manifest metadata, lineage, config, refs, and test context are limited.",
                suggested_fix="Run dbt parse or dbt compile so target/manifest.json is available.",
                weight=2,
            )
        )

    if not _SEMANTIC_LAYER_RE.search(content) and entities:
        findings.append(
            finding(
                severity="info",
                category="enterprise_modeling",
                code="DBT_READINESS_SEMANTIC_LAYER_OPPORTUNITY",
                path="/semantic",
                target=file_path,
                message=f"{file_path} has model metadata that can seed conceptual, logical, or semantic model review.",
                rationale="DataLex can use physical dbt models to bootstrap business concepts, logical entities, metrics, and glossary links.",
                suggested_fix="Use Ask AI to generate or update conceptual and logical models from this reviewed dbt file.",
                weight=1,
            )
        )


# ---------------------------------------------------------------------------
# Per-file review + project review


def _safe_yaml_load(content: str) -> Tuple[Optional[Any], Optional[Dict[str, Any]]]:
    try:
        return yaml.safe_load(content), None
    except yaml.YAMLError as err:
        mark = getattr(err, "problem_mark", None) or getattr(err, "context_mark", None)
        line = (mark.line + 1) if mark and getattr(mark, "line", None) is not None else None
        column = (mark.column + 1) if mark and getattr(mark, "column", None) is not None else None
        return None, {
            "message": str(getattr(err, "problem", None) or err),
            "line": line,
            "column": column,
        }


def summarize_review_file(file_record: Dict[str, Any], findings: List[Finding]) -> Dict[str, Any]:
    findings_dicts = [finding_to_dict(f) for f in findings]
    errors = sum(1 for f in findings if f.severity == "error")
    warnings = sum(1 for f in findings if f.severity == "warn")
    infos = sum(1 for f in findings if f.severity == "info")
    penalty = sum(int(f.weight or 0) for f in findings)
    score = max(0, min(100, 100 - penalty))
    if errors > 0 or score < 60:
        status = "red"
    elif warnings > 0 or score < 85:
        status = "yellow"
    else:
        status = "green"
    category_counts: Dict[str, int] = {}
    for f in findings:
        category_counts[f.category] = category_counts.get(f.category, 0) + 1

    remediation = []
    for f in findings_dicts:
        if f["severity"] == "info":
            continue
        if len(remediation) >= 12:
            break
        remediation.append(
            {
                "finding_code": f["code"],
                "path": file_record.get("path", ""),
                "mode": "ask_ai",
                "prompt": f["remediation"]["prompt"] or f["message"],
            }
        )

    return {
        "path": file_record.get("path", ""),
        "fullPath": file_record.get("fullPath", ""),
        "name": file_record.get("name", ""),
        "score": score,
        "status": status,
        "counts": {
            "errors": errors,
            "warnings": warnings,
            "infos": infos,
            "total": len(findings),
        },
        "category_counts": category_counts,
        "findings": findings_dicts,
        "remediation_candidates": remediation,
    }


def review_file(
    file_record: Dict[str, Any],
    dbt_artifacts: Optional[Dict[str, bool]] = None,
) -> Dict[str, Any]:
    full_path = file_record.get("fullPath") or file_record.get("path")
    try:
        content = Path(full_path).read_text(encoding="utf-8")
    except OSError as err:
        f = finding(
            severity="error",
            category="import_health",
            code="DBT_READINESS_FILE_UNREADABLE",
            path="/",
            target=file_record.get("path", ""),
            message=f"{file_record.get('path', '')} could not be read.",
            rationale="Unreadable files cannot be validated or remediated safely.",
            suggested_fix=f"Check file permissions and retry the review. {err}".strip(),
            weight=25,
        )
        return summarize_review_file(file_record, [f])

    doc, error = _safe_yaml_load(content)
    if error or not isinstance(doc, dict):
        location = ""
        if error and error.get("line"):
            location = f" at line {error['line']}"
            if error.get("column"):
                location += f", column {error['column']}"
        msg = error.get("message") if error else "Top-level YAML must be an object."
        f = finding(
            severity="error",
            category="import_health",
            code="DBT_READINESS_YAML_PARSE_ERROR",
            path="/",
            target=file_record.get("path", ""),
            message=f"{file_record.get('path', '')} has a YAML parse error{location}.",
            rationale="Parsing must succeed before DataLex can assess dbt metadata, model quality, or remediation patches.",
            suggested_fix=msg or "Fix the YAML syntax and rerun readiness review.",
            weight=35,
        )
        return summarize_review_file(file_record, [f])

    findings: List[Finding] = []
    review_add_document_findings(findings, file_record, doc, content, dbt_artifacts)
    return summarize_review_file(file_record, findings)


def _new_run_id() -> str:
    return f"dbt_review_{int(time.time() * 1000)}_{secrets.token_hex(3)}"


def review_project(
    project_id: str,
    project_path: str,
    paths: Optional[Iterable[str]] = None,
    scope: str = "all",
) -> Dict[str, Any]:
    structure = load_project_structure(project_path)
    model_path = structure["modelPath"]
    requested = {to_posix_path(str(p or "")).lstrip("/") for p in (paths or [])}
    files = walk_yaml_files(model_path)
    artifacts = load_dbt_artifact_presence(project_path)
    selected = [
        f
        for f in files
        if (not requested or scope in ("all", "changed"))
        or (to_posix_path(f["path"]) in requested or f["name"] in requested)
    ]

    file_reviews = [review_file(f, artifacts) for f in selected]
    summary = {
        "total_files": len(file_reviews),
        "red": sum(1 for f in file_reviews if f["status"] == "red"),
        "yellow": sum(1 for f in file_reviews if f["status"] == "yellow"),
        "green": sum(1 for f in file_reviews if f["status"] == "green"),
        "findings": sum(f["counts"]["total"] for f in file_reviews),
        "errors": sum(f["counts"]["errors"] for f in file_reviews),
        "warnings": sum(f["counts"]["warnings"] for f in file_reviews),
        "infos": sum(f["counts"]["infos"] for f in file_reviews),
        "score": round(sum(f["score"] for f in file_reviews) / len(file_reviews))
        if file_reviews
        else 100,
    }
    return {
        "ok": True,
        "runId": _new_run_id(),
        "projectId": project_id,
        "projectPath": project_path,
        "modelPath": model_path,
        "scope": scope,
        "generatedAt": datetime.now(tz=timezone.utc)
        .isoformat(timespec="milliseconds")
        .replace("+00:00", "Z"),
        "dbtArtifacts": artifacts,
        "summary": summary,
        "files": file_reviews,
        "byPath": {
            f["path"]: {"status": f["status"], "score": f["score"], "counts": f["counts"]}
            for f in file_reviews
        },
    }
