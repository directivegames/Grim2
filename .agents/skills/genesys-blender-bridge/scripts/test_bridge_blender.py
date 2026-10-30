"""Blender half of the bridge self-test. Started by test_euler_roundtrip.mjs; not run by hand.

    blender -b --factory-startup --python test_bridge_blender.py -- <cases.json> <results.json> <work-dir>

Reads the cases three.js produced, runs them through blender_bridge.py's real conversion,
sync and diff code, and writes what Blender produced. The Node half compares it with three.js.
"""
from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

import bpy
from mathutils import Euler, Matrix

sys.path.insert(0, str(Path(__file__).resolve().parent))
import blender_bridge as bridge  # noqa: E402


def rows(matrix: Matrix) -> list[list[float]]:
    return [[float(matrix[r][c]) for c in range(4)] for r in range(4)]


def from_rows(values: list[list[float]]) -> Matrix:
    return Matrix([[float(v) for v in row] for row in values])


def conversion_cases(cases: list[dict]) -> list[dict]:
    out = []
    for case in cases:
        record = {"position": case["position"], "rotation": case["rotation"], "scale": case["scale"]}
        obj = bpy.data.objects.new(f"case_{case['id']}", None)
        bpy.context.scene.collection.objects.link(obj)
        obj.matrix_world = bridge._genesys_transform_to_blender_matrix(record)
        bpy.context.view_layer.update()
        back = bridge._blender_matrix_to_genesys_transform(obj.matrix_world)
        # What the pre-fix code did: read three.js 'XYZ' as Blender 'XYZ'.
        legacy_rotation = bridge._genesys_rotation_matrix_to_blender(
            Euler(tuple(float(v) for v in case["rotation"]), "XYZ").to_matrix()
        )
        out.append(
            {
                "id": case["id"],
                "blenderWorld": rows(obj.matrix_world),
                "roundTrip": back,
                "legacyBlenderRotation": [[float(legacy_rotation[r][c]) for c in range(3)] for r in range(3)],
            }
        )
    return out


def export_test_model(work: Path) -> str:
    """A small project with one GLB, so additions can be linked duplicates of a library source."""
    models = work / "project" / "assets" / "models"
    models.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mesh = bridge._box_mesh(1.0, 2.0, 0.5)
    obj = bpy.data.objects.new("crate", mesh)
    bpy.context.scene.collection.objects.link(obj)
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.export_scene.gltf(filepath=str(models / "crate.glb"), export_format="GLB", use_selection=True)
    bpy.ops.wm.read_factory_settings(use_empty=False)  # factory scene: Cube/Camera/Light, as a user starts
    return "@project/assets/models/crate.glb"


def sync_and_diff(spec: dict, work: Path) -> dict:
    model_url = export_test_model(work)
    manifest = spec["manifest"]
    for record in manifest["records"]:
        if record.get("modelUrl") == "<TEST_MODEL>":
            record["modelUrl"] = model_url
    manifest_path = work / "manifest.json"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")
    blend = work / "mirror.blend"
    args = argparse.Namespace(
        manifest=str(manifest_path),
        project_root=str(work / "project"),
        output=str(blend),
        target_level=None,
        overwrite=True,
        replace_untagged=False,
    )
    first = bridge.sync_from_genesys(args)
    # Sync again into the same file: names must come back without .001 suffixes.
    second = bridge.sync_from_genesys(args)
    validation = bridge.validate(argparse.Namespace(target_level=None))
    by_id = {str(obj.get("genesys_node_id")): obj for obj in bpy.data.objects if obj.get("genesys_node_id")}
    # Mesh extents in the node's own Genesys axes: Blender local (bx, by, bz) is Genesys (bx, bz, -by).
    extents = {}
    for node_id, obj in by_id.items():
        if obj.type != "MESH" or obj.get("genesys_library_source"):
            continue
        xs = [v.co.x for v in obj.data.vertices]
        ys = [v.co.z for v in obj.data.vertices]
        zs = [-v.co.y for v in obj.data.vertices]
        extents[node_id] = [max(xs) - min(xs), max(ys) - min(ys), max(zs) - min(zs)]
    name_counts: dict[str, int] = {}
    for record in manifest["records"]:
        name_counts[record["name"]] = name_counts.get(record["name"], 0) + 1
    # Unique Genesys names come back exactly; shared names get Blender's .001 once, not more.
    names_restored = all(
        by_id[str(r["id"])].name == r["name"]
        if name_counts[r["name"]] == 1
        else bridge.clean_numeric_suffix(by_id[str(r["id"])].name) == r["name"]
        and by_id[str(r["id"])].name in {r["name"], f"{r['name']}.001"}
        for r in manifest["records"]
    )

    # Edits a user would make: move/rotate one child, and place a linked duplicate of the
    # library model under the rotated parent SceneNode (Alt+D, then parent).
    edits = spec["edits"]
    moved = by_id[edits["move"]["id"]]
    moved.matrix_world = from_rows(edits["move"]["blenderWorld"])
    source = bridge._find_library_source(model_url)
    added = source.copy()
    added.data = source.data
    for key in ("genesys_library_source",):
        if key in added:
            del added[key]
    added.name = "crate_added"
    scene_collection = bridge._find_scene_collection(None, manifest["sourceScene"])
    scene_collection.objects.link(added)
    for collection in list(added.users_collection):
        if collection is not scene_collection:
            collection.objects.unlink(added)
    parent = by_id[edits["add"]["parentId"]]
    added.parent = parent
    added.matrix_parent_inverse = Matrix.Identity(4)
    added.matrix_world = from_rows(edits["add"]["blenderWorld"])
    # A plain Blender duplicate of a mirrored model instance: it inherits genesys_node_id.
    original_instance = by_id[edits["duplicate"]["id"]]
    copy = original_instance.copy()
    copy.data = original_instance.data
    scene_collection.objects.link(copy)
    copy.matrix_world = from_rows(edits["duplicate"]["blenderWorld"])
    bpy.context.view_layer.update()
    delta = bridge.diff(argparse.Namespace(target_level=None, output=str(work / "changes.bridge-delta.json")))
    return {
        "firstSync": {k: first.get(k) for k in ("ok", "records", "placeholders", "librarySkipped", "transformValidation")},
        "secondSync": {k: second.get(k) for k in ("ok", "records", "placeholders")},
        "validation": {k: validation.get(k) for k in ("ok", "maxPositionError", "maxRotationError", "hierarchy_issues")},
        "namesRestored": names_restored,
        "extents": extents,
        "objectNames": sorted(obj.name for obj in scene_collection.objects),
        "delta": delta,
        "copyName": copy.name,
    }


def main() -> int:
    argv = sys.argv[sys.argv.index("--") + 1 :]
    cases_path, results_path, work = Path(argv[0]), Path(argv[1]), Path(argv[2])
    spec = json.loads(cases_path.read_text(encoding="utf-8"))
    results: dict = {}
    try:
        results["conversion"] = conversion_cases(spec["cases"])
        results["sync"] = sync_and_diff(spec["sync"], work)
        results["ok"] = True
    except Exception as error:  # noqa: BLE001 - reported to the Node half
        results["ok"] = False
        results["error"] = f"{type(error).__name__}: {error}"
        results["traceback"] = traceback.format_exc()
    results_path.write_text(json.dumps(results), encoding="utf-8")
    print(f"RESULT {'ok' if results['ok'] else 'fail'}")
    return 0


if __name__ == "__main__":
    main()
