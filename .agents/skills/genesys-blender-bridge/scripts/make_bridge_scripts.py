#!/usr/bin/env python3
"""Write ready-to-submit Genesys run_script bodies for the Blender bridge.

Run from the game project root with python3 (no Blender needed):

  python3 make_bridge_scripts.py extract --offset 0 [--count 40]
      -> .scratch/blender-bridge/run/extract-0000.js   (submit with run_script(readOnly))

  python3 make_bridge_scripts.py apply --delta .scratch/blender-bridge/changes.bridge-delta.json \
      [--deletions approved-deletions.json] [--max-units 80] [--max-chars 90000]
      -> .scratch/blender-bridge/run/apply-01.preview.js, apply-01.apply.js, ..., apply-index.json

Limits it respects: run_script code <= 100,000 characters (bodies stay under --max-chars) and the
MCP client's 300 s abort (about 0.6 s per mutation: a transform change costs 1 unit, an addition
3, a deletion 1; batches stay under --max-units). A changed parent and its changed descendants
share one batch, all transform changes come before additions, and deletions go last, so every
batch's conflict checks see the scene the previous batches left. Prints one JSON summary line.
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
EXTRACT_TEMPLATE = HERE / "extract_genesys_scene.js"
APPLY_TEMPLATE = HERE / "apply_genesys_delta.js"
DEFAULT_OUT = Path(".scratch") / "blender-bridge" / "run"
CODE_LIMIT = 100_000


def _inject(template: str, replacements: dict[str, str]) -> str:
    for old, new in replacements.items():
        if template.count(old) != 1:
            raise SystemExit(f"template line not found exactly once: {old}")
        template = template.replace(old, new)
    return template


def extract(args: argparse.Namespace) -> dict:
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    body = _inject(
        EXTRACT_TEMPLATE.read_text(encoding="utf-8"),
        {"const OFFSET = 0;": f"const OFFSET = {int(args.offset)};", "const COUNT = 40;": f"const COUNT = {int(args.count)};"},
    )
    path = out / f"extract-{int(args.offset):04d}.js"
    path.write_text(body, encoding="utf-8")
    return {"ok": True, "script": str(path), "chars": len(body)}


def _load_delta(path: Path) -> dict:
    delta = json.loads(path.read_text(encoding="utf-8"))
    if delta.get("format") != "genesys-blender-bridge-delta":
        raise SystemExit(f"{path} is not a genesys-blender-bridge-delta (run blender_bridge.py diff)")
    return delta


def _change_groups(changes: list[dict]) -> list[list[dict]]:
    """Each changed node joins the group of its nearest changed ancestor, in delta order."""
    by_id = {change["id"]: change for change in changes}
    root_of: dict[str, str] = {}

    def root(change_id: str) -> str:
        if change_id in root_of:
            return root_of[change_id]
        parent = by_id[change_id].get("parentId")
        root_of[change_id] = root(parent) if parent in by_id else change_id
        return root_of[change_id]

    groups: dict[str, list[dict]] = {}
    for change in changes:
        groups.setdefault(root(change["id"]), []).append(change)
    return list(groups.values())


def apply(args: argparse.Namespace) -> dict:
    delta = _load_delta(Path(args.delta))
    deletions = json.loads(Path(args.deletions).read_text(encoding="utf-8")) if args.deletions else []
    if not isinstance(deletions, list) or any(not {"id", "name", "className"} <= set(d) for d in deletions):
        raise SystemExit("--deletions must be a JSON list of { id, name, className } the user approved")
    template = APPLY_TEMPLATE.read_text(encoding="utf-8")
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    for old in out.glob("apply-*.js"):
        old.unlink()

    # Work items in dependency order: change groups, then additions, then one deletion item.
    items: list[tuple[str, list[dict], int]] = [("changes", group, len(group)) for group in _change_groups(delta.get("changes") or [])]
    items += [("additions", [addition], 3) for addition in delta.get("additions") or []]
    if deletions:
        items.append(("deletions", deletions, len(deletions)))

    def render(batch: dict, apply_flag: bool) -> str:
        body_delta = {
            "format": delta["format"],
            "version": delta.get("version", 1),
            "sourceScene": delta.get("sourceScene"),
            "batch": batch["label"],
            "changes": batch["changes"],
            "additions": batch["additions"],
            "unsupported": batch["unsupported"],
            "missingBaselineIds": batch["missingBaselineIds"],
        }
        return _inject(
            template,
            {
                "const DELTA = null;": f"const DELTA = {json.dumps(body_delta, separators=(',', ':'))};",
                "const APPLY = false;": f"const APPLY = {'true' if apply_flag else 'false'};",
                "const DELETIONS = [];": f"const DELETIONS = {json.dumps(batch['deletions'], separators=(',', ':'))};",
            },
        )

    def empty_batch() -> dict:
        return {"changes": [], "additions": [], "deletions": [], "units": 0, "unsupported": [], "missingBaselineIds": []}

    batches: list[dict] = []
    current = empty_batch()
    for kind, records, units in items:
        trial = {**current, kind: current[kind] + records, "label": "?"}
        too_many_units = current["units"] and current["units"] + units > args.max_units
        too_long = current["units"] and len(render(trial, True)) > args.max_chars
        if too_many_units or too_long:
            batches.append(current)
            current = empty_batch()
        current[kind] = current[kind] + records
        current["units"] += units
    if current["units"] or not batches:
        batches.append(current)
    # Informational lists ride in the first batch only.
    batches[0]["unsupported"] = delta.get("unsupported") or []
    batches[0]["missingBaselineIds"] = delta.get("missingBaselineIds") or []

    index = []
    for number, batch in enumerate(batches, start=1):
        batch["label"] = f"{number:02d}/{len(batches):02d}"
        entry = {"batch": batch["label"], "units": batch["units"], "changes": len(batch["changes"]), "additions": len(batch["additions"]), "deletions": len(batch["deletions"])}
        for mode, flag in (("preview", False), ("apply", True)):
            body = render(batch, flag)
            if len(body) > CODE_LIMIT:
                raise SystemExit(f"batch {batch['label']} is {len(body)} characters (> {CODE_LIMIT}); lower --max-units")
            path = out / f"apply-{number:02d}.{mode}.js"
            path.write_text(body, encoding="utf-8")
            entry[mode] = str(path)
            entry[f"{mode}Chars"] = len(body)
        index.append(entry)
    (out / "apply-index.json").write_text(json.dumps(index, indent=2), encoding="utf-8")
    return {"ok": True, "batches": len(batches), "index": str(out / "apply-index.json"), "plan": index}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = parser.add_subparsers(dest="command", required=True)
    ex = sub.add_parser("extract", help="extract body for one chunk")
    ex.add_argument("--offset", type=int, required=True, help="first record (0, then each response's nextOffset)")
    ex.add_argument("--count", type=int, default=40, help="records per chunk (default 40; the body shrinks it if the payload is too big)")
    ex.add_argument("--out", default=str(DEFAULT_OUT))
    ap = sub.add_parser("apply", help="preview/apply bodies for a reviewed delta, in batches")
    ap.add_argument("--delta", required=True, help="delta JSON written by blender_bridge.py diff --output")
    ap.add_argument("--deletions", help="JSON list of { id, name, className } the user explicitly approved")
    ap.add_argument("--max-units", type=int, default=80, help="mutation units per batch (change 1, addition 3, deletion 1)")
    ap.add_argument("--max-chars", type=int, default=90_000, help="max characters per run_script body")
    ap.add_argument("--out", default=str(DEFAULT_OUT))
    args = parser.parse_args(argv)
    result = extract(args) if args.command == "extract" else apply(args)
    print(json.dumps(result, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    sys.exit(main())
