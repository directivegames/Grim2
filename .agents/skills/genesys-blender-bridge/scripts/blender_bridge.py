from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import re
import shutil
import struct
import subprocess
import sys
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

import bmesh
import bpy
from mathutils import Euler, Matrix, Vector


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
# Tolerances: values cross MCP as rounded decimals and Blender stores float32, so a
# fixed 1e-5 sat below the noise. Position/scale use max(1e-4, 1e-6 * |value|).
POSITION_SCALE_EPSILON = 1e-4
RELATIVE_EPSILON = 1e-6
ROTATION_EPSILON = 1e-3
# Extensions Blender's glTF importer cannot read; such files go through plain-glb.mjs first.
BLENDER_UNSUPPORTED_GLTF = {"KHR_texture_basisu", "EXT_meshopt_compression", "EXT_texture_webp", "KHR_mesh_quantization"}
SKILL_DIR = Path(__file__).resolve().parent.parent
PLAIN_GLB_SCRIPT = SKILL_DIR.parent / "genesys-blender-modeling" / "scripts" / "plain-glb.mjs"
SCRATCH_REL = Path(".scratch") / "blender-bridge"
NUMERIC_SUFFIX_RE = re.compile(r"^(?P<base>.+?)\.(?P<suffix>\d{3})$")
# Genesys rotations are three.js Euler angles in order 'XYZ': R = Rx(x) @ Ry(y) @ Rz(z)
# (intrinsic X, then Y, then Z). Blender/mathutils names that same matrix 'ZYX' (its 'XYZ'
# is Rz @ Ry @ Rx). Reading three.js 'XYZ' as Blender 'XYZ' was the old bug. The bridge does
# its transform math in double precision with three.js's formulas (_compose / _decompose);
# for a quick mathutils equivalent use Euler(rotation, GENESYS_EULER_ORDER).
# Proof: scripts/test_euler_roundtrip.mjs.
GENESYS_EULER_ORDER = "ZYX"
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


# ---- transform math -------------------------------------------------------------------------
# Done in double precision with three.js's own formulas; mathutils is float32, and its Euler
# extraction drifted by up to 7e-4 rad near gimbal lock. Matrices here are row-major 4x4 lists.
# Genesys world G and Blender world B relate by B = A^T G A, with A = BASIS_A_4 (Blender ->
# Genesys axes): Genesys (x, y, z) is Blender (x, -z, y).
M4 = list  # list[list[float]], 4 rows of 4
BASIS_A_4: M4 = [[1.0, 0.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0], [0.0, -1.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0]]
BASIS_A_4_T: M4 = [list(row) for row in zip(*BASIS_A_4)]


def _identity4() -> M4:
    return [[1.0 if r == c else 0.0 for c in range(4)] for r in range(4)]


def _mat_mul(left: M4, right: M4) -> M4:
    return [[sum(left[r][k] * right[k][c] for k in range(4)) for c in range(4)] for r in range(4)]


def _affine_inverse(matrix: M4) -> M4:
    """Inverse of an affine 4x4 (any invertible 3x3 part); singular parts fall back to identity."""
    a = [[matrix[r][c] for c in range(3)] for r in range(3)]
    det = (
        a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1])
        - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0])
        + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0])
    )
    if abs(det) < 1e-12:
        return _identity4()
    inv = [
        [(a[1][1] * a[2][2] - a[1][2] * a[2][1]) / det, (a[0][2] * a[2][1] - a[0][1] * a[2][2]) / det, (a[0][1] * a[1][2] - a[0][2] * a[1][1]) / det],
        [(a[1][2] * a[2][0] - a[1][0] * a[2][2]) / det, (a[0][0] * a[2][2] - a[0][2] * a[2][0]) / det, (a[0][2] * a[1][0] - a[0][0] * a[1][2]) / det],
        [(a[1][0] * a[2][1] - a[1][1] * a[2][0]) / det, (a[0][1] * a[2][0] - a[0][0] * a[2][1]) / det, (a[0][0] * a[1][1] - a[0][1] * a[1][0]) / det],
    ]
    t = [matrix[r][3] for r in range(3)]
    out = [[inv[r][0], inv[r][1], inv[r][2], -sum(inv[r][k] * t[k] for k in range(3))] for r in range(3)]
    out.append([0.0, 0.0, 0.0, 1.0])
    return out


def _euler_xyz_to_rotation(rotation: Iterable[Any]) -> list[list[float]]:
    """three.js Matrix4.makeRotationFromEuler, order 'XYZ': R = Rx(x) @ Ry(y) @ Rz(z)."""
    x, y, z = (float(v) for v in rotation)
    a, b, c, d, e, f = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    ae, af, be, bf = a * e, a * f, b * e, b * f
    return [
        [c * e, -c * f, d],
        [af + be * d, ae - bf * d, -b * c],
        [bf - ae * d, be + af * d, a * c],
    ]


def _rotation_to_euler_xyz(m: list[list[float]]) -> list[float]:
    """Euler 'XYZ' angles of a rotation matrix: the same angles as three.js
    Euler.setFromRotationMatrix for an exact matrix, but stable near gimbal lock (y = ±90°),
    where Blender's float32 storage makes asin(m13) and the separate x/z atan2 drift by up to
    3e-4 rad. y uses atan2 against cos(y) = |row 0 without m13|; x is solved last from
    Rx = R @ Rz(z)^T @ Ry(y)^T, so x absorbs any error in z and the recomposed matrix matches."""
    cos_y = math.hypot(m[0][0], m[0][1])
    y = math.atan2(m[0][2], cos_y)
    z = math.atan2(-m[0][1], m[0][0]) if cos_y > 1e-12 else 0.0
    cz, sz = math.cos(z), math.sin(z)
    # Column 1 of Rz(z)^T @ Ry(y)^T is (sin z, cos z, 0) (Ry leaves the Y axis alone), so
    # Rx[1][1] = cos x and Rx[2][1] = sin x come from rows 1 and 2 of m.
    rx_11 = m[1][0] * sz + m[1][1] * cz
    rx_21 = m[2][0] * sz + m[2][1] * cz
    return [math.atan2(rx_21, rx_11), y, z]


def _euler_xyz_to_quaternion(rotation: Iterable[Any]) -> tuple[float, float, float, float]:
    """three.js Quaternion.setFromEuler, order 'XYZ' -> (x, y, z, w)."""
    x, y, z = (float(v) * 0.5 for v in rotation)
    c1, c2, c3, s1, s2, s3 = math.cos(x), math.cos(y), math.cos(z), math.sin(x), math.sin(y), math.sin(z)
    return (
        s1 * c2 * c3 + c1 * s2 * s3,
        c1 * s2 * c3 - s1 * c2 * s3,
        c1 * c2 * s3 + s1 * s2 * c3,
        c1 * c2 * c3 - s1 * s2 * s3,
    )


def _compose(transform: dict[str, Any]) -> M4:
    """three.js Matrix4.compose(position, Euler 'XYZ', scale)."""
    px, py, pz = (float(v) for v in transform["position"])
    sx, sy, sz = (float(v) for v in transform["scale"])
    r = _euler_xyz_to_rotation(transform["rotation"])
    return [
        [r[0][0] * sx, r[0][1] * sy, r[0][2] * sz, px],
        [r[1][0] * sx, r[1][1] * sy, r[1][2] * sz, py],
        [r[2][0] * sx, r[2][1] * sy, r[2][2] * sz, pz],
        [0.0, 0.0, 0.0, 1.0],
    ]


def _decompose(matrix: M4) -> dict[str, list[float]]:
    """three.js Matrix4.decompose -> position, Euler 'XYZ' (radians), scale."""
    columns = [[matrix[r][c] for r in range(3)] for c in range(3)]
    scale = [math.sqrt(sum(v * v for v in column)) for column in columns]
    det = (
        matrix[0][0] * (matrix[1][1] * matrix[2][2] - matrix[1][2] * matrix[2][1])
        - matrix[0][1] * (matrix[1][0] * matrix[2][2] - matrix[1][2] * matrix[2][0])
        + matrix[0][2] * (matrix[1][0] * matrix[2][1] - matrix[1][1] * matrix[2][0])
    )
    if det < 0:
        scale[0] = -scale[0]
    rotation = [[matrix[r][c] / (scale[c] or 1.0) for c in range(3)] for r in range(3)]
    return _transform_dict(
        [matrix[0][3], matrix[1][3], matrix[2][3]],
        _rotation_to_euler_xyz(rotation),
        scale,
    )


def _to_blender_matrix(matrix: M4) -> Matrix:
    return Matrix([[float(v) for v in row] for row in matrix])


def _from_blender_matrix(matrix: Matrix) -> M4:
    return [[float(matrix[r][c]) for c in range(4)] for r in range(4)]


def _genesys_rotation_matrix_to_blender(rotation_genesys: Matrix) -> Matrix:
    """3x3 mathutils helper kept for callers that hold a Genesys rotation matrix."""
    return BASIS_A_T @ rotation_genesys @ BASIS_A


def _genesys_transform_to_blender_matrix(transform: dict[str, Any]) -> Matrix:
    return _to_blender_matrix(_mat_mul(_mat_mul(BASIS_A_4_T, _compose(transform)), BASIS_A_4))


def _blender_world_to_genesys_matrix(matrix_world: Matrix) -> M4:
    return _mat_mul(_mat_mul(BASIS_A_4, _from_blender_matrix(matrix_world)), BASIS_A_4_T)


def _blender_matrix_to_genesys_transform(matrix_world: Matrix) -> dict[str, list[float]]:
    return _decompose(_blender_world_to_genesys_matrix(matrix_world))


def _genesys_transform_to_matrix(transform: dict[str, Any]) -> M4:
    return _compose(transform)


def _angular_distance(left: Iterable[float], right: Iterable[float]) -> float:
    # q and -q encode the same orientation. Measure the shortest arc so
    # equivalent quaternion signs cannot appear as a 2π rotation error.
    dot = abs(sum(a * b for a, b in zip(left, right)))
    return 2.0 * math.acos(max(-1.0, min(1.0, dot)))


def _transform_error(left: dict[str, Any], right: dict[str, Any]) -> tuple[float, float, float]:
    position_error = max(abs(float(a) - float(b)) for a, b in zip(left["position"], right["position"]))
    scale_error = max(abs(float(a) - float(b)) for a, b in zip(left["scale"], right["scale"]))
    rotation_error = _angular_distance(
        _euler_xyz_to_quaternion(left["rotation"]), _euler_xyz_to_quaternion(right["rotation"])
    )
    return position_error, scale_error, rotation_error


def _epsilon_for(*vectors: Iterable[Any]) -> float:
    """max(1e-4, 1e-6 * |largest component|): absolute near the origin, relative far out."""
    magnitude = max((abs(float(v)) for vector in vectors for v in vector), default=0.0)
    return max(POSITION_SCALE_EPSILON, RELATIVE_EPSILON * magnitude)


def _transform_changed(left: dict[str, Any], right: dict[str, Any]) -> bool:
    position_error, scale_error, rotation_error = _transform_error(left, right)
    return (
        position_error > _epsilon_for(left["position"], right["position"])
        or scale_error > _epsilon_for(left["scale"], right["scale"])
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
    """@project/<path> (assets/, packs/, anywhere in the project) and @engine/<path>."""
    project_root = _normalize_project_root(project_root)
    logical = _normalize_posix_path(str(url))
    if logical.startswith("@project/"):
        base, relative = project_root, PurePosixPath(logical[len("@project/") :])
    elif logical.startswith("@engine/"):
        base = project_root / "node_modules" / "@gnsx" / "genesys.js"
        relative = PurePosixPath(logical[len("@engine/") :])
    else:
        raise BridgeError(f"Unsupported asset URL: {url}")
    _require(relative.parts and ".." not in relative.parts, f"Unsupported asset URL: {url}")
    return base / Path(*relative.parts)


def _gltf_extensions_used(path: Path) -> set[str]:
    try:
        with path.open("rb") as handle:
            head = handle.read(20)
            if head[:4] != b"glTF":
                return set()
            length = struct.unpack("<I", head[12:16])[0]
            return set(json.loads(handle.read(length)).get("extensionsUsed", []))
    except (OSError, ValueError, struct.error):
        return set()


def _importable_glb(path: Path, project_root: Path) -> Path:
    """Engine GLBs ship KTX2 (KHR_texture_basisu), Meshopt and quantized data that Blender
    cannot import (they came in as cubes). Convert once through
    genesys-blender-modeling/scripts/plain-glb.mjs into .scratch/blender-bridge/plain-glb/."""
    if path.suffix.lower() != ".glb" or not (_gltf_extensions_used(path) & BLENDER_UNSUPPORTED_GLTF):
        return path
    _require(PLAIN_GLB_SCRIPT.exists(), f"Missing {PLAIN_GLB_SCRIPT} (genesys-blender-modeling skill) to convert {path.name}")
    _require(shutil.which("node") is not None, f"node is not on PATH; cannot convert {path.name} for Blender")
    cache = project_root / SCRATCH_REL / "plain-glb"
    cache.mkdir(parents=True, exist_ok=True)
    key = hashlib.sha1(str(path.resolve()).encode("utf-8")).hexdigest()[:12]
    out = cache / f"{path.stem}.{key}.glb"
    if out.exists() and out.stat().st_mtime >= path.stat().st_mtime:
        return out
    tmp = out.with_suffix(f".{os.getpid()}.tmp.glb")
    result = subprocess.run(
        ["node", str(PLAIN_GLB_SCRIPT), str(path), str(tmp)],
        cwd=str(project_root),
        capture_output=True,
        text=True,
    )
    if result.returncode != 0 or not tmp.exists():
        if tmp.exists():
            tmp.unlink()
        raise BridgeError(
            f"plain-glb.mjs could not convert {path.name} (exit {result.returncode}): "
            f"{(result.stderr or result.stdout or '').strip()[:300]}"
        )
    os.replace(tmp, out)
    return out


def _resolve_import_asset_path(url: str, project_root: Path) -> tuple[Path, Path | None]:
    primary = resolve_asset_path(url, project_root)
    if primary.exists():
        return _importable_glb(primary, project_root), None
    if not (_normalize_posix_path(url).startswith("@engine/assets/") and primary.suffix.lower() == ".glb"):
        raise BridgeError(f"Asset not found: {primary}")
    candidates = list((project_root / "assets").rglob(primary.name))
    if len(candidates) == 1:
        return _importable_glb(candidates[0], project_root), primary
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


def _principled_bsdf(material: bpy.types.Material) -> Any:
    """The material's Principled BSDF, found by node type (node names are localized)."""
    try:
        material.use_nodes = True  # deprecated (always on) in Blender 5.x; harmless there
    except (AttributeError, TypeError):
        pass
    if material.node_tree is None:
        return None
    return next((node for node in material.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def _guide_material() -> bpy.types.Material:
    material = bpy.data.materials.get("GenesysBridgeGuideOrange")
    if material is None:
        material = bpy.data.materials.new("GenesysBridgeGuideOrange")
    principled = _principled_bsdf(material)
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
        principled = _principled_bsdf(material)
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


# Primitive meshes are built with bmesh (no operators, no context). Mesh data is in the
# Blender-local frame of a mirrored object: Genesys local (x, y, z) -> Blender (x, -z, y), so a
# three.js shape built along +Y stands along +Z here, and one lying in the XY plane (plane,
# circle, torus) is turned +90 degrees about X.
_QUARTER_TURN_X = Matrix.Rotation(math.pi / 2.0, 4, "X")


def _new_mesh_from_bmesh(bm: bmesh.types.BMesh, name: str) -> bpy.types.Mesh:
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    mesh.update()
    return mesh


def _box_mesh(width: float, height: float, depth: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=(max(width, 0.001), max(depth, 0.001), max(height, 0.001)), verts=bm.verts)
    return _new_mesh_from_bmesh(bm, "GenesysBox")


def _cylinder_mesh(radius_top: float, radius_bottom: float, height: float, segments: int = 32) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_cone(
        bm,
        cap_ends=True,
        cap_tris=False,
        segments=segments,
        radius1=max(radius_bottom, 0.0),
        radius2=max(radius_top, 0.0),
        depth=max(height, 0.001),
    )
    return _new_mesh_from_bmesh(bm, "GenesysCylinder")


def _sphere_mesh(radius: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=32, v_segments=16, radius=max(radius, 0.001))
    return _new_mesh_from_bmesh(bm, "GenesysSphere")


def _icosphere_mesh(radius: float, detail: int) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_icosphere(bm, subdivisions=max(1, min(detail + 1, 4)), radius=max(radius, 0.001))
    return _new_mesh_from_bmesh(bm, "GenesysIcosphere")


def _capsule_mesh(radius: float, length: float) -> bpy.types.Mesh:
    """No capsule operator exists in Blender 5.x: split a UV sphere at its equator and
    push the halves apart by the straight length (three.js CapsuleGeometry, along +Y)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=24, v_segments=15, radius=max(radius, 0.001))
    half = max(length, 0.0) * 0.5
    for vert in bm.verts:
        vert.co.z += half if vert.co.z >= 0.0 else -half
    return _new_mesh_from_bmesh(bm, "GenesysCapsule")


def _plane_mesh(width: float, height: float) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=0.5)
    bmesh.ops.scale(bm, vec=(max(width, 0.001), max(height, 0.001), 1.0), verts=bm.verts)
    bmesh.ops.transform(bm, matrix=_QUARTER_TURN_X, verts=bm.verts)
    return _new_mesh_from_bmesh(bm, "GenesysPlane")


def _circle_mesh(radius: float, segments: int = 32) -> bpy.types.Mesh:
    bm = bmesh.new()
    bmesh.ops.create_circle(bm, cap_ends=True, cap_tris=False, segments=segments, radius=max(radius, 0.001))
    bmesh.ops.transform(bm, matrix=_QUARTER_TURN_X, verts=bm.verts)
    return _new_mesh_from_bmesh(bm, "GenesysCircle")


def _torus_mesh(major_radius: float, minor_radius: float, major_segments: int = 48, minor_segments: int = 12) -> bpy.types.Mesh:
    bm = bmesh.new()
    rings = []
    for i in range(major_segments):
        u = 2.0 * math.pi * i / major_segments
        ring = []
        for j in range(minor_segments):
            v = 2.0 * math.pi * j / minor_segments
            r = major_radius + minor_radius * math.cos(v)
            ring.append(bm.verts.new((r * math.cos(u), r * math.sin(u), minor_radius * math.sin(v))))
        rings.append(ring)
    for i in range(major_segments):
        a, b = rings[i], rings[(i + 1) % major_segments]
        for j in range(minor_segments):
            k = (j + 1) % minor_segments
            bm.faces.new((a[j], b[j], b[k], a[k]))
    bmesh.ops.transform(bm, matrix=_QUARTER_TURN_X, verts=bm.verts)
    return _new_mesh_from_bmesh(bm, "GenesysTorus")


def _buffer_geometry_mesh(geometry: dict[str, Any]) -> bpy.types.Mesh:
    """A three.js BufferGeometry JSON (data.attributes.position, optional data.index)."""
    data = geometry.get("data") or {}
    position = (data.get("attributes") or {}).get("position") or {}
    values = position.get("array")
    _require(isinstance(values, list) and len(values) >= 9, "BufferGeometry has no position array")
    _require(int(position.get("itemSize", 3)) == 3, "BufferGeometry position itemSize must be 3")
    verts = [(float(values[k]), -float(values[k + 2]), float(values[k + 1])) for k in range(0, len(values) - 2, 3)]
    index = (data.get("index") or {}).get("array")
    indices = [int(v) for v in index] if isinstance(index, list) and index else list(range(len(verts)))
    faces = [tuple(indices[k : k + 3]) for k in range(0, len(indices) - 2, 3)]
    _require(all(0 <= v < len(verts) for face in faces for v in face), "BufferGeometry index out of range")
    mesh = bpy.data.meshes.new("GenesysBufferGeometry")
    mesh.from_pydata(verts, [], faces)
    mesh.validate(clean_customdata=False)
    mesh.update()
    return mesh


def _primitive_mesh_from_geometry(geometry_payload: Any) -> tuple[bpy.types.Mesh, str]:
    geometry = _geometry_dict(geometry_payload)
    geometry_type = _geometry_type_name(geometry)
    parameters = geometry.get("parameters", geometry)
    if not isinstance(parameters, dict):
        parameters = {}

    def number(key: str, default: float) -> float:
        value = parameters.get(key, default)
        return float(default if value is None else value)

    if geometry_type in {"BoxGeometry", "BoxBufferGeometry", "box", "cube"}:
        return _box_mesh(number("width", 1.0), number("height", 1.0), number("depth", 1.0)), "box"
    if geometry_type in {"CylinderGeometry", "CylinderBufferGeometry", "cylinder"}:
        radius = number("radius", 0.5)
        return _cylinder_mesh(number("radiusTop", radius), number("radiusBottom", radius), number("height", 1.0)), "cylinder"
    if geometry_type in {"ConeGeometry", "ConeBufferGeometry", "cone"}:
        return _cylinder_mesh(0.0, number("radius", 0.5), number("height", 1.0)), "cone"
    if geometry_type in {"SphereGeometry", "SphereBufferGeometry", "sphere"}:
        return _sphere_mesh(number("radius", 0.5)), "sphere"
    if geometry_type in {"IcosahedronGeometry", "icosahedron"}:
        return _icosphere_mesh(number("radius", 1.0), int(number("detail", 0))), "icosahedron"
    if geometry_type in {"CapsuleGeometry", "capsule"}:
        length = parameters.get("length", parameters.get("height", 1.0))
        return _capsule_mesh(number("radius", 0.25), float(1.0 if length is None else length)), "capsule"
    if geometry_type in {"PlaneGeometry", "PlaneBufferGeometry", "plane"}:
        return _plane_mesh(number("width", 1.0), number("height", 1.0)), "plane"
    if geometry_type in {"CircleGeometry", "circle"}:
        return _circle_mesh(number("radius", 1.0)), "circle"
    if geometry_type in {"TorusGeometry", "torus"}:
        return _torus_mesh(number("radius", 1.0), number("tube", 0.4)), "torus"
    if geometry_type == "BufferGeometry" and isinstance(geometry.get("data"), dict):
        return _buffer_geometry_mesh(geometry), "buffer"
    raise BridgeError(f"Unsupported MeshNode geometry type: {geometry_type or '<missing>'}")


def _light_type_for_class(class_name: str) -> str | None:
    """Blender light type, or None for lights Blender has no object for (ambient and
    hemisphere light are world lighting in Blender): those mirror as an empty."""
    if class_name.endswith("DirectionalLightNode"):
        return "SUN"
    if class_name.endswith("SpotLightNode"):
        return "SPOT"
    if class_name.endswith("PointLightNode"):
        return "POINT"
    if class_name.endswith("RectAreaLightNode") or class_name.endswith("AreaLightNode"):
        return "AREA"
    return None


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
    placeholder_reason: str | None = None
    missing_source = False
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
        # One unsupported or malformed mesh must not abort the sync: it becomes a
        # placeholder empty that still carries the node id, so its transform round-trips.
        try:
            mesh, primitive_type = _primitive_mesh_from_geometry(record.get("geometry"))
            obj = bpy.data.objects.new(name, mesh)
            material = _cached_material(record.get("material"), material_cache)
            obj.data.materials.clear()
            obj.data.materials.append(material)
        except Exception as error:  # noqa: BLE001 - any geometry failure becomes a placeholder
            placeholder_reason = str(error) or type(error).__name__
            obj = bpy.data.objects.new(name, None)
            obj.empty_display_type = "CUBE"
            obj.empty_display_size = 0.5
            primitive_type = None
    elif _is_light_class(class_name):
        light_type = _light_type_for_class(class_name)
        if light_type is None:
            obj = bpy.data.objects.new(name, None)
            obj.empty_display_type = "SPHERE"
            obj.empty_display_size = 0.3
        else:
            obj = bpy.data.objects.new(name, bpy.data.lights.new(name, type=light_type))
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
        placeholder_reason = f"model not importable: {record.get('modelUrl') or '<no modelUrl>'}"
    if record.get("unsupportedReason") and placeholder_reason is None and obj.type == "EMPTY" and class_name != "ENGINE.SceneNode":
        placeholder_reason = str(record["unsupportedReason"])
    if placeholder_reason:
        obj["genesys_placeholder_reason"] = placeholder_reason
    return obj, primitive_type


def _restore_record_names(records: list[dict[str, Any]], created: dict[str, bpy.types.Object]) -> None:
    """Objects built while an older mirror still existed got `.001` names. Once the old
    collection is gone, give each object its Genesys name back where it is free, then
    remember the final Blender name: a later duplicate copies the property but not the name,
    which is how the diff tells the original from its copies."""
    for record in records:
        obj = created.get(str(record["id"]))
        if obj is None:
            continue
        wanted = str(record["name"])
        if obj.name != wanted:
            # The plain name, else the lowest free .NNN suffix (Twin, Twin.001, not Twin.003).
            candidates = [wanted] + [f"{wanted}.{index:03d}" for index in range(1, 1000)]
            for candidate in candidates:
                if candidate == obj.name:
                    break
                if bpy.data.objects.get(candidate) is None:
                    obj.name = candidate
                    break
        obj["genesys_blender_name"] = obj.name


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
        # The original still has the name it got at sync (genesys_blender_name, which may
        # carry a .001 suffix); a Blender duplicate copies that property under a new name.
        originals = [obj for obj in objects if obj.name == str(obj.get("genesys_blender_name") or baseline_name)]
        if len(originals) != 1:
            originals = [obj for obj in objects if obj.name == baseline_name]
        if len(originals) != 1:
            raise BridgeError(
                f"Ambiguous duplicate genesys_node_id {node_id} on "
                f"{', '.join(sorted(obj.name for obj in objects))}: rename none of them, or delete "
                "the extra copies, then diff again"
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
                        "genesys_placeholder_reason",
                        "genesys_blender_name",
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


def _current_genesys_world_matrix(obj: bpy.types.Object) -> M4:
    return _blender_world_to_genesys_matrix(obj.matrix_world)


def _transform_from_genesys_matrix(matrix: M4) -> dict[str, list[float]]:
    return _decompose(matrix)


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
    referenced_urls = sorted(
        {
            _normalize_posix_path(str(record["modelUrl"]))
            for record in manifest["records"]
            if record.get("modelUrl")
        }
    )
    engine_urls = [url for url in referenced_urls if url.startswith("@engine/")]
    # Every project model under assets/models, plus whatever the scene references anywhere
    # else (packs/, other assets/ folders, the engine).
    all_urls = sorted(dict.fromkeys(project_urls + referenced_urls))
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
    placeholders: list[dict[str, Any]] = []
    for record in ordered_records:
        obj, _ = _instantiate_record_object(record, library_sources, material_cache)
        if obj.get("genesys_placeholder_reason"):
            placeholders.append(
                {"id": str(record["id"]), "name": str(record["name"]), "reason": str(obj["genesys_placeholder_reason"])}
            )
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
    _restore_record_names(ordered_records, created)
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
        referencedModelUrls=len(referenced_urls),
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
            _mat_mul(_affine_inverse(baseline_parent_matrix), baseline_world_matrix)
        )
        current_parent_matrix = (
            _current_genesys_world_matrix(obj.parent)
            if obj.parent is not None
            else _identity4()
        )
        current_local = _transform_from_genesys_matrix(
            _mat_mul(
                _affine_inverse(current_parent_matrix),
                _current_genesys_world_matrix(obj),
            )
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
            else _identity4()
        )
        desired_local_matrix = _mat_mul(_affine_inverse(parent_world), _current_genesys_world_matrix(obj))
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
    parser = argparse.ArgumentParser(
        prog="blender_bridge.py",
        description="Genesys <-> Blender scene bridge. Run inside Blender: "
        "blender -b [file.blend] --python blender_bridge.py -- <command> ... "
        "The last stdout lines are one JSON result and RESULT ok|fail.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    target_help = (
        "Name of the Blender scene collection to build or read. Default: the scene file name "
        "from the manifest's sourceScene (e.g. default.genesys-scene)."
    )
    sync_parser = subparsers.add_parser("sync-from-genesys", help="Build the Blender mirror from a merged manifest")
    sync_parser.add_argument("--manifest", required=True, help="Merged manifest JSON (merge_manifest_chunks.py)")
    sync_parser.add_argument("--project-root", required=True, help="Game project root (has assets/ and node_modules/)")
    sync_parser.add_argument("--output", required=True, help="Output .blend, e.g. .scratch/blender-bridge/<scene>.blend")
    sync_parser.add_argument("--target-level", help=target_help)
    sync_parser.add_argument("--overwrite", action="store_true", help="Replace an existing output file")
    sync_parser.add_argument(
        "--replace-untagged",
        action="store_true",
        help="Allow replacing a target collection that holds objects the bridge did not create "
        "(they are deleted and listed in swap.deletedUntagged)",
    )

    diff_parser = subparsers.add_parser("diff", help="Write the reviewed-edit delta from the open .blend")
    diff_parser.add_argument("--target-level", help=target_help)
    diff_parser.add_argument("--output", help="Delta JSON, e.g. .scratch/blender-bridge/changes.bridge-delta.json")

    validate_parser = subparsers.add_parser("validate", help="Check a fresh mirror against its baseline")
    validate_parser.add_argument("--target-level", help=target_help)
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
        ok = bool(result.get("ok", False))
    except BridgeError as error:
        _print_json_result(_error_result(operation, error))
        ok = False
    except Exception as error:  # pragma: no cover - Blender runtime failure path
        _print_json_result(_error_result(operation, error))
        ok = False
    # Blender's exit status does not reliably carry the script's; callers read this line.
    sys.stdout.write(f"RESULT {'ok' if ok else 'fail'}\n")
    sys.stdout.flush()
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
