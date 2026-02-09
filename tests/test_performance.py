import time
import unittest
from copy import deepcopy
from pathlib import Path

import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))

from dm_core import compile_model, semantic_diff


def make_large_model(entity_count=250, field_count=8):
    entities = []
    relationships = []

    for idx in range(entity_count):
        entity_name = f"Entity{idx:03d}"
        fields = [
            {
                "name": f"field_{field_idx}",
                "type": "integer" if field_idx == 0 else "string",
                "primary_key": field_idx == 0,
                "nullable": field_idx != 0,
            }
            for field_idx in range(field_count)
        ]
        entities.append({"name": entity_name, "type": "table", "fields": fields})

        if idx > 0:
            prev_entity = f"Entity{idx - 1:03d}"
            relationships.append(
                {
                    "name": f"{prev_entity.lower()}_{entity_name.lower()}_rel",
                    "from": f"{prev_entity}.field_0",
                    "to": f"{entity_name}.field_0",
                    "cardinality": "one_to_many",
                }
            )

    return {
        "model": {
            "name": "perf_model",
            "version": "1.0.0",
            "domain": "performance",
            "owners": ["perf@example.com"],
            "state": "draft",
        },
        "entities": entities,
        "relationships": relationships,
    }


class PerformanceTests(unittest.TestCase):
    def test_large_model_compile_and_diff_budget(self):
        baseline = make_large_model()
        changed = deepcopy(baseline)
        changed["entities"][10]["fields"].append(
            {"name": "new_metric", "type": "decimal(12,2)", "nullable": True}
        )

        compile_start = time.perf_counter()
        compile_model(baseline)
        compile_elapsed = time.perf_counter() - compile_start

        diff_start = time.perf_counter()
        diff = semantic_diff(baseline, changed)
        diff_elapsed = time.perf_counter() - diff_start

        self.assertLess(compile_elapsed, 5.0)
        self.assertLess(diff_elapsed, 8.0)
        self.assertEqual(1, diff["summary"]["changed_entities"])


if __name__ == "__main__":
    unittest.main()
