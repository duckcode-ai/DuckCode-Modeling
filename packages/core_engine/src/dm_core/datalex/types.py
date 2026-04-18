"""DataLex logical type system.

Grammar:
    type      := primitive | parameterized | composite
    primitive := string | text | integer | bigint | float | boolean
               | date | timestamp | timestamp_tz | interval
               | uuid | json | binary | decimal
    parameterized := primitive '(' INT [',' INT] ')'          e.g. decimal(18,4), string(255)
    composite := 'array' '<' type '>'
               | 'map'   '<' type ',' type '>'
               | 'struct' '<' field (',' field)* '>'
    field     := ident ':' type

The parser is recursive-descent and deterministic; `str(parsed)` round-trips to a
canonical form used by dialect plugins and the diff engine.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from dm_core.datalex.errors import DataLexError


PRIMITIVES = frozenset({
    "string", "text", "integer", "bigint", "float", "boolean",
    "date", "timestamp", "timestamp_tz", "interval",
    "uuid", "json", "binary", "decimal",
})

COMPOSITE_KEYWORDS = frozenset({"array", "map", "struct"})


@dataclass(frozen=True)
class LogicalType:
    """In-memory representation of a parsed logical type.

    `kind` is one of PRIMITIVES or COMPOSITE_KEYWORDS.
    `params` is the tuple of numeric parameters (e.g. (18, 4) for decimal(18,4)).
    `children` is the tuple of child types for array/map.
    `fields` is the tuple of (name, type) pairs for struct.
    """
    kind: str
    params: Tuple[int, ...] = ()
    children: Tuple["LogicalType", ...] = ()
    fields: Tuple[Tuple[str, "LogicalType"], ...] = ()

    def render(self) -> str:
        if self.kind == "array":
            return f"array<{self.children[0].render()}>"
        if self.kind == "map":
            return f"map<{self.children[0].render()},{self.children[1].render()}>"
        if self.kind == "struct":
            inner = ",".join(f"{n}:{t.render()}" for n, t in self.fields)
            return f"struct<{inner}>"
        if self.params:
            return f"{self.kind}({','.join(str(p) for p in self.params)})"
        return self.kind

    def is_composite(self) -> bool:
        return self.kind in COMPOSITE_KEYWORDS

    def __str__(self) -> str:
        return self.render()


class _Tokenizer:
    """Tiny tokenizer for the logical type grammar."""

    def __init__(self, text: str):
        self.text = text
        self.pos = 0
        self.n = len(text)

    def peek(self) -> str:
        self._skip_ws()
        return self.text[self.pos] if self.pos < self.n else ""

    def consume(self, ch: str) -> bool:
        self._skip_ws()
        if self.pos < self.n and self.text[self.pos] == ch:
            self.pos += 1
            return True
        return False

    def expect(self, ch: str) -> None:
        if not self.consume(ch):
            raise DataLexError(
                code="TYPE_PARSE",
                message=f"Expected '{ch}' at position {self.pos} in type '{self.text}'",
                suggested_fix=f"Check the type syntax near '{self.text[max(0, self.pos-8):self.pos+8]}'",
            )

    def read_ident(self) -> str:
        self._skip_ws()
        start = self.pos
        while self.pos < self.n and (self.text[self.pos].isalnum() or self.text[self.pos] == "_"):
            self.pos += 1
        if start == self.pos:
            raise DataLexError(
                code="TYPE_PARSE",
                message=f"Expected identifier at position {self.pos} in type '{self.text}'",
            )
        return self.text[start:self.pos]

    def read_int(self) -> int:
        self._skip_ws()
        start = self.pos
        while self.pos < self.n and self.text[self.pos].isdigit():
            self.pos += 1
        if start == self.pos:
            raise DataLexError(code="TYPE_PARSE", message=f"Expected integer in type '{self.text}'")
        return int(self.text[start:self.pos])

    def eof(self) -> bool:
        self._skip_ws()
        return self.pos >= self.n

    def _skip_ws(self) -> None:
        while self.pos < self.n and self.text[self.pos] in " \t\n":
            self.pos += 1


def parse_type(text: str) -> LogicalType:
    """Parse a DataLex logical type string into a LogicalType.

    Raises DataLexError(code=TYPE_PARSE) on malformed input. Unknown primitive names
    are accepted (returned as a raw kind with no params) so dialect plugins can accept
    dialect-specific types as escape hatches; validation of known primitives happens
    in the validator pass.
    """
    if not isinstance(text, str) or not text.strip():
        raise DataLexError(code="TYPE_PARSE", message="Empty type string")
    tok = _Tokenizer(text.strip())
    parsed = _parse(tok)
    if not tok.eof():
        raise DataLexError(
            code="TYPE_PARSE",
            message=f"Trailing characters after type in '{text}'",
        )
    return parsed


def _parse(tok: _Tokenizer) -> LogicalType:
    ident = tok.read_ident().lower()

    if ident == "array":
        tok.expect("<")
        inner = _parse(tok)
        tok.expect(">")
        return LogicalType(kind="array", children=(inner,))

    if ident == "map":
        tok.expect("<")
        k = _parse(tok)
        tok.expect(",")
        v = _parse(tok)
        tok.expect(">")
        return LogicalType(kind="map", children=(k, v))

    if ident == "struct":
        tok.expect("<")
        fields: List[Tuple[str, LogicalType]] = []
        while True:
            name = tok.read_ident()
            tok.expect(":")
            ftype = _parse(tok)
            fields.append((name, ftype))
            if tok.consume(","):
                continue
            break
        tok.expect(">")
        return LogicalType(kind="struct", fields=tuple(fields))

    # primitive or parameterized
    params: Tuple[int, ...] = ()
    if tok.peek() == "(":
        tok.expect("(")
        params_list: List[int] = [tok.read_int()]
        while tok.consume(","):
            params_list.append(tok.read_int())
        tok.expect(")")
        params = tuple(params_list)

    return LogicalType(kind=ident, params=params)


def is_known_primitive(kind: str) -> bool:
    return kind in PRIMITIVES


def validate_type_string(text: str) -> Optional[DataLexError]:
    """Return a DataLexError if the type string is malformed or uses unknown primitives
    in a shape that is clearly wrong (e.g. composite keyword without generics)."""
    try:
        t = parse_type(text)
    except DataLexError as e:
        return e

    return _validate_tree(t)


def _validate_tree(t: LogicalType) -> Optional[DataLexError]:
    if t.kind in COMPOSITE_KEYWORDS:
        for c in t.children:
            err = _validate_tree(c)
            if err:
                return err
        for _, ft in t.fields:
            err = _validate_tree(ft)
            if err:
                return err
        return None

    if t.kind not in PRIMITIVES:
        # allow as pass-through so dialects can accept native types, but flag a warning
        return DataLexError(
            code="TYPE_UNKNOWN_PRIMITIVE",
            severity="warn",
            message=f"Unknown logical primitive '{t.kind}' — will be passed through to the dialect verbatim",
            suggested_fix=f"Use one of: {', '.join(sorted(PRIMITIVES))} — or provide a per-dialect physical override.",
        )
    return None
