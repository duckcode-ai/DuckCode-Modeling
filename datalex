#!/usr/bin/env python3
import sys
from pathlib import Path


def _add_local_paths() -> None:
    root = Path(__file__).resolve().parent
    core_src = root / "packages" / "core_engine" / "src"
    cli_src = root / "packages" / "cli" / "src"
    sys.path.insert(0, str(core_src))
    sys.path.insert(0, str(cli_src))


def main() -> int:
    _add_local_paths()
    from dm_cli.main import main as cli_main

    return cli_main()


if __name__ == "__main__":
    raise SystemExit(main())
