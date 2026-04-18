"""Synthetic DataLex project generator for scale testing.

Usage:
    python3 tests/fixtures/large_synth/generate.py <out_dir> [--entities N]

Produces a valid DataLex project tree:
    <out_dir>/datalex.yaml
    <out_dir>/models/physical/postgres/ent_0001.yaml ... ent_NNNN.yaml
    <out_dir>/glossary/term_001.yaml ... (a handful of shared terms)

Perf target (`--entities 10000`): validate < 30s, peak RSS < 1GB on a dev laptop.
The generated entities have realistic column shapes (6–12 columns each,
types drawn from a fixed palette, PK on first column) but no FK edges, so
loader performance is the dominant cost.
"""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import List

import yaml


TYPE_PALETTE: List[str] = [
    "bigint",
    "int",
    "string",
    "string(64)",
    "string(255)",
    "decimal(18,2)",
    "boolean",
    "timestamp",
    "date",
    "uuid",
]


def _columns_for(ent_idx: int) -> List[dict]:
    # Deterministic column count based on entity index.
    n_cols = 6 + (ent_idx % 7)
    cols = [{"name": "id", "type": "bigint", "constraints": [{"type": "primary_key"}]}]
    for i in range(1, n_cols):
        cols.append({
            "name": f"col_{i:02d}",
            "type": TYPE_PALETTE[(ent_idx + i) % len(TYPE_PALETTE)],
            "description": f"Synthetic column {i} of entity {ent_idx}.",
        })
    return cols


def generate(out_dir: Path, n_entities: int = 10_000) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "datalex.yaml").write_text(
        yaml.safe_dump(
            {
                "kind": "project",
                "name": f"large_synth_{n_entities}",
                "version": "1",
                "dialects": ["postgres"],
                "default_dialect": "postgres",
            },
            sort_keys=False,
        ),
        encoding="utf-8",
    )

    ent_dir = out_dir / "models" / "physical" / "postgres"
    ent_dir.mkdir(parents=True, exist_ok=True)

    # Write entities in flat directory. 10K files at ~200 bytes each is ~2MB —
    # well within fs limits on any modern system.
    for idx in range(1, n_entities + 1):
        doc = {
            "kind": "entity",
            "layer": "physical",
            "dialect": "postgres",
            "name": f"ent_{idx:06d}",
            "description": f"Synthetic entity #{idx}.",
            "columns": _columns_for(idx),
        }
        (ent_dir / f"ent_{idx:06d}.yaml").write_text(
            yaml.safe_dump(doc, sort_keys=False), encoding="utf-8"
        )

    glossary_dir = out_dir / "glossary"
    glossary_dir.mkdir(parents=True, exist_ok=True)
    for t_idx in range(1, 11):
        (glossary_dir / f"term_{t_idx:03d}.yaml").write_text(
            yaml.safe_dump(
                {
                    "kind": "term",
                    "name": f"term_{t_idx:03d}",
                    "definition": f"Synthetic glossary term {t_idx}.",
                },
                sort_keys=False,
            ),
            encoding="utf-8",
        )


def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("out_dir")
    p.add_argument("--entities", type=int, default=10_000)
    args = p.parse_args()
    generate(Path(args.out_dir), n_entities=args.entities)
    print(f"Wrote {args.entities} entities to {args.out_dir}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
