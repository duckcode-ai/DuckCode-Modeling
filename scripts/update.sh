#!/usr/bin/env bash
# scripts/update.sh — one-command update to the latest DataLex.
#
# Detects how `datalex-cli` is installed in the active Python environment
# and runs the right upgrade for it:
#
#   1. Editable source checkout in *this* repo  → `git pull` + `pip install -e .`
#   2. Installed from a `git+https://github.com/...` URL → re-install from main
#   3. Installed from PyPI                       → `pip install -U` from PyPI
#   4. Not installed                             → install [serve] from PyPI
#
# Pass `--from-source` to force option 2 (useful when PyPI is behind main —
# e.g. you hit a fix that's on main but not yet released).

set -euo pipefail

REPO_URL="https://github.com/duckcode-ai/DataLex.git"
SUBDIR="packages/cli"
PIP_FROM_MAIN="git+${REPO_URL}#subdirectory=${SUBDIR}"

force_source=0
for arg in "$@"; do
  case "$arg" in
    --from-source) force_source=1 ;;
    -h|--help)
      sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
      exit 0 ;;
  esac
done

# Resolve `python` and `pip` from the active environment. Honor a venv if
# one is active; otherwise fall back to the system python3.
PY="${VIRTUAL_ENV:+$VIRTUAL_ENV/bin/python}"
PY="${PY:-$(command -v python3 || command -v python || true)}"
if [[ -z "$PY" ]]; then
  echo "error: no python3 on PATH" >&2
  exit 1
fi

probe() {
  "$PY" - <<'PY'
import json, sys
try:
    from importlib.metadata import distribution, PackageNotFoundError
except Exception:
    sys.exit(2)
try:
    d = distribution("datalex-cli")
except PackageNotFoundError:
    print(json.dumps({"installed": False}))
    sys.exit(0)
direct = None
try:
    direct = d.read_text("direct_url.json")
except Exception:
    pass
out = {
    "installed": True,
    "version": d.version,
    "direct_url": direct,
    "location": str(d.locate_file("")),
}
print(json.dumps(out))
PY
}

info_json="$(probe)"
mode="pypi"
if [[ "$force_source" == "1" ]]; then
  mode="from-source"
elif echo "$info_json" | grep -q '"installed": false'; then
  mode="install-fresh"
elif echo "$info_json" | grep -q '"editable": true'; then
  mode="editable"
elif echo "$info_json" | grep -q '"vcs":'; then
  mode="vcs"
fi

# `direct_url.json` shape from PEP 610: editable installs have
# `dir_info.editable=true`; VCS installs have a `vcs_info` block.
case "$info_json" in
  *'"editable": true'*) mode="editable" ;;
  *'"vcs_info"'*)       mode="vcs" ;;
esac

echo "[update] python = $PY"
echo "[update] datalex-cli mode = $mode"

case "$mode" in
  editable)
    # Find the source dir from direct_url.json's url=file://...
    src=$("$PY" - <<'PY'
import json
from importlib.metadata import distribution
d = distribution("datalex-cli")
info = json.loads(d.read_text("direct_url.json") or "{}")
url = info.get("url", "")
prefix = "file://"
print(url[len(prefix):] if url.startswith(prefix) else "")
PY
)
    if [[ -z "$src" || ! -d "$src" ]]; then
      echo "error: could not resolve editable source dir from direct_url.json" >&2
      exit 1
    fi
    # If the src is inside a git checkout, pull main first.
    repo_root="$(git -C "$src" rev-parse --show-toplevel 2>/dev/null || true)"
    if [[ -n "$repo_root" ]]; then
      echo "[update] git pull in $repo_root"
      git -C "$repo_root" pull --ff-only origin main
    fi
    echo "[update] reinstalling editable: $src"
    "$PY" -m pip install -e "$src"
    ;;
  vcs|from-source)
    echo "[update] installing latest main from GitHub: $PIP_FROM_MAIN"
    "$PY" -m pip install -U "$PIP_FROM_MAIN"
    ;;
  pypi)
    echo "[update] upgrading from PyPI"
    "$PY" -m pip install -U 'datalex-cli[serve]'
    ;;
  install-fresh)
    echo "[update] datalex-cli not installed — installing [serve] from PyPI"
    "$PY" -m pip install 'datalex-cli[serve]'
    ;;
esac

echo
echo "[update] installed version:"
"$PY" -m pip show datalex-cli | awk -F': ' '/^Version:/ {print "  " $2}'
echo "[update] done. Run \`datalex serve\` to start."
