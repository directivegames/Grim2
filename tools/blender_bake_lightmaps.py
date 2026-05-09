"""
Blender Lightmap Baking Workflow for Genesys

This script helps with the post-import baking workflow:
1. Adds UV2 (lightmap UV) to all meshes
2. Sets up Cycles for baking
3. Bakes lighting/shadows to textures
4. Exports the baked textures and updated GLBs

Usage in Blender (after running import_genesys_scene.py):
1. Go to Scripting tab
2. Create new text block
3. Paste this script
4. Configure BAKE_OUTPUT_FOLDER below
5. Click "Run Script"
"""

import bpy
import bmesh
import os

# ============ CONFIGURE THESE ============
BAKE_OUTPUT_FOLDER = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\assets\textures\baked"
BAKE_RESOLUTION = 2048  # Size of baked texture (2048 or 4096 recommended)
# =========================================

def ensure_uv2_on_mesh(obj):
    """Add UV2 channel to a mesh if it doesn't exist, unwrap it for lightmapping"""
    if obj.type != 'MESH':
        return False

    mesh = obj.data

    # Check if UV2 already exists
    if len(mesh.uv_layers) >= 2:
        print(f"  {obj.name}: UV2 already exists")
        return True

    # Enter edit mode to unwrap
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode='EDIT')

    # Select all faces
    bpy.ops.mesh.select_all(action='SELECT')

    # Add new UV map
    bpy.ops.mesh.uv_texture_add()

    # Smart UV project for lightmap (non-overlapping)
    # Island margin ensures no bleeding between UV islands
    bpy.ops.uv.smart_project(
        angle_limit=66,
        island_margin=0.02,
        area_weight=0.0,
        correct_aspect=True,
        scale_to_bounds=False
    )

    # Rename UV2 to "UVMap2"
    mesh.uv_layers.active.name = "UVMap2"

    bpy.ops.object.mode_set(mode='OBJECT')

    print(f"  {obj.name}: Created UV2")
    return True

def setup_bake_material(obj, image_name):
    """Create a temporary material setup for baking emission"""
    mesh = obj.data

    # Create new image for baking
    image = bpy.data.images.new(
        name=image_name,
        width=BAKE_RESOLUTION,
        height=BAKE_RESOLUTION,
        alpha=False,
        float_buffer=False
    )

    # Ensure object has material
    if not mesh.materials:
        mat = bpy.data.materials.new(name=f"{obj.name}_BakeMat")
        mesh.materials.append(mat)
    else:
        mat = mesh.materials[0]

    # Make material use nodes
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links

    # Clear existing nodes
    nodes.clear()

    # Add output node
    output = nodes.new(type='ShaderNodeOutputMaterial')
    output.location = (300, 0)

    # Add emission node (we'll bake emission to get combined lighting)
    emission = nodes.new(type='ShaderNodeEmission')
    emission.location = (0, 0)

    # Add texture node for the bake target
    tex_node = nodes.new(type='ShaderNodeTexImage')
    tex_node.location = (-300, -200)
    tex_node.image = image
    tex_node.select = True
    nodes.active = tex_node

    # Link emission to output
    links.new(emission.outputs['Emission'], output.inputs['Surface'])

    # Store reference to image for baking
    obj["bake_image"] = image.name

    return image

def prepare_all_meshes():
    """Add UV2 to all mesh objects in the scene"""
    print("\n" + "=" * 60)
    print("PREPARING MESHES FOR LIGHTMAPPING")
    print("=" * 60)

    mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']

    for obj in mesh_objects:
        ensure_uv2_on_mesh(obj)

    print(f"\nPrepared {len(mesh_objects)} meshes")

def setup_cycles_for_bake():
    """Configure Cycles render engine for baking"""
    print("\nSetting up Cycles for baking...")

    # Switch to Cycles
    bpy.context.scene.render.engine = 'CYCLES'

    # Set device to GPU if available (faster)
    # bpy.context.scene.cycles.device = 'GPU'

    # Configure bake settings
    bpy.context.scene.cycles.bake_type = 'COMBINED'
    bpy.context.scene.render.bake.use_pass_direct = True
    bpy.context.scene.render.bake.use_pass_indirect = True
    bpy.context.scene.render.bake.use_pass_color = True
    bpy.context.scene.render.bake.use_pass_glossy = False
    bpy.context.scene.render.bake.use_pass_transmission = False
    bpy.context.scene.render.bake.use_pass_emit = False

    # Margin to prevent edge bleeding
    bpy.context.scene.render.bake.margin = 4

    print("Cycles configured")

def bake_selected_objects():
    """Bake lighting for all selected mesh objects"""
    print("\n" + "=" * 60)
    print("BAKING LIGHTING")
    print("=" * 60)

    os.makedirs(BAKE_OUTPUT_FOLDER, exist_ok=True)

    mesh_objects = [obj for obj in bpy.context.selected_objects if obj.type == 'MESH']

    if not mesh_objects:
        print("No mesh objects selected! Please select the objects you want to bake.")
        return

    for obj in mesh_objects:
        print(f"\nBaking: {obj.name}")

        # Deselect all
        bpy.ops.object.select_all(action='DESELECT')

        # Select only this object
        obj.select_set(True)
        bpy.context.view_layer.objects.active = obj

        # Setup material for bake
        image_name = f"{obj.name}_lightmap"
        image = setup_bake_material(obj, image_name)

        # Get the texture node and make it active
        mat = obj.data.materials[0]
        tex_node = mat.node_tree.nodes.get("Image Texture")
        if tex_node:
            tex_node.select = True
            mat.node_tree.nodes.active = tex_node

        # Perform bake
        try:
            bpy.ops.object.bake(
                type='COMBINED',
                pass_filter={'COLOR'},
                filepath=os.path.join(BAKE_OUTPUT_FOLDER, f"{image_name}.png"),
                save_mode='EXTERNAL',
                width=BAKE_RESOLUTION,
                height=BAKE_RESOLUTION,
                margin=4,
                use_selected_to_active=False,
                target='IMAGE_TEXTURES'
            )

            # Save image
            image.filepath_raw = os.path.join(BAKE_OUTPUT_FOLDER, f"{image_name}.png")
            image.file_format = 'PNG'
            image.save()

            print(f"  Saved: {image.filepath_raw}")

        except Exception as e:
            print(f"  ERROR baking {obj.name}: {e}")

def export_with_uv2(output_folder):
    """Export all meshes as GLBs with UV2 included"""
    print("\n" + "=" * 60)
    print("EXPORTING GLBS WITH UV2")
    print("=" * 60)

    os.makedirs(output_folder, exist_ok=True)

    # Deselect all
    bpy.ops.object.select_all(action='DESELECT')

    # Export each mesh object individually
    mesh_objects = [obj for obj in bpy.data.objects if obj.type == 'MESH']

    for obj in mesh_objects:
        # Select only this object
        bpy.ops.object.select_all(action='DESELECT')
        obj.select_set(True)

        filepath = os.path.join(output_folder, f"{obj.name}.glb")

        print(f"Exporting: {filepath}")

        bpy.ops.export_scene.gltf(
            filepath=filepath,
            use_selection=True,
            export_format='GLB',
            export_yup=True,
            export_uvs=True,  # This includes UV2
            export_normals=True,
            export_materials='EXPORT',
            export_apply=True
        )

    print(f"\nExported {len(mesh_objects)} GLB files")

def main():
    """Full workflow"""
    print("=" * 60)
    print("GENESYS LIGHTMAP BAKING WORKFLOW")
    print("=" * 60)

    # Step 1: Prepare meshes
    prepare_all_meshes()

    # Step 2: Setup cycles
    setup_cycles_for_bake()

    print("\n" + "=" * 60)
    print("NEXT STEPS (Manual)")
    print("=" * 60)
    print("""
1. Select all objects you want to bake (or use 'A' to select all)
2. Set up your lighting in Blender (add sun lamp, adjust world lighting)
3. Position camera to match your isometric view if needed
4. Run bake_selected_objects() when ready:

   >>> bake_selected_objects()

5. After baking, export with UV2:

   >>> export_with_uv2(r"path/to/output")

NOTE: For the final workflow, you may want to:
- Bake individual objects OR bake to a single atlas texture
- For atlas baking: unwrap all objects to shared UV space
- Adjust lightmap resolution per object importance
""")

if __name__ == "__main__":
    main()
