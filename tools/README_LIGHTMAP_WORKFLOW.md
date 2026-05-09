# Genesys Lightmap Baking Workflow

This folder contains tools to export your Genesys scene to Blender, bake lighting/shadows, and import back with baked lightmaps.

## The Problem

Real-time shadows tank performance. We want to:
1. Export the whole scene to Blender
2. Bake shadows/lighting into textures
3. Re-import with pre-baked shadows (no runtime shadow calculations)

## Files

- `import_genesys_scene.py` - Imports your .genesys-scene into Blender with all meshes at correct positions
- `blender_bake_lightmaps.py` - Sets up UV2 and baking workflow in Blender

## Step-by-Step Workflow

### Phase 1: Import Scene to Blender

1. **Open Blender** (use Blender 3.6 or newer)

2. **Go to the Scripting tab** (top of Blender window)

3. **Create a new text block:**
   - Click "New" button in the text editor
   - Name it `import_scene`

4. **Open the import script:**
   - Click "Open" and navigate to `tools/import_genesys_scene.py`
   - OR copy-paste the contents

5. **Configure the paths** at the top of the script:
   ```python
   SCENE_FILE_PATH = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\assets\default.genesys-scene"
   PROJECT_ROOT = r"C:\Users\r2fir\Desktop\test game\Grim\Grim"
   ```
   Update these to your actual paths (keep the `r"..."` raw string format).

6. **Run the script:**
   - Click the "Run Script" button (play icon)
   - OR press Alt+P

7. **Result:** All your GLB models appear in Blender at their correct world positions in a collection called "Genesys_Imported"

### Phase 2: Setup for Baking

1. **Open the bake script:**
   - In the same text editor, click "Open"
   - Load `tools/blender_bake_lightmaps.py`

2. **Configure bake output folder**:
   ```python
   BAKE_OUTPUT_FOLDER = r"C:\Users\r2fir\Desktop\test game\Grim\Grim\assets\textures\baked"
   BAKE_RESOLUTION = 2048  # or 4096 for higher quality
   ```

3. **Run the main() function**:
   - This adds UV2 to all meshes for lightmapping
   - Sets up Cycles render engine

4. **Setup your lighting in Blender:**
   - Add a **Sun Light** (Shift+A → Light → Sun)
   - Position it to match your game's sun direction
   - Adjust strength (try 5-10)
   - Add ambient lighting via **World** → Surface → Strength (try 0.3)

5. **Select all objects** you want to bake (press A in the viewport)

6. **Run the bake function** in the Blender Python console:
   ```python
   bake_selected_objects()
   ```
   Or add this to the end of the script and re-run.

7. **Wait** - Baking takes time depending on resolution and mesh count.

### Phase 3: Apply in Genesys

For each baked mesh:

1. The baked texture is saved to `assets/textures/baked/[MeshName]_lightmap.png`

2. Update the corresponding `.material.json` to add the lightmap:
   ```json
   {
     "$root": {
       "$bc": "THREE.MeshStandardMaterial",
       "map": { ... },
       "lightMap": {
         "$bc": "ENGINE.UrlTexture",
         "$uuid": "your-uuid-here",
         "url": "@project/assets/textures/baked/[MeshName]_lightmap.png"
       },
       "lightMapIntensity": 1.0
     }
   }
   ```

3. **Re-export the GLB from Blender with UV2** if needed:
   - Select object
   - File → Export → glTF 2.0
   - Enable "UVs" and "Include all UV maps"
   - Export to overwrite the original in `assets/models/`

## Alternative: Single Atlas Lightmap

For better performance, you can bake everything to ONE large texture instead of individual textures:

1. **In Blender, join all static meshes** (Ctrl+J) OR use "Smart UV Project" with shared UV space
2. **Unwrap everything together** so they all fit in 0-1 UV space
3. **Bake once** to a single large texture (e.g., 4096x4096)
4. **Re-separate meshes** if needed (P → Separate by Loose Parts)
5. **All meshes share the same lightMap texture** in Genesys

This is more efficient but requires more careful UV planning.

## Tips

- **Start small:** Test with just one building first
- **UV2 margins:** The script uses 0.02 island margin to prevent light bleeding
- **Shadow-only bake:** If you want just shadows (keeping your diffuse textures), set up emission nodes differently
- **Batch export:** The `export_with_uv2()` function can export all meshes at once
- **Use WebP:** Convert PNGs to WebP for smaller file sizes in production

## Troubleshooting

**"File not found" errors:**
- Check the SCENE_FILE_PATH and PROJECT_ROOT paths are correct
- Use raw strings: `r"C:\path\to\file"`

**Meshes not appearing at correct positions:**
- The script applies transforms after import. Check the console output for position values.

**UV2 not working:**
- Make sure to export with "Include all UV maps" enabled in the GLB export settings
- Verify UV2 exists: Select mesh → Object Data Properties → UV Maps (should show 2 entries)

**Black baked textures:**
- Check your lighting setup. Add a Sun lamp and increase its strength.
- Ensure "Use Nodes" is enabled on materials before baking.
