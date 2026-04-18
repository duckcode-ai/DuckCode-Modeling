"""Scale perf smoke test.

Opt-in: set DATALEX_PERF=1 to run. Skipped in the default suite because it
generates 10K YAML files and takes 10-30 seconds.

Perf target from the Phase C spec: validate < 30s, peak RSS < 1GB.
We run a scaled-down variant by default (1000 entities) to keep the test
useful as a regression gate without bloating CI; set `DATALEX_PERF_N` to
override the entity count.
"""

from __future__ import annotations

import os
import resource
import sys
import tempfile
import time
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "packages" / "core_engine" / "src"))
sys.path.insert(0, str(ROOT / "tests" / "fixtures" / "large_synth"))

from dm_core.datalex import load_project  # noqa: E402
from generate import generate  # noqa: E402


def _peak_rss_mb() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux reports KB. Normalize to MB.
    if sys.platform == "darwin":
        return usage / 1024.0 / 1024.0
    return usage / 1024.0


@unittest.skipUnless(
    os.environ.get("DATALEX_PERF") == "1",
    "Set DATALEX_PERF=1 to run scale perf tests.",
)
class ScalePerfTests(unittest.TestCase):
    def test_load_ten_thousand_entities(self) -> None:
        n = int(os.environ.get("DATALEX_PERF_N", "10000"))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "synth"
            generate(root, n_entities=n)

            t0 = time.perf_counter()
            project = load_project(root, strict=True)
            elapsed = time.perf_counter() - t0

            rss_mb = _peak_rss_mb()
            print(
                f"\n[scale] entities={n} load={elapsed:.2f}s peak_rss={rss_mb:.1f}MB",
                flush=True,
            )

            self.assertEqual(len(project.entities), n)
            self.assertLess(elapsed, 30.0, f"Load took {elapsed:.1f}s, budget 30s")
            self.assertLess(rss_mb, 1024.0, f"Peak RSS {rss_mb:.0f}MB, budget 1024MB")

    def test_cache_hit_is_faster_than_cold(self) -> None:
        n = int(os.environ.get("DATALEX_PERF_N", "2000"))
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "synth"
            cache_dir = Path(tmp) / "cache"
            generate(root, n_entities=n)

            t0 = time.perf_counter()
            load_project(root, strict=True, cache_dir=cache_dir)
            cold = time.perf_counter() - t0

            t1 = time.perf_counter()
            load_project(root, strict=True, cache_dir=cache_dir)
            warm = time.perf_counter() - t1

            print(
                f"\n[scale] cache entities={n} cold={cold:.2f}s warm={warm:.2f}s "
                f"speedup={(cold / warm):.1f}x",
                flush=True,
            )
            self.assertLess(warm, cold, "Warm cache should be faster than cold.")


class FixtureGeneratorSmokeTests(unittest.TestCase):
    """Run by default — confirms the generator produces a loadable project."""

    def test_small_fixture_loads(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp) / "synth"
            generate(root, n_entities=25)
            project = load_project(root, strict=True)
            self.assertEqual(len(project.entities), 25)


if __name__ == "__main__":
    unittest.main()
