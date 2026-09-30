#!/usr/bin/env python3
"""Merge compressed Genesys bridge extraction chunks into one manifest."""

from __future__ import annotations

import argparse
import base64
import gzip
import json
import sys
from pathlib import Path
from typing import Any


class MergeError(RuntimeError):
    pass


SUPPORTED_CLASSES = {
    "ENGINE.SceneNode",
    "ENGINE.MeshNode",
    "ENGINE.ModelMeshNode",
}


def is_light_class(class_name: str) -> bool:
    return isinstance(class_name, str) and class_name.startswith("ENGINE.") and class_name.endswith("LightNode")


def is_supported_class(class_name: str) -> bool:
    return class_name in SUPPORTED_CLASSES or is_light_class(class_name)


def load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def decode_chunk(raw: Any) -> dict[str, Any]:
    """Accept either a compressed MCP wrapper or a plain chunk object."""
    if not isinstance(raw, dict):
        raise MergeError("Chunk root must be an object")

    # Genesys run_script wrappers often nest under result.
    if "result" in raw and isinstance(raw["result"], dict):
        raw = raw["result"]

    if raw.get("format") == "genesys-blender-bridge-chunk-compressed":
        payload = raw.get("payload")
        if not isinstance(payload, str) or not payload:
            raise MergeError("Compressed chunk is missing payload")
        try:
            decoded = gzip.decompress(base64.b64decode(payload, validate=True))
            chunk = json.loads(decoded.decode("utf-8"))
        except (ValueError, OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
            raise MergeError(f"Invalid compressed chunk payload: {error}") from error
    elif raw.get("format") == "genesys-blender-bridge-chunk":
        chunk = raw
    else:
        raise MergeError(f"Unsupported chunk format: {raw.get('format')!r}")

    if chunk.get("format") != "genesys-blender-bridge-chunk":
        raise MergeError("Decoded payload is not a bridge chunk")
    if chunk.get("version") != 1:
        raise MergeError(f"Unsupported chunk version: {chunk.get('version')!r}")
    return chunk


def validate_record(record: dict[str, Any], known_ids: set[str]) -> None:
    required = [
        "id",
        "name",
        "className",
        "outlineOrder",
        "position",
        "rotation",
        "scale",
    ]
    for key in required:
        if key not in record:
            raise MergeError(f"Record missing {key}: {record.get('id')}")
    if not is_supported_class(record["className"]):
        raise MergeError(
            f"Unsupported class {record['className']!r} on {record['id']}"
        )
    parent_id = record.get("parentId")
    bridge_parent = record.get("bridgeParentId")
    if parent_id and parent_id not in known_ids:
        # Parent may appear in a later/earlier chunk; checked again after merge.
        pass
    if parent_id and bridge_parent not in (None, parent_id):
        # Soft warning path: under the actor-ancestry rule these must match.
        # Enforce after full merge when the full ID set is known.
        pass
    for key in ("position", "rotation", "scale"):
        value = record[key]
        if not isinstance(value, list) or len(value) < 3:
            raise MergeError(f"Record {record['id']} has invalid {key}")


def merge_chunks(chunk_paths: list[Path]) -> dict[str, Any]:
    chunks = [decode_chunk(load_json(path)) for path in chunk_paths]
    chunks.sort(key=lambda item: item["offset"])
    if not chunks:
        raise MergeError("No chunks provided")

    first = chunks[0]
    records: list[dict[str, Any]] = []
    seen_ids: set[str] = set()
    next_offset = 0
    skipped_by: dict[str, int] = {}
    skipped_count = 0

    for chunk in chunks:
        for key in ("sourceScene", "total", "inventoryHash"):
            if chunk.get(key) != first.get(key):
                raise MergeError(
                    f"Chunk mismatch on {key}: {chunk.get(key)!r} vs {first.get(key)!r}"
                )
        if chunk["offset"] != next_offset:
            raise MergeError(
                f"Non-contiguous chunk offset {chunk['offset']} (expected {next_offset})"
            )
        if chunk["count"] != len(chunk.get("records") or []):
            raise MergeError(
                f"Chunk at offset {chunk['offset']} count mismatch"
            )
        for record in chunk["records"]:
            validate_record(record, seen_ids)
            if record["id"] in seen_ids:
                raise MergeError(f"Duplicate record id {record['id']}")
            seen_ids.add(record["id"])
            records.append(record)
        next_offset += chunk["count"]
        skipped_count = max(skipped_count, int(chunk.get("skippedCount") or 0))
        for key, value in (chunk.get("skippedByBlockingClass") or {}).items():
            skipped_by[key] = max(skipped_by.get(key, 0), int(value))

    if len(records) != first["total"]:
        raise MergeError(
            f"Expected {first['total']} records, assembled {len(records)}"
        )

    # Contiguous outlineOrder covering 0..N-1 after sort.
    ordered = sorted(records, key=lambda item: item["outlineOrder"])
    for index, record in enumerate(ordered):
        if record["outlineOrder"] != index:
            raise MergeError(
                f"outlineOrder hole at {index}: found {record['outlineOrder']}"
            )

    records_by_id = {record["id"]: record for record in ordered}
    known_ids = set(records_by_id)
    for record in ordered:
        parent_id = record.get("parentId")
        if parent_id and parent_id not in known_ids:
            raise MergeError(
                f"parentId {parent_id} for {record['id']} is not mirrored "
                "(actor-ancestry invariant broken)"
            )
        bridge_parent = record.get("bridgeParentId")
        if parent_id is None:
            if bridge_parent not in (None,):
                raise MergeError(
                    f"Root {record['id']} has non-null bridgeParentId"
                )
        elif bridge_parent != parent_id:
            raise MergeError(
                f"bridgeParentId mismatch for {record['id']}: "
                f"{bridge_parent} != {parent_id}"
            )
        elif records_by_id[parent_id]["className"] not in SUPPORTED_CLASSES:
            raise MergeError(
                f"Parent {parent_id} for {record['id']} is not a mirrorable "
                "SceneNode/MeshNode/ModelMeshNode"
            )

    manifest = {
        "format": "genesys-blender-bridge",
        "version": 1,
        "sourceScene": first["sourceScene"],
        "totalNodes": first.get("totalNodes"),
        "inventoryHash": first["inventoryHash"],
        "skippedCount": skipped_count,
        "skippedByBlockingClass": skipped_by,
        "rootOrderSource": first.get("rootOrderSource"),
        "records": ordered,
    }
    return manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "chunks",
        nargs="+",
        type=Path,
        help="Chunk JSON files (compressed MCP wrappers or plain chunks)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        required=True,
        help="Merged manifest output path",
    )
    args = parser.parse_args(argv)

    try:
        manifest = merge_chunks(args.chunks)
    except MergeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}), file=sys.stderr)
        return 1

    args.output.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    print(
        json.dumps(
            {
                "ok": True,
                "output": str(args.output),
                "records": len(manifest["records"]),
                "sourceScene": manifest["sourceScene"],
                "inventoryHash": manifest["inventoryHash"],
                "skippedCount": manifest.get("skippedCount", 0),
            },
            separators=(",", ":"),
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
