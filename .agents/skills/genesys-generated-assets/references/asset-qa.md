# Asset QA

Run these checks on every generated (or downloaded) file before wiring it. Record the results in the report.

## Size budgets per role

The budgets live in one table: `genesys-assets` → *Weight budgets* (hero/enemy ≤ 1.5 MB, prop ≤ 300 KB, title ≤ 600 KB, icon ≤ 60 KB, …). The Blender normalise folder enforces its `role` row on every build. The engine's own demo characters (`@engine/assets/models/demo/Characters/Knightdude.glb`, `Spacedude.glb`) are about 1.5 MB each; generated GLBs of 4–5 MB per enemy and a 3.9 MB title PNG were observed in a real build.

Settings that land inside the budgets:

| Kind | Typical settings |
|---|---|
| Hero / player mesh | Schema face count in the lower-middle of its range; 1024 textures (`shrink_textures(1024)`) |
| Enemy mesh | Lowest face count that keeps the silhouette; 3+ enemy types on screen → aim at two thirds of the creature budget |
| Prop | Low face count; 512–1024 textures |
| Title art / menu backdrop | ≤ 1920 × 1080; JPG or WebP when there is no transparency |
| Icon / sprite | 256–512 px PNG |
| Tileable texture | 1024² (2048² max), power of two |
| Skybox | 2K equirect ≈ 5 MB HDR (the engine's 2K sky); 4K HDR is ~23 MB — prefer 2K |
| SFX / music loop | Short, trimmed silence; music after compression within the `music` row |

Check sizes with `ls -l assets/models assets/ui assets/textures assets/audio`.

When a file is over budget:
1. Normalise it down in its Blender folder first: `decimate(obj, tris)`, `shrink_textures(px)` (free). Regenerate with a lower face-count or texture-size field only if that cannot reach the budget (a new paid run: price it and ask).
2. Enable `genesys-asset-compiler` (Meshopt for GLB geometry, KTX2 for textures, MP3 for audio). It shrinks `.dist`, not the source file, and it is off by default.
3. Report the size and the choice. Do not ship silently.

Images used by HTML/CSS UI (title art, icons in widgets) must stay PNG/JPG at runtime. Add them to the asset compiler's texture `exclude` list (its scanner finds them).

## Measure a GLB's bounds

In Play, from the loaded model:

Source: `.engine/src/nodes/visual/ModelMeshNode.ts` (`onMeshLoaded`, `calcBoundingBoxFromGLTFModel`)
```ts
const TARGET = 1.8; // metres: character height, or longest extent for a prop
mesh.onMeshLoaded.add((node, model) => {
  node.scale.setScalar(1);
  node.updateMatrixWorld(true);
  const size = ENGINE.ModelMeshNode.calcBoundingBoxFromGLTFModel(model)
    .getSize(new THREE.Vector3());
  const extent = Math.max(size.x, size.y, size.z, 0.001); // use size.y for characters
  node.scale.setScalar(TARGET / extent);
});
```

This is a runtime fallback for meshes whose size varies. For a single known file, measure once and bake the scale into the mesh child's `scale` option or the placed node's scale (MCP), so nothing rescales every spawn.

Offline, without the editor: glTF requires `min` / `max` on every `POSITION` accessor. Reading them gives the raw mesh extents (node transforms inside the file are not applied).

Source: glTF 2.0 specification, accessor `min` / `max` (required for `POSITION`)
```python
# python3 -I measure_glb.py assets/models/SM_Hero.glb
import json, struct, sys
data = open(sys.argv[1], 'rb').read()
length = struct.unpack_from('<I', data, 12)[0]
gltf = json.loads(data[20:20 + length])
lo = [min(a['min'][i] for m in gltf['meshes'] for p in m['primitives']
          for a in [gltf['accessors'][p['attributes']['POSITION']]]) for i in range(3)]
hi = [max(a['max'][i] for m in gltf['meshes'] for p in m['primitives']
          for a in [gltf['accessors'][p['attributes']['POSITION']]]) for i in range(3)]
print('size xyz:', [round(h - l, 3) for l, h in zip(lo, hi)], 'min:', lo, 'max:', hi)
```

Keep the script in the scratchpad, not in the project. Integer-sized results in the tens of thousands (seen on the engine's demo characters) mean quantized positions scaled by node transforms; use the in-Play measure for those files.

## Orientation

- Engine controllers move the pawn along its local −Z (`new THREE.Vector3(0, 0, -1).applyQuaternion(pawn.getWorldQuaternion())` in `.engine/src/gameplay-sim/entities/GSSPlayerController.ts`).
- glTF content usually faces +Z, so the engine rotates its own character mesh by π around Y (`GSSCharacterPawn.setupVisualNode`).
- Generated models can face +Z, −Z, +X, or −X. A centred front-view concept usually gives +Z.

Check: in Play, move or fire forward and look at the hero from the game camera (a capture under `genesys-verification`). The nose, face, or barrel must point the way the pawn moves or shoots. For a top-down or side game, compare against the game's own forward (the direction the move input or fire direction uses).

Fix: set the mesh child's yaw to one of `0`, `Math.PI / 2`, `Math.PI`, `-Math.PI / 2`. Rotate the visual child only. Rotating the pawn root changes movement and the camera. Model tilted (lying on its back or side) → an X or Z offset of ±π/2 on the same child.

## Pivot

- Character: the mesh child's feet at the pawn's bottom. `GSSCharacterPawn` puts the mesh at `y = -CHARACTER_HEIGHT / 2` (1.8 m height, `ENGINE.CHARACTER_HEIGHT`).
- Props: base on the floor. When the model's origin is at its centre, offset the node up by half its height.
- Hover or flying pawns: centre the mesh on the pawn's collision.

## Visual-child settings

- `physicsOptions: { enabled: false }` on the visual child; collision stays on the pawn's own body.
- `castShadow: true` for heroes, enemies, and large props.
- One `ModelMeshNode` per visual. Swapping a blockout for the model replaces the child; it does not stack both.

## Textures and images

- Tileable: open the image twice side by side (or tile it 2×2 in an image viewer) and look for seams before assigning.
- Transparency: confirm the PNG has an alpha channel (`file assets/ui/icon.png` reports RGBA).
- Title art: check it reads at 1280 × 720 behind the title widgets; keep the subject away from where the Start button sits.
