"""Finding dataclass + serializers (JSON, SARIF)."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional


@dataclass
class Finding:
    severity: str = "warn"
    category: str = ""
    code: str = ""
    path: str = "/"
    target: str = ""
    message: str = ""
    rationale: str = ""
    suggested_fix: str = ""
    weight: int = 5

    def remediation_prompt(self) -> str:
        return (
            f"{self.message}\n\nWhy it matters: {self.rationale}\n\n"
            f"Suggested YAML change: {self.suggested_fix}"
        )


def finding(
    severity: str = "warn",
    category: str = "",
    code: str = "",
    path: str = "/",
    message: str = "",
    rationale: str = "",
    suggested_fix: str = "",
    target: str = "",
    weight: int = 5,
) -> Finding:
    return Finding(
        severity=severity,
        category=category,
        code=code,
        path=path or "/",
        target=target,
        message=message,
        rationale=rationale,
        suggested_fix=suggested_fix,
        weight=weight,
    )


def finding_to_dict(f: Finding) -> Dict[str, Any]:
    """Match the JS `reviewFinding` JSON shape exactly."""
    return {
        "severity": f.severity,
        "category": f.category,
        "code": f.code,
        "path": f.path or "/",
        "target": f.target,
        "message": f.message,
        "rationale": f.rationale,
        "suggested_fix": f.suggested_fix,
        "weight": f.weight,
        "remediation": {
            "mode": "ai_proposal",
            "prompt": f.remediation_prompt(),
        },
    }


_SARIF_LEVEL = {"error": "error", "warn": "warning", "info": "note"}


def findings_to_sarif(file_reviews: List[Dict[str, Any]]) -> Dict[str, Any]:
    """Emit SARIF 2.1.0 for GitHub code-scanning upload."""
    results = []
    rules: Dict[str, Dict[str, Any]] = {}
    for file_review in file_reviews:
        file_path = file_review.get("path") or ""
        for f in file_review.get("findings", []):
            code = f.get("code") or "DBT_READINESS"
            rules.setdefault(
                code,
                {
                    "id": code,
                    "shortDescription": {"text": code},
                    "fullDescription": {"text": f.get("rationale") or ""},
                    "defaultConfiguration": {"level": _SARIF_LEVEL.get(f.get("severity"), "warning")},
                },
            )
            results.append(
                {
                    "ruleId": code,
                    "level": _SARIF_LEVEL.get(f.get("severity"), "warning"),
                    "message": {"text": f.get("message") or ""},
                    "locations": [
                        {
                            "physicalLocation": {
                                "artifactLocation": {"uri": file_path},
                            }
                        }
                    ],
                    "properties": {
                        "category": f.get("category") or "",
                        "weight": f.get("weight") or 0,
                        "suggested_fix": f.get("suggested_fix") or "",
                    },
                }
            )
    return {
        "version": "2.1.0",
        "$schema": "https://json.schemastore.org/sarif-2.1.0.json",
        "runs": [
            {
                "tool": {
                    "driver": {
                        "name": "datalex-readiness",
                        "informationUri": "https://duckcode.ai",
                        "rules": list(rules.values()),
                    }
                },
                "results": results,
            }
        ],
    }
