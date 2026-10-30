#!/usr/bin/env bash
# Headless Blender for the genesys-blender-modeling skill. Run from the game project root.
#
#   blender.sh build blender/<asset> [--look]   rebuild one asset from its step scripts, export its GLB
#   blender.sh build-all                        rebuild every blender/*/ that has an asset.json (parent only)
#   blender.sh sheet <file.glb|@engine/…> [--look]  contact sheet + numbers for any model
#   blender.sh preview <file.glb>               Cycles beauty render (textured / baked assets)
#   blender.sh prune [--apply] [--all]          list (or delete) .scratch/blender leftovers of
#                                               folders that no longer exist under blender/
#
# Finds Blender via $BLENDER, then `blender` on PATH, then the usual install folders (macOS, Linux,
# Windows Git Bash). Needs Blender 4.1+. Each run is killed after $BLENDER_TIMEOUT seconds
# (default 300). A run that ends without a RESULT line is retried once. Parallel runs are safe.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(pwd)"
TIMEOUT="${BLENDER_TIMEOUT:-300}"
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "FAIL run from the game project root (the folder with package.json)" >&2
  exit 2
fi

usage() { sed -n '2,13p' "$0"; exit 2; }

# ---------------------------------------------------------------- scratch hygiene
check_ignored() {
  local p
  for p in .scratch art-source; do
    if git -C "$ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
      git -C "$ROOT" check-ignore -q "$p/probe" 2>/dev/null && continue
    elif grep -qE "^/?$p/?[[:space:]]*$" "$ROOT/.gitignore" 2>/dev/null; then
      continue
    fi
    echo "WARN $p/ is not git-ignored — add this line to .gitignore:  $p/"
  done
}

if [[ "${1:-}" == "prune" ]]; then
  shift
  exec node "$HERE/prune.mjs" "$@"
fi

# ---------------------------------------------------------------- find Blender
BL="${BLENDER:-}"
if [[ -z "$BL" ]]; then
  for c in "$(command -v blender || true)" \
           /Applications/Blender.app/Contents/MacOS/Blender "$HOME/Applications/Blender.app/Contents/MacOS/Blender" \
           /snap/bin/blender /usr/bin/blender /usr/local/bin/blender /opt/blender/blender \
           /c/Program\ Files/Blender\ Foundation/Blender*/blender.exe; do
    if [[ -n "$c" && -x "$c" ]]; then BL="$c"; break; fi
  done
fi
if [[ -z "$BL" || ! -x "$BL" ]]; then
  echo "FAIL Blender not found${BL:+ at $BL}. Install Blender 4.1+ or set BLENDER=/path/to/blender" >&2
  exit 3
fi
# Follow symlinks (e.g. /usr/local/bin/blender → Blender.app): Blender finds its bundled Python and
# scripts relative to the real binary and crashes when started through a link.
while [[ -L "$BL" ]]; do
  t="$(readlink "$BL")"
  if [[ "$t" == /* ]]; then BL="$t"; else BL="$(dirname "$BL")/$t"; fi
done

# ---------------------------------------------------------------- one Blender run, with a timeout
LOG="$(mktemp "${TMPDIR:-/tmp}/gblender.XXXXXX")"
trap 'rm -f "$LOG" "$LOG.timeout"' EXIT

run_once() {
  rm -f "$LOG.timeout"
  PYTHONDONTWRITEBYTECODE=1 GKIT_PROJECT_ROOT="$ROOT" "$BL" -b --factory-startup \
    --python "$HERE/runner.py" -- "$@" >"$LOG" 2>&1 &
  local pid=$!
  # Portable watchdog (macOS has no `timeout`): stop Blender after $TIMEOUT seconds.
  ( sleep "$TIMEOUT"; if kill -0 "$pid" 2>/dev/null; then : >"$LOG.timeout"; kill -TERM "$pid" 2>/dev/null; sleep 5; kill -KILL "$pid" 2>/dev/null; fi ) >/dev/null 2>&1 &
  local wd=$!
  local code=0
  wait "$pid" 2>/dev/null || code=$?   # (2>: no shell job-status noise)
  pkill -P "$wd" 2>/dev/null || true
  kill "$wd" 2>/dev/null || true
  wait "$wd" 2>/dev/null || true
  return $code
}

show() {
  # Machine-readable lines only; the glTF exporter's own warnings come through as WARN glTF.
  sed -nE \
    -e 's/^[0-9:]+ \| (WARNING|ERROR): (.*)$/WARN glTF \1: \2/p' \
    -e '/^(BLENDER|STEP|NUMBERS|BUDGET|MARKERS|SHEET|LOOK|EXPORT|RIG|STILL|EXPECT|NOTE|WARN|FAIL|RESULT|PRINT|Traceback|  File|    |[A-Za-z]*Error)/p' \
    "$LOG"
}

run() {
  local attempt code=0
  for attempt in 1 2; do
    code=0
    run_once "$@" || code=$?
    show
    if [[ -f "$LOG.timeout" ]]; then
      echo "FAIL Blender ran longer than ${TIMEOUT}s and was stopped — simplify the step (fewer booleans, smaller bakes) or raise BLENDER_TIMEOUT"
      return 1
    fi
    grep -q '^RESULT ok' "$LOG" && return 0
    grep -q '^RESULT' "$LOG" && return 1
    if [[ $attempt == 1 ]]; then
      echo "RETRY Blender exited without a RESULT line (exit $code) — running once more"
    fi
  done
  echo "FAIL Blender exited twice without a RESULT line (exit $code). Last lines of its output:"
  tail -n 15 "$LOG" | sed 's/^/  | /'
  return 1
}

case "${1:-}" in
  build)
    [[ -n "${2:-}" ]] || { echo "usage: blender.sh build blender/<asset> [--look]" >&2; exit 2; }
    check_ignored
    run build "$2" "${3:-}"
    ;;
  build-all)
    check_ignored
    status=0
    for d in "$ROOT"/blender/*/; do
      [[ -f "$d/asset.json" ]] || continue
      echo "== ${d#$ROOT/}"
      run build "${d#$ROOT/}" || status=1
    done
    exit $status
    ;;
  sheet)
    [[ -n "${2:-}" ]] || { echo "usage: blender.sh sheet <file.glb|@engine/...> [--look]" >&2; exit 2; }
    check_ignored
    run sheet "$2" "${3:-}" "${4:-}"
    ;;
  preview)
    [[ -n "${2:-}" ]] || { echo "usage: blender.sh preview <file.glb|@project/...>" >&2; exit 2; }
    check_ignored
    run preview "$2" "${3:-}"
    ;;
  *)
    usage
    ;;
esac
