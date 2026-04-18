"""Source-located error model for DataLex.

Every error carries file, line, column, and a suggested fix where possible. This is
what the DataLex spec calls out as a parser guarantee and what makes both humans and
LLMs faster at repair.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional


@dataclass(frozen=True)
class SourceLocation:
    file: str
    line: Optional[int] = None
    column: Optional[int] = None

    def format(self) -> str:
        if self.line is None:
            return self.file
        if self.column is None:
            return f"{self.file}:{self.line}"
        return f"{self.file}:{self.line}:{self.column}"


@dataclass
class DataLexError(Exception):
    code: str
    message: str
    location: Optional[SourceLocation] = None
    suggested_fix: Optional[str] = None
    path: Optional[str] = None
    severity: str = "error"

    def __str__(self) -> str:
        loc = self.location.format() if self.location else ""
        prefix = f"{loc}: " if loc else ""
        fix = f"\n  hint: {self.suggested_fix}" if self.suggested_fix else ""
        path = f" [{self.path}]" if self.path else ""
        return f"{prefix}{self.severity}[{self.code}]: {self.message}{path}{fix}"

    def to_dict(self) -> dict:
        return {
            "code": self.code,
            "severity": self.severity,
            "message": self.message,
            "path": self.path,
            "file": self.location.file if self.location else None,
            "line": self.location.line if self.location else None,
            "column": self.location.column if self.location else None,
            "suggested_fix": self.suggested_fix,
        }


@dataclass
class DataLexErrorBag:
    """Collects multiple errors across a project load so the user can fix them in one pass."""

    errors: List[DataLexError] = field(default_factory=list)

    def add(self, err: DataLexError) -> None:
        self.errors.append(err)

    def extend(self, errs: List[DataLexError]) -> None:
        self.errors.extend(errs)

    def has_errors(self) -> bool:
        return any(e.severity == "error" for e in self.errors)

    def raise_if_errors(self) -> None:
        if self.has_errors():
            raise DataLexLoadError(self.errors)

    def to_list(self) -> List[dict]:
        return [e.to_dict() for e in self.errors]


class DataLexLoadError(Exception):
    """Raised when load_project finishes with one or more errors."""

    def __init__(self, errors: List[DataLexError]):
        self.errors = errors
        super().__init__(f"{len(errors)} DataLex error(s) — " + "; ".join(e.code for e in errors[:5]))
