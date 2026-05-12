import bpy
import json
import os

output_path = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\tools\blender-object-mapping.json"

mapping = {}

print("[Blender Mapping] Scanning scene...", flush=True)

for obj in bpy.data.objects:
    if obj.type == 'MESH':
        mesh_name = obj.data.name
        mapping[obj.name] = mesh_name
        print(f"  {obj.name} -> {mesh_name}", flush=True)

# Save to JSON
with open(output_path, 'w') as f:
    json.dump(mapping, f, indent=2)

print(f"\n[Blender Mapping] Saved {len(mapping)} entries to {output_path}", flush=True)
