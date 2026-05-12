# ============================================================
# IMPORTANT: Update version numbers on EVERY change!
# Agent must update version number every time he makes an iteration.
# Update both: bl_info["version"] AND EXPORTER_VERSION
# ============================================================

bl_info = {
    "name": "Genesys Exporter",
    "author": "Directive Games - Matthew Squires - Senior Tech Artist",
    "version": (1, 26, 0),
    "blender": (4, 5, 0),
    "location": "View3D > Sidebar > Genesys",
    "description": "Export models and layouts to Genesys game engine format",
    "category": "Import-Export",
}

# Exporter version for material export tracking
EXPORTER_VERSION = "1.26.0"

import bpy
import os
import sys
import subprocess
import math
import shutil
import json
import re
import uuid
from mathutils import Matrix, Vector, Euler
from bpy.props import StringProperty, BoolProperty, EnumProperty, IntProperty, FloatProperty
from bpy.types import Operator, Panel, PropertyGroup

# Add user site-packages to sys.path for PIL/Pillow and other user-installed packages
import site
import platform

# Try multiple common locations for user site-packages
potential_paths = []

# Standard user site-packages
try:
    user_site = site.getusersitepackages()
    if user_site:
        potential_paths.append(user_site)
except:
    pass

# Windows-specific paths
if platform.system() == "Windows":
    import os
    username = os.environ.get('USERNAME', '')
    python_version = f"Python{sys.version_info.major}{sys.version_info.minor}"
    
    # Common Windows user site-packages locations
    potential_paths.extend([
        os.path.join(os.environ.get('APPDATA', ''), 'Python', python_version, 'site-packages'),
        os.path.join(os.environ.get('LOCALAPPDATA', ''), 'Programs', 'Python', python_version, 'site-packages'),
        os.path.join('C:', 'Users', username, 'AppData', 'Roaming', 'Python', python_version, 'site-packages'),
        os.path.join('C:', 'Users', username, 'AppData', 'Local', 'Programs', 'Python', python_version, 'site-packages'),
    ])

# macOS/Linux paths
elif platform.system() in ["Darwin", "Linux"]:
    import os
    home = os.path.expanduser("~")
    python_version = f"python{sys.version_info.major}.{sys.version_info.minor}"
    
    potential_paths.extend([
        os.path.join(home, '.local', 'lib', python_version, 'site-packages'),
        os.path.join(home, 'Library', 'Python', f"{sys.version_info.major}.{sys.version_info.minor}", 'lib', 'python', 'site-packages'),
    ])

# Add existing paths and check if they contain packages
added_paths = []
for path in potential_paths:
    if path and os.path.exists(path) and path not in sys.path:
        sys.path.append(path)
        added_paths.append(path)

if added_paths:
    print(f"[Genesys Exporter] Added {len(added_paths)} user site-packages path(s) to sys.path")
    for p in added_paths:
        print(f"  - {p}")

# ============================================================
# TIMER FUNCTIONS FOR AUTO-CLEARING STATUS
# ============================================================

def clear_export_status(context):
    """Clear export status after 60 seconds"""
    try:
        context.scene.genesys_exporter.export_status = ""
        context.scene.genesys_exporter.export_warnings = ""
    except:
        pass
    return None  # Don't repeat

def clear_layout_status(context):
    """Clear layout export status after 60 seconds"""
    try:
        context.scene.genesys_exporter.layout_export_status = ""
        context.scene.genesys_exporter.layout_export_warnings = ""
    except:
        pass
    return None  # Don't repeat

def reset_layout_button(context):
    """Reset layout button label after 30 seconds"""
    try:
        context.scene.genesys_exporter.layout_button_label = "Export Layout"
    except:
        pass
    return None  # Don't repeat

def clear_utility_status(context):
    """Clear utility status after 60 seconds"""
    try:
        context.scene.genesys_exporter.utility_status = ""
    except:
        pass
    return None  # Don't repeat

# ============================================================
# GLTF EXPORT HOOK - Add custom extensions to materials
# ============================================================

class glTF2ExportUserExtension:
    """Extension class for adding custom GLTF extensions during export"""
    
    def __init__(self):
        self.properties = {}
    
    def gather_material_hook(self, gltf2_material, blender_material, export_settings):
        """Add custom extensions to materials during GLTF export"""
        # Debug: Always print what material we're processing
        if blender_material:
            has_ref = "genesys_material_ref" in blender_material
            print(f"       [GLTF Hook] Processing: {blender_material.name} | Has ref: {has_ref}")
            
            if has_ref:
                print(f"       [GLTF Hook]   Value: {blender_material['genesys_material_ref']}")
        
        if blender_material and "genesys_material_ref" in blender_material:
            material_ref = blender_material["genesys_material_ref"]
            
            # Import Extension class from GLTF IO addon
            try:
                from io_scene_gltf2.io.com.gltf2_io_extensions import Extension
                
                if gltf2_material.extensions is None:
                    gltf2_material.extensions = {}
                
                # Create extension with our custom data
                gltf2_material.extensions["GENESYS_material_overrides"] = Extension(
                    name="GENESYS_material_overrides",
                    extension={
                        "materialOverride": material_ref
                    },
                    required=False
                )
                
                print(f"       [GLTF Hook] ✓ Added extension for: {blender_material.name}")
            except Exception as e:
                print(f"       [GLTF Hook] ✗ Error: {e}")

# ============================================================
# PROPERTIES
# ============================================================

def update_texture_path(self, context):
    """Auto-save when texture path changes"""
    if self.texture_export_custom_path:
        self.has_custom_paths = True

def update_material_path(self, context):
    """Auto-save when material path changes"""
    if self.material_export_custom_path:
        self.has_custom_paths = True

class GenesysObjectExportSettings(PropertyGroup):
    """Per-object export settings - stored with each mesh"""
    
    # Custom paths stored per-object
    texture_export_custom_path: StringProperty(
        name="Texture Path",
        description="Custom texture export path for this object",
        default="",
        subtype='DIR_PATH',
        update=update_texture_path
    )
    
    material_export_custom_path: StringProperty(
        name="Material Path",
        description="Custom material export path for this object",
        default="",
        subtype='DIR_PATH',
        update=update_material_path
    )
    
    # Flag to indicate if this object has custom settings
    has_custom_paths: BoolProperty(
        name="Has Custom Paths",
        description="This object has custom export paths configured",
        default=False
    )

class GenesysExporterProperties(PropertyGroup):
    # Project path
    project_path: StringProperty(
        name="Project Path",
        description="Base path for asset exports (e.g., C:/GIT/ThirdPersonGame/assets/)",
        default="C:/GIT/ThirdPersonGame/assets/",
        subtype='DIR_PATH'
    )
    
    # Layout export path
    layout_export_path: StringProperty(
        name="Layout Export Path",
        description="Subfolder relative to Project Path (e.g., /layouts), or absolute path for custom location",
        default="/layouts"
        # NOTE: No subtype='DIR_PATH' - this makes it a text field, not folder browser
    )
    
    # Use custom layout filename
    use_custom_layout_name: BoolProperty(
        name="Use Custom Filename",
        description="Use custom filename instead of blend file name",
        default=False
    )
    
    # Layout filename
    layout_filename: StringProperty(
        name="Layout Filename",
        description="Name for the exported layout file (without extension)",
        default="Layout01"
    )
    
    # Export settings
    convert_for_threejs: BoolProperty(
        name="Convert for Three.js",
        description="Apply coordinate system conversion for Three.js",
        default=False
    )
    
    export_textures: BoolProperty(
        name="Embed Textures in GLB",
        description="Embed texture files in the GLB",
        default=True
    )
    
    export_textures_to_folder: BoolProperty(
        name="Export Textures to Genesys",
        description="Export texture files as separate files to /textures folder. Texture files must start with T_",
        default=True
    )
    
    show_texture_export_options: BoolProperty(
        name="Show Texture Export Options",
        description="Show/hide texture export path options",
        default=False
    )
    
    texture_export_custom_path: StringProperty(
        name="",
        description="Custom absolute path for texture export (e.g., C:/ProjectTextures). Leave empty to use /assets/textures relative to project path",
        default="or custom path here",
        subtype='DIR_PATH'
    )
    
    export_materials_metadata: BoolProperty(
        name="Create Genesys Materials",
        description="Create .material.json files with material definitions for Genesys engine. Materials must be named M_",
        default=True
    )
    
    show_material_export_options: BoolProperty(
        name="Show Material Export Options",
        description="Show/hide material export path options",
        default=False
    )
    
    material_export_custom_path: StringProperty(
        name="",
        description="Custom absolute path for material export (e.g., C:/SharedMaterials). Leave empty to use /assets/materials relative to project path",
        default="or custom path here",
        subtype='DIR_PATH'
    )
    
    invert_emissive: BoolProperty(
        name="Invert Emissive",
        description="Set emissive to black (#000000) and strength to 1 on export (matches engine defaults)",
        default=True
    )
    
    force_materials: BoolProperty(
        name="Force Materials",
        description="Overwrite existing material files even if they already exist",
        default=False
    )
    
    force_texture_slots: BoolProperty(
        name="Force Texture Slots",
        description="Update texture slots in existing materials with current textures from Blender",
        default=True
    )
    
    # Export status messages
    export_status: StringProperty(
        name="Export Status",
        description="Status message from last export",
        default=""
    )
    
    export_warnings: StringProperty(
        name="Export Warnings",
        description="Warning messages from last export",
        default=""
    )
    
    export_animations: BoolProperty(
        name="Export Animations",
        description="Include animations in export",
        default=True
    )
    
    apply_modifiers: BoolProperty(
        name="Apply Modifiers",
        description="Apply modifiers on export",
        default=True
    )
    
    force_alpha_mode: EnumProperty(
        name="Alpha Mode",
        description="Force alpha/transparency mode for materials",
        items=[
            ('AUTO', 'Auto', 'Let Blender decide'),
            ('OPAQUE', 'Opaque', 'No transparency'),
            ('MASK', 'Mask', 'Binary cutoff'),
            ('BLEND', 'Blend', 'Smooth alpha'),
        ],
        default='AUTO'
    )
    
    alpha_cutoff: FloatProperty(
        name="Alpha Cutoff",
        description="Threshold for MASK mode (0.0-1.0)",
        default=0.5,
        min=0.0,
        max=1.0
    )
    
    generate_uv2: BoolProperty(
        name="Generate UV2 for Lightmapping",
        description="Auto-generate a second UV channel (UVMap-Lightmap) on each mesh before export. Required for lightmaps. Skips meshes that already have UV2.",
        default=False
    )

    # Advanced Export Options
    show_advanced_export: BoolProperty(
        name="Show Advanced Export Options",
        description="Show/hide advanced export options",
        default=False
    )
    
    # Utility Tools
    show_utilities: BoolProperty(
        name="Show Utilities",
        description="Show/hide utility tools section",
        default=False
    )
    
    show_layout: BoolProperty(
        name="Show Layout",
        description="Show/hide layout export section",
        default=False
    )
    
    clean_folders: BoolProperty(
        name="Clean Empty Folders",
        description="Remove empty folders in the imported hierarchy after import",
        default=False
    )
    
    force_instances: BoolProperty(
        name="FORCE INSTANCES",
        description="Force all selected objects to be spawned as InstancedMeshComponent in Genesys editor",
        default=False
    )
    
    show_force_instances_options: BoolProperty(
        name="Show Force Instances Options",
        description="Show/hide additional options for Force Instances",
        default=False
    )
    
    force_instances_ignore_folders: BoolProperty(
        name="Ignore Folders",
        description="Group all matching meshes into single instanced components regardless of folder structure (all under root folder)",
        default=False
    )
    
    validate_layout_files: BoolProperty(
        name="Validate Files",
        description="Check if all mesh files exist in the project during layout export",
        default=True
    )
    
    # Debug output for layout export
    debug_layout_export: BoolProperty(
        name="Debug Output",
        description="Print detailed debug information during layout export (for troubleshooting)",
        default=False
    )
    
    convert_tools_to_instances: BoolProperty(
        name="Convert Tools to Instances",
        description="Before export, find selected Curve objects with a Geometry Nodes modifier and make their instances real so they are included in the layout export",
        default=True
    )
    
    keep_tool_instances: BoolProperty(
        name="Keep Tool Instances",
        description="After the layout JSON is written, keep the real mesh instances that were generated from Curve/Geometry Node tools. Disable to automatically delete them after export",
        default=True
    )
    
    # Scene name for pnpm import command
    scene_name: StringProperty(
        name="Scene Name",
        description="Target scene name for pnpm import-mesh-comb command",
        default="default"
    )
    
    # Dynamic button label for layout export
    layout_button_label: StringProperty(
        name="Layout Button Label",
        description="Dynamic label for export layout button",
        default="Export Layout"
    )
    
    # Layout export status messages
    layout_export_status: StringProperty(
        name="Layout Export Status",
        description="Status message from last layout export",
        default=""
    )
    
    layout_export_warnings: StringProperty(
        name="Layout Export Warnings",
        description="Warning messages from last layout export",
        default=""
    )
    
    utility_status: StringProperty(
        name="Utility Status",
        description="Status message from last utility run",
        default=""
    )
    
    run_material_merge: BoolProperty(
        name="Material Merge",
        description="Merge duplicate materials (M_Concrete.001 -> M_Concrete)",
        default=False
    )
    
    run_texture_backup: BoolProperty(
        name="Texture Backup",
        description="Copy textures to local folder and repath materials",
        default=False
    )
    
    run_shader_cleanup: BoolProperty(
        name="Shader Cleanup",
        description="Remove disconnected/unused nodes from shaders",
        default=False
    )
    
    run_split_rgb_channels: BoolProperty(
        name="Split RGB Channels",
        description="Split selected texture into separate channel JPEGs and update material connections",
        default=False
    )
    
    split_rgb_compression: FloatProperty(
        name="Split RGB Compression",
        description="JPEG compression quality percentage (0-100) for split textures",
        default=75.0,
        min=0.0,
        max=100.0,
        subtype='PERCENTAGE'
    )
    
    run_texture_convert: BoolProperty(
        name="Texture Convert",
        description="Convert non-JPG/PNG textures (JPG if no alpha, PNG if alpha used)",
        default=False
    )
    
    run_texture_rename: BoolProperty(
        name="Texture Rename",
        description="Rename texture files to match their image node names in Blender",
        default=False
    )
    
    run_texture_resize: BoolProperty(
        name="Texture Resize",
        description="Resize large textures and save to backup folder",
        default=False
    )
    
    texture_backup_folder: StringProperty(
        name="Backup Folder",
        description="Texture backup folder name (created next to .blend file)",
        default="Genesys_Textures"
    )
    
    texture_backup_custom_path: StringProperty(
        name="Custom Backup Path",
        description="Custom absolute path for texture backup (e.g., C:/LocalTextures). Leave empty to use folder next to .blend file",
        default="",
        subtype='DIR_PATH'
    )
    
    show_texture_backup_options: BoolProperty(
        name="Show Texture Backup Options",
        description="Show/hide texture backup options",
        default=False
    )
    
    force_repath_to_backup: BoolProperty(
        name="Force Repath to Backup",
        description="When enabled, materials will be repathed to use textures from backup folder. When disabled, only copies textures without changing material paths",
        default=False
    )
    
    max_texture_size: EnumProperty(
        name="Max Texture Size",
        description="Maximum texture resolution",
        items=[
            ('128', '128', 'Maximum 128x128'),
            ('256', '256', 'Maximum 256x256'),
            ('512', '512', 'Maximum 512x512'),
            ('1024', '1024', 'Maximum 1024x1024'),
            ('2048', '2048', 'Maximum 2048x2048'),
        ],
        default='512'
    )
    
    preserve_aspect_ratio: BoolProperty(
        name="Preserve Aspect Ratio",
        description="Scale uniformly based on largest dimension. If disabled, forces both dimensions to max size",
        default=True
    )
    
    preserve_originals_resize: BoolProperty(
        name="Preserve Originals (Duplicate to RESIZED folder)",
        description="When enabled, copies textures to RESIZED folder next to .blend file, resizes them, and repaths materials. When disabled, resizes textures in their current location",
        default=False
    )
    
    texture_resize_custom_path: StringProperty(
        name="Custom Resize Path",
        description="Custom absolute path for resized textures (e.g., C:/ResizedTextures). Leave empty to use RESIZED folder next to .blend file",
        default="",
        subtype='DIR_PATH'
    )
    
    show_texture_resize_options: BoolProperty(
        name="Show Texture Resize Options",
        description="Show/hide texture resize options",
        default=False
    )
    
    # Folder structure created flag
    folder_structure_created: BoolProperty(
        name="Folder Structure Created",
        description="Whether the standard folder structure has been created",
        default=False
    )

class GenesysMaterialProperties(PropertyGroup):
    """Per-material Genesys properties - displayed in Material properties panel"""
    
    transparency: BoolProperty(
        name="Transparency (If Alpha Test > 0 = Transparency False)",
        description="Enable transparency for this material. NOTE: If Alpha Test is set, transparency will be forced to False",
        default=False
    )
    
    alpha_test: FloatProperty(
        name="Alpha Test",
        description="Alpha test cutoff threshold (0-1). Pixels with alpha below this value are discarded",
        default=0.0,
        min=0.0,
        max=1.0,
        subtype='FACTOR'
    )
    
    opacity: FloatProperty(
        name="Opacity",
        description="Opacity/Alpha value (0-1). Gradual transparency slider: 0 = fully transparent, 0.5 = semi-transparent, 1 = fully opaque",
        default=1.0,
        min=0.0,
        max=1.0,
        subtype='FACTOR'
    )

# ============================================================
# HELPER FUNCTIONS (from importbpy_Turbo13.py)
# ============================================================

def store_and_center_hierarchy(obj):
    """Store original transforms and center the hierarchy at world origin."""
    original_matrix = obj.matrix_world.copy()
    world_pos = obj.matrix_world.translation.copy()
    translate_to_origin = Matrix.Translation(-world_pos)
    obj.matrix_world = translate_to_origin @ obj.matrix_world
    return original_matrix, world_pos

def rotate_for_threejs(obj, convert_enabled):
    """Apply rotations to align object correctly for Three.js."""
    if not convert_enabled:
        return
    rot_x = Matrix.Rotation(math.radians(-90), 4, 'X')
    rot_z = Matrix.Rotation(math.radians(-90), 4, 'Z')
    rot_y = Matrix.Rotation(math.radians(90), 4, 'Y')
    obj.matrix_world = obj.matrix_world @ rot_x @ rot_z @ rot_y

def restore_transforms(obj, original_matrix):
    """Restore object's original transformation."""
    obj.matrix_world = original_matrix

def select_hierarchy(obj):
    """Select an object and all its children recursively."""
    obj.select_set(True)
    for child in obj.children:
        select_hierarchy(child)

def get_images_from_object(obj):
    """Get all image textures used by an object and its children."""
    images = set()
    
    def collect_images(o):
        if not o.data or not hasattr(o.data, 'materials'):
            return
        for mat_slot in o.data.materials:
            if not mat_slot:
                continue
            mat = mat_slot
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    images.add(node.image)
        for child in o.children:
            collect_images(child)
    
    collect_images(obj)
    return images

def copy_textures_to_folder(obj, texture_folder):
    """Copy all texture files used by the object's materials to the texture folder."""
    def process_object_textures(o):
        if not o.data or not hasattr(o.data, 'materials'):
            return
        for mat_slot in o.data.materials:
            if not mat_slot:
                continue
            mat = mat_slot
            if not mat.use_nodes:
                continue
            for node in mat.node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    img = node.image
                    if img.filepath:
                        if img.packed_file:
                            img_path = os.path.join(texture_folder, os.path.basename(img.filepath))
                            img.filepath_raw = img_path
                            img.save()
                        else:
                            src_path = bpy.path.abspath(img.filepath)
                            if os.path.exists(src_path):
                                dst_path = os.path.join(texture_folder, os.path.basename(src_path))
                                if not os.path.exists(dst_path) or os.path.getmtime(src_path) > os.path.getmtime(dst_path):
                                    shutil.copy2(src_path, dst_path)
    
    process_object_textures(obj)
    for child in obj.children:
        copy_textures_to_folder(child, texture_folder)

def apply_alpha_mode_to_materials(obj, alpha_mode, alpha_cutoff):
    """Apply alpha mode settings to all materials on an object and its children."""
    original_settings = {}
    
    def process_materials(o):
        if not o.data or not hasattr(o.data, 'materials'):
            return
        for mat in o.data.materials:
            if not mat or mat in original_settings:
                continue
            original_settings[mat] = (mat.blend_method, mat.alpha_threshold)
            if alpha_mode == 'OPAQUE':
                mat.blend_method = 'OPAQUE'
            elif alpha_mode == 'MASK':
                mat.blend_method = 'CLIP'
                mat.alpha_threshold = alpha_cutoff
            elif alpha_mode == 'BLEND':
                mat.blend_method = 'BLEND'
        for child in o.children:
            process_materials(child)
    
    process_materials(obj)
    return original_settings

def restore_material_alpha_settings(original_settings):
    """Restore materials to their original alpha/blend settings after export."""
    for mat, (blend_method, alpha_threshold) in original_settings.items():
        mat.blend_method = blend_method
        mat.alpha_threshold = alpha_threshold

# ============================================================
# HELPER FUNCTIONS (from ExportLayoutToGenesysTurbo13.py)
# ============================================================

def get_world_quaternion(obj):
    """Returns the world-space rotation of the object as a quaternion [x, y, z, w]."""
    euler = obj.matrix_world.to_euler('XYZ')
    x_deg = math.degrees(euler.x)
    y_deg = math.degrees(euler.y)
    z_deg = math.degrees(euler.z)
    
    while z_deg < 0:
        z_deg += 360
    
    genesys_y = z_deg
    genesys_z = 0
    
    new_euler = Euler((
        math.radians(0),
        math.radians(genesys_y),
        math.radians(genesys_z)
    ), 'XYZ')
    
    quat = new_euler.to_quaternion()
    quat.normalize()
    
    return [
        0.0 if abs(quat.x) < 1e-6 else round(quat.x, 7),
        0.0 if abs(quat.y) < 1e-6 else round(quat.y, 7),
        0.0 if abs(quat.z) < 1e-6 else round(quat.z, 7),
        1.0 if abs(quat.w - 1.0) < 1e-6 else round(quat.w, 7)
    ]

def get_collection_path(obj):
    """Get the collection hierarchy path for an object."""
    collections_in = [col for col in bpy.data.collections if obj.name in col.objects]
    
    if not collections_in:
        return None
    
    collection = collections_in[0]
    path_parts = []
    current_collection = collection
    
    while current_collection:
        if current_collection.name == "Scene Collection":
            break
        path_parts.append(current_collection.name)
        
        parent_collection = None
        for col in bpy.data.collections:
            if current_collection.name in [child.name for child in col.children]:
                parent_collection = col
                break
        
        current_collection = parent_collection
    
    path_parts.reverse()
    
    if path_parts:
        return '/'.join(path_parts)
    else:
        return None

def strip_texture_extension(filename):
    """
    Remove file extensions from texture names.
    Example: "T_SCIFIFLOOR01_BCAW.webp" -> "T_SCIFIFLOOR01_BCAW"
    """
    extensions = ['.webp', '.png', '.jpg', '.jpeg', '.tga', '.tiff', '.bmp', '.exr']
    for ext in extensions:
        if filename.lower().endswith(ext):
            return filename[:-len(ext)]
    return filename

def export_genesys_materials(obj, assets_root, invert_emissive=True, force_materials=False, force_texture_slots=True, custom_path="", texture_custom_path=""):
    """
    Export materials as individual .material.json files using engine format.
    One file per material in /assets/materials/ folder (flat, no subfolders).
    
    Args:
        assets_root: Root assets directory (used if custom_path is empty)
        invert_emissive: If True, set emissive to black and strength to 1 (default True)
        force_materials: If True, overwrite existing material files completely
        force_texture_slots: If True, update only texture slots in existing materials
        custom_path: Custom absolute path for material export (optional)
        texture_custom_path: Custom absolute path for texture location (optional, for building texture URLs)
    
    Returns:
        Dictionary with export status:
        {
            'exported': int,  # Number of new materials exported
            'existing': list,  # Names of existing materials reused
            'skipped': list,  # Names of materials skipped (no M_ prefix)
            'errors': list  # Error messages
        }
    """
    if not obj.data or not hasattr(obj.data, 'materials') or not obj.data.materials:
        print(f"  -> No materials on {obj.name}")
        return 0
    
    print(f"\n  [Material Export] Processing: {obj.name}")
    
    # Use custom path if provided, otherwise use /assets/materials
    custom_path_clean = custom_path.strip() if custom_path else ""
    if custom_path_clean and custom_path_clean != "or custom path here":
        materials_dir = bpy.path.abspath(custom_path_clean)
    else:
        materials_dir = os.path.join(assets_root, 'materials')
    
    # Determine the base materials directory (for calculating @project paths)
    # This is always assets/materials, regardless of custom_path
    base_materials_dir = os.path.join(assets_root, 'materials')
    
    # Use custom texture path if provided, otherwise use /assets/textures
    texture_custom_path_clean = texture_custom_path.strip() if texture_custom_path else ""
    if texture_custom_path_clean and texture_custom_path_clean != "or custom path here":
        textures_dir = bpy.path.abspath(texture_custom_path_clean)
    else:
        textures_dir = os.path.join(assets_root, 'textures')
    
    # Determine the base textures directory (for calculating @project paths)
    base_textures_dir = os.path.join(assets_root, 'textures')
    
    os.makedirs(materials_dir, exist_ok=True)
    
    # Build a map of existing materials by searching all subfolders
    existing_material_files = {}
    for root, dirs, files in os.walk(materials_dir):
        for file in files:
            if file.endswith('.material.json'):
                mat_name = file.replace('.material.json', '')
                full_path = os.path.join(root, file)
                existing_material_files[mat_name] = full_path
    
    exported_count = 0
    skipped_materials = []
    existing_materials = []
    
    for mat_slot in obj.data.materials:
        if not mat_slot:
            continue
        
        mat = mat_slot
        mat_name = mat.name
        
        # Check if material name starts with M_
        if not mat_name.startswith('M_'):
            skipped_materials.append(mat_name)
            continue
        
        print(f"    -> {mat_name}")
        
        # Skip if not using nodes
        if not mat.use_nodes or not mat.node_tree:
            print(f"       Warning: No nodes, will still embed reference")
            # Still set the material reference even if we can't export it
            material_filename = f"{mat_name}.material.json"
            material_path = os.path.join(materials_dir, material_filename)
            rel_path = os.path.relpath(material_path, base_materials_dir).replace('\\', '/')
            material_ref = f"@project/assets/materials/{rel_path}"
            mat["genesys_material_ref"] = material_ref
            print(f"       → Will embed reference: {material_ref}")
            continue
        
        node_tree = mat.node_tree
        
        # Find Principled BSDF
        principled = None
        for node in node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                principled = node
                break
        
        if not principled:
            print(f"       Warning: No Principled BSDF, will still embed reference")
            # Still set the material reference even if we can't export it
            material_filename = f"{mat_name}.material.json"
            material_path = os.path.join(materials_dir, material_filename)
            rel_path = os.path.relpath(material_path, base_materials_dir).replace('\\', '/')
            material_ref = f"@project/assets/materials/{rel_path}"
            mat["genesys_material_ref"] = material_ref
            print(f"       → Will embed reference: {material_ref}")
            continue
        
        # Build engine-format material
        material_data = {
            "$version": 2,
            "$root": {
                "$bc": "THREE.MeshStandardMaterial",
                "name": mat_name,
                "userData": {
                    "textureTransforms": {},
                    "exporterVersion": EXPORTER_VERSION
                }
            }
        }
        
        root = material_data["$root"]
        
        # Set transparent flag if alpha is connected (will be checked later)
        # This will be set after we process textures
        
        # Extract properties (only if NOT default and NOT textured)
        
        # Base Color
        base_color_socket = principled.inputs.get('Base Color')
        if base_color_socket and not base_color_socket.is_linked:
            color = base_color_socket.default_value
            # Convert to hex integer (THREE.js format)
            r, g, b = int(color[0] * 255), int(color[1] * 255), int(color[2] * 255)
            color_hex = (r << 16) | (g << 8) | b
            # Only save if not white (0xffffff)
            if color_hex != 0xffffff:
                root["color"] = color_hex
        
        # Metalness
        metallic_socket = principled.inputs.get('Metallic')
        if metallic_socket and not metallic_socket.is_linked:
            val = metallic_socket.default_value
            # Only save if not default (0)
            if val != 0.0:
                root["metalness"] = val
        
        # Roughness
        roughness_socket = principled.inputs.get('Roughness')
        if roughness_socket and not roughness_socket.is_linked:
            val = roughness_socket.default_value
            # Only save if not default (1)
            if val != 1.0:
                root["roughness"] = val
        
        # Emission - handle invert_emissive option
        if invert_emissive:
            # Force emissive to black and strength to 1 (engine defaults)
            root["emissive"] = 0x000000  # Black
            root["emissiveIntensity"] = 1
        else:
            # Export actual values from Blender
            emission_socket = principled.inputs.get('Emission Color')
            if emission_socket and not emission_socket.is_linked:
                emission = emission_socket.default_value
                r, g, b = int(emission[0] * 255), int(emission[1] * 255), int(emission[2] * 255)
                emissive_hex = (r << 16) | (g << 8) | b
                # Only save if not black (0x000000)
                if emissive_hex != 0x000000:
                    root["emissive"] = emissive_hex
            
            emission_strength_socket = principled.inputs.get('Emission Strength')
            if emission_strength_socket and not emission_strength_socket.is_linked:
                val = emission_strength_socket.default_value
                if val != 1.0:
                    root["emissiveIntensity"] = val
        
        # Helper function to trace back through nodes to find the texture
        def find_texture_node(socket):
            """Follow node chain backwards to find the TEX_IMAGE node."""
            if not socket or not socket.is_linked:
                return None
            
            visited = set()
            nodes_to_check = [socket.links[0].from_node]
            
            while nodes_to_check:
                node = nodes_to_check.pop(0)
                
                if node in visited:
                    continue
                visited.add(node)
                
                # Found the texture!
                if node.type == 'TEX_IMAGE' and node.image:
                    return node
                
                # Follow connections backwards through intermediate nodes
                # (like Separate Color, ColorRamp, Math nodes, etc.)
                for input_socket in node.inputs:
                    if input_socket.is_linked:
                        for link in input_socket.links:
                            if link.from_node not in visited:
                                nodes_to_check.append(link.from_node)
            
            return None
        
        # Check Genesys material properties for transparency settings
        genesys_mat = mat.genesys_material
        alpha_socket = principled.inputs.get('Alpha')
        
        # Debug: Print material properties
        
        # Only export transparency settings if they differ from defaults
        # Defaults: transparency=False, alpha_test=0.0, opacity=1.0
        
        transparency_enabled = genesys_mat.transparency
        alpha_test_value = genesys_mat.alpha_test
        opacity_value = genesys_mat.opacity
        
        # RULE 2: If Alpha Test is set (> 0), it OVERRIDES alpha socket connections
        # Export _alphaTest but DON'T export transparent:true (unless user manually enabled it)
        if alpha_test_value > 0.0:
            root["_alphaTest"] = alpha_test_value
            print(f"       + _alphaTest: {alpha_test_value}")
            
            # Only export transparency/opacity if user MANUALLY changed them from defaults
            if transparency_enabled:
                root["transparent"] = True
                print(f"       + transparent: true (user override)")
            
            if opacity_value < 1.0:
                root["opacity"] = opacity_value
                print(f"       + opacity: {opacity_value} (user override)")
            
            if not transparency_enabled and opacity_value >= 1.0:
                print(f"       ✓ AlphaTest mode: transparency/opacity at defaults (not exported)")
        else:
            # RULE 1: No Alpha Test - check if alpha socket is connected/modified
            # If alpha socket is connected → export transparent:true
            has_alpha_connection = (alpha_socket and alpha_socket.is_linked)
            has_alpha_modified = (alpha_socket and alpha_socket.default_value < 1.0)
            
            # Check if ANY transparency setting differs from default
            has_transparency_override = (
                transparency_enabled or 
                opacity_value < 1.0 or
                has_alpha_connection or
                has_alpha_modified
            )
            
            if has_transparency_override:
                # Export transparent flag
                if transparency_enabled or has_alpha_connection or has_alpha_modified:
                    root["transparent"] = True
                    print(f"       + transparent: true")
                else:
                    root["transparent"] = False
                    print(f"       + transparent: false")
                
                # Export opacity if changed
                if opacity_value < 1.0:
                    root["opacity"] = opacity_value
                    print(f"       + opacity: {opacity_value}")
                elif has_alpha_modified:
                    root["opacity"] = alpha_socket.default_value
                    print(f"       + opacity: {alpha_socket.default_value}")
                else:
                    root["opacity"] = 1.0
                    print(f"       + opacity: 1.0")
                
                print(f"       ✓ Transparency properties exported")
            else:
                # All at defaults - don't export anything
                print(f"       ✓ All transparency settings at defaults - not exported")
        
        # Texture mapping - always include all possible maps
        texture_mapping = {
            'Base Color': 'map',
            'Metallic': 'metalnessMap',
            'Roughness': 'roughnessMap',
            'Normal': 'normalMap',
            'Emission Color': 'emissiveMap',
            'Alpha': 'alphaMap',
        }
        
        # Track which texture is used for Base Color to check if Alpha uses the same one
        base_color_texture_node = None
        base_color_socket = principled.inputs.get('Base Color')
        if base_color_socket and base_color_socket.is_linked:
            base_color_texture_node = find_texture_node(base_color_socket)
        
        # Extract textures - follow node chains to find actual texture
        for socket_name, three_property in texture_mapping.items():
            socket = principled.inputs.get(socket_name)
            if not socket or not socket.is_linked:
                continue
            
            # Special handling for Normal socket (goes through Normal Map node)
            if socket_name == 'Normal':
                first_node = socket.links[0].from_node
                if first_node.type == 'NORMAL_MAP':
                    # Normal Map node - look at its Color input
                    color_socket = first_node.inputs.get('Color')
                    texture_node = find_texture_node(color_socket)
                else:
                    # Direct connection or other node
                    texture_node = find_texture_node(socket)
            else:
                # For all other sockets, trace back to find texture
                texture_node = find_texture_node(socket)
            
            # If we found a texture, export it
            if texture_node and texture_node.image:
                # SPECIAL RULE: Skip alphaMap if it's the same texture as Base Color
                # The engine will automatically use PNG alpha channel from the base color map
                if socket_name == 'Alpha' and base_color_texture_node:
                    if texture_node == base_color_texture_node:
                        print(f"       ↻ Skipping alphaMap (same as Base Color - engine will use PNG alpha channel)")
                        continue
                
                image_name = texture_node.image.name
                clean_name = strip_texture_extension(image_name)
                
                # Find the actual texture file in the textures directory
                actual_extension = ".jpg"  # Default fallback (preferred format)
                texture_file_path = None
                
                if os.path.exists(textures_dir):
                    # Scan the textures folder for a file matching the texture name
                    for filename in os.listdir(textures_dir):
                        name_without_ext, ext = os.path.splitext(filename)
                        if name_without_ext == clean_name:
                            actual_extension = ext.lower()
                            texture_file_path = os.path.join(textures_dir, filename)
                            break
                else:
                    # Fallback: try to get from Blender image
                    if texture_node.image.filepath:
                        _, ext = os.path.splitext(texture_node.image.filepath)
                        if ext:
                            actual_extension = ext.lower()
                
                # Build texture URL relative to @project/assets/textures/
                # Calculate relative path from base_textures_dir to the actual texture file
                if texture_file_path:
                    # Get relative path from base textures dir
                    rel_texture_path = os.path.relpath(texture_file_path, base_textures_dir).replace('\\', '/')
                    texture_url = f"@project/assets/textures/{rel_texture_path}"
                else:
                    # Fallback: assume flat structure
                    texture_url = f"@project/assets/textures/{clean_name}{actual_extension}"
                
                # Detect wrap mode from texture node
                # Blender extension values: 'REPEAT' = RepeatWrapping (1000)
                #                          'EXTEND' = ClampToEdgeWrapping (1001)
                #                          'CLIP' = ClampToEdgeWrapping (1001) with transparency
                wrap_s = 1000  # Default to RepeatWrapping
                wrap_t = 1000
                
                if hasattr(texture_node, 'extension'):
                    if texture_node.extension == 'REPEAT':
                        wrap_s = 1000  # RepeatWrapping
                        wrap_t = 1000
                        print(f"       + {socket_name} → {clean_name}{actual_extension} [Repeat]")
                    elif texture_node.extension in ['EXTEND', 'CLIP']:
                        wrap_s = 1001  # ClampToEdgeWrapping
                        wrap_t = 1001
                        print(f"       + {socket_name} → {clean_name}{actual_extension} [Clamp]")
                    else:
                        # Unknown mode, default to repeat
                        print(f"       + {socket_name} → {clean_name}{actual_extension} [Unknown: {texture_node.extension}]")
                else:
                    print(f"       + {socket_name} → {clean_name}{actual_extension} [No extension property]")
                
                # Create texture object with wrap mode and UUID
                root[three_property] = {
                    "$uuid": str(uuid.uuid4()),
                    "url": texture_url,
                    "wrapS": wrap_s,
                    "wrapT": wrap_t,
                    "$bc": "ENGINE.UrlTexture"
                }
                
                # Add texture transform with detected wrap mode
                root["userData"]["textureTransforms"][three_property] = {
                    "wrapS": wrap_s,
                    "wrapT": wrap_t,
                    "repeatX": 1,
                    "repeatY": 1,
                    "offsetX": 0,
                    "offsetY": 0,
                    "rotation": 0
                }
        
        # Strip userData if no textures were found (keeps output clean like native materials)
        if not root.get("userData", {}).get("textureTransforms"):
            root.pop("userData", None)

        # Check if material already exists anywhere in materials folder tree
        material_exists = mat_name in existing_material_files
        
        if material_exists and not force_materials:
            existing_path = existing_material_files[mat_name]
            
            # Force Texture Slots: Update only textures in existing material
            if force_texture_slots:
                try:
                    # Load existing material
                    with open(existing_path, 'r') as f:
                        existing_data = json.load(f)
                    
                    # Update only texture properties (map, metalnessMap, roughnessMap, etc.)
                    texture_props = ['map', 'metalnessMap', 'roughnessMap', 'normalMap', 'emissiveMap', 'alphaMap']
                    for prop in texture_props:
                        if prop in material_data["$root"]:
                            existing_data["$root"][prop] = material_data["$root"][prop]
                            # Also update texture transforms
                            if prop in material_data["$root"]["userData"]["textureTransforms"]:
                                existing_data["$root"]["userData"]["textureTransforms"][prop] = material_data["$root"]["userData"]["textureTransforms"][prop]
                    
                    # Update exporter version
                    existing_data["$root"]["userData"]["exporterVersion"] = EXPORTER_VERSION
                    
                    # Save updated material
                    with open(existing_path, 'w') as f:
                        json.dump(existing_data, f, indent=2)
                    
                    print(f"       ⚙ Updated texture slots: {os.path.relpath(existing_path, materials_dir)}")
                except Exception as e:
                    print(f"       ⚠ Could not update textures: {e}")
            else:
                print(f"       ⚠ Already exists: {os.path.relpath(existing_path, materials_dir)}")
            
            existing_materials.append(mat_name)
            
            # Get relative path from base materials directory for the @project reference
            rel_path = os.path.relpath(existing_path, base_materials_dir).replace('\\', '/')
            material_ref = f"@project/assets/materials/{rel_path}"
        else:
            # Create new material file (or overwrite if force_materials is True)
            material_filename = f"{mat_name}.material.json"
            material_path = os.path.join(materials_dir, material_filename)
            
            try:
                with open(material_path, 'w') as f:
                    json.dump(material_data, f, indent=2)
                
                if material_exists and force_materials:
                    print(f"       ✓ Overwritten: {material_filename}")
                else:
                    print(f"       ✓ Saved: {material_filename}")
                
                exported_count += 1
                
                # Get relative path from base materials directory for the @project reference
                rel_path = os.path.relpath(material_path, base_materials_dir).replace('\\', '/')
                material_ref = f"@project/assets/materials/{rel_path}"
            except Exception as e:
                print(f"       ✗ ERROR: {e}")
                continue
        
        # Store material reference as custom property
        # The GLTF export hook (gather_material_hook) will read this and add it as an extension
        mat["genesys_material_ref"] = material_ref
        
        print(f"       → Will embed reference: {material_ref}")
    
    if exported_count > 0:
        print(f"  -> Exported {exported_count} new material(s)")
    
    if existing_materials:
        print(f"  -> {len(existing_materials)} Material(s) already exist, reused: {', '.join(existing_materials)}")
    
    if skipped_materials:
        print(f"  -> {len(skipped_materials)} Material(s) skipped (no M_ prefix): {', '.join(skipped_materials)}")
    
    return {
        'exported': exported_count,
        'existing': existing_materials,
        'skipped': skipped_materials,
        'errors': []  # Could be populated with error messages if needed
    }

def export_material_metadata(obj, export_path, assets_root):
    """
    Export material metadata from a Blender object to JSON format.
    Creates a .materials.json file that matches THREE.MeshStandardMaterial format.
    Materials are saved to /materials folder, textures remain in /textures folder.
    
    Args:
        obj: Blender object with materials
        export_path: Full path where the GLB was exported
        assets_root: Root assets directory path
    """
    if not obj.data or not hasattr(obj.data, 'materials') or not obj.data.materials:
        print(f"  -> No materials on {obj.name}, skipping material export")
        return
    
    materials_data = {"materials": {}}
    collection_path = get_collection_path(obj)
    
    print(f"\n  [Material Export] Processing materials for: {obj.name}")
    
    for slot_index, mat_slot in enumerate(obj.data.materials):
        if not mat_slot:
            print(f"    -> Slot {slot_index}: Empty, skipping")
            continue
        
        mat = mat_slot
        mat_name = mat.name
        
        print(f"    -> Slot {slot_index}: {mat_name}")
        
        # Get node tree
        if not mat.use_nodes or not mat.node_tree:
            print(f"       Warning: Material '{mat_name}' doesn't use nodes")
            materials_data["materials"][mat_name] = {
                "type": "MeshStandardMaterial",
                "slot": slot_index,
                "properties": {"color": [0.8, 0.8, 0.8], "metalness": 0.0, "roughness": 0.5},
                "textures": {}
            }
            continue
        
        node_tree = mat.node_tree
        
        # Find Principled BSDF node
        principled = None
        for node in node_tree.nodes:
            if node.type == 'BSDF_PRINCIPLED':
                principled = node
                break
        
        if not principled:
            print(f"       Warning: No Principled BSDF in '{mat_name}'")
            materials_data["materials"][mat_name] = {
                "type": "MeshStandardMaterial",
                "slot": slot_index,
                "properties": {"color": [0.8, 0.8, 0.8], "metalness": 0.0, "roughness": 0.5},
                "textures": {}
            }
            continue
        
        # Extract properties
        mat_data = {
            "type": "MeshStandardMaterial",
            "slot": slot_index,
            "properties": {},
            "textures": {}
        }
        
        # Base Color
        base_color_socket = principled.inputs.get('Base Color')
        if base_color_socket:
            if not base_color_socket.is_linked:
                color = base_color_socket.default_value
                mat_data["properties"]["color"] = [color[0], color[1], color[2]]
            else:
                mat_data["properties"]["color"] = [1.0, 1.0, 1.0]
        
        # Metallic
        metallic_socket = principled.inputs.get('Metallic')
        if metallic_socket and not metallic_socket.is_linked:
            mat_data["properties"]["metalness"] = metallic_socket.default_value
        else:
            mat_data["properties"]["metalness"] = 0.0
        
        # Roughness
        roughness_socket = principled.inputs.get('Roughness')
        if roughness_socket and not roughness_socket.is_linked:
            mat_data["properties"]["roughness"] = roughness_socket.default_value
        else:
            mat_data["properties"]["roughness"] = 0.5
        
        # Emission
        emission_socket = principled.inputs.get('Emission Color')
        emission_strength_socket = principled.inputs.get('Emission Strength')
        if emission_socket and not emission_socket.is_linked:
            emission = emission_socket.default_value
            mat_data["properties"]["emissive"] = [emission[0], emission[1], emission[2]]
        if emission_strength_socket and not emission_strength_socket.is_linked:
            mat_data["properties"]["emissiveIntensity"] = emission_strength_socket.default_value
        
        # Texture mapping (Blender -> Three.js)
        texture_mapping = {
            'Base Color': 'map',
            'Metallic': 'metalnessMap',
            'Roughness': 'roughnessMap',
            'Normal': 'normalMap',
            'Emission Color': 'emissiveMap',
        }
        
        # Extract textures
        for socket_name, three_property in texture_mapping.items():
            socket = principled.inputs.get(socket_name)
            if not socket or not socket.is_linked:
                continue
            
            link = socket.links[0]
            texture_node = link.from_node
            
            # Handle Image Texture nodes
            if texture_node.type == 'TEX_IMAGE' and texture_node.image:
                image_name = texture_node.image.name
                clean_name = strip_texture_extension(image_name)
                
                # Textures always go to /textures folder with collection path
                if collection_path:
                    texture_path = f"@project/assets/textures/{collection_path}/{clean_name}"
                else:
                    texture_path = f"@project/assets/textures/{clean_name}"
                
                mat_data["textures"][three_property] = texture_path
                print(f"       Texture: {socket_name} -> {clean_name}")
            
            # Handle Normal Map nodes
            elif socket_name == 'Normal' and texture_node.type == 'NORMAL_MAP':
                color_socket = texture_node.inputs.get('Color')
                if color_socket and color_socket.is_linked:
                    img_link = color_socket.links[0]
                    img_node = img_link.from_node
                    if img_node.type == 'TEX_IMAGE' and img_node.image:
                        image_name = img_node.image.name
                        clean_name = strip_texture_extension(image_name)
                        
                        # Textures always go to /textures folder with collection path
                        if collection_path:
                            texture_path = f"@project/assets/textures/{collection_path}/{clean_name}"
                        else:
                            texture_path = f"@project/assets/textures/{clean_name}"
                        
                        mat_data["textures"][three_property] = texture_path
                        print(f"       Texture: {socket_name} -> {clean_name}")
        
        materials_data["materials"][mat_name] = mat_data
    
    # Write JSON file to /materials folder (not next to GLB)
    # Determine materials folder path relative to assets root
    materials_dir = os.path.join(assets_root, 'materials')
    if collection_path:
        materials_dir = os.path.join(materials_dir, collection_path.replace('/', os.sep))
    
    # Create materials directory if it doesn't exist
    os.makedirs(materials_dir, exist_ok=True)
    
    # Get just the filename without path
    glb_filename = os.path.basename(export_path)
    material_filename = glb_filename.replace('.glb', '.materials.json')
    json_path = os.path.join(materials_dir, material_filename)
    
    try:
        with open(json_path, 'w') as f:
            json.dump(materials_data, f, indent=2)
        print(f"  -> Material metadata exported: {json_path}")
        print(f"  -> {len(materials_data['materials'])} materials exported")
    except Exception as e:
        print(f"  -> ERROR: Failed to write materials JSON: {e}")

# ============================================================
# UTILITY FUNCTIONS
# ============================================================

def merge_duplicate_materials():
    """Merge materials with duplicate base names on SELECTED objects."""
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' and obj.data and hasattr(obj.data, 'materials')]
    
    if not selected_objects:
        return 0, "No mesh objects selected"
    
    used_materials = set()
    for obj in selected_objects:
        for mat_slot in obj.data.materials:
            if mat_slot:
                used_materials.add(mat_slot)
    
    if not used_materials:
        return 0, "No materials found"
    
    suffix_pattern = re.compile(r'^(.+?)(\.\d{3,})$')
    material_groups = {}
    
    for mat in used_materials:
        match = suffix_pattern.match(mat.name)
        if match:
            base_name = match.group(1)
        else:
            base_name = mat.name
        
        if base_name not in material_groups:
            material_groups[base_name] = []
        material_groups[base_name].append(mat)
    
    merged_count = 0
    for base_name, materials in material_groups.items():
        if len(materials) == 1:
            continue
        
        def sort_key(m):
            match = suffix_pattern.match(m.name)
            if match:
                return (1, int(match.group(2)[1:]))
            else:
                return (0, 0)
        
        materials.sort(key=sort_key)
        master_material = materials[0]
        duplicates = materials[1:]
        
        for obj in selected_objects:
            if not obj.data.materials:
                continue
            for i, mat_slot in enumerate(obj.data.materials):
                if mat_slot in duplicates:
                    obj.data.materials[i] = master_material
                    merged_count += 1
    
    return merged_count, f"Merged {merged_count} material slots"

def cleanup_unused_shader_nodes():
    """Remove disconnected/unused nodes from shaders on SELECTED objects."""
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' and obj.data and hasattr(obj.data, 'materials')]
    
    if not selected_objects:
        return 0, "No mesh objects selected"
    
    materials_to_process = set()
    for obj in selected_objects:
        for mat_slot in obj.data.materials:
            if mat_slot and mat_slot.use_nodes and mat_slot.node_tree:
                materials_to_process.add(mat_slot)
    
    if not materials_to_process:
        return 0, "No node-based materials found"
    
    total_removed = 0
    for mat in materials_to_process:
        node_tree = mat.node_tree
        nodes = node_tree.nodes
        
        output_nodes = [n for n in nodes if n.type == 'OUTPUT_MATERIAL']
        if not output_nodes:
            continue
        
        connected_nodes = set()
        
        def trace_connections(node):
            if node in connected_nodes:
                return
            connected_nodes.add(node)
            for input_socket in node.inputs:
                for link in input_socket.links:
                    if link.from_node:
                        trace_connections(link.from_node)
        
        for output_node in output_nodes:
            trace_connections(output_node)
        
        nodes_to_remove = []
        for node in nodes:
            if node not in connected_nodes and node.type != 'FRAME':
                nodes_to_remove.append(node)
        
        for node in nodes_to_remove:
            nodes.remove(node)
            total_removed += 1
    
    return total_removed, f"Removed {total_removed} unused nodes"

def backup_and_repath_textures(backup_folder_name, custom_path="", force_repath=False):
    """Copy all textures used by SELECTED OBJECTS to a local folder.
    
    Args:
        backup_folder_name: Name of backup folder (used if custom_path is empty)
        custom_path: Custom absolute path for backup (optional)
        force_repath: If True, repath materials to backup folder. If False, only copy files.
    """
    blend_filepath = bpy.data.filepath
    if not blend_filepath:
        return 0, "Please save your Blender file first"
    
    # Use custom path if provided, otherwise use folder next to .blend file
    if custom_path and custom_path.strip():
        backup_dir = bpy.path.abspath(custom_path)
    else:
        blend_dir = os.path.dirname(blend_filepath)
        backup_dir = os.path.join(blend_dir, backup_folder_name)
    
    os.makedirs(backup_dir, exist_ok=True)
    
    all_images = set()
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' or obj.type == 'EMPTY']
    
    if not selected_objects:
        return 0, "No objects selected"
    
    for obj in selected_objects:
        images = get_images_from_object(obj)
        all_images.update(images)
    
    if not all_images:
        return 0, "No textures found"
    
    copied_count = 0
    for image in all_images:
        if not image.filepath and not image.packed_file:
            continue
        
        if image.filepath:
            src_path = bpy.path.abspath(image.filepath)
            original_filename = os.path.basename(src_path)
        else:
            ext = '.png'
            if image.file_format:
                format_map = {'JPEG': '.jpg', 'PNG': '.png', 'TARGA': '.tga', 'TIFF': '.tif'}
                ext = format_map.get(image.file_format, '.png')
            original_filename = image.name + ext
        
        # Skip if already in backup directory
        if image.filepath:
            current_abs_path = bpy.path.abspath(image.filepath)
            if os.path.normpath(os.path.dirname(current_abs_path)) == os.path.normpath(backup_dir):
                continue
        
        dest_path = os.path.join(backup_dir, original_filename)
        
        # If file already exists in backup, optionally repath
        if os.path.exists(dest_path):
            if force_repath:
                image.filepath = dest_path
            continue
        
        # Copy/save the texture file
        if image.packed_file:
            # Save packed file to backup location
            if force_repath:
                image.filepath = dest_path
            else:
                # Save without changing the image filepath
                original_path = image.filepath
                image.filepath = dest_path
                image.save()
                image.filepath = original_path
            copied_count += 1
        else:
            # Copy external file
            if os.path.exists(src_path):
                shutil.copy2(src_path, dest_path)
                copied_count += 1
                # Only repath if force_repath is enabled
                if force_repath:
                    image.filepath = dest_path
    
    action = "Copied and repathed" if force_repath else "Copied"
    return copied_count, f"{action} {copied_count} textures"

def split_rgb_channels_utility(compression_quality=75):
    """
    Split selected texture node into separate channel JPEGs.
    Works on the currently selected texture node in the active material.
    
    Detects which channels are being used (via Separate Color nodes or alpha connections)
    and creates separate JPEG files for each used channel.
    
    Args:
        compression_quality: JPEG quality (0-100)
    
    Returns:
        tuple: (count, message) - number of textures split and status message
    """
    try:
        from PIL import Image
        import numpy as np
    except ImportError as e:
        return 0, f"ERROR: PIL/Pillow or NumPy not available: {e}"
    
    # Get active object and material
    obj = bpy.context.active_object
    if not obj or obj.type != 'MESH':
        return 0, "No mesh object selected"
    
    mat = obj.active_material
    if not mat or not mat.use_nodes:
        return 0, "No active material with nodes"
    
    # Get selected node in shader editor
    selected_nodes = [n for n in mat.node_tree.nodes if n.select]
    if not selected_nodes:
        return 0, "No texture node selected in shader editor"
    
    # Find the first selected texture node
    texture_node = None
    for node in selected_nodes:
        if node.type == 'TEX_IMAGE' and node.image:
            texture_node = node
            break
    
    if not texture_node:
        return 0, "Selected node is not a texture node with an image"
    
    image = texture_node.image
    image_name = image.name
    
    # Get the texture file path
    if not image.filepath:
        return 0, f"Texture {image_name} has no file path (might be generated)"
    
    texture_path = bpy.path.abspath(image.filepath)
    if not os.path.exists(texture_path):
        return 0, f"Texture file not found: {texture_path}"
    
    # Analyze which outputs of this texture node are being used
    node_tree = mat.node_tree
    nodes = node_tree.nodes
    links = node_tree.links
    
    # Track which channels are being used
    channels_used = {}  # output_socket_name -> [(target_node, target_socket_name), ...]
    
    # Check direct connections from texture node (excluding Separate Color nodes)
    for output in texture_node.outputs:
        if output.is_linked:
            for link in output.links:
                target_node = link.to_node
                target_socket = link.to_socket
                
                # Skip connections to Separate Color nodes - we'll handle those separately
                if target_node.type in ['SEPRGB', 'SEPARATE_COLOR']:
                    continue
                
                if output.name not in channels_used:
                    channels_used[output.name] = []
                channels_used[output.name].append((target_node, target_socket.name))
    
    # Check if texture feeds into Separate Color nodes
    separate_color_usage = {}  # channel_index -> [(target_node, target_socket_name), ...]
    
    for output in texture_node.outputs:
        if not output.is_linked:
            continue
        
        for link in output.links:
            next_node = link.to_node
            
            # Check if it's a Separate Color/RGB node
            if next_node.type in ['SEPRGB', 'SEPARATE_COLOR']:
                # Track which outputs of the Separate node are used
                for sep_output in next_node.outputs:
                    if sep_output.is_linked:
                        # Determine channel index
                        channel_index = None
                        if 'R' in sep_output.name or 'Red' in sep_output.name:
                            channel_index = 0
                        elif 'G' in sep_output.name or 'Green' in sep_output.name:
                            channel_index = 1
                        elif 'B' in sep_output.name or 'Blue' in sep_output.name:
                            channel_index = 2
                        elif 'A' in sep_output.name or 'Alpha' in sep_output.name:
                            channel_index = 3
                        
                        if channel_index is not None:
                            if channel_index not in separate_color_usage:
                                separate_color_usage[channel_index] = []
                            
                            for sep_link in sep_output.links:
                                separate_color_usage[channel_index].append((sep_link.to_node, sep_link.to_socket.name))
    
    if not channels_used and not separate_color_usage:
        return 0, f"Texture {image_name} is not connected to anything"
    
    # Check if texture feeds into multiple channels (only split if multiple)
    total_channels = len(channels_used) + len(separate_color_usage)
    
    # Special case: If texture has both Color and Alpha outputs used, that counts as 2 channels
    if 'Color' in channels_used and 'Alpha' in channels_used:
        # This is valid for splitting (base color + alpha)
        pass
    elif total_channels <= 1:
        # Only one channel used - no point in splitting
        channel_name = list(channels_used.keys())[0] if channels_used else f"Channel {list(separate_color_usage.keys())[0]}"
        return 0, f"Texture {image_name} only feeds into one shader input ({channel_name}). No split needed."
    
    print(f"\n[Split RGB Channels] Processing: {image_name}")
    
    # Load the image
    try:
        img = Image.open(texture_path)
        img_array = np.array(img)
    except Exception as e:
        return 0, f"Failed to load image: {e}"
    
    # Get dimensions
    height, width = img_array.shape[:2]
    has_alpha = len(img_array.shape) == 3 and img_array.shape[2] == 4
    
    # Get output directory (same as texture)
    output_dir = os.path.dirname(texture_path)
    base_name = strip_texture_extension(image_name)
    
    # Remove common texture suffixes (BCAW, RMA, ORM, N, etc.)
    # This converts T_SCIFIFLOOR01_BCAW → T_SCIFIFLOOR01
    # and T_SCIFIFLOOR01_RMA → T_SCIFIFLOOR01
    common_suffixes = ['_BCAW', '_RMA', '_ORM', '_N', '_BC', '_AO', '_R', '_M', '_A']
    for suffix in common_suffixes:
        if base_name.upper().endswith(suffix):
            base_name = base_name[:-len(suffix)]
            break
    
    # Split and save channels
    split_files = {}
    jpeg_quality = int(compression_quality)
    
    # Handle direct Color output connection (e.g., Color → Base Color)
    if 'Color' in channels_used:
        output_filename = f"{base_name}_Color.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        # Check if split texture already exists
        if os.path.exists(output_path):
            print(f"  ↻ Reusing: {output_filename}")
            split_files['Color'] = (output_path, 'Color', channels_used['Color'])
        else:
            # Save the RGB channels as-is
            if len(img_array.shape) == 3:
                color_img = img_array[:, :, :3]  # Take only RGB, ignore alpha if present
            else:
                color_img = img_array
            
            Image.fromarray(color_img).save(output_path, 'JPEG', quality=jpeg_quality)
            split_files['Color'] = (output_path, 'Color', channels_used['Color'])
            print(f"  ✓ Created: {output_filename}")
    
    # Handle direct Alpha output connection (e.g., Alpha → Alpha socket)
    if 'Alpha' in channels_used and has_alpha:
        output_filename = f"{base_name}_Alpha.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        # Check if split texture already exists
        if os.path.exists(output_path):
            print(f"  ↻ Reusing: {output_filename}")
            split_files['Alpha'] = (output_path, 'Alpha', channels_used['Alpha'])
        else:
            # Create new split texture
            alpha_channel = img_array[:, :, 3]
            # Save alpha as grayscale in RGB channels
            alpha_img = np.stack([alpha_channel, alpha_channel, alpha_channel], axis=-1)
            
            Image.fromarray(alpha_img).save(output_path, 'JPEG', quality=jpeg_quality)
            split_files['Alpha'] = (output_path, 'Alpha', channels_used['Alpha'])
            print(f"  ✓ Created: {output_filename}")
    
    # Handle separate color channels (R, G, B)
    if separate_color_usage:
        channel_names = {0: 'Red', 1: 'Green', 2: 'Blue'}
        
        for channel_index, connections in separate_color_usage.items():
            if channel_index > 2:  # Skip alpha for now, handle separately
                continue
            
            # Determine filename based on what socket it's connected to
            # Check if connected to Roughness, Metallic, etc.
            socket_name = None
            for target_node, target_socket_name in connections:
                if 'Roughness' in target_socket_name:
                    socket_name = 'Roughness'
                    break
                elif 'Metallic' in target_socket_name or 'Metalness' in target_socket_name:
                    socket_name = 'Metallic'
                    break
            
            if not socket_name:
                socket_name = channel_names[channel_index]
            
            output_filename = f"{base_name}_{socket_name}.jpg"
            output_path = os.path.join(output_dir, output_filename)
            
            # Check if split texture already exists
            if os.path.exists(output_path):
                print(f"  ↻ Reusing: {output_filename}")
                split_files[channel_index] = (output_path, socket_name, connections)
            else:
                # Create new split texture
                channel_data = img_array[:, :, channel_index]
                # Create grayscale RGB image by replicating the channel across R, G, and B
                channel_img = np.stack([channel_data, channel_data, channel_data], axis=-1)
                
                Image.fromarray(channel_img).save(output_path, 'JPEG', quality=jpeg_quality)
                split_files[channel_index] = (output_path, socket_name, connections)
                print(f"  ✓ Created: {output_filename}")
    
    # Handle alpha channel if connected
    if has_alpha and 3 in separate_color_usage:
        output_filename = f"{base_name}_Alpha.jpg"
        output_path = os.path.join(output_dir, output_filename)
        
        # Check if split texture already exists
        if os.path.exists(output_path):
            print(f"  ↻ Reusing: {output_filename}")
            split_files[3] = (output_path, 'Alpha', separate_color_usage[3])
        else:
            # Create new split texture
            alpha_channel = img_array[:, :, 3]
            # Save alpha as grayscale in RGB channels
            alpha_img = np.stack([alpha_channel, alpha_channel, alpha_channel], axis=-1)
            
            Image.fromarray(alpha_img).save(output_path, 'JPEG', quality=jpeg_quality)
            split_files[3] = (output_path, 'Alpha', separate_color_usage[3])
            print(f"  ✓ Created: {output_filename}")
    
    if not split_files:
        return 0, "No channels to split"
    
    # Update Blender material nodes
    print(f"  Updating Blender material nodes...")
    
    # Find Separate Color nodes connected to this texture
    separate_nodes = []
    for output in texture_node.outputs:
        if output.is_linked:
            for link in output.links:
                if link.to_node.type in ['SEPRGB', 'SEPARATE_COLOR']:
                    separate_nodes.append(link.to_node)
    
    # Frame and move the original texture setup
    frame = nodes.new('NodeFrame')
    frame.label = f"Original (Preserved)"
    frame.use_custom_color = True
    frame.color = (0.3, 0.3, 0.3)
    
    if separate_nodes:
        # Include both texture node and separate nodes in the frame
        nodes_to_frame = [texture_node] + separate_nodes
    else:
        # Just frame the texture node for direct connections (base color, alpha, etc.)
        nodes_to_frame = [texture_node]
    
    # Calculate bounding box of all nodes
    min_x = min(node.location.x for node in nodes_to_frame)
    max_x = max(node.location.x for node in nodes_to_frame)
    min_y = min(node.location.y for node in nodes_to_frame)
    max_y = max(node.location.y for node in nodes_to_frame)
    
    offset_x = -250  # Reduced from -500 to keep it closer
    for node in nodes_to_frame:
        node.parent = frame
        node.location.x += offset_x
    
    frame.location.x = min_x + offset_x
    frame.location.y = min_y
    
    # Enable Fake User on the original texture image to prevent deletion
    if image:
        image.use_fake_user = True
        print(f"  ✓ Enabled Fake User on original texture: {image.name}")
    
    # Position new nodes based on the original location
    start_x = min_x + 200
    start_y = max_y
    
    y_offset = 0
    
    # Get original texture's color space
    original_colorspace = image.colorspace_settings.name
    
    for channel_key, (split_path, socket_name, connections) in split_files.items():
        # Load the split image (reuse if already loaded in Blender)
        image_filename = os.path.basename(split_path)
        
        # Search for existing image by checking filepath (handles .001, .002 duplicates)
        img = None
        for existing_img in bpy.data.images:
            if existing_img.filepath:
                existing_path = bpy.path.abspath(existing_img.filepath)
                if os.path.normpath(existing_path) == os.path.normpath(split_path):
                    img = existing_img
                    break
        
        if not img:
            # Load it for the first time
            img = bpy.data.images.load(split_path)
        
        # Apply the original texture's color space to the split texture
        img.colorspace_settings.name = original_colorspace
        
        # Create new texture node
        new_tex_node = nodes.new('ShaderNodeTexImage')
        new_tex_node.image = img
        new_tex_node.location = (start_x, start_y + y_offset)
        new_tex_node.label = f"{socket_name} (Split)"
        
        # Reconnect to the target sockets
        for target_node, target_socket_name in connections:
            target_socket = target_node.inputs.get(target_socket_name)
            if target_socket:
                # Disconnect old connection
                if target_socket.is_linked:
                    for link in list(target_socket.links):
                        links.remove(link)
                
                # Connect new texture node
                # Alpha textures (JPEGs) use Color output since JPEGs don't have alpha channels
                # The grayscale data is in the RGB channels
                if socket_name == 'Alpha' or channel_key == 'Alpha' or channel_key == 3:
                    output_socket = new_tex_node.outputs['Color']
                else:
                    output_socket = new_tex_node.outputs['Color']
                
                links.new(output_socket, target_socket)
                print(f"  Connected {os.path.basename(split_path)} → {target_node.name}.{target_socket_name}")
        
        y_offset -= 300
    
    # Build summary message
    channel_names = []
    for channel_key, (split_path, socket_name, connections) in split_files.items():
        channel_names.append(socket_name)
    
    summary = f"Split {len(split_files)} channel(s) from {image_name}\n"
    summary += f"  Channels: {', '.join(channel_names)}\n"
    summary += f"  Output: {output_dir}\n"
    summary += f"  Quality: {jpeg_quality}%"
    
    return len(split_files), summary

def convert_textures_to_jpg_png(backup_folder_name):
    """Convert non-JPG/PNG textures based on alpha usage."""
    blend_filepath = bpy.data.filepath
    if not blend_filepath:
        return 0, "Please save your Blender file first"
    
    blend_dir = os.path.dirname(blend_filepath)
    output_dir = os.path.join(blend_dir, backup_folder_name)
    os.makedirs(output_dir, exist_ok=True)
    
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' or obj.type == 'EMPTY']
    
    if not selected_objects:
        return 0, "No objects selected"
    
    images_alpha_used = {}
    for obj in selected_objects:
        if not obj.data or not hasattr(obj.data, 'materials'):
            continue
        for mat_slot in obj.data.materials:
            if not mat_slot or not mat_slot.use_nodes:
                continue
            node_tree = mat_slot.node_tree
            for node in node_tree.nodes:
                if node.type == 'TEX_IMAGE' and node.image:
                    img = node.image
                    alpha_connected = False
                    if 'Alpha' in node.outputs:
                        alpha_socket = node.outputs['Alpha']
                        if alpha_socket.links:
                            alpha_connected = True
                    if img not in images_alpha_used:
                        images_alpha_used[img] = alpha_connected
                    elif alpha_connected:
                        images_alpha_used[img] = True
    
    if not images_alpha_used:
        return 0, "No textures found"
    
    converted_count = 0
    for image, alpha_used in images_alpha_used.items():
        current_ext = ''
        if image.filepath:
            current_ext = os.path.splitext(bpy.path.abspath(image.filepath))[1].lower()
        
        if current_ext in ['.jpg', '.jpeg', '.png']:
            continue
        
        if not image.has_data and not image.packed_file:
            continue
        
        if alpha_used:
            new_format = 'PNG'
            new_ext = '.png'
        else:
            new_format = 'JPEG'
            new_ext = '.jpg'
        
        base_name = image.name
        for ext in ['.tga', '.tif', '.tiff', '.bmp', '.exr', '.hdr', '.png', '.jpg', '.jpeg']:
            if base_name.lower().endswith(ext):
                base_name = base_name[:-len(ext)]
                break
        
        new_filename = base_name + new_ext
        new_path = os.path.join(output_dir, new_filename)
        
        counter = 1
        while os.path.exists(new_path):
            new_filename = f"{base_name}_{counter:02d}{new_ext}"
            new_path = os.path.join(output_dir, new_filename)
            counter += 1
        
        original_format = image.file_format
        original_path = image.filepath
        
        try:
            image.file_format = new_format
            image.filepath_raw = new_path
            image.save()
            converted_count += 1
        except:
            image.file_format = original_format
            image.filepath = original_path
    
    return converted_count, f"Converted {converted_count} textures"

def rename_textures_to_match_nodes():
    """Rename texture files to match their image node names in Blender."""
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' or obj.type == 'EMPTY']
    
    if not selected_objects:
        return 0, "No objects selected"
    
    all_images = set()
    for obj in selected_objects:
        images = get_images_from_object(obj)
        all_images.update(images)
    
    if not all_images:
        return 0, "No textures found"
    
    renamed_count = 0
    for image in all_images:
        node_name = image.name
        if not image.filepath:
            continue
        
        current_path = bpy.path.abspath(image.filepath)
        if not os.path.exists(current_path):
            continue
        
        current_dir = os.path.dirname(current_path)
        current_filename = os.path.basename(current_path)
        current_name, current_ext = os.path.splitext(current_filename)
        
        clean_node_name = node_name
        for ext in ['.tga', '.tif', '.tiff', '.bmp', '.exr', '.hdr', '.png', '.jpg', '.jpeg']:
            if clean_node_name.lower().endswith(ext):
                clean_node_name = clean_node_name[:-len(ext)]
                break
        
        if current_name == clean_node_name:
            continue
        
        new_filename = clean_node_name + current_ext
        new_path = os.path.join(current_dir, new_filename)
        
        if os.path.exists(new_path) and new_path != current_path:
            continue
        
        try:
            os.rename(current_path, new_path)
            image.filepath = new_path
            renamed_count += 1
        except:
            pass
    
    return renamed_count, f"Renamed {renamed_count} texture files"

def resize_textures_standalone(max_size, preserve_aspect_ratio=True, preserve_originals=False, custom_path=""):
    """Resize textures for selected objects.
    
    Args:
        max_size: Maximum texture dimension
        preserve_aspect_ratio: If True, scales uniformly. If False, forces square
        preserve_originals: If True, copies to RESIZED folder and repaths. If False, resizes in place
        custom_path: Custom absolute path for resized textures (only used if preserve_originals is True)
    """
    blend_filepath = bpy.data.filepath
    if not blend_filepath:
        return 0, "Please save your Blender file first"
    
    selected_objects = [obj for obj in bpy.context.selected_objects
                       if obj.type == 'MESH' or obj.type == 'EMPTY']
    
    if not selected_objects:
        return 0, "No objects selected"
    
    all_images = set()
    for obj in selected_objects:
        all_images.update(get_images_from_object(obj))
    
    if not all_images:
        return 0, "No textures found"
    
    # Setup output directory if preserving originals
    output_dir = None
    if preserve_originals:
        # Use custom path if provided, otherwise use RESIZED folder next to .blend file
        if custom_path and custom_path.strip():
            output_dir = bpy.path.abspath(custom_path)
        else:
            blend_dir = os.path.dirname(blend_filepath)
            output_dir = os.path.join(blend_dir, "RESIZED")
        os.makedirs(output_dir, exist_ok=True)
    
    resized_count = 0
    for image in all_images:
        width, height = image.size
        
        if width <= max_size and height <= max_size:
            continue
        
        if not image.has_data and not image.packed_file:
            continue
        
        # Calculate new dimensions based on aspect ratio setting
        if preserve_aspect_ratio:
            # Scale uniformly based on largest dimension
            if width > height:
                new_width = max_size
                new_height = max(1, int((height / width) * max_size))
            else:
                new_height = max_size
                new_width = max(1, int((width / height) * max_size))
        else:
            # Force both dimensions to max_size (may distort)
            new_width = max_size
            new_height = max_size
        
        # Determine output path
        if image.filepath:
            base_filename = os.path.basename(bpy.path.abspath(image.filepath))
            original_path = bpy.path.abspath(image.filepath)
        else:
            ext = '.png'
            if image.file_format == 'JPEG':
                ext = '.jpg'
            base_filename = image.name + ext
            original_path = None
        
        if preserve_originals:
            # Save to RESIZED folder
            output_path = os.path.join(output_dir, base_filename)
        else:
            # Resize in place (overwrite original)
            if original_path:
                output_path = original_path
            else:
                # For packed files without path, skip
                continue
        
        original_pixels = list(image.pixels[:])
        original_width, original_height = image.size
        original_filepath = image.filepath
        
        try:
            # Resize the image
            image.scale(new_width, new_height)
            
            # Set format based on extension
            ext = os.path.splitext(base_filename)[1].lower()
            if ext in ['.jpg', '.jpeg']:
                image.file_format = 'JPEG'
            elif ext == '.png':
                image.file_format = 'PNG'
            
            # Save resized image
            image.filepath_raw = output_path
            image.save()
            resized_count += 1
            
            if preserve_originals:
                # Restore original in memory but keep filepath pointing to RESIZED
                image.scale(original_width, original_height)
                image.pixels[:] = original_pixels
                image.filepath = output_path  # Keep pointing to RESIZED folder
            else:
                # For in-place resize, reload the resized image
                image.reload()
        except Exception as e:
            # Restore on error
            image.scale(original_width, original_height)
            image.pixels[:] = original_pixels
            image.filepath = original_filepath
            print(f"Error resizing {base_filename}: {e}")
    
    if preserve_originals:
        return resized_count, f"Resized {resized_count} textures to RESIZED folder"
    else:
        return resized_count, f"Resized {resized_count} textures in place"

# ============================================================
# OPERATORS
# ============================================================

class GENESYS_OT_export_models(Operator):
    """Export selected models as GLB files"""
    bl_idname = "genesys.export_models"
    bl_label = "Export Models (GLB)"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        print("=" * 80)
        print(f"GENESYS EXPORTER VERSION {EXPORTER_VERSION} - EXPORT STARTING")
        print("=" * 80)
        props = context.scene.genesys_exporter
        
        # Clear previous status
        props.export_status = ""
        props.export_warnings = ""
        
        blend_filepath = bpy.data.filepath
        if not blend_filepath:
            self.report({'ERROR'}, "Please save your Blender file first")
            props.export_status = "❌ Error: Save Blender file first"
            return {'CANCELLED'}
        
        scene_dir = os.path.dirname(blend_filepath)
        base_export_path = props.project_path
        
        # Collect top-level selected objects
        top_level_objects = [obj for obj in context.selected_objects
                            if (obj.type == 'MESH' or obj.type == 'EMPTY') and obj.parent is None]
        
        if not top_level_objects:
            self.report({'WARNING'}, "No top-level objects selected")
            props.export_status = "⚠ Warning: No objects selected"
            return {'CANCELLED'}
        
        exported_count = 0
        export_dirs_used = set()
        all_material_stats = {'exported': 0, 'existing': [], 'skipped': [], 'errors': []}
        
        for obj in top_level_objects:
            asset_name = obj.name
            export_dir = base_export_path
            
            # Determine export path based on collection hierarchy
            if obj.users_collection:
                obj_collection = obj.users_collection[0]
                collection_path_parts = []
                current_col = obj_collection
                
                while current_col:
                    if current_col.name.lower() not in ["scene collection", "@project", "assets"]:
                        collection_path_parts.insert(0, current_col.name)
                    
                    parent_col = None
                    for col in bpy.data.collections:
                        if current_col.name in [c.name for c in col.children]:
                            parent_col = col
                            break
                    
                    if not parent_col:
                        if current_col.name in [c.name for c in context.scene.collection.children]:
                            break
                    
                    current_col = parent_col
                
                if collection_path_parts:
                    export_dir = os.path.join(base_export_path, *collection_path_parts)
            
            # Export the model (returns material stats if materials were exported)
            material_stats = self.export_model(export_dir, asset_name, obj, props)
            if material_stats:
                all_material_stats['exported'] += material_stats['exported']
                all_material_stats['existing'].extend(material_stats['existing'])
                all_material_stats['skipped'].extend(material_stats['skipped'])
                all_material_stats['errors'].extend(material_stats['errors'])
            
            exported_count += 1
            export_dirs_used.add(export_dir)
        
        # Build status message (each part on its own line)
        status_parts = [f"✓ Exported {exported_count} model(s)"]
        
        # Add embedded textures info
        if props.export_textures:
            status_parts.append("Embedded Textures")
        
        # Add texture export location
        if props.export_textures_to_folder:
            obj = context.active_object
            if obj and obj.type == 'MESH' and obj.genesys_export_settings.has_custom_paths and obj.genesys_export_settings.texture_export_custom_path:
                custom_path = obj.genesys_export_settings.texture_export_custom_path
                last_folder = os.path.basename(custom_path.rstrip('/\\'))
                status_parts.append(f"/..{last_folder}")
            else:
                status_parts.append("/textures")
        
        # Add material export location
        if props.export_materials_metadata:
            obj = context.active_object
            if obj and obj.type == 'MESH' and obj.genesys_export_settings.has_custom_paths and obj.genesys_export_settings.material_export_custom_path:
                custom_path = obj.genesys_export_settings.material_export_custom_path
                last_folder = os.path.basename(custom_path.rstrip('/\\'))
                status_parts.append(f"/..{last_folder}")
            else:
                status_parts.append("/materials")
            
            if all_material_stats['exported'] > 0:
                status_parts.append(f"✓ Created {all_material_stats['exported']} material(s)")
            if all_material_stats['existing']:
                status_parts.append(f"↻ Reused {len(all_material_stats['existing'])} existing")
            
            # Show force options if enabled
            force_info = []
            if props.force_materials:
                force_info.append("Force Materials")
            if props.force_texture_slots:
                force_info.append("Force Texture Slots")
            if force_info:
                status_parts.append(f"⚠ {' | '.join(force_info)}")
        
        props.export_status = "\n".join(status_parts)
        
        # Start timer to clear status after 60 seconds
        bpy.app.timers.register(lambda: clear_export_status(context), first_interval=60.0)
        
        # Build warnings message
        warning_parts = []
        if all_material_stats['skipped']:
            warning_parts.append(f"⚠ Skipped {len(all_material_stats['skipped'])} material(s) (no M_ prefix): {', '.join(all_material_stats['skipped'][:5])}")
            if len(all_material_stats['skipped']) > 5:
                warning_parts[-1] += f" +{len(all_material_stats['skipped']) - 5} more"
        
        props.export_warnings = " | ".join(warning_parts) if warning_parts else ""
        
        self.report({'INFO'}, f"Exported {exported_count} model(s)")
        
        # Open export folders
        for export_dir in export_dirs_used:
            try:
                if sys.platform.startswith('win'):
                    os.startfile(export_dir)
                elif sys.platform == 'darwin':
                    subprocess.call(['open', export_dir])
                else:
                    subprocess.call(['xdg-open', export_dir])
            except:
                pass
        
        return {'FINISHED'}
    
    def export_model(self, out_path, model_name, obj, props):
        """Export a single object as GLB.
        
        Returns:
            Dictionary with material export stats, or None if materials not exported
        """
        # Select the object and all its children
        bpy.ops.object.select_all(action='DESELECT')
        select_hierarchy(obj)
        bpy.context.view_layer.objects.active = obj
        
        # Store and center transforms
        original_matrix, _ = store_and_center_hierarchy(obj)
        original_alpha_settings = {}
        material_stats = None
        
        try:
            # Apply Three.js rotation if enabled
            rotate_for_threejs(obj, props.convert_for_threejs)
            
            # Ensure export directory exists
            os.makedirs(out_path, exist_ok=True)
            
            # Copy textures to folder if requested
            if props.export_textures_to_folder:
                # Check if object has custom texture path
                obj_settings = obj.genesys_export_settings
                if obj_settings.has_custom_paths and obj_settings.texture_export_custom_path:
                    texture_dir = bpy.path.abspath(obj_settings.texture_export_custom_path)
                else:
                    # Fall back to scene-level custom path or default
                    custom_tex_path = props.texture_export_custom_path.strip()
                    if custom_tex_path and custom_tex_path != "or custom path here":
                        texture_dir = bpy.path.abspath(custom_tex_path)
                    else:
                        # Default: find assets folder and use /textures subfolder
                        current_path = out_path
                        while current_path and not current_path.endswith('models'):
                            current_path = os.path.dirname(current_path)
                        
                        if current_path:
                            assets_dir = os.path.dirname(current_path)
                            texture_dir = os.path.join(assets_dir, 'textures')
                        else:
                            texture_dir = os.path.join(os.path.dirname(out_path), 'textures')
                
                os.makedirs(texture_dir, exist_ok=True)
                copy_textures_to_folder(obj, texture_dir)
            
            # Determine glTF export settings
            if props.export_textures:
                export_image_format = 'AUTO'
            else:
                export_image_format = 'NONE'
            
            # Apply alpha mode to materials if not AUTO
            if props.force_alpha_mode != 'AUTO':
                original_alpha_settings = apply_alpha_mode_to_materials(
                    obj, props.force_alpha_mode, props.alpha_cutoff
                )
            
            # Export material metadata BEFORE GLB export (so gltf_extras are embedded)
            if props.export_materials_metadata:
                # Find assets root by going up from out_path until we find 'assets' folder
                assets_root = out_path
                while assets_root:
                    folder_name = os.path.basename(assets_root)
                    if folder_name == 'assets':
                        break
                    parent = os.path.dirname(assets_root)
                    if parent == assets_root:  # Reached filesystem root
                        # Fallback: assume we're in models subfolder
                        assets_root = os.path.dirname(out_path)
                        break
                    assets_root = parent
                
                # Check if object has custom material/texture paths
                obj_settings = obj.genesys_export_settings
                if obj_settings.has_custom_paths:
                    material_custom_path = obj_settings.material_export_custom_path or props.material_export_custom_path
                    texture_custom_path = obj_settings.texture_export_custom_path or props.texture_export_custom_path
                else:
                    material_custom_path = props.material_export_custom_path
                    texture_custom_path = props.texture_export_custom_path
                
                print(f"  [Material Export] Assets root: {assets_root}")
                material_stats = export_genesys_materials(
                    obj, 
                    assets_root, 
                    invert_emissive=props.invert_emissive,
                    force_materials=props.force_materials,
                    force_texture_slots=props.force_texture_slots,
                    custom_path=material_custom_path,
                    texture_custom_path=texture_custom_path
                )
            
            # Generate UV2 for lightmapping if requested
            if props.generate_uv2:
                meshes_to_process = [obj] if obj.type == 'MESH' else []
                meshes_to_process += [child for child in obj.children_recursive if child.type == 'MESH']
                for mesh_obj in meshes_to_process:
                    if "UVMap-Lightmap" not in mesh_obj.data.uv_layers:
                        prev_active = bpy.context.view_layer.objects.active
                        prev_mode = bpy.context.object.mode if bpy.context.object else 'OBJECT'
                        bpy.context.view_layer.objects.active = mesh_obj
                        bpy.ops.object.mode_set(mode='EDIT')
                        bpy.ops.mesh.select_all(action='SELECT')
                        uv_layer = mesh_obj.data.uv_layers.new(name="UVMap-Lightmap")
                        mesh_obj.data.uv_layers.active = uv_layer
                        bpy.ops.uv.smart_project(island_margin=0.02)
                        bpy.ops.object.mode_set(mode='OBJECT')
                        bpy.context.view_layer.objects.active = prev_active
                        print(f"  [UV2] Generated UVMap-Lightmap for: {mesh_obj.name}")
                    else:
                        print(f"  [UV2] UVMap-Lightmap already exists on: {mesh_obj.name}, skipping")

            # Export GLB (with embedded gltf_extras from material export above)
            full_export_path = os.path.join(out_path, model_name + '.glb')
            
            # Prepare export settings with custom extension hook
            export_settings = {
                'filepath': full_export_path,
                'use_selection': True,
                'export_format': 'GLB',
                'export_materials': 'EXPORT',
                'export_image_format': export_image_format,
                'export_normals': True,
                'export_tangents': True,
                'export_texcoords': True,
                'export_animations': props.export_animations,
                'export_apply': props.apply_modifiers,
                'export_yup': True
            }
            
            # Add custom extension if available
            if hasattr(bpy.app, 'genesys_gltf_extension'):
                export_settings['export_user_extensions'] = [bpy.app.genesys_gltf_extension]
            
            bpy.ops.export_scene.gltf(**export_settings)
            
        finally:
            # Restore alpha settings
            if original_alpha_settings:
                restore_material_alpha_settings(original_alpha_settings)
            
            # Restore original transform
            restore_transforms(obj, original_matrix)
        
        return material_stats


class GENESYS_OT_export_layout(Operator):
    """Export scene layout as .genesys-mesh-comb file"""
    bl_idname = "genesys.export_layout"
    bl_label = "Export Layout"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        import time
        start_time = time.time()
        
        props = context.scene.genesys_exporter
        
        # Print export banner
        print("=" * 80)
        print(f"GENESYS LAYOUT EXPORT v{EXPORTER_VERSION} - STARTING")
        print("=" * 80)
        
        # Clear previous status
        props.layout_export_status = ""
        props.layout_export_warnings = ""
        
        blend_filepath = bpy.data.filepath
        if not blend_filepath:
            self.report({'ERROR'}, "Please save your Blender file first")
            props.layout_export_status = "❌ Error: Save Blender file first"
            return {'CANCELLED'}
        
        # Use the layout export path from settings
        layout_path = props.layout_export_path.strip()
        if not layout_path:
            self.report({'ERROR'}, "Layout export path is empty")
            props.layout_export_status = "❌ Error: Layout export path is empty"
            return {'CANCELLED'}
        
        if props.debug_layout_export:
            print(f"[DEBUG] Layout path from settings: '{layout_path}'")
        
        # Check if path is absolute or relative
        # On Windows, check for drive letter (C:) or UNC path (\\)
        # Single leading slash (/) should be treated as relative
        is_absolute = (os.path.isabs(layout_path) and 
                      (layout_path[1:2] == ':' or layout_path.startswith('\\\\')))
        
        if is_absolute:
            # Use absolute path as-is
            export_dir = layout_path
            if props.debug_layout_export:
                print(f"[DEBUG] Using absolute path: {export_dir}")
        else:
            # Combine with project_path (treat as relative)
            base_path = props.project_path.strip()
            if not base_path:
                self.report({'ERROR'}, "Project path is empty. Please set Project Path first.")
                props.layout_export_status = "❌ Error: Project path is empty"
                return {'CANCELLED'}
            # Remove leading slash if present for proper path joining
            layout_path = layout_path.lstrip('/\\')
            export_dir = os.path.join(base_path, layout_path)
            if props.debug_layout_export:
                print(f"[DEBUG] Base path (project_path): '{base_path}'")
                print(f"[DEBUG] Combined export_dir: {export_dir}")
        
        # Create export directory if it doesn't exist
        try:
            os.makedirs(export_dir, exist_ok=True)
        except Exception as e:
            self.report({'ERROR'}, f"Could not create layout export path: {e}")
            return {'CANCELLED'}
        
        # Determine filename: use custom name if enabled, otherwise use blend file name
        if props.use_custom_layout_name:
            layout_name = props.layout_filename if props.layout_filename else "Layout01"
        else:
            layout_name = os.path.splitext(os.path.basename(blend_filepath))[0]
        
        # Convert Curve/Geometry Node tools to real instances before gathering
        tool_generated_objects = []
        # Maps generated mesh obj → folder name to assign (non-None only for INSTANCED_ curves)
        tool_obj_folder_override = {}

        if props.convert_tools_to_instances:
            curve_tools = [
                obj for obj in context.selected_objects
                if obj.type == 'CURVE' and any(
                    mod.type == 'NODES' for mod in obj.modifiers
                )
            ]
            if curve_tools:
                print(f"[Tools→Instances] Found {len(curve_tools)} Curve tool(s) with Geometry Nodes")

                original_selection = list(context.selected_objects)

                # Process each curve separately so we can track which objects it spawned
                for ct in curve_tools:
                    objects_before = set(bpy.data.objects)

                    bpy.ops.object.select_all(action='DESELECT')
                    ct.select_set(True)
                    context.view_layer.objects.active = ct

                    bpy.ops.object.duplicates_make_real()

                    new_objects = [
                        obj for obj in bpy.data.objects
                        if obj not in objects_before and obj.type == 'MESH'
                    ]
                    tool_generated_objects.extend(new_objects)
                    print(f"[Tools→Instances] '{ct.name}' → {len(new_objects)} real mesh instance(s)")

                    # If curve is named INSTANCED_*, assign that name as the layout folder
                    # so the existing isInstanced logic on the folder triggers automatically
                    if ct.name.startswith("INSTANCED_"):
                        for obj in new_objects:
                            tool_obj_folder_override[obj.name] = ct.name
                        print(f"[Tools→Instances] '{ct.name}' flagged as INSTANCED folder")

                # Restore original selection + new objects
                bpy.ops.object.select_all(action='DESELECT')
                for orig in original_selection:
                    orig.select_set(True)
                for new_obj in tool_generated_objects:
                    new_obj.select_set(True)

        # Gather instances from selected objects only
        actors = []
        selected_objects = [obj for obj in context.selected_objects if obj.type == 'MESH']
        # Also include any tool-generated objects that may not be in the active selection yet
        for tgo in tool_generated_objects:
            if tgo not in selected_objects:
                selected_objects.append(tgo)
        
        if not selected_objects:
            self.report({'WARNING'}, "No mesh objects selected")
            return {'CANCELLED'}
        
        position_scale = 1.0
        collision_overrides = {}
        
        for obj in selected_objects:
            # Skip objects with parents
            if obj.parent is not None:
                continue
            
            # Find source object for instanced meshes
            source_obj = None
            source_warnings = []
            asset_name = re.sub(r'\.\d{3}$', '', obj.name)  # Only strip .001, .002, etc.
            
            if obj.data.users > 1:  # This object shares mesh data (is an instance)
                # Find the original object that this is instanced from
                # ONLY search in @project collections for source meshes
                for potential_source in bpy.data.objects:
                    if (potential_source.type == 'MESH' and 
                        potential_source.data == obj.data and 
                        potential_source != obj):
                        
                        # Get the collection path of potential source
                        source_collection = get_collection_path(potential_source)
                        
                        # ONLY accept sources from @project collections
                        if source_collection and source_collection.startswith('@project'):
                            # Check if this potential source has a clean name (no trailing numbers/dots)
                            clean_name = re.sub(r'\.\d{3}$', '', potential_source.name)
                            if potential_source.name == clean_name or clean_name == asset_name:
                                source_obj = potential_source
                                break
            
            # Check if source object has .001 suffix - THIS IS AN ERROR!
            if source_obj and re.search(r'\.\d{3}$', source_obj.name):
                warning = f"⚠️ ERROR: Source mesh '{source_obj.name}' has .001 suffix!"
                source_warnings.append(warning)
                print(f"[ERROR] {warning}")
            
            if source_obj:
                asset_name = re.sub(r'\.\d{3}$', '', source_obj.name)  # Only strip .001, .002, etc.
            
            # Get collection paths
            if source_obj:
                asset_collection_path = get_collection_path(source_obj)
            else:
                asset_collection_path = get_collection_path(obj)
            
            # Build asset path
            if asset_collection_path:
                if asset_collection_path.startswith('@project'):
                    asset_path = asset_collection_path + '/' + asset_name + '.glb'
                else:
                    asset_path = '@project/../assets/' + asset_collection_path + '/' + asset_name + '.glb'
            else:
                asset_path = '@project/../assets/' + asset_name + '.glb'
            
            # Clean up path
            asset_path = asset_path.replace('\\', '/').replace('//', '/')
            asset_path = re.sub(r'\.+glb$', '.glb', asset_path)
            
            # Get layout folder (full path for nested hierarchy)
            # Tool-generated objects from INSTANCED_ curves override the folder name
            if obj.name in tool_obj_folder_override:
                layout_folder = tool_obj_folder_override[obj.name]
            else:
                instance_collection_path = get_collection_path(obj)
                layout_folder = instance_collection_path if instance_collection_path else None
            
            # Position (world space with coordinate system conversion)
            world_location = obj.matrix_world.to_translation()
            position = [
                round(world_location.x * position_scale, 6),
                round(world_location.z * position_scale, 6),
                round(-world_location.y * position_scale, 6)
            ]
            
            # Rotation as quaternion
            quaternion = get_world_quaternion(obj)
            
            # Scale
            world_scale = obj.matrix_world.to_scale()
            scale = [round(s, 6) for s in world_scale]
            
            actor_data = {
                "displayName": obj.name,
                "meshes": [
                    {
                        "path": asset_path,
                        "position": position,
                        "quaternion": quaternion,
                        "scale": scale,
                        "asRoot": True,
                        "collisionOverride": collision_overrides.get(asset_name, None)
                    }
                ],
                "layoutFolder": layout_folder
            }
            
            actors.append(actor_data)
        
        if len(actors) == 0:
            self.report({'WARNING'}, "No actors to export")
            return {'CANCELLED'}
        
        # Organize actors into folders
        folders_dict = {}
        root_actors = []
        
        # If "Ignore Folders" is enabled with Force Instances, group all actors by root folder only
        if props.force_instances and props.force_instances_ignore_folders:
            # Find the root folder name - take the FIRST part of the path
            # Examples:
            #   "LEVEL01/SideRoom/SubFolder" → "LEVEL01"
            #   "@project/assets/models/SCIFI01" → "@project"
            root_folder_name = None
            
            for actor_data in actors:
                folder_name = actor_data.get("layoutFolder", None)
                if folder_name:
                    # Take the first part of the path as the root folder
                    root_folder_name = folder_name.split('/')[0]
                    break
            
            # If no folder found, use "InstancedMeshes" as default
            if not root_folder_name:
                root_folder_name = "InstancedMeshes"
            
            # Group all actors under the root folder
            for actor_data in actors:
                actor_data.pop("layoutFolder", None)  # Remove folder info
                if root_folder_name not in folders_dict:
                    folders_dict[root_folder_name] = []
                folders_dict[root_folder_name].append(actor_data)
        else:
            # Normal folder organization
            for actor_data in actors:
                folder_name = actor_data.pop("layoutFolder", None)
                if folder_name:
                    if folder_name not in folders_dict:
                        folders_dict[folder_name] = []
                    folders_dict[folder_name].append(actor_data)
                else:
                    root_actors.append(actor_data)
        
        # Build export structure
        export_data = {}
        
        # Add folders if any exist
        if folders_dict:
            export_data["folders"] = [
                {
                    "name": folder_name,
                    "actors": folder_actors,
                    "isInstanced": props.force_instances or any(part.startswith("INSTANCED_") for part in folder_name.split('/'))
                }
                for folder_name, folder_actors in folders_dict.items()
            ]
        
        # Add root-level actors if any exist
        if root_actors:
            export_data["actors"] = root_actors
        
        # Add clean folders flag
        export_data["cleanFolders"] = props.clean_folders
        
        # Validate mesh files if enabled
        unique_mesh_paths = set()
        missing_files = []
        instanced_folder_count = 0
        
        if props.validate_layout_files:
            # Collect unique mesh paths from all actors
            for actor_data in actors:
                for mesh in actor_data.get("meshes", []):
                    mesh_path = mesh.get("path", "")
                    if mesh_path:
                        unique_mesh_paths.add(mesh_path)
            
            # Count instanced folders
            if folders_dict:
                for folder_name in folders_dict.keys():
                    if props.force_instances or any(part.startswith("INSTANCED_") for part in folder_name.split('/')):
                        instanced_folder_count += 1
            
            # Check if each unique mesh file exists
            # The project_path should point to the parent of 'assets' folder
            # But to be safe, we'll handle both cases
            base_path = props.project_path.rstrip('/\\')
            
            for mesh_path in unique_mesh_paths:
                # Convert @project path to actual file path
                file_path = mesh_path.replace("@project/", "").replace("@project/../", "")
                
                if props.debug_layout_export:
                    print(f"[DEBUG VALIDATION] Checking: {mesh_path}")
                
                # If base_path ends with 'assets' and file_path starts with 'assets/', 
                # remove the duplicate 'assets/'
                if base_path.endswith('assets') and file_path.startswith('assets/'):
                    file_path = file_path[7:]  # Remove 'assets/' prefix
                    if props.debug_layout_export:
                        print(f"[DEBUG VALIDATION] Removed duplicate 'assets/' prefix")
                
                full_path = os.path.join(base_path, file_path)
                full_path = os.path.normpath(full_path)  # Normalize path separators
                
                if props.debug_layout_export:
                    print(f"[DEBUG VALIDATION] Full path: {full_path}")
                    print(f"[DEBUG VALIDATION] Exists: {os.path.exists(full_path)}")
                
                if not os.path.exists(full_path):
                    # Extract just the filename for cleaner display
                    filename = os.path.basename(mesh_path)
                    missing_files.append(filename)
        
        # Use the configured export directory and custom filename
        out_path = os.path.join(export_dir, layout_name + ".genesys-mesh-comb")
        
        # Write JSON
        with open(out_path, "w") as f:
            json.dump(export_data, f, indent=2)
        
        # Clean up tool-generated instances if requested
        if tool_generated_objects and not props.keep_tool_instances:
            print(f"[Tools→Instances] Removing {len(tool_generated_objects)} temporary mesh instance(s)")
            bpy.ops.object.select_all(action='DESELECT')
            for tgo in tool_generated_objects:
                if tgo.name in bpy.data.objects:
                    tgo.select_set(True)
            bpy.ops.object.delete()
            print("[Tools→Instances] Temporary instances deleted")
        
        # Calculate export time
        elapsed_time = time.time() - start_time
        
        # Build status message
        status_parts = [f"✓ Exported {len(actors)} actor(s)"]
        
        # Show FORCE INSTANCES status
        if props.force_instances:
            status_parts.append("🔒 FORCE INSTANCES")
        
        # Show tool instances status
        if tool_generated_objects:
            kept = "kept" if props.keep_tool_instances else "removed"
            status_parts.append(f"🔧 {len(tool_generated_objects)} tool instance(s) {kept}")
        
        # Show folder count
        if folders_dict:
            status_parts.append(f"📁 {len(folders_dict)} folder(s)")
        
        # Show instanced collection count (will become instanced mesh components)
        if instanced_folder_count > 0:
            status_parts.append(f"📦 {instanced_folder_count} instanced mesh component(s)")
        
        # Show file validation results
        if props.validate_layout_files:
            verified_count = len(unique_mesh_paths) - len(missing_files)
            status_parts.append(f"✓ {verified_count}/{len(unique_mesh_paths)} files verified")
        
        # Show export time
        status_parts.append(f"⏱ {elapsed_time:.2f}s")
        
        props.layout_export_status = "\n".join(status_parts)
        
        # Start timer to clear status after 60 seconds
        bpy.app.timers.register(lambda: clear_layout_status(context), first_interval=60.0)
        
        # Build warnings message
        if missing_files:
            warning_text = f"⚠ {len(missing_files)} NOT matched in Genesys: {', '.join(missing_files[:5])}"
            if len(missing_files) > 5:
                warning_text += f" +{len(missing_files) - 5} more"
            props.layout_export_warnings = warning_text
        
        # Build report message for console
        msg = f"Exported {len(actors)} actor(s)"
        if folders_dict:
            msg += f" in {len(folders_dict)} folder(s)"
        if instanced_folder_count > 0:
            msg += f" ({instanced_folder_count} instanced)"
        if props.clean_folders:
            msg += " [Clean mode]"
        msg += f" in {elapsed_time:.2f}s"
        
        self.report({'INFO'}, msg)
        
        # Copy pnpm import command to clipboard
        scene_name = props.scene_name.strip() if props.scene_name.strip() else "default"
        clipboard_text = f"pnpm import-mesh-comb @project/assets/layouts/{layout_name}.genesys-mesh-comb {scene_name}"
        
        try:
            context.window_manager.clipboard = clipboard_text
            print(f"[INFO] Copied to clipboard: {clipboard_text}")
        except Exception as e:
            print(f"[WARNING] Could not copy to clipboard: {e}")
        
        # Change button label to show success
        props.layout_button_label = "✓ Export Complete! pnpm command copied - paste into Cursor"
        
        # Start timer to reset button after 30 seconds
        bpy.app.timers.register(lambda: reset_layout_button(context), first_interval=30.0)
        
        # Print export completion banner
        print("=" * 80)
        print(f"GENESYS LAYOUT EXPORT v{EXPORTER_VERSION} - COMPLETED")
        print("=" * 80)
        print("")  # Extra line for spacing
        
        # Open folder
        try:
            if sys.platform.startswith('win'):
                os.startfile(export_dir)
            elif sys.platform == 'darwin':
                subprocess.call(['open', export_dir])
            else:
                subprocess.call(['xdg-open', export_dir])
        except:
            pass
        
        return {'FINISHED'}


class GENESYS_OT_open_export_folder(Operator):
    """Open the export folder in file browser"""
    bl_idname = "genesys.open_export_folder"
    bl_label = "Open Export Folder"
    
    def execute(self, context):
        props = context.scene.genesys_exporter
        export_path = props.project_path
        
        if not os.path.exists(export_path):
            self.report({'WARNING'}, f"Path does not exist: {export_path}")
            return {'CANCELLED'}
        
        try:
            if sys.platform.startswith('win'):
                os.startfile(export_path)
            elif sys.platform == 'darwin':
                subprocess.call(['open', export_path])
            else:
                subprocess.call(['xdg-open', export_path])
        except Exception as e:
            self.report({'ERROR'}, f"Could not open folder: {e}")
            return {'CANCELLED'}
        
        return {'FINISHED'}


class GENESYS_OT_tooltip_info(Operator):
    """Not me!! The options below 😊"""
    bl_idname = "genesys.tooltip_info"
    bl_label = "Hover over options for tooltips"
    
    def execute(self, context):
        # This operator does nothing, it's just for the tooltip
        return {'FINISHED'}


class GENESYS_OT_inherit_paths(Operator):
    """Copy active object's custom paths to all selected objects"""
    bl_idname = "genesys.inherit_paths"
    bl_label = "Inherit Paths from Active"
    bl_description = "Copy the active object's custom texture and material paths to all other selected objects"
    
    def execute(self, context):
        active_obj = context.active_object
        if not active_obj or active_obj.type != 'MESH':
            self.report({'WARNING'}, "No active mesh object")
            return {'CANCELLED'}
        
        # Get active object's settings
        active_settings = active_obj.genesys_export_settings
        
        # Copy to all other selected mesh objects
        copied_count = 0
        for obj in context.selected_objects:
            if obj != active_obj and obj.type == 'MESH':
                obj_settings = obj.genesys_export_settings
                obj_settings.texture_export_custom_path = active_settings.texture_export_custom_path
                obj_settings.material_export_custom_path = active_settings.material_export_custom_path
                if active_settings.texture_export_custom_path or active_settings.material_export_custom_path:
                    obj_settings.has_custom_paths = True
                copied_count += 1
        
        if copied_count > 0:
            self.report({'INFO'}, f"Copied custom paths from {active_obj.name} to {copied_count} object(s)")
        else:
            self.report({'WARNING'}, "No other mesh objects selected")
        
        return {'FINISHED'}


class GENESYS_OT_inherit_texture_path(Operator):
    """Copy active object's texture path to all selected objects"""
    bl_idname = "genesys.inherit_texture_path"
    bl_label = "Inherit Texture Path"
    bl_description = "Copy the active object's custom texture path to all other selected objects"
    
    def execute(self, context):
        active_obj = context.active_object
        if not active_obj or active_obj.type != 'MESH':
            self.report({'WARNING'}, "No active mesh object")
            return {'CANCELLED'}
        
        # Get active object's settings
        active_settings = active_obj.genesys_export_settings
        
        # Copy to all other selected mesh objects
        copied_count = 0
        for obj in context.selected_objects:
            if obj != active_obj and obj.type == 'MESH':
                obj_settings = obj.genesys_export_settings
                obj_settings.texture_export_custom_path = active_settings.texture_export_custom_path
                if active_settings.texture_export_custom_path:
                    obj_settings.has_custom_paths = True
                copied_count += 1
        
        if copied_count > 0:
            self.report({'INFO'}, f"Copied texture path from {active_obj.name} to {copied_count} object(s)")
        else:
            self.report({'WARNING'}, "No other mesh objects selected")
        
        return {'FINISHED'}


class GENESYS_OT_inherit_material_path(Operator):
    """Copy active object's material path to all selected objects"""
    bl_idname = "genesys.inherit_material_path"
    bl_label = "Inherit Material Path"
    bl_description = "Copy the active object's custom material path to all other selected objects"
    
    def execute(self, context):
        active_obj = context.active_object
        if not active_obj or active_obj.type != 'MESH':
            self.report({'WARNING'}, "No active mesh object")
            return {'CANCELLED'}
        
        # Get active object's settings
        active_settings = active_obj.genesys_export_settings
        
        # Copy to all other selected mesh objects
        copied_count = 0
        for obj in context.selected_objects:
            if obj != active_obj and obj.type == 'MESH':
                obj_settings = obj.genesys_export_settings
                obj_settings.material_export_custom_path = active_settings.material_export_custom_path
                if active_settings.material_export_custom_path:
                    obj_settings.has_custom_paths = True
                copied_count += 1
        
        if copied_count > 0:
            self.report({'INFO'}, f"Copied material path from {active_obj.name} to {copied_count} object(s)")
        else:
            self.report({'WARNING'}, "No other mesh objects selected")
        
        return {'FINISHED'}


class GENESYS_OT_create_folder_structure(Operator):
    """Create standard Genesys folder structure as collections"""
    bl_idname = "genesys.create_folder_structure"
    bl_label = "Create Folder Structure"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.genesys_exporter
        
        # Define the standard folder structure
        structure = {
            "@project": {
                "assets": {
                    "models": {},
                    "characters": {}
                }
            },
            "Level01 (ExportLayout - instance your models in here)": {}
        }
        
        def create_collection_hierarchy(parent_collection, structure_dict):
            """Recursively create collection hierarchy"""
            for name, children in structure_dict.items():
                # Check if collection already exists
                existing = bpy.data.collections.get(name)
                if existing:
                    collection = existing
                else:
                    # Create new collection
                    collection = bpy.data.collections.new(name)
                    parent_collection.children.link(collection)
                
                # Recursively create children
                if children:
                    create_collection_hierarchy(collection, children)
        
        # Start from scene collection
        scene_collection = context.scene.collection
        create_collection_hierarchy(scene_collection, structure)
        
        # Mark as created
        props.folder_structure_created = True
        
        self.report({'INFO'}, "Folder structure created: @project/assets/models, characters, Level01")
        return {'FINISHED'}


class GENESYS_OT_run_utilities(Operator):
    """Run selected utility tools on selected objects"""
    bl_idname = "genesys.run_utilities"
    bl_label = "Run Utility Tools"
    bl_options = {'REGISTER', 'UNDO'}
    
    def execute(self, context):
        props = context.scene.genesys_exporter
        
        if not context.selected_objects:
            self.report({'WARNING'}, "No objects selected")
            return {'CANCELLED'}
        
        results = []
        ran_any = False
        
        # Run enabled utilities
        if props.run_split_rgb_channels:
            count, msg = split_rgb_channels_utility(props.split_rgb_compression)
            results.append(f"Split RGB Channels: {msg}")
            ran_any = True
        
        if props.run_shader_cleanup:
            count, msg = cleanup_unused_shader_nodes()
            results.append(f"Shader Cleanup: {msg}")
            ran_any = True
        
        if props.run_material_merge:
            count, msg = merge_duplicate_materials()
            results.append(f"Material Merge: {msg}")
            ran_any = True
        
        if props.run_texture_rename:
            count, msg = rename_textures_to_match_nodes()
            results.append(f"Texture Rename: {msg}")
            ran_any = True
        
        if props.run_texture_convert:
            count, msg = convert_textures_to_jpg_png(props.texture_backup_folder)
            results.append(f"Texture Convert: {msg}")
            ran_any = True
        
        if props.run_texture_backup:
            count, msg = backup_and_repath_textures(
                props.texture_backup_folder,
                props.texture_backup_custom_path,
                props.force_repath_to_backup
            )
            results.append(f"Texture Backup: {msg}")
            ran_any = True
        
        if props.run_texture_resize:
            max_size = int(props.max_texture_size)
            count, msg = resize_textures_standalone(
                max_size,
                props.preserve_aspect_ratio,
                props.preserve_originals_resize,
                props.texture_resize_custom_path
            )
            results.append(f"Texture Resize: {msg}")
            ran_any = True
        
        if not ran_any:
            self.report({'WARNING'}, "No utilities enabled. Enable at least one utility to run.")
            return {'CANCELLED'}
        
        # Report results
        for result in results:
            print(result)
        
        # Set utility status for UI display
        props.utility_status = "\n".join(results)
        
        self.report({'INFO'}, f"Completed {len(results)} utility tool(s)")
        
        # Save reminder
        if ran_any:
            self.report({'WARNING'}, "IMPORTANT: Save your .blend file to preserve changes!")
        
        # Start timer to clear status after 60 seconds
        bpy.app.timers.register(lambda: clear_utility_status(context), first_interval=60.0)
        
        return {'FINISHED'}

# ============================================================
# UI PANEL
# ============================================================

class GENESYS_PT_exporter_panel(Panel):
    """Genesys Exporter Panel"""
    bl_label = "Genesys Exporter"
    bl_idname = "GENESYS_PT_exporter_panel"
    bl_space_type = 'VIEW_3D'
    bl_region_type = 'UI'
    bl_category = 'Genesys'
    
    def draw(self, context):
        layout = self.layout
        props = context.scene.genesys_exporter
        
        # Version info at top
        row = layout.row()
        row.label(text=f"v{EXPORTER_VERSION}", icon='INFO')
        
        layout.separator()
        
        # Project Path
        box = layout.box()
        box.label(text="Project Settings:", icon='FILE_FOLDER')
        box.prop(props, "project_path")
        box.operator("genesys.open_export_folder", icon='FILEBROWSER')
        box.operator("genesys.inherit_paths", text="Inherit Paths", icon='DUPLICATE')
        
        # Create Folder Structure button
        row = box.row()
        row.operator("genesys.create_folder_structure", icon='NEWFOLDER')
        row.enabled = not props.folder_structure_created
        if props.folder_structure_created:
            box.label(text="✓ Folder structure created", icon='CHECKMARK')
        
        layout.separator()
        
        # Export Models Section
        box = layout.box()
        box.label(text="Export Models (GLB):", icon='EXPORT')
        
        # Tooltip reminder (as a button-style label with tooltip)
        info_row = box.row()
        info_row.operator("genesys.tooltip_info", text="Hover over options for tooltips", icon='INFO', emboss=False)
        
        # Export Textures with cog dropdown
        row = box.row(align=True)
        row.prop(props, "export_textures_to_folder")
        row.prop(props, "show_texture_export_options", text="", icon="SETTINGS", emboss=False)
        
        # Texture Export Options (only show if cog is expanded)
        if props.show_texture_export_options:
            tex_export_box = box.box()
            tex_export_box.label(text="/textures")
            # Show object's custom path if an object is selected, otherwise scene default
            obj = context.active_object
            if obj and obj.type == 'MESH':
                tex_export_box.prop(obj.genesys_export_settings, "texture_export_custom_path", text="")
            else:
                tex_export_box.prop(props, "texture_export_custom_path")
            tex_export_box.operator("genesys.inherit_texture_path", text="Inherit Texture Path", icon='DUPLICATE')
        
        box.prop(props, "export_textures")
        
        # Create Genesys Materials with cog dropdown
        row = box.row(align=True)
        row.prop(props, "export_materials_metadata")
        row.prop(props, "show_material_export_options", text="", icon="SETTINGS", emboss=False)
        
        # Material Export Options (only show if cog is expanded)
        if props.show_material_export_options:
            mat_export_box = box.box()
            mat_export_box.label(text="/materials")
            # Show object's custom path if an object is selected, otherwise scene default
            obj = context.active_object
            if obj and obj.type == 'MESH':
                mat_export_box.prop(obj.genesys_export_settings, "material_export_custom_path", text="")
            else:
                mat_export_box.prop(props, "material_export_custom_path")
            mat_export_box.operator("genesys.inherit_material_path", text="Inherit Material Path", icon='DUPLICATE')
            mat_export_box.separator()
            mat_export_box.prop(props, "force_materials")
            mat_export_box.prop(props, "force_texture_slots")
        
        box.prop(props, "export_animations")
        
        # Advanced Export Options (Collapsible)
        row = box.row(align=True)
        row.prop(props, "show_advanced_export",
                icon='TRIA_DOWN' if props.show_advanced_export else 'TRIA_RIGHT',
                icon_only=True,
                emboss=False)
        row.label(text="Advanced:", icon='SETTINGS')
        
        if props.show_advanced_export:
            adv_box = box.box()
            adv_box.prop(props, "convert_for_threejs")
            adv_box.prop(props, "invert_emissive")
            adv_box.prop(props, "apply_modifiers")
            adv_box.prop(props, "generate_uv2")
        
        row = box.row()
        row.scale_y = 1.5
        row.operator("genesys.export_models", icon='MESH_CUBE')
        
        # Export status display
        if props.export_status:
            status_box = box.box()
            # Use alert styling if there are warnings
            if props.export_warnings:
                status_box.alert = True
            # Split into multiple lines
            for line in props.export_status.split('\n'):
                status_box.label(text=line, icon='CHECKMARK' if not props.export_warnings else 'INFO')
            
            if props.export_warnings:
                # Split warnings into multiple lines if too long
                warning_lines = props.export_warnings.split(' | ')
                for line in warning_lines:
                    if len(line) > 60:
                        # Wrap long lines
                        words = line.split()
                        current_line = ""
                        for word in words:
                            if len(current_line) + len(word) + 1 <= 60:
                                current_line += (" " if current_line else "") + word
                            else:
                                if current_line:
                                    status_box.label(text=current_line, icon='ERROR')
                                current_line = word
                        if current_line:
                            status_box.label(text=current_line, icon='ERROR')
                    else:
                        status_box.label(text=line, icon='ERROR')
        
        layout.separator()
        
        # Export Layout Section (Collapsible)
        box = layout.box()
        row = box.row()
        row.prop(props, "show_layout",
                icon='TRIA_DOWN' if props.show_layout else 'TRIA_RIGHT',
                icon_only=True,
                emboss=False)
        row.label(text="Export Layout:", icon='SCENE_DATA')
        
        if props.show_layout:
            box.prop(props, "layout_export_path")
            
            # Scene name for pnpm command
            box.prop(props, "scene_name")
            
            # Custom filename toggle and field
            row = box.row()
            row.prop(props, "use_custom_layout_name")
            row = box.row()
            row.prop(props, "layout_filename")
            row.enabled = props.use_custom_layout_name
            
            box.prop(props, "clean_folders", text="Clean Empty Folders on Import")
            
            # Force Instances with cog icon for options
            row = box.row(align=True)
            row.prop(props, "force_instances")
            row.prop(props, "show_force_instances_options", text="", icon="SETTINGS", emboss=False)
            
            # Show additional options if expanded
            if props.show_force_instances_options:
                sub_box = box.box()
                sub_box.prop(props, "force_instances_ignore_folders")
                sub_box.prop(props, "validate_layout_files")
                sub_box.prop(props, "debug_layout_export")
                sub_box.separator()
                sub_box.prop(props, "convert_tools_to_instances")
                row = sub_box.row()
                row.prop(props, "keep_tool_instances")
                row.enabled = props.convert_tools_to_instances
            
            row = box.row()
            row.scale_y = 1.5
            # Use dynamic button label
            row.operator("genesys.export_layout", text=props.layout_button_label, icon='OUTLINER_OB_GROUP_INSTANCE')
            
            # Layout export status display
            if props.layout_export_status:
                status_box = box.box()
                # Use alert styling if there are warnings
                if props.layout_export_warnings:
                    status_box.alert = True
                
                # Split status into individual lines for better readability
                for line in props.layout_export_status.split('\n'):
                    status_box.label(text=line, icon='CHECKMARK' if not props.layout_export_warnings else 'INFO')
                
                # Show warnings on separate lines
                if props.layout_export_warnings:
                    # Wrap long warning text
                    warning_text = props.layout_export_warnings
                    if len(warning_text) > 60:
                        words = warning_text.split()
                        current_line = ""
                        for word in words:
                            if len(current_line) + len(word) + 1 <= 60:
                                current_line += (" " if current_line else "") + word
                            else:
                                if current_line:
                                    status_box.label(text=current_line, icon='ERROR')
                                current_line = word
                        if current_line:
                            status_box.label(text=current_line, icon='ERROR')
                    else:
                        status_box.label(text=warning_text, icon='ERROR')
        
        layout.separator()
        
        # Info
        box = layout.box()
        selected_count = len([obj for obj in context.selected_objects if obj.type == 'MESH'])
        box.label(text=f"Selected Meshes: {selected_count}", icon='INFO')
        
        layout.separator()
        
        # Utility Tools Section (Collapsible) - AT BOTTOM
        box = layout.box()
        row = box.row()
        row.prop(props, "show_utilities",
                icon='TRIA_DOWN' if props.show_utilities else 'TRIA_RIGHT',
                icon_only=True,
                emboss=False)
        row.label(text="Utility Tools:", icon='TOOL_SETTINGS')
        
        if props.show_utilities:
            # Utility switches
            col = box.column(align=True)
            col.prop(props, "run_material_merge")
            col.prop(props, "run_shader_cleanup")
            col.prop(props, "run_texture_rename")
            col.prop(props, "run_texture_convert")
            
            # Split RGB Channels
            row = col.row(align=True)
            row.prop(props, "run_split_rgb_channels")
            row.prop(props, "split_rgb_compression", text="", slider=True)
            
            # Texture Backup with cog dropdown
            row = col.row(align=True)
            row.prop(props, "run_texture_backup")
            row.prop(props, "show_texture_backup_options", text="", icon="SETTINGS", emboss=False)
            
            # Texture Resize with cog dropdown
            row = col.row(align=True)
            row.prop(props, "run_texture_resize")
            row.prop(props, "show_texture_resize_options", text="", icon="SETTINGS", emboss=False)
            
            box.separator()
            
            # Texture Backup Options (only show if cog is expanded)
            if props.show_texture_backup_options:
                backup_box = box.box()
                backup_box.label(text="Texture Backup Options:", icon='SETTINGS')
                backup_box.prop(props, "texture_backup_custom_path", text="Custom Path")
                backup_box.label(text="Leave empty to use folder next to .blend file:", icon='INFO')
                backup_box.prop(props, "texture_backup_folder", text="Folder Name")
                backup_box.prop(props, "force_repath_to_backup")
            
            # Texture Resize Options (only show if cog is expanded)
            if props.show_texture_resize_options:
                resize_box = box.box()
                resize_box.label(text="Texture Resize Options:", icon='SETTINGS')
                resize_box.prop(props, "preserve_aspect_ratio")
                resize_box.prop(props, "max_texture_size", text="Max Size")
                resize_box.prop(props, "preserve_originals_resize")
                
                # Custom path (only enabled when preserve originals is checked)
                custom_path_row = resize_box.row()
                custom_path_row.prop(props, "texture_resize_custom_path", text="Custom Path")
                custom_path_row.enabled = props.preserve_originals_resize
                
                if props.preserve_originals_resize:
                    resize_box.label(text="Leave empty to use RESIZED folder next to .blend file", icon='INFO')
            
            box.separator()
            
            # Curve tool creator
            box.operator("genesys.create_instanced_along_curve", icon='OUTLINER_OB_CURVE')
            
            box.separator()
            
            # Run button
            box.operator("genesys.run_utilities", icon='PLAY')
            
            # Status display
            if props.utility_status:
                status_box = box.box()
                for line in props.utility_status.split('\n'):
                    if line.strip():
                        status_box.label(text=line, icon='CHECKMARK')
            
            # Warning
            warning_box = box.box()
            warning_box.label(text="⚠ Only affects SELECTED objects", icon='ERROR')

class GENESYS_PT_material_panel(Panel):
    """Genesys Material Properties Panel"""
    bl_label = "Genesys"
    bl_idname = "MATERIAL_PT_genesys_material"
    bl_space_type = 'PROPERTIES'
    bl_region_type = 'WINDOW'
    bl_context = 'material'
    
    @classmethod
    def poll(cls, context):
        """Only show panel when object has active material"""
        return context.object and context.object.active_material
    
    def draw(self, context):
        layout = self.layout
        material = context.object.active_material
        genesys_mat = material.genesys_material
        
        # Material attributes box
        box = layout.box()
        box.label(text="Material Attributes:", icon='MATERIAL')
        
        # Transparency checkbox
        row = box.row()
        row.prop(genesys_mat, "transparency")
        
        # Alpha Test slider
        row = box.row()
        row.prop(genesys_mat, "alpha_test", slider=True)
        
        # Opacity slider
        row = box.row()
        row.prop(genesys_mat, "opacity", slider=True)

# ============================================================
# ADDON PREFERENCES & DEPENDENCY INSTALLER
# ============================================================

class GENESYS_OT_install_dependencies(Operator):
    """Install required Python libraries (Pillow, NumPy) for image processing features"""
    bl_idname = "genesys.install_dependencies"
    bl_label = "Install Dependencies"
    bl_description = "Install Pillow and NumPy libraries required for Split RGB Channels feature"
    
    def execute(self, context):
        import subprocess
        import sys
        
        try:
            # Install Pillow
            self.report({'INFO'}, "Installing Pillow...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "Pillow"])
            
            # Install NumPy
            self.report({'INFO'}, "Installing NumPy...")
            subprocess.check_call([sys.executable, "-m", "pip", "install", "--user", "numpy"])
            
            self.report({'INFO'}, "Dependencies installed successfully! Restart Blender to use Split RGB Channels.")
            return {'FINISHED'}
        except Exception as e:
            self.report({'ERROR'}, f"Failed to install dependencies: {str(e)}")
            return {'CANCELLED'}

def ensure_array_on_curve_node_group():
    """Return GN_ArrayOnCurve02, creating it from scratch if it doesn't exist."""
    NAME = 'GN_ArrayOnCurve02'

    # Prefer exact name, then any ArrayOnCurve variant
    ng = bpy.data.node_groups.get(NAME)
    if ng is None:
        candidates = [g for g in bpy.data.node_groups if 'ArrayOnCurve' in g.name and g.type == 'GEOMETRY']
        if candidates:
            ng = candidates[0]
            print(f"[GN_ArrayOnCurve02] Using existing '{ng.name}'")
            return ng

    if ng is not None:
        return ng

    # ── Build from scratch ────────────────────────────────────────────────
    print(f"[GN_ArrayOnCurve02] Not found — creating from scratch")
    ng = bpy.data.node_groups.new(NAME, 'GeometryNodeTree')
    nodes = ng.nodes
    links = ng.links

    # ── Interface (exposed sockets) ───────────────────────────────────────
    iface = ng.interface
    iface.new_socket('Geometry',        in_out='OUTPUT', socket_type='NodeSocketGeometry')
    iface.new_socket('Geometry',        in_out='INPUT',  socket_type='NodeSocketGeometry')
    sock_inst   = iface.new_socket('Instance Object',  in_out='INPUT',  socket_type='NodeSocketObject')
    sock_count  = iface.new_socket('Count',            in_out='INPUT',  socket_type='NodeSocketInt');   sock_count.default_value  = 20
    iface.new_socket('Use Length Mode', in_out='INPUT',  socket_type='NodeSocketBool')
    sock_space  = iface.new_socket('Spacing (Length)', in_out='INPUT',  socket_type='NodeSocketFloat'); sock_space.default_value  = 5.0
    sock_align  = iface.new_socket('Align to Curve',   in_out='INPUT',  socket_type='NodeSocketBool');  sock_align.default_value  = True
    sock_real   = iface.new_socket('Realize Instances',in_out='INPUT',  socket_type='NodeSocketBool');  sock_real.default_value   = False
    sock_rot    = iface.new_socket('Rotation Offset',  in_out='INPUT',  socket_type='NodeSocketVector'); sock_rot.default_value = (1.5708, 0.0, 1.5708)

    # ── Nodes ─────────────────────────────────────────────────────────────
    n_gi  = nodes.new('NodeGroupInput');         n_gi.location  = (-1395, -47)
    n_go  = nodes.new('NodeGroupOutput');        n_go.location  = ( 1205, -47)
    n_oi  = nodes.new('GeometryNodeObjectInfo'); n_oi.location  = ( -995, -247);  n_oi.inputs['As Instance'].default_value = True
    n_c2p = nodes.new('GeometryNodeCurveToPoints'); n_c2p.location = (-395, -47)
    n_iop = nodes.new('GeometryNodeInstanceOnPoints'); n_iop.location = (196, 1)
    n_ri  = nodes.new('GeometryNodeRealizeInstances'); n_ri.location = (728, 14)
    n_sw  = nodes.new('GeometryNodeSwitch');     n_sw.location  = ( 955, -47);    n_sw.input_type = 'GEOMETRY'
    n_add = nodes.new('ShaderNodeVectorMath');   n_add.location = ( -100, -150);  n_add.operation = 'ADD'

    # ── Links ─────────────────────────────────────────────────────────────
    links.new(n_gi.outputs['Geometry'],          n_c2p.inputs['Curve'])
    links.new(n_gi.outputs['Count'],             n_c2p.inputs['Count'])
    links.new(n_gi.outputs['Instance Object'],   n_oi.inputs['Object'])
    links.new(n_c2p.outputs['Points'],           n_iop.inputs['Points'])
    links.new(n_oi.outputs['Geometry'],          n_iop.inputs['Instance'])
    links.new(n_c2p.outputs['Rotation'],         n_add.inputs[0])
    links.new(n_gi.outputs['Rotation Offset'],   n_add.inputs[1])
    links.new(n_add.outputs['Vector'],           n_iop.inputs['Rotation'])
    links.new(n_iop.outputs['Instances'],        n_ri.inputs['Geometry'])
    links.new(n_gi.outputs['Realize Instances'], n_sw.inputs['Switch'])
    links.new(n_iop.outputs['Instances'],        n_sw.inputs[1])   # False branch
    links.new(n_ri.outputs['Geometry'],          n_sw.inputs[2])   # True branch
    links.new(n_sw.outputs[0],                   n_go.inputs['Geometry'])

    print(f"[GN_ArrayOnCurve02] Created successfully")
    return ng


class GENESYS_OT_create_instanced_along_curve(Operator):
    """Create a Curve tool with GN_ArrayOnCurve02 that instances the selected mesh along it.
    Places the curve at the selected mesh's origin, sets count to 3, then removes the original mesh."""
    bl_idname = "genesys.create_instanced_along_curve"
    bl_label = "Create Instanced Along Curve"
    bl_options = {'REGISTER', 'UNDO'}

    def execute(self, context):
        # Need exactly one mesh selected
        mesh_objs = [o for o in context.selected_objects if o.type == 'MESH']
        if not mesh_objs:
            self.report({'WARNING'}, "Select at least one mesh object first")
            return {'CANCELLED'}

        # Get or create the node group
        node_group = ensure_array_on_curve_node_group()

        created_curves = []

        for mesh_obj in mesh_objs:
            origin = mesh_obj.matrix_world.translation.copy()
            mesh_name = mesh_obj.name

            # ── 1. Add a Bezier curve at the mesh origin ──────────────────
            bpy.ops.object.select_all(action='DESELECT')
            bpy.ops.curve.primitive_bezier_curve_add(
                radius=1,
                enter_editmode=False,
                location=origin
            )
            curve_obj = context.active_object
            curve_obj.name = f"CurveTool_{mesh_name}"

            # ── 2. Shape the curve: flat bezier spread on X ───────────────
            spline = curve_obj.data.splines[0]
            # Left point at -5, right point at +5, all Z=0
            pts = spline.bezier_points
            pts[0].co             = (-5.0, 0.0, 0.0)
            pts[0].handle_left    = (-6.5, 0.0, 0.0)
            pts[0].handle_right   = (-3.5, 0.0, 0.0)
            pts[1].co             = ( 5.0, 0.0, 0.0)
            pts[1].handle_left    = ( 3.5, 0.0, 0.0)
            pts[1].handle_right   = ( 6.5, 0.0, 0.0)

            # ── 3. Add Geometry Nodes modifier using the existing node group ─
            mod = curve_obj.modifiers.new(name="ArrayOnCurve", type='NODES')
            mod.node_group = node_group

            # ── 3. Set modifier inputs ─────────────────────────────────────
            # Socket identifiers confirmed from ng.interface.items_tree:
            # Socket_0 = Geometry (in), Socket_1 = Instance Object, Socket_2 = Count
            # Socket_3 = Use Length Mode, Socket_4 = Spacing, Socket_5 = Align to Curve
            # Socket_7 = Realize Instances, Socket_8 = Rotation Offset
            mod["Socket_1"] = mesh_obj              # Instance Object
            mod["Socket_2"] = 3                     # Count
            mod["Socket_5"] = True                  # Align to Curve
            mod["Socket_7"] = False                 # Realize Instances (exporter handles make_real)
            mod["Socket_8"] = (1.5708, 0.0, 1.5708) # Rotation Offset X=90°, Y=0°, Z=90°

            created_curves.append(curve_obj)
            print(f"[Create Instanced Along Curve] Created '{curve_obj.name}' → instances '{mesh_name}' x3")

        # ── 4. Delete original mesh objects ───────────────────────────────
        bpy.ops.object.select_all(action='DESELECT')
        for mesh_obj in mesh_objs:
            mesh_obj.select_set(True)
        bpy.ops.object.delete()

        # ── 5. Reselect the new curve tools ───────────────────────────────
        for c in created_curves:
            c.select_set(True)
        if created_curves:
            context.view_layer.objects.active = created_curves[-1]

        self.report({'INFO'},
            f"Created {len(created_curves)} curve tool(s) with GN_ArrayOnCurve02 (count=3)")
        return {'FINISHED'}


class GenesysExporterPreferences(bpy.types.AddonPreferences):
    bl_idname = __name__
    
    def draw(self, context):
        layout = self.layout
        
        box = layout.box()
        box.label(text="Dependencies for Split RGB Channels Feature:", icon='PACKAGE')
        
        # Check if libraries are available
        pillow_available = False
        numpy_available = False
        
        try:
            import PIL
            pillow_available = True
        except ImportError:
            pass
        
        try:
            import numpy
            numpy_available = True
        except ImportError:
            pass
        
        col = box.column(align=True)
        
        # Pillow status
        row = col.row()
        if pillow_available:
            row.label(text="✓ Pillow: Installed", icon='CHECKMARK')
        else:
            row.label(text="✗ Pillow: Not Installed", icon='ERROR')
        
        # NumPy status
        row = col.row()
        if numpy_available:
            row.label(text="✓ NumPy: Installed", icon='CHECKMARK')
        else:
            row.label(text="✗ NumPy: Not Installed", icon='ERROR')
        
        box.separator()
        
        # Install button
        if not pillow_available or not numpy_available:
            row = box.row()
            row.scale_y = 1.5
            row.operator("genesys.install_dependencies", icon='IMPORT')
            
            box.separator()
            box.label(text="Note: Restart Blender after installation", icon='INFO')
        else:
            box.label(text="All dependencies are installed!", icon='CHECKMARK')

# ============================================================
# REGISTRATION
# ============================================================

classes = (
    GenesysObjectExportSettings,
    GenesysExporterProperties,
    GenesysMaterialProperties,
    GENESYS_OT_export_models,
    GENESYS_OT_export_layout,
    GENESYS_OT_open_export_folder,
    GENESYS_OT_tooltip_info,
    GENESYS_OT_inherit_paths,
    GENESYS_OT_inherit_texture_path,
    GENESYS_OT_inherit_material_path,
    GENESYS_OT_create_folder_structure,
    GENESYS_OT_run_utilities,
    GENESYS_OT_create_instanced_along_curve,
    GENESYS_OT_install_dependencies,
    GenesysExporterPreferences,
    GENESYS_PT_exporter_panel,
    GENESYS_PT_material_panel,
)

def register():
    for cls in classes:
        bpy.utils.register_class(cls)
    bpy.types.Scene.genesys_exporter = bpy.props.PointerProperty(type=GenesysExporterProperties)
    bpy.types.Object.genesys_export_settings = bpy.props.PointerProperty(type=GenesysObjectExportSettings)
    bpy.types.Material.genesys_material = bpy.props.PointerProperty(type=GenesysMaterialProperties)
    
    # Register GLTF export hook for custom extensions
    try:
        import io_scene_gltf2
        io_scene_gltf2.io.com.gltf2_io_extensions.Extension
        # Hook is available, register our extension
        if not hasattr(bpy.app, 'genesys_gltf_extension'):
            bpy.app.genesys_gltf_extension = glTF2ExportUserExtension()
    except (ImportError, AttributeError):
        print("Warning: GLTF exporter not available, material extensions will not be embedded")

def unregister():
    # Unregister GLTF export hook
    if hasattr(bpy.app, 'genesys_gltf_extension'):
        del bpy.app.genesys_gltf_extension
    
    for cls in reversed(classes):
        bpy.utils.unregister_class(cls)
    del bpy.types.Scene.genesys_exporter
    del bpy.types.Object.genesys_export_settings
    del bpy.types.Material.genesys_material

if __name__ == "__main__":
    register()
