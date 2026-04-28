import sys
from pathlib import Path

# Make `datalex_readiness` importable without installing the package.
SRC = Path(__file__).resolve().parent.parent / "src"
if str(SRC) not in sys.path:
    sys.path.insert(0, str(SRC))
