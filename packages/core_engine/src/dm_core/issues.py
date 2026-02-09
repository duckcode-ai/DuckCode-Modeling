from dataclasses import dataclass
from typing import Iterable, List


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    path: str = "/"


def has_errors(issues: Iterable[Issue]) -> bool:
    return any(issue.severity == "error" for issue in issues)


def to_lines(issues: List[Issue]) -> List[str]:
    lines = []
    for issue in issues:
        lines.append(
            f"[{issue.severity.upper()}] {issue.code} {issue.path}: {issue.message}"
        )
    return lines
