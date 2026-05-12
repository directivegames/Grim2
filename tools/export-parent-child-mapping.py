import bpy
import json
import os

output_path = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\tools\blender-parent-child-mapping.json"

mapping = {}
mesh_only_objects = []

print("[Blender Export] Scanning scene for parent->mesh relationships...", flush=True)

for obj in bpy.data.objects:
    # Find objects that are parents (have children) and contain mesh data
    if obj.children:
        for child in obj.children:
            if child.type == 'MESH':
                mesh_name = child.data.name
                parent_name = obj.name
                
                # Store the mapping: parent name -> mesh data name
                mapping[parent_name] = mesh_name
                print(f"  {parent_name} -> {mesh_name}", flush=True)
    
    # Also find mesh objects that have no parent (top level meshes)
    if obj.type == 'MESH' and not obj.parent:
        mesh_only_objects.append(obj.name)
        print(f"  [TOP LEVEL] {obj.name} -> {obj.data.name}", flush=True)

# Save to JSON
output_data = {
    "parent_to_mesh": mapping,
    "top_level_meshes": mesh_only_objects,
    "total_mappings": len(mapping),
    "total_top_level": len(mesh_only_objects)
}

with open(output_path, 'w') as f:
    json.dump(output_data, f, indent=2)

print(f"\n[Blender Export] Saved {len(mapping)} parent->mesh mappings", flush=True)
print(f"[Blender Export] Found {len(mesh_only_objects)} top-level meshes", flush=True)
print(f"[Blender Export] Output: {output_path}", flush=True)
