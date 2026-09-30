from __future__ import annotations

import argparse
import json
import math
import re
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import bpy
from mathutils import Euler, Matrix, Quaternion, Vector


MANIFEST_FORMAT = "genesys-blender-bridge"
MANIFEST_VERSION = 1
DELTA_FORMAT = "genesys-blender-bridge-delta"
DELTA_VERSION = 1
BASELINE_TEXT_NAME = "GENESYS_BRIDGE_BASELINE"
SOURCE_SCENE_PROP = "genesys_source_scene"
GUIDE_TEXT = (
    "THESE ARE YOUR PROJECT ASSETS:\n"
    "INSTANCE THESE (ALT+D) AND MOVE INTO THE SCENE FOLDER"
)
GUIDE_PROP = "genesys_library_guide"
LOGICAL_PATH_PROP = "genesys_logical_path"
POSITION_SCALE_EPSILON = 1e-5
ROTATION_EPSILON = 1e-3
NUMERIC_SUFFIX_RE = re.compile(r"^(?P<base>.+?)\.(?P<suffix>\d{3})$")
BASIS_A = Matrix(((1.0, 0.0, 0.0), (0.0, 0.0, 1.0), (0.0, -1.0, 0.0)))
BASIS_A_T = BASIS_A.transposed()
SUPPORTED_SCENE_CLASSES = {
    "ENGINE.SceneNode",
    "ENGINE.ModelMeshNode",
    "ENGINE.MeshNode",
}
LIGHT_CLASS_RE = re.compile(r"^ENGINE\..*LightNode$")


class BridgeError(RuntimeError):
    """Raised for bridge failures that should return structured JSON."""


def _json_dumps(payload: dict[str, Any]) -> str:
    return json.dumps(payload, separators=(",", ":"), ensure_ascii=True)


def _print_json_result(payload: dict[str, Any]) -> None:
    sys.stdout.write(_json_dumps(payload) + "\n")
    sys.stdout.flush()


def _operation_result(operation: str, **payload: Any) -> dict[str, Any]:
    result = {"ok": True, "operation": operation}
    result.update(payload)
    return result


def _error_result(operation: str, error: Exception) -> dict[str, Any]:
    return {
        "ok": False,
        "operation": operation,
        "errorType": type(error).__name__,
        "error": str(error),
    }


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise BridgeError(message)


def _as_path(value: Any, *, label: str) -> Path:
    if isinstance(value, Path):
        return value
    if isinstance(value, str) and value:
        return Path(value)
    raise BridgeError(f"Missing {label}")


def _normalize_project_root(value: Any) -> Path:
    path = _as_path(value, label="project_root").expanduser().resolve()
    _require(path.exists(), f"Project root does not exist: {path}")
    return path


def _normalize_output_path(value: Any | None) -> Path | None:
    if value in (None, ""):
        return None
    return _as_path(value, label="output").expanduser().resolve()


def _normalize_posix_path(path: str) -> str:
    return path.replace("\\", "/")


def _scene_collection_name_from_source(source_scene: str) -> str:
    source_scene = _normalize_posix_path(source_scene)
    name = source_scene.rsplit("/", 1)[-1]
    _require(bool(name), f"Invalid sourceScene: {source_scene}")
    return name


def _target_scene_name(source_scene: str | None, target_level: str | None) -> str:
    if target_level:
        return str(target_level)
    _require(bool(source_scene), "Target scene collection is unknown")
    return _scene_collection_name_from_source(str(source_scene))


def _is_light_class(class_name: str | None) -> bool:
    return bool(class_name and LIGHT_CLASS_RE.match(class_name))


def _is_supported_record_class(class_name: str | None) -> bool:
    return class_name in SUPPORTED_SCENE_CLASSES or _is_light_class(class_name)


def _coerce_json(value: Any) -> Any:
    if isinstance(value, str):
        text = value.strip()
        if not text:
            return value
        if text[0] not in "{[":
            return value
        try:
            return json.loads(text)
        except json.JSONDecodeError:
            return value
    return value


def _vector3(value: Iterable[Any], *, fallback: tuple[float, float, float]) -> Vector:
    numbers = [float(part) for part in value]
    if len(numbers) < 3:
        numbers = list(numbers) + [0.0] * (3 - len(numbers))
    return Vector((numbers[0], numbers[1], numbers[2])) if numbers else Vector(fallback)


def _transform_dict(position: Iterable[Any], rotation: Iterable[Any], scale: Iterable[Any]) -> dict[str, list[float]]:
    return {
        "position": [float(v) for v in position],
        "rotation": [float(v) for v in rotation],
        "scale": [float(v) for v in scale],
    }


def _genesys_position_to_blender(position: Iterable[Any]) -> Vector:
    gx, gy, gz = [float(v) for v in position]
    return Vector((gx, -gz, gy))


def _blender_position_to_genesys(position: Vector) -> Vector:
    return Vector((position.x, position.z, -position.y))


def _genesys_scale_to_blender(scale: Iterable[Any]) -> Vector:
    sx, sy, sz = [float(v) for v in scale]
    return Vector((sx, sz, sy))


def _blender_scale_to_genesys(scale: Vector) -> Vector:
    return Vector((scale.x, scale.z, scale.y))


def _genesys_rotation_matrix_to_blender(rotation_genesys: Matrix) -> Matrix:
    return BASIS_A_T @ rotation_genesys @ BASIS_A


def _blender_rotation_matrix_to_genesys(rotation_blender: Matrix) -> Matrix:
    return BASIS_A @ rotation_blender @ BASIS_A_T


def _genesys_euler_to_blender_euler(rotation: Iterable[Any]) -> Euler:
    genesys_euler = Euler(tuple(float(v) for v in rotation), "XYZ")
    blender_matrix = _genesys_rotation_matrix_to_blender(genesys_euler.to_matrix())
    return blender_matrix.to_euler("XYZ")


def _blender_euler_to_genesys_euler(rotation: Euler) -> Euler:
    genesys_matrix = _blender_rotation_matrix_to_genesys(rotation.to_matrix())
    return genesys_matrix.to_euler("XYZ")


def _genesys_transform_to_blender_matrix(transform: dict[str, Any]) -> Matrix:
    position = _genesys_position_to_blender(transform["position"])
    rotation = _genesys_euler_to_blender_euler(transform["rotation"])
    scale = _genesys_scale_to_blender(transform["scale"])
    return Matrix.LocRotScale(position, rotation, scale)


def _blender_matrix_to_genesys_transform(matrix_world: Matrix) -> dict[str, list[float]]:
    location, rotation, scale = matrix_world.decompose()
    genesys_position = _blender_position_to_genesys(location)
    genesys_rotation = _blender_rotation_matrix_to_genesys(rotation.to_matrix()).to_euler("XYZ")
    genesys_scale = _blender_scale_to_genesys(scale)
    return _transform_dict(genesys_position, genesys_rotation, genesys_scale)


def _genesys_transform_to_matrix(transform: dict[str, Any]) -> Matrix:
    position = Vector(tuple(float(v) for v in transform["position"]))
    rotation = Euler(tuple(float(v) for v in transform["rotation"]), "XYZ")
    scale = Vector(tuple(float(v) for v in transform["scale"]))
    return Matrix.LocRotScale(position, rotation, scale)


def _angular_distance(left: Quaternion, right: Quaternion) -> float:
    # q and -q encode the same orientation. Measure the shortest arc so
    # equivalent quaternion signs cannot appear as a 2π rotation error.
    dot = abs(left.normalized().dot(right.normalized()))
    return 2.0 * math.acos(max(-1.0, min(1.0, dot)))


def _transform_error(left: dict[str, Any], right: dict[str, Any]) -> tuple[float, float, float]:
    left_position = Vector(tuple(float(v) for v in left["position"]))
    right_position = Vector(tuple(float(v) for v in right["position"]))
    left_scale = Vector(tuple(float(v) for v in left["scale"]))
    right_scale = Vector(tuple(float(v) for v in right["scale"]))
    left_quat = Euler(tuple(float(v) for v in left["rotation"]), "XYZ").to_quaternion()
    right_quat = Euler(tuple(float(v) for v in right["rotation"]), "XYZ").to_quaternion()
    position_error = max(abs(a - b) for a, b in zip(left_position, right_position))
    scale_error = max(abs(a - b) for a, b in zip(left_scale, right_scale))
    rotation_error = _angular_distance(left_quat, right_quat)
    return position_error, scale_error, rotation_error


def _transform_changed(left: dict[str, Any], right: dict[str, Any]) -> bool:
    position_error, scale_error, rotation_error = _transform_error(left, right)
    return (
        position_error > POSITION_SCALE_EPSILON
        or scale_error > POSITION_SCALE_EPSILON
        or rotation_error > ROTATION_EPSILON
    )


def _identity_transform() -> dict[str, list[float]]:
    return {"position": [0.0, 0.0, 0.0], "rotation": [0.0, 0.0, 0.0], "scale": [1.0, 1.0, 1.0]}


def _ensure_object_mode() -> None:
    context_obj = bpy.context.object
    if context_obj and context_obj.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")


def clean_numeric_suffix(name: str) -> str:
    match = NUMERIC_SUFFIX_RE.match(name)
    return match.group("base") if match else name


def resolve_asset_path(url: str, project_root: Path | str) -> Path:
    project_root = _normalize_project_root(project_root)
    logical = _normalize_posix_path(str(url))
    if logical.startswith("@project/assets/"):
        relative = PurePosixPath(logical[len("@project/") :])
        return project_root / Path(*relative.parts)
    if logical.startswith("@engine/assets/"):
        relative = PurePosixPath(logical[len("@engine/assets/") :])
        return project_root / "node_modules" / "@gnsx" / "genesys.js" / "assets" / Path(*relative.parts)
    raise BridgeError(f"Unsupported asset URL: {url}")


def _resolve_import_asset_path(url: str, project_root: Path) -> tuple[Path, Path | None]:
    primary = resolve_asset_path(url, project_root)
    if primary.exists():
        return primary, None
    if not (_normalize_posix_path(url).startswith("@engine/assets/") and primary.suffix.lower() == ".glb"):
        raise BridgeError(f"Asset not found: {primary}")
    candidates = list((project_root / "assets").rglob(primary.name))
    if len(candidates) == 1:
        return candidates[0], primary
    raise BridgeError(f"Asset not found for {url}: {primary}")


def _load_json_file(path: Path) -> dict[str, Any]:
    _require(path.exists(), f"Missing file: {path}")
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise BridgeError(f"Invalid JSON in {path}: {error}") from error


def _validate_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    _require(manifest.get("format") == MANIFEST_FORMAT, "Manifest format must be genesys-blender-bridge")
    _require(manifest.get("version") == MANIFEST_VERSION, "Manifest version must be 1")
    records = manifest.get("records")
    _require(isinstance(records, list), "Manifest records must be a list")
    ids = set()
    parent_id_invariant_ok = True
    for index, record in enumerate(records):
        _require(isinstance(record, dict), f"Record {index} must be an object")
        for key in ("id", "name", "className", "position", "rotation", "scale", "outlineOrder"):
            _require(key in record, f"Record {index} missing {key}")
        node_id = str(record["id"])
        _require(node_id not in ids, f"Duplicate record id {node_id}")
        ids.add(node_id)
        _require(_is_supported_record_class(str(record["className"])), f"Unsupported class {record['className']}")
    for record in records:
        parent_id = record.get("parentId")
        if parent_id and str(parent_id) not in ids:
            parent_id_invariant_ok = False
            break
        bridge_parent_id = record.get("bridgeParentId")
        if (str(bridge_parent_id) if bridge_parent_id else None) != (
            str(parent_id) if parent_id else None
        ):
            parent_id_invariant_ok = False
            break
        if parent_id:
            parent_record = next(
                (item for item in records if str(item["id"]) == str(parent_id)),
                None,
            )
            if (
                parent_record is None
                or parent_record.get("className") not in SUPPORTED_SCENE_CLASSES
            ):
                parent_id_invariant_ok = False
                break
    _require(
        parent_id_invariant_ok,
        "Manifest parentId/bridgeParentId must identify a mirrored "
        "SceneNode/MeshNode/ModelMeshNode parent",
    )
    return {
        "recordCount": len(records),
        "parentIdInvariantOk": parent_id_invariant_ok,
    }


def _load_manifest(path: Path | str) -> dict[str, Any]:
    manifest_path = _as_path(path, label="manifest").expanduser().resolve()
    manifest = _load_json_file(manifest_path)
    _validate_manifest(manifest)
    return manifest


def _baseline_text_block() -> bpy.types.Text | None:
    return bpy.data.texts.get(BASELINE_TEXT_NAME)


def _load_baseline_manifest() -> dict[str, Any]:
    text_block = _baseline_text_block()
    _require(text_block is not None, "Missing GENESYS_BRIDGE_BASELINE text block")
    try:
        manifest = json.loads(text_block.as_string())
    except json.JSONDecodeError as error:
        raise BridgeError(f"Invalid baseline JSON: {error}") from error
    _validate_manifest(manifest)
    return manifest


def _store_baseline_manifest(manifest: dict[str, Any]) -> None:
    payload = _json_dumps(manifest)
    text_block = _baseline_text_block()
    if text_block is None:
        text_block = bpy.data.texts.new(BASELINE_TEXT_NAME)
    text_block.clear()
    text_block.write(payload)
    bpy.context.scene[SOURCE_SCENE_PROP] = str(manifest.get("sourceScene", ""))


def _iter_scene_children(collection: bpy.types.Collection) -> list[bpy.types.Collection]:
    return list(collection.children)


def _find_child_collection(parent: bpy.types.Collection, name: str) -> bpy.types.Collection | None:
    matches = [child for child in parent.children if clean_numeric_suffix(child.name) == name]
    if len(matches) > 1:
        raise BridgeError(
            f"Duplicate collection branches under {parent.name}: {', '.join(child.name for child in matches)}"
        )
    if not matches:
        return None
    child = matches[0]
    if child.name != name:
        child.name = name
    return child


def _ensure_collection(parent: bpy.types.Collection, name: str, logical_path: str | None = None) -> bpy.types.Collection:
    existing = _find_child_collection(parent, name)
    if existing is None:
        existing = bpy.data.collections.new(name)
        parent.children.link(existing)
    if logical_path:
        existing[LOGICAL_PATH_PROP] = logical_path
    return existing


def _ensure_top_level_collection(name: str) -> bpy.types.Collection:
    scene_root = bpy.context.scene.collection
    existing = _find_child_collection(scene_root, name)
    if existing is None:
        existing = bpy.data.collections.new(name)
        scene_root.children.link(existing)
    if name in {"@engine", "@project"}:
        existing[LOGICAL_PATH_PROP] = name
    return existing


def _logical_folder_collection(logical_url: str) -> bpy.types.Collection:
    logical_url = _normalize_posix_path(logical_url)
    _require(logical_url.startswith("@project/") or logical_url.startswith("@engine/"), f"Invalid logical URL: {logical_url}")
    parts = logical_url.split("/")
    root_name = parts[0]
    folder_parts = parts[1:-1]
    collection = _ensure_top_level_collection(root_name)
    logical_path = root_name
    for part in folder_parts:
        logical_path = f"{logical_path}/{part}"
        collection = _ensure_collection(collection, part, logical_path=logical_path)
    return collection


def _find_collection_by_name(name: str) -> bpy.types.Collection | None:
    return bpy.data.collections.get(name)


def _find_collection_by_logical_path(logical_path: str) -> bpy.types.Collection | None:
    for collection in bpy.data.collections:
        if collection.get(LOGICAL_PATH_PROP) == logical_path:
            return collection
    return None


def _find_scene_collection(target_level: str | None = None, source_scene: str | None = None) -> bpy.types.Collection:
    collection_name = _target_scene_name(source_scene or bpy.context.scene.get(SOURCE_SCENE_PROP), target_level)
    collection = _find_collection_by_name(collection_name)
    _require(collection is not None, f"Missing scene collection: {collection_name}")
    return collection


def _delete_object(obj: bpy.types.Object) -> None:
    data = obj.data
    bpy.data.objects.remove(obj, do_unlink=True)
    if data and hasattr(data, "users") and data.users == 0:
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.Light):
            bpy.data.lights.remove(data)
        elif isinstance(data, bpy.types.Curve):
            bpy.data.curves.remove(data)


def _delete_collection_tree(collection: bpy.types.Collection) -> None:
    for child in list(collection.children):
        _delete_collection_tree(child)
    for obj in list(collection.objects):
        _delete_object(obj)
    bpy.data.collections.remove(collection)


def _is_bridge_tagged(obj: bpy.types.Object) -> bool:
    return any(
        key in obj
        for key in (
            "genesys_node_id",
            "genesys_asset_path",
            "genesys_library_source",
            "genesys_class_name",
            GUIDE_PROP,
        )
    )


def _is_factory_object(obj: bpy.types.Object) -> bool:
    return obj.name in {"Cube", "Camera", "Light"} and not _is_bridge_tagged(obj)


def remove_factory_starter_scene() -> dict[str, Any]:
    removed_objects: list[str] = []
    removed_collections: list[str] = []
    for name in ("Cube", "Camera", "Light"):
        obj = bpy.data.objects.get(name)
        if obj and _is_factory_object(obj):
            _delete_object(obj)
            removed_objects.append(name)
    factory_collection = bpy.data.collections.get("Collection")
    if factory_collection:
        tagged = any(_is_bridge_tagged(obj) for obj in factory_collection.all_objects)
        has_named_factory = all(obj.name in {"Cube", "Camera", "Light"} for obj in factory_collection.all_objects)
        if not tagged and (len(factory_collection.all_objects) == 0 or has_named_factory):
            _delete_collection_tree(factory_collection)
            removed_collections.append("Collection")
    return {"removedObjects": removed_objects, "removedCollections": removed_collections}


def reorder_top_level_collections(scene_collection_or_name: bpy.types.Collection | str | None = None) -> dict[str, Any]:
    scene_root = bpy.context.scene.collection
    if isinstance(scene_collection_or_name, bpy.types.Collection):
        scene_name = scene_collection_or_name.name
    elif isinstance(scene_collection_or_name, str):
        scene_name = scene_collection_or_name
    else:
        scene_name = bpy.context.scene.get(SOURCE_SCENE_PROP)
        scene_name = _scene_collection_name_from_source(scene_name) if scene_name else None
    ordered_names = [name for name in ("@engine", "@project", scene_name) if name]
    current_children = list(scene_root.children)
    name_to_collection = {child.name: child for child in current_children}
    reordered = [name_to_collection[name] for name in ordered_names if name in name_to_collection]
    extras = [child for child in current_children if child.name not in ordered_names]
    # Importer scaffolding (glTF_not_exported) can survive a failed GLB import.
    # Drop it when empty; keep anything holding user content.
    purged = [child for child in extras if not child.objects and not child.children]
    reordered.extend(child for child in extras if child not in purged)
    for child in current_children:
        scene_root.children.unlink(child)
    for child in reordered:
        scene_root.children.link(child)
    purged_names = []
    for child in purged:
        purged_names.append(child.name)
        if child.users == 0:
            bpy.data.collections.remove(child)
    return {
        "order": [child.name for child in scene_root.children],
        "purgedEmpty": purged_names,
    }


def _space_settings() -> tuple[bool, bool]:
    relationship_lines_enabled = False
    alphabetical_sorting_enabled = False
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    overlay = getattr(space, "overlay", None)
                    if overlay and getattr(overlay, "show_relationship_lines", False):
                        relationship_lines_enabled = True
                if space.type == "OUTLINER" and getattr(space, "use_sort_alpha", False):
                    alphabetical_sorting_enabled = True
    return relationship_lines_enabled, alphabetical_sorting_enabled


def _apply_viewport_preferences() -> dict[str, Any]:
    affected = {"view3d": 0, "outliner": 0}
    for screen in bpy.data.screens:
        for area in screen.areas:
            for space in area.spaces:
                if space.type == "VIEW_3D":
                    overlay = getattr(space, "overlay", None)
                    if overlay and getattr(overlay, "show_relationship_lines", None) is not None:
                        overlay.show_relationship_lines = False
                        affected["view3d"] += 1
                if space.type == "OUTLINER" and getattr(space, "use_sort_alpha", None) is not None:
                    space.use_sort_alpha = False
                    affected["outliner"] += 1
    return affected


def existing_model_sources() -> list[str]:
    urls = {
        str(obj.get("genesys_asset_path"))
        for obj in bpy.data.objects
        if obj.get("genesys_asset_path")
        and _is_canonical_library_source(
            obj,
            str(obj.get("genesys_asset_path")),
        )
    }
    return sorted(urls)


def _all_project_model_urls(project_root: Path) -> list[str]:
    model_root = project_root / "assets" / "models"
    if not model_root.exists():
        return []
    urls = []
    for path in sorted(model_root.rglob("*.glb")):
        relative = path.relative_to(project_root).as_posix()
        urls.append(f"@project/{relative}")
    return urls


def _mirror_project_model_directories(project_root: Path) -> dict[str, Any]:
    urls = _all_project_model_urls(project_root)
    directories = {str(PurePosixPath(url).parent) for url in urls}
    for directory in sorted(directories):
        _logical_folder_collection(f"{directory}/__placeholder__.glb")
    return {"directoriesMirrored": len(directories)}


def _snapshot_data_block_ids() -> dict[str, set[str]]:
    return {
        "objects": {obj.name_full for obj in bpy.data.objects},
        "collections": {collection.name_full for collection in bpy.data.collections},
        "meshes": {mesh.name_full for mesh in bpy.data.meshes},
        "materials": {material.name_full for material in bpy.data.materials},
        "images": {image.name_full for image in bpy.data.images},
        "lights": {light.name_full for light in bpy.data.lights},
        "cameras": {camera.name_full for camera in bpy.data.cameras},
    }


def _cleanup_imported_data(snapshot: dict[str, set[str]]) -> None:
    for obj in list(bpy.data.objects):
        if obj.name_full not in snapshot["objects"]:
            _delete_object(obj)
    # Importer scaffolding such as glTF_not_exported is linked into the scene,
    # so users > 0. Unlink it before removal or it survives a failed import.
    for collection in list(bpy.data.collections):
        if collection.name_full in snapshot["collections"]:
            continue
        for parent in [bpy.context.scene.collection, *bpy.data.collections]:
            if parent is not collection and collection.name in parent.children:
                parent.children.unlink(collection)
        if collection.users == 0:
            bpy.data.collections.remove(collection)
    for mesh in list(bpy.data.meshes):
        if mesh.name_full not in snapshot["meshes"] and mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for material in list(bpy.data.materials):
        if material.name_full not in snapshot["materials"] and material.users == 0:
            bpy.data.materials.remove(material)
    for image in list(bpy.data.images):
        if image.name_full not in snapshot["images"] and image.users == 0:
            bpy.data.images.remove(image)
    for light in list(bpy.data.lights):
        if light.name_full not in snapshot["lights"] and light.users == 0:
            bpy.data.lights.remove(light)
    for camera in list(bpy.data.cameras):
        if camera.name_full not in snapshot["cameras"] and camera.users == 0:
            bpy.data.cameras.remove(camera)


def _remove_transient_import_collections(snapshot: dict[str, set[str]]) -> None:
    for collection in list(bpy.data.collections):
        if collection.name_full in snapshot["collections"]:
            continue
        if len(collection.objects) == 0 and len(collection.children) == 0 and collection.users <= 1:
            bpy.data.collections.remove(collection)


def _join_imported_meshes(mesh_objects: list[bpy.types.Object], name: str) -> bpy.types.Object:
    _ensure_object_mode()
    bpy.ops.object.select_all(action="DESELECT")
    for obj in mesh_objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = mesh_objects[0]
    result = bpy.ops.object.join()
    if "FINISHED" not in result:
        raise BridgeError(f"Unable to join imported meshes for {name}")
    joined = bpy.context.view_layer.objects.active
    # Capture the world matrix while still parented, then unparent before
    # baking. Assigning matrix_world under a parent only sets the basis, so
    # clearing the parent afterwards would resurrect the parent transform.
    world = joined.matrix_world.copy()
    joined.parent = None
    joined.matrix_parent_inverse = Matrix.Identity(4)
    joined.data.transform(world)
    joined.matrix_world = Matrix.Identity(4)
    joined.name = name
    if joined.data:
        joined.data.name = f"{name}.mesh"
        joined.data.update()
    bpy.ops.object.select_all(action="DESELECT")
    return joined


def _exclusive_link(obj: bpy.types.Object, collection: bpy.types.Collection) -> None:
    for linked_collection in list(obj.users_collection):
        if linked_collection is not collection:
            linked_collection.objects.unlink(obj)
    # bpy_prop_collection membership is keyed by name, so compare datablocks.
    if collection not in list(obj.users_collection):
        collection.objects.link(obj)


def _is_canonical_library_source(obj: bpy.types.Object, url: str) -> bool:
    if not bool(obj.get("genesys_library_source")):
        return False
    logical_folder = str(PurePosixPath(_normalize_posix_path(url)).parent)
    return any(
        collection.get(LOGICAL_PATH_PROP) == logical_folder
        for collection in obj.users_collection
    )


def _find_library_source(url: str) -> bpy.types.Object | None:
    matches = [
        obj
        for obj in bpy.data.objects
        if obj.get("genesys_asset_path") == url
        and _is_canonical_library_source(obj, url)
    ]
    if len(matches) > 1:
        raise BridgeError(f"Multiple library sources found for {url}")
    return matches[0] if matches else None


def _flatten_imported_model(url: str, import_path: Path, collection: bpy.types.Collection) -> bpy.types.Object:
    snapshot = _snapshot_data_block_ids()
    try:
        result = bpy.ops.import_scene.gltf(filepath=str(import_path))
        if "FINISHED" not in result:
            raise BridgeError(f"GLB import failed for {import_path}")
        new_objects = [obj for obj in bpy.data.objects if obj.name_full not in snapshot["objects"]]
        mesh_objects = [obj for obj in new_objects if obj.type == "MESH"]
        _require(mesh_objects, f"No meshes imported from {import_path}")
        if len(mesh_objects) == 1:
            source = mesh_objects[0]
            world = source.matrix_world.copy()
            source.parent = None
            source.matrix_parent_inverse = Matrix.Identity(4)
            source.data.transform(world)
            source.matrix_world = Matrix.Identity(4)
            source.name = Path(url).stem
            if source.data:
                source.data.name = f"{source.name}.mesh"
        else:
            source = _join_imported_meshes(mesh_objects, Path(url).stem)
        # join() frees the merged datablocks, so new_objects may hold dead
        # references by now. Re-resolve against live objects instead.
        for obj in list(bpy.data.objects):
            if obj is source:
                continue
            if obj.name_full not in snapshot["objects"]:
                _delete_object(obj)
        _remove_transient_import_collections(snapshot)
        # Geometry is baked, so rig/deform modifiers would only dangle at the
        # armature we just deleted.
        source.modifiers.clear()
        # This source is part of the browsable Z=-100 asset grid.
        source.hide_viewport = False
        source.hide_render = True
        source["genesys_asset_path"] = url
        source["genesys_library_source"] = 1
        source["genesys_class_name"] = "ENGINE.ModelMeshNode"
        _exclusive_link(source, collection)
        return source
    except Exception:
        _cleanup_imported_data(snapshot)
        raise


def _ensure_library_source(url: str, project_root: Path) -> tuple[bpy.types.Object | None, dict[str, Any] | None]:
    existing = _find_library_source(url)
    target_collection = _logical_folder_collection(url)
    if existing is not None:
        _exclusive_link(existing, target_collection)
        existing.hide_viewport = False
        existing.hide_render = True
        return existing, None
    try:
        import_path, fallback_path = _resolve_import_asset_path(url, project_root)
        source = _flatten_imported_model(url, import_path, target_collection)
        info = {
            "url": url,
            "importPath": str(import_path),
        }
        if fallback_path is not None:
            info["fallbackFrom"] = str(fallback_path)
        return source, info
    except Exception as error:
        return None, {"url": url, "error": str(error)}


def _mesh_local_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    _require(obj.type == "MESH" and obj.data is not None, f"Object is not a mesh: {obj.name}")
    vertices = obj.data.vertices
    _require(len(vertices) > 0, f"Mesh has no vertices: {obj.name}")
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    for vertex in vertices:
        co = vertex.co
        minimum.x = min(minimum.x, co.x)
        minimum.y = min(minimum.y, co.y)
        minimum.z = min(minimum.z, co.z)
        maximum.x = max(maximum.x, co.x)
        maximum.y = max(maximum.y, co.y)
        maximum.z = max(maximum.z, co.z)
    return minimum, maximum


def _world_bounds(objects: Iterable[bpy.types.Object]) -> tuple[Vector, Vector]:
    minimum = Vector((math.inf, math.inf, math.inf))
    maximum = Vector((-math.inf, -math.inf, -math.inf))
    points_found = False
    for obj in objects:
        if obj.type == "MESH" and obj.data is not None:
            low, high = _mesh_local_bounds(obj)
            corners = (
                Vector((low.x, low.y, low.z)),
                Vector((low.x, low.y, high.z)),
                Vector((low.x, high.y, low.z)),
                Vector((low.x, high.y, high.z)),
                Vector((high.x, low.y, low.z)),
                Vector((high.x, low.y, high.z)),
                Vector((high.x, high.y, low.z)),
                Vector((high.x, high.y, high.z)),
            )
        elif obj.type == "FONT":
            corners = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
        else:
            continue
        for corner in corners:
            point = corner if obj.type == "FONT" else obj.matrix_world @ corner
            minimum.x = min(minimum.x, point.x)
            minimum.y = min(minimum.y, point.y)
            minimum.z = min(minimum.z, point.z)
            maximum.x = max(maximum.x, point.x)
            maximum.y = max(maximum.y, point.y)
            maximum.z = max(maximum.z, point.z)
            points_found = True
    _require(points_found, "No world bounds available")
    return minimum, maximum


def _remove_existing_library_guides() -> None:
    for obj in list(bpy.data.objects):
        if bool(obj.get(GUIDE_PROP)):
            _delete_object(obj)


def _guide_material() -> bpy.types.Material:
    material = bpy.data.materials.get("GenesysBridgeGuideOrange")
    if material is None:
        material = bpy.data.materials.new("GenesysBridgeGuideOrange")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    principled = nodes.get("Principled BSDF")
    if principled is not None:
        if principled.inputs.get("Base Color"):
            principled.inputs["Base Color"].default_value = (1.0, 0.45, 0.05, 1.0)
        if principled.inputs.get("Emission Color"):
            principled.inputs["Emission Color"].default_value = (1.0, 0.3, 0.0, 1.0)
        if principled.inputs.get("Emission Strength"):
            principled.inputs["Emission Strength"].default_value = 0.25
        if principled.inputs.get("Roughness"):
            principled.inputs["Roughness"].default_value = 0.6
    return material


def _create_library_guide(grid_bounds: tuple[Vector, Vector], grid_z: float = -100.0) -> bpy.types.Object:
    _remove_existing_library_guides()
    target_collection = _find_collection_by_logical_path("@project/assets") or bpy.data.collections.get("@project")
    _require(target_collection is not None, "Missing @project collection for library guide")
    curve = bpy.data.curves.new("Genesys Bridge Guide", "FONT")
    curve.body = GUIDE_TEXT
    curve.align_x = "LEFT"
    curve.size = 1.8
    curve.space_line = 1.2
    guide = bpy.data.objects.new("Genesys Bridge Guide", curve)
    guide.data.materials.append(_guide_material())
    guide[GUIDE_PROP] = 1
    guide["genesys_class_name"] = "GENESYS.LibraryGuide"
    low, high = grid_bounds
    guide.location = Vector((high.x + 3.0, low.y, grid_z))
    _exclusive_link(guide, target_collection)
    return guide


def layout_library_sources(urls: list[str], grid_z: float = -100.0) -> dict[str, Any]:
    bpy.context.view_layer.update()
    placed: list[dict[str, Any]] = []
    objects: list[bpy.types.Object] = []
    margin = 1.5
    sources: list[tuple[str, bpy.types.Object, Vector, Vector]] = []
    for url in sorted(dict.fromkeys(urls)):
        obj = _find_library_source(url)
        if obj is None:
            continue
        low, high = _mesh_local_bounds(obj)
        size = high - low
        sources.append((url, obj, low, size))
    if not sources:
        _create_library_guide(
            (Vector((0.0, 0.0, grid_z)), Vector((0.0, 0.0, grid_z))),
            grid_z=grid_z,
        )
        return {"count": 0, "placements": [], "bounds": None}
    total_area = sum(max(item[3].x, 0.1) * max(item[3].y, 0.1) for item in sources)
    row_width_target = max(math.sqrt(total_area) * 1.6, 12.0)
    x_cursor = 0.0
    y_cursor = 0.0
    row_depth = 0.0
    provisional: list[tuple[str, bpy.types.Object, Vector]] = []
    for url, obj, low, size in sorted(sources, key=lambda item: (-max(item[3].y, item[3].x), item[0])):
        width = max(size.x, 0.1)
        depth = max(size.y, 0.1)
        if provisional and x_cursor + width > row_width_target:
            x_cursor = 0.0
            y_cursor += row_depth + margin
            row_depth = 0.0
        location = Vector((x_cursor - low.x, y_cursor - low.y, grid_z - low.z))
        provisional.append((url, obj, location))
        x_cursor += width + margin
        row_depth = max(row_depth, depth)
    for _, obj, location in provisional:
        obj.location = location
        obj.rotation_euler = Euler((0.0, 0.0, 0.0))
        obj.scale = Vector((1.0, 1.0, 1.0))
        obj.hide_viewport = False
        obj.hide_render = True
    bpy.context.view_layer.update()
    low, high = _world_bounds([obj for _, obj, _ in provisional])
    center_shift = Vector((-(low.x + high.x) * 0.5, -(low.y + high.y) * 0.5, 0.0))
    for url, obj, _ in provisional:
        obj.location += center_shift
        objects.append(obj)
        bounds_low, bounds_high = _mesh_local_bounds(obj)
        world_low, world_high = _world_bounds([obj])
        placed.append(
            {
                "url": url,
                "name": obj.name,
                "position": [round(obj.location.x, 6), round(obj.location.y, 6), round(obj.location.z, 6)],
                "size": [
                    round(bounds_high.x - bounds_low.x, 6),
                    round(bounds_high.y - bounds_low.y, 6),
                    round(bounds_high.z - bounds_low.z, 6),
                ],
                "worldBounds": {
                    "min": [round(world_low.x, 6), round(world_low.y, 6), round(world_low.z, 6)],
                    "max": [round(world_high.x, 6), round(world_high.y, 6), round(world_high.z, 6)],
                },
            }
        )
    bpy.context.view_layer.update()
    grid_bounds = _world_bounds(objects)
    _create_library_guide(grid_bounds, grid_z=grid_z)
    final_low, final_high = _world_bounds(objects)
    return {
        "count": len(objects),
        "placements": placed,
        "bounds": {
            "min": [round(final_low.x, 6), round(final_low.y, 6), round(final_low.z, 6)],
            "max": [round(final_high.x, 6), round(final_high.y, 6), round(final_high.z, 6)],
        },
    }


def _material_color(material_payload: Any) -> tuple[float, float, float, float]:
    material_payload = _coerce_json(material_payload)
    color = 0xCCCCCC
    if isinstance(material_payload, dict):
        color = material_payload.get("color", material_payload.get("diffuse", color))
    elif isinstance(material_payload, int):
        color = material_payload
    if isinstance(color, dict):
        red = float(color.get("r", 0.8))
        green = float(color.get("g", 0.8))
        blue = float(color.get("b", 0.8))
        if max(red, green, blue) > 1.0:
            red /= 255.0
            green /= 255.0
            blue /= 255.0
        return red, green, blue, 1.0
    if isinstance(color, str):
        text = color.strip().lower()
        if text.startswith("#"):
            value = int(text[1:], 16)
        elif text.startswith("0x"):
            value = int(text, 16)
        else:
            value = int(text)
        color = value
    if isinstance(color, (int, float)):
        value = int(color)
        return (
            ((value >> 16) & 255) / 255.0,
            ((value >> 8) & 255) / 255.0,
            (value & 255) / 255.0,
            1.0,
        )
    return 0.8, 0.8, 0.8, 1.0


def _cached_material(material_payload: Any, cache: dict[str, bpy.types.Material]) -> bpy.types.Material:
    color = _material_color(material_payload)
    key = ",".join(f"{channel:.5f}" for channel in color)
    material = cache.get(key)
    if material is None:
        material = bpy.data.materials.new(f"GenesysMesh_{len(cache):03d}")
        material.use_nodes = True
        principled = material.node_tree.nodes.get("Principled BSDF")
        if principled is not None:
            principled.inputs["Base Color"].default_value = color
            principled.inputs["Roughness"].default_value = 0.65
            principled.inputs["Metallic"].default_value = 0.0
        cache[key] = material
    return material


def _geometry_dict(geometry_payload: Any) -> dict[str, Any]:
    geometry_payload = _coerce_json(geometry_payload)
    _require(isinstance(geometry_payload, dict), "MeshNode geometry must be an object")
    return geometry_payload


def _geometry_type_name(geometry: dict[str, Any]) -> str:
    return str(geometry.get("type") or geometry.get("name") or geometry.get("geometryType") or "")


def _primitive_operator_mesh(operator_name: str, **kwargs: Any) -> bpy.types.Mesh:
    _ensure_object_mode()
    snapshot = {obj.name_full for obj in bpy.data.objects}
    operator = getattr(bpy.ops.mesh, operator_name, None)
    _require(operator is not None, f"Unsupported Blender primitive operator: {operator_name}")
    result = operator(**kwargs)
    if "FINISHED" not in result:
        raise BridgeError(f"Primitive creation failed: {operator_name}")
    created = [obj for obj in bpy.data.objects if obj.name_full not in snapshot]
    mesh_objects = [obj for obj in created if obj.type == "MESH" and obj.data is not None]
    _require(mesh_objects, f"Primitive operator created no mesh: {operator_name}")
    obj = mesh_objects[0]
    mesh = obj.data.copy()
    _delete_object(obj)
    return mesh


def _capsule_mesh(radius: float, length: float) -> bpy.types.Mesh:
    depth = max(length, 0.0)
    return _primitive_operator_mesh("primitive_capsule_add", radius=radius, depth=depth, vertices=24, rings=8)


def _torus_mesh(major_radius: float, minor_radius: float) -> bpy.types.Mesh:
    return _primitive_operator_mesh(
        "primitive_torus_add",
        major_radius=max(major_radius, 0.001),
        minor_radius=max(minor_radius, 0.001),
        major_segments=48,
        minor_segments=16,
    )


def _box_mesh(width: float, height: float, depth: float) -> bpy.types.Mesh:
    mesh = _primitive_operator_mesh("primitive_cube_add", size=2.0)
    mesh.transform(
        Matrix.Diagonal((max(width, 0.001) * 0.5, max(depth, 0.001) * 0.5, max(height, 0.001) * 0.5, 1.0))
    )
    mesh.update()
    return mesh


def _cylinder_mesh(radius_top: float, radius_bottom: float, height: float) -> bpy.types.Mesh:
    return _primitive_operator_mesh(
        "primitive_cone_add",
        radius1=max(radius_bottom, 0.001),
        radius2=max(radius_top, 0.001),
        depth=max(height, 0.001),
        vertices=32,
    )


def _sphere_mesh(radius: float) -> bpy.types.Mesh:
    return _primitive_operator_mesh("primitive_uv_sphere_add", radius=max(radius, 0.001), segments=32, ring_count=16)


def _primitive_mesh_from_geometry(geometry_payload: Any) -> tuple[bpy.types.Mesh, str]:
    geometry = _geometry_dict(geometry_payload)
    geometry_type = _geometry_type_name(geometry)
    if geometry_type in {"BoxGeometry", "BoxBufferGeometry", "box"}:
        parameters = geometry.get("parameters", geometry)
        return _box_mesh(
            float(parameters.get("width", 1.0)),
            float(parameters.get("height", 1.0)),
            float(parameters.get("depth", 1.0)),
        ), "box"
    if geometry_type in {"CylinderGeometry", "CylinderBufferGeometry", "cylinder"}:
        parameters = geometry.get("parameters", geometry)
        return _cylinder_mesh(
            float(parameters.get("radiusTop", parameters.get("radius", 0.5))),
            float(parameters.get("radiusBottom", parameters.get("radius", 0.5))),
            float(parameters.get("height", 1.0)),
        ), "cylinder"
    if geometry_type in {"SphereGeometry", "SphereBufferGeometry", "sphere"}:
        parameters = geometry.get("parameters", geometry)
        return _sphere_mesh(float(parameters.get("radius", 0.5))), "sphere"
    if geometry_type in {"CapsuleGeometry", "capsule"}:
        parameters = geometry.get("parameters", geometry)
        radius = float(parameters.get("radius", 0.25))
        length = float(parameters.get("length", parameters.get("height", 1.0)))
        return _capsule_mesh(radius, length), "capsule"
    if geometry_type in {"TorusGeometry", "torus"}:
        parameters = geometry.get("parameters", geometry)
        return _torus_mesh(
            float(parameters.get("radius", 1.0)),
            float(parameters.get("tube", 0.25)),
        ), "torus"
    raise BridgeError(f"Unsupported MeshNode geometry type: {geometry_type or '<missing>'}")


def _light_type_for_class(class_name: str) -> str:
    if class_name.endswith("DirectionalLightNode"):
        return "SUN"
    if class_name.endswith("SpotLightNode"):
        return "SPOT"
    if class_name.endswith("PointLightNode"):
        return "POINT"
    if class_name.endswith("HemisphereLightNode"):
        return "AREA"
    if class_name.endswith("AreaLightNode"):
        return "AREA"
    return "SUN"


def _record_transform(record: dict[str, Any]) -> dict[str, list[float]]:
    return _transform_dict(record["position"], record["rotation"], record["scale"])


def _record_parent_transform(record: dict[str, Any]) -> dict[str, list[float]]:
    value = record.get("parentTransform")
    if value:
        return _transform_dict(value["position"], value["rotation"], value["scale"])
    return _identity_transform()


def _apply_record_metadata(obj: bpy.types.Object, record: dict[str, Any], *, primitive_type: str | None = None) -> None:
    for key in ("genesys_library_source", GUIDE_PROP):
        if key in obj:
            del obj[key]
    obj["genesys_node_id"] = str(record["id"])
    obj["genesys_outline_order"] = int(record.get("outlineOrder", 0))
    obj["genesys_class_name"] = str(record["className"])
    obj["genesys_bridge_parent_id"] = str(record["bridgeParentId"]) if record.get("bridgeParentId") else ""
    obj["genesys_actor_group"] = str(record.get("group") or "")
    obj["genesys_group_id"] = str(record.get("groupId") or "")
    if record.get("modelUrl"):
        obj["genesys_asset_path"] = str(record["modelUrl"])
    if primitive_type:
        obj["genesys_primitive_type"] = primitive_type


def _instantiate_record_object(
    record: dict[str, Any],
    library_sources: dict[str, bpy.types.Object],
    material_cache: dict[str, bpy.types.Material],
) -> tuple[bpy.types.Object, str | None]:
    class_name = str(record["className"])
    name = str(record["name"])
    if class_name == "ENGINE.SceneNode":
        obj = bpy.data.objects.new(name, None)
        obj.empty_display_type = "PLAIN_AXES"
        obj.empty_display_size = 0.4
        primitive_type = None
    elif class_name == "ENGINE.ModelMeshNode":
        url = str(record.get("modelUrl") or "")
        source = library_sources.get(url)
        missing_source = source is None
        if source is None:
            obj = bpy.data.objects.new(name, None)
            obj.empty_display_type = "CUBE"
            obj.empty_display_size = 0.5
        else:
            obj = source.copy()
            obj.data = source.data
            obj.animation_data_clear()
            obj.hide_viewport = False
            obj.hide_render = False
        primitive_type = None
    elif class_name == "ENGINE.MeshNode":
        mesh, primitive_type = _primitive_mesh_from_geometry(record.get("geometry"))
        obj = bpy.data.objects.new(name, mesh)
        material = _cached_material(record.get("material"), material_cache)
        obj.data.materials.clear()
        obj.data.materials.append(material)
    elif _is_light_class(class_name):
        light = bpy.data.lights.new(name, type=_light_type_for_class(class_name))
        obj = bpy.data.objects.new(name, light)
        primitive_type = None
    else:
        raise BridgeError(f"Unsupported class {class_name}")
    obj.matrix_world = _genesys_transform_to_blender_matrix(_record_transform(record))
    obj.hide_select = False
    obj.hide_viewport = False
    obj.hide_render = False
    _apply_record_metadata(obj, record, primitive_type=primitive_type)
    if class_name == "ENGINE.ModelMeshNode" and missing_source:
        obj["genesys_missing_library_source"] = 1
    return obj, primitive_type


def _parent_objects(records: list[dict[str, Any]], created: dict[str, bpy.types.Object]) -> dict[str, Any]:
    parented = 0
    hierarchy_issues: list[str] = []
    records_by_id = {str(record["id"]): record for record in records}
    for record in records:
        child = created[str(record["id"])]
        parent_id = record.get("bridgeParentId")
        if not parent_id:
            continue
        parent = created.get(str(parent_id))
        if parent is None:
            hierarchy_issues.append(f"Missing bridge parent {parent_id} for {record['name']}")
            continue
        if records_by_id.get(str(parent_id), {}).get("className") not in SUPPORTED_SCENE_CLASSES | {"ENGINE.SceneNode"}:
            hierarchy_issues.append(f"Invalid bridge parent class for {record['name']}")
            continue
        world = child.matrix_world.copy()
        child.parent = parent
        child.matrix_parent_inverse = parent.matrix_world.inverted()
        child.matrix_world = world
        parented += 1
    return {"parented": parented, "hierarchyIssues": hierarchy_issues}


def _validate_objects_against_records(records: list[dict[str, Any]], objects_by_id: dict[str, bpy.types.Object]) -> dict[str, Any]:
    max_position_error = 0.0
    max_scale_error = 0.0
    max_rotation_error = 0.0
    mismatches: list[str] = []
    for record in records:
        obj = objects_by_id.get(str(record["id"]))
        if obj is None:
            mismatches.append(f"Missing object for {record['id']}")
            continue
        actual = _blender_matrix_to_genesys_transform(obj.matrix_world)
        expected = _record_transform(record)
        position_error, scale_error, rotation_error = _transform_error(expected, actual)
        max_position_error = max(max_position_error, position_error)
        max_scale_error = max(max_scale_error, scale_error)
        max_rotation_error = max(max_rotation_error, rotation_error)
        if _transform_changed(expected, actual):
            mismatches.append(
                f"{record['name']} position={position_error:.6g} scale={scale_error:.6g} rotation={rotation_error:.6g}"
            )
    return {
        "ok": not mismatches,
        "maxPositionError": max_position_error,
        "maxScaleError": max_scale_error,
        "maxRotationError": max_rotation_error,
        "mismatches": mismatches,
    }


def _temporary_collection_name(target_name: str) -> str:
    return f"__genesys_bridge_build__{target_name}"


def _untagged_objects_in_collection(collection: bpy.types.Collection) -> list[str]:
    return sorted(obj.name for obj in collection.all_objects if not _is_bridge_tagged(obj))


def _swap_scene_collection(temp_collection: bpy.types.Collection, target_name: str, replace_untagged: bool) -> dict[str, Any]:
    existing = bpy.data.collections.get(target_name)
    deleted_untagged: list[str] = []
    if existing is not None and existing != temp_collection:
        untagged = _untagged_objects_in_collection(existing)
        if untagged and not replace_untagged:
            raise BridgeError(
                f"Target collection {target_name} contains untagged objects; rerun with --replace-untagged to replace it"
            )
        deleted_untagged = untagged
        _delete_collection_tree(existing)
    temp_collection.name = target_name
    return {"replacedCollection": existing is not None, "deletedUntagged": deleted_untagged}


def _save_mainfile(output_path: Path, overwrite: bool) -> None:
    if output_path.exists() and not overwrite:
        raise BridgeError(f"Output already exists: {output_path}")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_path))


def _baseline_records_by_id(manifest: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {str(record["id"]): record for record in manifest["records"]}


def _scene_collection_objects(scene_collection: bpy.types.Collection) -> list[bpy.types.Object]:
    return list(scene_collection.objects)


def _repair_duplicate_ids(
    scene_objects: list[bpy.types.Object],
    baseline_by_id: dict[str, dict[str, Any]],
    *,
    mutate: bool = True,
) -> tuple[dict[str, bpy.types.Object], list[dict[str, Any]]]:
    grouped: dict[str, list[bpy.types.Object]] = {}
    for obj in scene_objects:
        node_id = obj.get("genesys_node_id")
        if node_id:
            grouped.setdefault(str(node_id), []).append(obj)
    resolved: dict[str, bpy.types.Object] = {}
    repairs: list[dict[str, Any]] = []
    for node_id, objects in grouped.items():
        if len(objects) == 1:
            resolved[node_id] = objects[0]
            continue
        baseline = baseline_by_id.get(node_id)
        baseline_name = baseline["name"] if baseline else None
        originals = [obj for obj in objects if obj.name == baseline_name]
        if len(originals) != 1:
            raise BridgeError(
                f"Ambiguous duplicate genesys_node_id {node_id}: expected "
                f"exactly one object named {baseline_name!r}"
            )
        keep = originals[0]
        resolved[node_id] = keep
        for obj in objects:
            if obj == keep:
                continue
            if obj.get("genesys_asset_path"):
                if mutate:
                    for key in (
                        "genesys_node_id",
                        "genesys_outline_order",
                        "genesys_class_name",
                        "genesys_bridge_parent_id",
                        "genesys_actor_group",
                        "genesys_group_id",
                        "genesys_missing_library_source",
                    ):
                        if key in obj:
                            del obj[key]
                repairs.append({"id": node_id, "kept": keep.name, "convertedToAddition": obj.name})
                continue
            class_name = baseline["className"] if baseline else obj.get("genesys_class_name")
            if class_name == "ENGINE.MeshNode":
                raise BridgeError(f"Ambiguous duplicate MeshNode id {node_id} on {obj.name}")
            raise BridgeError(f"Unsupported duplicate node id {node_id} on {obj.name}")
    return resolved, repairs


def _parent_genesys_id_for_addition(obj: bpy.types.Object, baseline_by_id: dict[str, dict[str, Any]]) -> str | None:
    parent = obj.parent
    if not parent:
        return None
    parent_id = parent.get("genesys_node_id")
    if not parent_id:
        return None
    baseline = baseline_by_id.get(str(parent_id))
    if baseline and baseline.get("className") == "ENGINE.SceneNode":
        return str(parent_id)
    return None


def _actual_bridge_parent_id(obj: bpy.types.Object) -> str | None:
    if obj.parent is None:
        return None
    parent_id = obj.parent.get("genesys_node_id")
    return str(parent_id) if parent_id else None


def _is_linked_library_instance(obj: bpy.types.Object, model_url: str) -> bool:
    if obj.type != "MESH" or obj.data is None:
        return False
    source = _find_library_source(model_url)
    return bool(
        source is not None
        and source.type == "MESH"
        and source.data is not None
        and obj.data == source.data
    )


def _current_genesys_world_matrix(obj: bpy.types.Object) -> Matrix:
    return _genesys_transform_to_matrix(_blender_matrix_to_genesys_transform(obj.matrix_world))


def _transform_from_genesys_matrix(matrix: Matrix) -> dict[str, list[float]]:
    location, rotation, scale = matrix.decompose()
    return _transform_dict(location, rotation.to_euler("XYZ"), scale)


def sync_from_genesys(args: argparse.Namespace) -> dict[str, Any]:
    manifest = _load_manifest(args.manifest)
    source_scene = str(manifest.get("sourceScene") or "")
    project_root = _normalize_project_root(args.project_root)
    output_path = _normalize_output_path(getattr(args, "output", None))
    target_name = _target_scene_name(source_scene, getattr(args, "target_level", None))
    replace_untagged = bool(getattr(args, "replace_untagged", False))
    # These roots are structural invariants even if this project currently has
    # no models from one of the two logical asset namespaces.
    _ensure_top_level_collection("@engine")
    _ensure_top_level_collection("@project")
    mirror_info = _mirror_project_model_directories(project_root)
    project_urls = _all_project_model_urls(project_root)
    engine_urls = sorted(
        {
            str(record["modelUrl"])
            for record in manifest["records"]
            if record.get("modelUrl") and _normalize_posix_path(str(record["modelUrl"])).startswith("@engine/assets/")
        }
    )
    all_urls = sorted(dict.fromkeys(project_urls + engine_urls))
    imported: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    library_sources: dict[str, bpy.types.Object] = {}
    for url in all_urls:
        source, info = _ensure_library_source(url, project_root)
        if source is not None:
            library_sources[url] = source
            if info:
                imported.append(info)
        else:
            skipped.append(info or {"url": url, "error": "Unknown import failure"})
    layout_result = layout_library_sources(all_urls, grid_z=-100.0)
    temp_name = _temporary_collection_name(target_name)
    existing_temp = bpy.data.collections.get(temp_name)
    if existing_temp is not None:
        _delete_collection_tree(existing_temp)
    temp_collection = bpy.data.collections.new(temp_name)
    bpy.context.scene.collection.children.link(temp_collection)
    material_cache: dict[str, bpy.types.Material] = {}
    ordered_records = sorted(manifest["records"], key=lambda record: int(record.get("outlineOrder", 0)))
    created: dict[str, bpy.types.Object] = {}
    placeholders: list[str] = []
    for record in ordered_records:
        obj, _ = _instantiate_record_object(record, library_sources, material_cache)
        if obj.get("genesys_missing_library_source"):
            placeholders.append(obj.name)
        temp_collection.objects.link(obj)
        created[str(record["id"])] = obj
    parenting_info = _parent_objects(ordered_records, created)
    _require(
        not parenting_info["hierarchyIssues"],
        "Hierarchy validation failed after sync from Genesys",
    )
    transform_validation = _validate_objects_against_records(ordered_records, created)
    _require(
        transform_validation["ok"],
        "Transform validation failed after sync from Genesys",
    )
    removed_factory = remove_factory_starter_scene()
    swap_info = _swap_scene_collection(temp_collection, target_name, replace_untagged)
    reorder_info = reorder_top_level_collections(target_name)
    viewport_info = _apply_viewport_preferences()
    _store_baseline_manifest(manifest)
    bpy.context.scene[SOURCE_SCENE_PROP] = source_scene
    post_sync_validation = validate(
        argparse.Namespace(target_level=target_name)
    )
    _require(
        post_sync_validation["ok"],
        "Structural validation failed after sync from Genesys: "
        + json.dumps(post_sync_validation, default=str),
    )
    if output_path is not None:
        _save_mainfile(output_path, overwrite=bool(getattr(args, "overwrite", False)))
    return _operation_result(
        "sync-from-genesys",
        sourceScene=source_scene,
        targetCollection=target_name,
        records=len(ordered_records),
        mirrorDirectories=mirror_info["directoriesMirrored"],
        projectModelUrls=len(project_urls),
        engineModelUrls=len(engine_urls),
        importedLibraries=imported,
        librarySkipped=skipped,
        libraryLayout=layout_result,
        placeholders=placeholders,
        parented=parenting_info["parented"],
        hierarchyIssues=parenting_info["hierarchyIssues"],
        transformValidation=transform_validation,
        removedFactory=removed_factory,
        swap=swap_info,
        topLevelOrder=reorder_info["order"],
        viewportPreferences=viewport_info,
        validation=post_sync_validation,
        baselineStored=True,
        output=str(output_path) if output_path else None,
    )


def diff(args: argparse.Namespace) -> dict[str, Any]:
    manifest = _load_baseline_manifest()
    baseline_by_id = _baseline_records_by_id(manifest)
    scene_collection = _find_scene_collection(getattr(args, "target_level", None), manifest.get("sourceScene"))
    scene_objects = _scene_collection_objects(scene_collection)
    resolved_by_id, repairs = _repair_duplicate_ids(scene_objects, baseline_by_id)
    changes: list[dict[str, Any]] = []
    additions: list[dict[str, Any]] = []
    unsupported: list[dict[str, Any]] = []
    current_transforms = {
        node_id: _blender_matrix_to_genesys_transform(obj.matrix_world)
        for node_id, obj in resolved_by_id.items()
    }
    changed_ids: set[str] = set()
    desired_local_by_id: dict[str, dict[str, list[float]]] = {}
    for node_id, obj in resolved_by_id.items():
        baseline_record = baseline_by_id.get(node_id)
        if baseline_record is None:
            continue
        expected_parent = (
            str(baseline_record.get("bridgeParentId"))
            if baseline_record.get("bridgeParentId")
            else None
        )
        actual_parent = _actual_bridge_parent_id(obj)
        if actual_parent != expected_parent:
            unsupported.append(
                {
                    "id": node_id,
                    "name": obj.name,
                    "reason": (
                        "Blender hierarchy changed; sync does not reparent "
                        f"Genesys nodes (expected {expected_parent or 'ROOT'}, "
                        f"found {actual_parent or 'ROOT'})"
                    ),
                }
            )
            continue

        baseline_world_matrix = _genesys_transform_to_matrix(
            _record_transform(baseline_record)
        )
        baseline_parent_matrix = _genesys_transform_to_matrix(
            _record_parent_transform(baseline_record)
        )
        baseline_local = _transform_from_genesys_matrix(
            baseline_parent_matrix.inverted_safe() @ baseline_world_matrix
        )
        current_parent_matrix = (
            _current_genesys_world_matrix(obj.parent)
            if obj.parent is not None
            else Matrix.Identity(4)
        )
        current_local = _transform_from_genesys_matrix(
            current_parent_matrix.inverted_safe()
            @ _genesys_transform_to_matrix(current_transforms[node_id])
        )
        if _transform_changed(baseline_local, current_local):
            changed_ids.add(node_id)
            desired_local_by_id[node_id] = current_local
    for node_id in sorted(changed_ids, key=lambda item: int(baseline_by_id[item].get("outlineOrder", 0))):
        obj = resolved_by_id[node_id]
        baseline_record = baseline_by_id[node_id]
        desired_world = current_transforms[node_id]
        changes.append(
            {
                "operation": "updateTransform",
                "id": node_id,
                "name": baseline_record["name"],
                "className": baseline_record["className"],
                "parentId": baseline_record.get("parentId"),
                "bridgeParentId": baseline_record.get("bridgeParentId"),
                "groupId": baseline_record.get("groupId"),
                "baselineWorld": _record_transform(baseline_record),
                "baselineParentWorld": _record_parent_transform(baseline_record),
                "desiredWorld": desired_world,
                "desiredLocal": desired_local_by_id[node_id],
            }
        )
    for obj in scene_objects:
        if not obj.get("genesys_asset_path"):
            continue
        if obj.get("genesys_node_id"):
            continue
        model_url = str(obj.get("genesys_asset_path"))
        if not _is_linked_library_instance(obj, model_url):
            unsupported.append(
                {
                    "name": obj.name,
                    "reason": (
                        "Model addition is not a mesh linked to the matching "
                        "canonical library source"
                    ),
                    "type": obj.type,
                    "modelUrl": model_url,
                }
            )
            continue
        desired_world = _blender_matrix_to_genesys_transform(obj.matrix_world)
        target_parent_id = _parent_genesys_id_for_addition(obj, baseline_by_id)
        parent_world = (
            _current_genesys_world_matrix(obj.parent)
            if target_parent_id and obj.parent is not None
            else Matrix.Identity(4)
        )
        desired_local_matrix = parent_world.inverted_safe() @ _genesys_transform_to_matrix(desired_world)
        additions.append(
            {
                "operation": "addModel",
                "name": obj.name,
                "parentId": target_parent_id,
                "groupId": target_parent_id,
                "modelUrl": model_url,
                "desiredWorld": desired_world,
                "desiredLocal": _transform_from_genesys_matrix(desired_local_matrix),
            }
        )
    for obj in scene_objects:
        if obj.get(GUIDE_PROP):
            continue
        if obj.get("genesys_node_id"):
            continue
        if obj.get("genesys_asset_path"):
            continue
        if _is_bridge_tagged(obj):
            unsupported.append(
                {
                    "name": obj.name,
                    "reason": "Unsupported tagged object without modelUrl or node id",
                    "type": obj.type,
                }
            )
    missing_baseline_ids = sorted(node_id for node_id in baseline_by_id if node_id not in resolved_by_id)
    result = _operation_result(
        "diff",
        format=DELTA_FORMAT,
        version=DELTA_VERSION,
        sourceScene=str(manifest.get("sourceScene") or bpy.context.scene.get(SOURCE_SCENE_PROP) or ""),
        changes=changes,
        additions=additions,
        unsupported=unsupported,
        missingBaselineIds=missing_baseline_ids,
        repairedDuplicates=repairs,
    )
    output_path = _normalize_output_path(getattr(args, "output", None))
    if output_path is not None:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        output_path.write_text(_json_dumps(result), encoding="utf-8")
        result["output"] = str(output_path)
    return result


def _library_guide_issues() -> list[str]:
    guides = [obj for obj in bpy.data.objects if bool(obj.get(GUIDE_PROP))]
    if not guides:
        return ["Missing library guide"]
    if len(guides) > 1:
        return ["Multiple library guides found"]
    guide = guides[0]
    issues: list[str] = []
    if guide.type != "FONT":
        issues.append("Library guide is not a FONT object")
    if getattr(guide.data, "body", "") != GUIDE_TEXT:
        issues.append("Library guide text does not match expected text")
    if abs(float(guide.location.z) - (-100.0)) > POSITION_SCALE_EPSILON:
        issues.append("Library guide is not at Z=-100")
    if not guide.data.materials or guide.data.materials[0].name != "GenesysBridgeGuideOrange":
        issues.append("Library guide does not use the orange guide material")
    collection_paths = {
        str(collection.get(LOGICAL_PATH_PROP) or collection.name) for collection in guide.users_collection
    }
    if not ({"@project/assets", "@project"} & collection_paths):
        issues.append("Library guide is not linked under @project or @project/assets")
    return issues


def _library_source_issues() -> list[str]:
    issues: list[str] = []
    for source in bpy.data.objects:
        model_url = source.get("genesys_asset_path")
        if not model_url or not _is_canonical_library_source(
            source,
            str(model_url),
        ):
            continue
        if source.type != "MESH" or source.data is None:
            issues.append(f"{source.name} is not a mesh library source")
            continue
        if source.hide_viewport:
            issues.append(f"{source.name} is hidden from the viewport")
        try:
            low, _ = _world_bounds([source])
            if abs(float(low.z) - (-100.0)) > 1e-3:
                issues.append(f"{source.name} does not rest at Z=-100")
        except BridgeError as error:
            issues.append(f"{source.name}: {error}")
    return issues


def _outline_order_preserved(
    scene_collection: bpy.types.Collection,
    resolved_by_id: dict[str, bpy.types.Object] | None = None,
) -> bool:
    canonical_names = (
        {obj.name_full for obj in resolved_by_id.values()}
        if resolved_by_id is not None
        else None
    )
    scene_objects = [
        obj
        for obj in scene_collection.objects
        if "genesys_outline_order" in obj
        and (canonical_names is None or obj.name_full in canonical_names)
    ]
    orders = [int(obj["genesys_outline_order"]) for obj in scene_objects]
    return orders == sorted(orders)


def validate(args: argparse.Namespace) -> dict[str, Any]:
    baseline_missing = False
    try:
        manifest = _load_baseline_manifest()
    except BridgeError:
        manifest = None
        baseline_missing = True
    source_scene = (
        manifest.get("sourceScene") if manifest else bpy.context.scene.get(SOURCE_SCENE_PROP)
    )
    scene_collection = _find_scene_collection(getattr(args, "target_level", None), source_scene)
    scene_objects = _scene_collection_objects(scene_collection)
    empties = sum(1 for obj in scene_objects if obj.type == "EMPTY")
    meshes = sum(1 for obj in scene_objects if obj.type == "MESH")
    lights = sum(1 for obj in scene_objects if obj.type == "LIGHT")
    library_count = sum(
        1
        for obj in bpy.data.objects
        if obj.get("genesys_asset_path")
        and _is_canonical_library_source(
            obj,
            str(obj.get("genesys_asset_path")),
        )
    )
    hierarchy_issues: list[str] = []
    baseline_by_id = _baseline_records_by_id(manifest) if manifest else {}
    resolved_by_id: dict[str, bpy.types.Object] = {}
    repairs: list[dict[str, Any]] = []
    if manifest:
        resolved_by_id, repairs = _repair_duplicate_ids(
            scene_objects,
            baseline_by_id,
            mutate=False,
        )
        for node_id, obj in resolved_by_id.items():
            expected_parent = baseline_by_id[node_id].get("bridgeParentId")
            actual_parent = str(obj.parent.get("genesys_node_id")) if obj.parent and obj.parent.get("genesys_node_id") else None
            if expected_parent != actual_parent:
                hierarchy_issues.append(
                    f"{obj.name} expected parent {expected_parent or 'ROOT'} but has {actual_parent or 'ROOT'}"
                )
    relationship_lines_enabled, alphabetical_sorting_enabled = _space_settings()
    top_level_order = [collection.name for collection in bpy.context.scene.collection.children]
    expected_scene_name = _target_scene_name(source_scene, getattr(args, "target_level", None))
    top_level_order_valid = top_level_order[:3] == ["@engine", "@project", expected_scene_name]
    if manifest:
        transform_validation = _validate_objects_against_records(list(baseline_by_id.values()), resolved_by_id)
        max_position_error = transform_validation["maxPositionError"]
        max_scale_error = transform_validation["maxScaleError"]
        max_rotation_error = transform_validation["maxRotationError"]
        parent_invariant_ok = _validate_manifest(manifest)["parentIdInvariantOk"]
    else:
        transform_validation = {"ok": False, "mismatches": ["Missing baseline"]}
        max_position_error = 0.0
        max_scale_error = 0.0
        max_rotation_error = 0.0
        parent_invariant_ok = False
    scene_child_collections = [child.name for child in scene_collection.children]
    guide_issues = _library_guide_issues()
    library_source_issues = _library_source_issues()
    outline_order_preserved = _outline_order_preserved(
        scene_collection,
        resolved_by_id if manifest else None,
    )
    valid = bool(
        not baseline_missing
        and not hierarchy_issues
        and not scene_child_collections
        and top_level_order_valid
        and not relationship_lines_enabled
        and not alphabetical_sorting_enabled
        and outline_order_preserved
        and not guide_issues
        and not library_source_issues
        and parent_invariant_ok
        and transform_validation["ok"]
    )
    return _operation_result(
        "validate",
        ok=valid,
        sourceScene=str(source_scene or ""),
        targetCollection=scene_collection.name,
        counts={
            "empties": empties,
            "meshes": meshes,
            "lights": lights,
            "library": library_count,
        },
        hierarchy_issues=hierarchy_issues,
        sceneChildCollections=scene_child_collections,
        topLevelOrderValid=top_level_order_valid,
        topLevelOrder=top_level_order,
        relationshipLinesEnabled=relationship_lines_enabled,
        alphabeticalSortingEnabled=alphabetical_sorting_enabled,
        outlineOrderPreserved=outline_order_preserved,
        library_guide_issues=guide_issues,
        library_source_issues=library_source_issues,
        repairedDuplicates=repairs,
        parentIdInvariantOk=parent_invariant_ok,
        baselineMissing=baseline_missing,
        maxPositionError=max_position_error,
        maxScaleError=max_scale_error,
        maxRotationError=max_rotation_error,
    )


def _build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="blender_bridge.py")
    subparsers = parser.add_subparsers(dest="command", required=True)

    sync_parser = subparsers.add_parser("sync-from-genesys")
    sync_parser.add_argument("--manifest", required=True)
    sync_parser.add_argument("--project-root", required=True)
    sync_parser.add_argument("--output", required=True)
    sync_parser.add_argument("--target-level")
    sync_parser.add_argument("--overwrite", action="store_true")
    sync_parser.add_argument("--replace-untagged", action="store_true")

    diff_parser = subparsers.add_parser("diff")
    diff_parser.add_argument("--target-level")
    diff_parser.add_argument("--output")

    validate_parser = subparsers.add_parser("validate")
    validate_parser.add_argument("--target-level")
    return parser


def _command_argv() -> list[str]:
    if "--" in sys.argv:
        index = sys.argv.index("--")
        return sys.argv[index + 1 :]
    return sys.argv[1:]


def main(argv: list[str] | None = None) -> int:
    parser = _build_parser()
    parsed = parser.parse_args(_command_argv() if argv is None else argv)
    operation = parsed.command
    try:
        if operation == "sync-from-genesys":
            result = sync_from_genesys(parsed)
        elif operation == "diff":
            result = diff(parsed)
        elif operation == "validate":
            result = validate(parsed)
        else:
            raise BridgeError(f"Unsupported command: {operation}")
        _print_json_result(result)
        return 0 if result.get("ok", False) else 1
    except BridgeError as error:
        _print_json_result(_error_result(operation, error))
        return 1
    except Exception as error:  # pragma: no cover - Blender runtime failure path
        _print_json_result(_error_result(operation, error))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
