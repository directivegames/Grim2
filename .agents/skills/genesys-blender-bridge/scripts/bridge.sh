#!/usr/bin/env bash
# Blender side of the Genesys Blender bridge. Run from the game project root.
#
#   bridge.sh sync-from-genesys --manifest <manifest.json> --output <out.blend> [--from <prior.blend>]
#                               [--target-level <collection>] [--overwrite] [--replace-untagged]
#   bridge.sh diff <edited.blend> --output <changes.bridge-delta.json> [--target-level <collection>]
#   bridge.sh validate <synced.blend> [--target-level <collection>]
#   bridge.sh test                      self-test: Euler order, round trips, sync and diff vs three.js
#
# Finds Blender via $BLENDER, then /Applications/Blender.app, then `blender` on PATH.
# Prints the bridge's JSON result and a RESULT ok|fail line; the exit status follows RESULT,
# because Blender's own exit status does not carry the script's.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(pwd)"
if [[ ! -f "$ROOT/package.json" ]]; then
  echo "FAIL run from the game project root (the folder with package.json)" >&2
  exit 2
fi

BL="${BLENDER:-}"
if [[ -z "$BL" ]]; then
  for c in /Applications/Blender.app/Contents/MacOS/Blender "$HOME/Applications/Blender.app/Contents/MacOS/Blender" "$(command -v blender || true)"; do
    if [[ -n "$c" && -x "$c" ]]; then BL="$c"; break; fi
  done
fi
if [[ -z "$BL" ]]; then
  echo "FAIL Blender not found. Install Blender 4.2+ or set BLENDER=/path/to/blender" >&2
  exit 3
fi

run() {
  # $1: .blend to open ('' for a factory scene); rest: blender_bridge.py arguments.
  local blend="$1"; shift
  local out
  if [[ -n "$blend" ]]; then
    [[ -f "$blend" ]] || { echo "FAIL no such .blend: $blend" >&2; return 1; }
    out="$(PYTHONDONTWRITEBYTECODE=1 "$BL" -b "$blend" --python "$HERE/blender_bridge.py" -- "$@" 2>&1 || true)"
  else
    out="$(PYTHONDONTWRITEBYTECODE=1 "$BL" -b --factory-startup --python "$HERE/blender_bridge.py" -- "$@" 2>&1 || true)"
  fi
  printf '%s\n' "$out" | grep -E '^(\{"ok"|RESULT |Traceback|[A-Za-z]*Error)' || true
  grep -q '^RESULT ok' <<<"$out" || { grep -q '^RESULT' <<<"$out" || echo "FAIL Blender exited without a RESULT line"; return 1; }
}

cmd="${1:-}"
shift || true
case "$cmd" in
  sync-from-genesys)
    from=""
    args=()
    while [[ $# -gt 0 ]]; do
      if [[ "$1" == "--from" ]]; then from="$2"; shift 2; else args+=("$1"); shift; fi
    done
    run "$from" sync-from-genesys --project-root "$ROOT" "${args[@]}"
    ;;
  diff|validate)
    [[ -n "${1:-}" ]] || { echo "usage: bridge.sh $cmd <file.blend> [...]" >&2; exit 2; }
    blend="$1"; shift
    run "$blend" "$cmd" "$@"
    ;;
  test)
    node "$HERE/test_euler_roundtrip.mjs" --project-root "$ROOT" --blender "$BL" "$@"
    ;;
  *)
    sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 2
    ;;
esac
