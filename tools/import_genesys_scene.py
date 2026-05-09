"""
Import a Genesys scene into Blender for lightmap baking.

This script rebuilds the level layout from a .genesys-scene file:
- GLB/GLTF actors are imported and placed using the Genesys scene transform.
- MeshComponent actors are recreated as Blender primitives for floors/roads/grass.
- Three.js Y-up scene transforms are converted to Blender Z-up transforms.
- Materials are lightweight by default to avoid Blender crashing in material preview.

Usage in Blender:
1. Open Blender.
2. Go to the Scripting tab.
3. Open this file or paste it into a new text block.
4. Check SCENE_FILE_PATH and PROJECT_ROOT below.
5. Run Script.

Important:
- Leave LOAD_TEXTURE_IMAGES = False for the first import. This prevents Blender from
  loading every project texture at once when you switch to material preview.
- After placement looks correct, you can set LOAD_TEXTURE_IMAGES = True and re-import.
"""

import json
import math
import os

import bpy
import mathutils

# ============ CONFIGURE THESE PATHS ============
SCENE_FILE_PATH = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\assets\default.genesys-scene"
PROJECT_ROOT = r"C:\Users\r2fir\Desktop\test game\Grim\Grim"
# ===============================================

# Keep this false until the level is positioned correctly. Full texture preview can
# consume a lot of VRAM/RAM and crash Blender on a large scene.
LOAD_TEXTURE_IMAGES = False

# Remove old objects from previous runs of this importer.
CLEAR_PREVIOUS_IMPORT = True

# Material colors used when LOAD_TEXTURE_IMAGES is false.
MATERIAL_COLOR_HINTS = {
    "grass": (0.18, 0.35, 0.12, 1.0),
    "road": (0.08, 0.08, 0.08, 1.0),
    "sidewalk": (0.45, 0.45, 0.42, 1.0),
    "default": (0.7, 0.7, 0.7, 1.0),
}

# Three.js/glTF Y-up to Blender Z-up:
# Three (x, y-up, z) -> Blender (x, -z, y)
THREE_TO_BLENDER = mathutils.Matrix((
    (1.0, 0.0, 0.0),
    (0.0, 0.0, -1.0),
    (0.0, 1.0, 0.0),
))


def resolve_project_path(url):
    """Convert @project/assets/... to an absolute local path."""
    if not isinstance(url, str):
        return None
    if url.startswith("@project/"):
        return os.path.join(PROJECT_ROOT, url[len("@project/"):])
    return url


def vector_from_data(data, default):
    if isinstance(data, dict) and data.get("$bc") == "v3" and isinstance(data.get("_"), list):
        values = data["_"]
        if len(values) >= 3:
            return mathutils.Vector((float(values[0]), float(values[1]), float(values[2])))
    return mathutils.Vector(default)


def euler_from_data(data):
    if isinstance(data, dict) and data.get("$bc") == "e" and isinstance(data.get("_"), list):
        values = data["_"]
        if len(values) >= 3:
            return mathutils.Euler((float(values[0]), float(values[1]), float(values[2])), "XYZ")
    return mathutils.Euler((0.0, 0.0, 0.0), "XYZ")


def convert_position(pos_data):
    pos = vector_from_data(pos_data, (0.0, 0.0, 0.0))
    return THREE_TO_BLENDER @ pos


def convert_scale(scale_data):
    scale = vector_from_data(scale_data, (1.0, 1.0, 1.0))
    return mathutils.Vector((scale.x, scale.z, scale.y))


def convert_rotation(rot_data):
    euler = euler_from_data(rot_data)
    three_matrix = euler.to_matrix()
    blender_matrix = THREE_TO_BLENDER @ three_matrix @ THREE_TO_BLENDER.inverted()
    return blender_matrix.to_euler("XYZ")


def apply_scene_transform(obj, component_data):
    """Apply a serialized Genesys component transform to a Blender object."""
    obj.location = convert_position(component_data.get("position"))
    obj.rotation_euler = convert_rotation(component_data.get("rotation"))
    obj.scale = convert_scale(component_data.get("scale"))


def collection_for_name(name):
    existing = bpy.data.collections.get(name)
    if existing:
        return existing
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    return collection


def unlink_from_all_collections(obj):
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)


def move_object_to_collection(obj, collection):
    if obj.name not in collection.objects.keys():
        unlink_from_all_collections(obj)
        collection.objects.link(obj)


def clear_previous_imports():
    if not CLEAR_PREVIOUS_IMPORT:
        return

    for collection_name in ("Genesys_GLTF_Models", "Genesys_Primitives", "Genesys_Lights"):
        collection = bpy.data.collections.get(collection_name)
        if not collection:
            continue

        for obj in list(collection.objects):
            bpy.data.objects.remove(obj, do_unlink=True)

        if not collection.objects and not collection.children:
            bpy.data.collections.remove(collection)


def material_reference_name(material_ref):
    if isinstance(material_ref, str):
        return os.path.basename(material_ref).replace(".material.json", "")
    if isinstance(material_ref, dict):
        return material_ref.get("name", "DefaultMaterial")
    return "DefaultMaterial"


def material_color(material_name):
    lower = material_name.lower()
    for key, color in MATERIAL_COLOR_HINTS.items():
        if key in lower:
            return color
    return MATERIAL_COLOR_HINTS["default"]


def load_material_json(material_ref):
    """Read a Genesys .material.json file. Returns the $root object or None."""
    if not isinstance(material_ref, str):
        return None

    path = resolve_project_path(material_ref)
    if not path or not os.path.exists(path):
        return None

    try:
        with open(path, "r", encoding="utf-8") as handle:
            data = json.load(handle)
        return data.get("$root", data)
    except Exception as exc:
        print(f"    Could not load material {material_ref}: {exc}")
        return None


def get_texture_path(material_root, key):
    if not isinstance(material_root, dict):
        return None
    texture_data = material_root.get(key)
    if isinstance(texture_data, dict):
        return resolve_project_path(texture_data.get("url"))
    return None


def create_blender_material(material_ref):
    """Create a stable Blender material for preview and baking setup."""
    name = material_reference_name(material_ref)
    existing = bpy.data.materials.get(name)
    if existing:
        return existing

    mat = bpy.data.materials.new(name=name)
    mat.use_nodes = True
    mat.diffuse_color = material_color(name)

    nodes = mat.node_tree.nodes
    bsdf = nodes.get("Principled BSDF")
    if bsdf:
        try:
            bsdf.inputs["Base Color"].default_value = mat.diffuse_color
            bsdf.inputs["Roughness"].default_value = 0.85
        except Exception:
            pass

    if not LOAD_TEXTURE_IMAGES:
        return mat

    material_root = load_material_json(material_ref)
    map_path = get_texture_path(material_root, "map")
    if not map_path or not os.path.exists(map_path) or not bsdf:
        return mat

    try:
        image = bpy.data.images.load(map_path, check_existing=True)
        image.colorspace_settings.name = "sRGB"
        tex_node = nodes.new(type="ShaderNodeTexImage")
        tex_node.image = image
        tex_node.location = (-350, 150)
        mat.node_tree.links.new(tex_node.outputs["Color"], bsdf.inputs["Base Color"])
    except Exception as exc:
        print(f"    Could not load texture {map_path}: {exc}")

    return mat


def ensure_default_uvs(obj):
    """Give generated primitives usable UVs for preview/baking."""
    if obj.type != "MESH":
        return

    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    previous_mode = bpy.context.object.mode if bpy.context.object else "OBJECT"
    if previous_mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")

    try:
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        bpy.ops.object.mode_set(mode="EDIT")
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.smart_project(angle_limit=66.0, island_margin=0.02)
        bpy.ops.object.mode_set(mode="OBJECT")
    except Exception as exc:
        print(f"    UV unwrap failed for {obj.name}: {exc}")
        try:
            bpy.ops.object.mode_set(mode="OBJECT")
        except Exception:
            pass
    finally:
        obj.select_set(False)


def create_mesh_component_object(actor_name, component_data):
    """Create the visual mesh used by ENGINE.MeshComponent."""
    geometry = component_data.get("geometry")
    geometry_type = geometry.get("$bc") if isinstance(geometry, dict) else "THREE.BoxGeometry"

    bpy.ops.object.select_all(action="DESELECT")

    if geometry_type == "THREE.PlaneGeometry":
        params = geometry.get("_", [1.0, 1.0]) if isinstance(geometry, dict) else [1.0, 1.0]
        width = float(params[0]) if len(params) > 0 else 1.0
        height = float(params[1]) if len(params) > 1 else 1.0
        bpy.ops.mesh.primitive_plane_add(size=1.0)
        obj = bpy.context.active_object
        obj.name = actor_name
        # Plane lies in Blender XY. This matches Three XZ ground after axis conversion.
        obj.scale = (width, height, 1.0)
    else:
        params = geometry.get("_", [1.0, 1.0, 1.0]) if isinstance(geometry, dict) else [1.0, 1.0, 1.0]
        width = float(params[0]) if len(params) > 0 else 1.0
        height = float(params[1]) if len(params) > 1 else 1.0
        depth = float(params[2]) if len(params) > 2 else 1.0
        bpy.ops.mesh.primitive_cube_add(size=1.0)
        obj = bpy.context.active_object
        obj.name = actor_name
        # Three BoxGeometry(width, height(Y-up), depth) -> Blender dimensions X, Y, Z.
        obj.scale = (width, depth, height)

    material = create_blender_material(component_data.get("material"))
    obj.data.materials.append(material)
    ensure_default_uvs(obj)
    apply_scene_transform(obj, component_data)
    return obj


def imported_roots(imported_objects):
    imported_set = set(imported_objects)
    return [obj for obj in imported_objects if obj.parent not in imported_set]


def import_gltf_actor(actor_name, component_data, collection):
    model_url = component_data.get("modelUrl")
    model_path = resolve_project_path(model_url)

    if not model_path or not os.path.exists(model_path):
        print(f"  Missing model: {model_url}")
        return None

    before = set(bpy.data.objects)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.import_scene.gltf(filepath=model_path)
    imported = list(set(bpy.data.objects) - before)

    if not imported:
        print(f"  No objects imported from: {model_url}")
        return None

    container = bpy.data.objects.new(actor_name, None)
    collection.objects.link(container)

    roots = imported_roots(imported)
    for root in roots:
        root.parent = container

    for obj in imported:
        if obj.type == "MESH":
            obj["genesys_source_actor"] = actor_name
        if not obj.users_collection:
            collection.objects.link(obj)
        else:
            for user_collection in list(obj.users_collection):
                if user_collection != collection:
                    user_collection.objects.unlink(obj)
            if obj.name not in collection.objects.keys():
                collection.objects.link(obj)

    apply_scene_transform(container, component_data)
    container["genesys_model_url"] = model_url
    return container


def create_light(actor_name, component_data):
    """Import scene lights as Blender lights for baking reference."""
    bc = component_data.get("$bc")
    light = None

    if bc == "ENGINE.DirectionalLightComponent":
        light_data = bpy.data.lights.new(actor_name, type="SUN")
        light_data.energy = 3.0
        light = bpy.data.objects.new(actor_name, light_data)
    elif bc == "ENGINE.PointLightComponent":
        light_data = bpy.data.lights.new(actor_name, type="POINT")
        light_data.energy = 150.0
        light = bpy.data.objects.new(actor_name, light_data)
    elif bc == "ENGINE.SpotLightComponent":
        light_data = bpy.data.lights.new(actor_name, type="SPOT")
        light_data.energy = 500.0
        light = bpy.data.objects.new(actor_name, light_data)

    if not light:
        return None

    apply_scene_transform(light, component_data)
    return light


def actor_root(actor):
    root = actor.get("rootComponent")
    return root if isinstance(root, dict) else {}


def find_importable_actors(scene_data):
    """Read top-level World.actors only, avoiding accidental duplicate nested matches."""
    root = scene_data.get("$root", {})
    actors_dict = root.get("actors", {})
    if not isinstance(actors_dict, dict):
        return []

    actors = []
    for _, actor in actors_dict.items():
        if not isinstance(actor, dict):
            continue

        root_component = actor_root(actor)
        root_bc = root_component.get("$bc")
        name = actor.get("name", root_component.get("name", "GenesysActor"))

        if root_bc == "ENGINE.GLTFMeshComponent" and root_component.get("modelUrl"):
            actors.append(("gltf", name, root_component))
        elif root_bc == "ENGINE.MeshComponent":
            # MeshComponent defaults to a 1x1x1 BoxGeometry when geometry is omitted.
            actors.append(("mesh", name, root_component))
        elif root_bc in (
            "ENGINE.DirectionalLightComponent",
            "ENGINE.PointLightComponent",
            "ENGINE.SpotLightComponent",
        ):
            actors.append(("light", name, root_component))

    return actors


def configure_scene_for_lightmap_work():
    bpy.context.scene.render.engine = "CYCLES"
    bpy.context.scene.cycles.samples = 64
    bpy.context.scene.view_settings.view_transform = "Filmic"
    bpy.context.scene.view_settings.look = "Medium High Contrast"
    bpy.context.scene.world.color = (0.02, 0.02, 0.03)


def main():
    print("=" * 72)
    print("GENESYS SCENE IMPORTER - Blender lightmap layout")
    print("=" * 72)
    print(f"Scene: {SCENE_FILE_PATH}")
    print(f"Project: {PROJECT_ROOT}")
    print(f"Load texture images: {LOAD_TEXTURE_IMAGES}")

    with open(SCENE_FILE_PATH, "r", encoding="utf-8") as handle:
        scene_data = json.load(handle)

    clear_previous_imports()
    configure_scene_for_lightmap_work()

    gltf_collection = collection_for_name("Genesys_GLTF_Models")
    mesh_collection = collection_for_name("Genesys_Primitives")
    light_collection = collection_for_name("Genesys_Lights")

    actors = find_importable_actors(scene_data)
    print(f"Found importable actors: {len(actors)}")
    print(f"  GLTF actors: {sum(1 for kind, _, _ in actors if kind == 'gltf')}")
    print(f"  Mesh primitives: {sum(1 for kind, _, _ in actors if kind == 'mesh')}")
    print(f"  Lights: {sum(1 for kind, _, _ in actors if kind == 'light')}")

    counts = {"gltf": 0, "mesh": 0, "light": 0, "failed": 0}

    for index, (kind, name, component_data) in enumerate(actors, start=1):
        print(f"[{index}/{len(actors)}] {kind}: {name}")

        try:
            if kind == "gltf":
                obj = import_gltf_actor(name, component_data, gltf_collection)
            elif kind == "mesh":
                obj = create_mesh_component_object(name, component_data)
                move_object_to_collection(obj, mesh_collection)
            elif kind == "light":
                obj = create_light(name, component_data)
                if obj:
                    light_collection.objects.link(obj)
            else:
                obj = None

            if obj:
                counts[kind] += 1
            else:
                counts["failed"] += 1
        except Exception as exc:
            counts["failed"] += 1
            print(f"  FAILED: {exc}")

    bpy.ops.object.select_all(action="DESELECT")

    print("=" * 72)
    print("IMPORT COMPLETE")
    print(f"  GLTF actors: {counts['gltf']}")
    print(f"  Mesh primitives: {counts['mesh']}")
    print(f"  Lights: {counts['light']}")
    print(f"  Failed: {counts['failed']}")
    print("=" * 72)
    print("If placement looks correct, set LOAD_TEXTURE_IMAGES = True and re-run.")
    print("If Blender crashes in material preview, keep LOAD_TEXTURE_IMAGES = False for baking layout.")


if __name__ == "__main__":
    main()
