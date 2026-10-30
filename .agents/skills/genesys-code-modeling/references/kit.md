# Code-model kit

The files every code-model game copies from `templates/`. Change the colours to the `GAME.md` palette and the ramp to the art direction.

| Template | Copy to | Holds |
|---|---|---|
| `tools/models/parts.ts` | same path | `part()`, `merge()`, `tris()` |
| `tools/models/looks.ts` | same path | look roles `TOON`, `FLAT`, `SOFT`, `GLOW`, `INK`; `inkHull()`, `pivot()`, `mesh()` |
| `tools/models/index.ts` | same path | `MODELS` (one GLB each), `TOON_BANDS` |
| `tools/models/sprout.ts` | `tools/models/<model>.ts` | the worked example: shapes, ink hulls, named pivots, `buildSprout()` |
| `src/models/glb-model.ts` | same path | `GlbModel` (loads the GLB, physics off, `part()`, `flash()`, `setLook()`) and `toonTint()` |
| `src/models/sprout-model.ts` | `src/models/<model>-model.ts` | the runtime class: stride, breath, look-at, flash, death tumble |

`tools/` never ships: nothing in `src/` imports it, and the export reads it with `tsx`. Builders import only `three`, never `@gnsx/genesys.js`.

## tools/models/parts.ts — parts, merge, triangle count

`part()` copies a template geometry, drops its UVs, paints it with one vertex colour and applies the placement. Every part has the same attribute layout (non-indexed position, normal, color), so `merge()` always succeeds. `three/addons/utils/BufferGeometryUtils.js` is the import path the engine itself uses (`.engine/src/navigation/RecastNavigationServer.ts`).

Source: Composed — typechecked against @gnsx/genesys.js 19.0.0-alpha.351 (the template `tools/models/parts.ts`; three 0.186; `mergeGeometries` as the engine imports `three/addons/utils/BufferGeometryUtils.js`)
```ts
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _c = new THREE.Color();
type V3 = [number, number, number];

/** One shaped part: a copy of a template geometry, placed, and painted with a palette colour. */
export function part(geo: THREE.BufferGeometry, hex: number, at: V3, scale: V3 = [1, 1, 1], rot: V3 = [0, 0, 0]): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo.clone(); // one layout for every part, so they merge
  g.deleteAttribute('uv');
  _c.setHex(hex); // sRGB hex in, linear vertex colour out
  const n = g.getAttribute('position').count;
  const rgb = new Float32Array(n * 3);
  for (let i = 0; i < n * 3; i += 3) { rgb[i] = _c.r; rgb[i + 1] = _c.g; rgb[i + 2] = _c.b; }
  g.setAttribute('color', new THREE.BufferAttribute(rgb, 3));
  _q.setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2]));
  g.applyMatrix4(_m.compose(new THREE.Vector3(...at), _q, new THREE.Vector3(...scale)));
  return g;
}

/** Many parts → one geometry → one draw call per material. */
export function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error('merge: parts have different attributes');
  for (const p of parts) p.dispose();
  merged.computeBoundingSphere();
  return merged;
}

/** Triangle count, for the role budget. */
export function tris(g: THREE.BufferGeometry): number {
  return (g.index ? g.index.count : g.getAttribute('position').count) / 3;
}
```

- `_c.setHex()` converts the sRGB palette hex to the linear value a vertex colour needs (three colour management).
- `part()` allocates; call it only at module load, never per frame or per spawn.
- Log `tris()` of each merged shape and its hull once while building, and compare with the role budget.

## tools/models/looks.ts — look roles and the ink hull

The materials here never render: they only mark each mesh's look for the export. The material name picks the engine material. `INK` marks an ink hull, which takes the model's main look, so a `SOFT` game with ink never pulls in `M_Toon`.

Source: Composed — typechecked against @gnsx/genesys.js 19.0.0-alpha.351 (the template `tools/models/looks.ts`)
```ts
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

/**
 * Look roles for the GLB export (genesys-code-modeling → scripts/export-glb.ts). The material name
 * picks the engine material the GLB links to: 'toon' → M_Toon, 'flat' → M_Flat, 'soft' → M_Soft,
 * 'glow' → M_Glow. Colours come from the parts' vertex colours (part()), or from `color` when a
 * material has no vertex colours. A BackSide material marks an ink hull: the exporter flips its
 * winding, so the front-side look material draws it as the outline in the hull's colour.
 * These materials never render: the game shows the exported GLBs.
 */
export const TOON = new THREE.MeshBasicMaterial({ name: 'toon', vertexColors: true });
export const FLAT = new THREE.MeshBasicMaterial({ name: 'flat', vertexColors: true });
export const SOFT = new THREE.MeshBasicMaterial({ name: 'soft', vertexColors: true });
export const GLOW = new THREE.MeshBasicMaterial({ name: 'glow', vertexColors: true });
export const INK = new THREE.MeshBasicMaterial({ name: 'toon', color: 0x1b1622, side: THREE.BackSide });

/** Inverted hull: the shape pushed out along welded (smoothed) normals. */
export function inkHull(src: THREE.BufferGeometry, width: number): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position').clone());
  const hull = mergeVertices(g, 1e-4); // shared corners get one normal, so the hull has no cracks
  hull.computeVertexNormals();
  const p = hull.getAttribute('position');
  const n = hull.getAttribute('normal');
  for (let i = 0; i < p.count; i++) {
    p.setXYZ(i, p.getX(i) + n.getX(i) * width, p.getY(i) + n.getY(i) * width, p.getZ(i) + n.getZ(i) * width);
  }
  return hull;
}

/** A named empty at a joint: the runtime finds pivots by these names, so keep them unique per model. */
export function pivot(name: string, children: THREE.Object3D[] = [], at?: THREE.Vector3): THREE.Group {
  const g = new THREE.Group();
  g.name = name;
  if (at) g.position.copy(at);
  if (children.length) g.add(...children);
  return g;
}

/** A named mesh with its look. */
export function mesh(name: string, geo: THREE.BufferGeometry, look: THREE.Material = TOON): THREE.Mesh {
  const m = new THREE.Mesh(geo, look);
  m.name = name;
  return m;
}
```

- The hull is fixed width in metres. Use about 1 % of the model height: 0.012 m on a 1.3 m creature, 0.004 m on a 0.4 m pickup. Check it in pixels at gameplay distance: a 0.012 m line seen from 19 m with a 55° FOV is under 1 px.
- Eyes and small parts that stand proud of a surface get their own ink ring. That reads as cartoon line work; verify in Play that thin parts (antennae, blades) do not turn solid black at gameplay distance.
- The export flips each hull's winding and normals, so the model's front-side look material draws it, in the hull's colour (`INK` is near-black).

## Worked example: the sprout

`templates/tools/models/sprout.ts` builds a small creature once at module load: front toward −Z, feet at y = 0, 1.34 m tall, about 11 parts, five palette values (leaf base, shade, cream accent, ink eyes, shine glints). `buildSprout()` returns `rig` with the body and its hull, and the pivots `head`, `leg_l`, `leg_r` at their joints. A hero at the bar adds arms, hands, boots, hair or a hat, brows, a mouth and one role accessory.

The builder's shape (`INK_W`, `BODY`, `HEAD` and `LEG` are module-level constants in the template):

Source: Composed — typechecked against 19.0.0-alpha.351 (the template `tools/models/sprout.ts`)
```ts
const inked = (name: string, g: THREE.BufferGeometry): THREE.Mesh[] => [mesh(name, g), mesh(`${name}_ink`, inkHull(g, INK_W), INK)];

export function buildSprout(): THREE.Group {
  return pivot('rig', [
    ...inked('sprout_body', BODY),
    pivot('head', inked('sprout_head', HEAD), new THREE.Vector3(0, 0.66, 0)),
    pivot('leg_l', inked('sprout_leg_l', LEG), new THREE.Vector3(-0.12, 0.2, 0)),
    pivot('leg_r', inked('sprout_leg_r', LEG), new THREE.Vector3(0.12, 0.2, 0)),
  ]);
}
```

## Looks in detail

The export turns colours into a palette and looks into engine material assets.

- **Palette.** `T_Palette.png` holds one 8 px swatch per colour, in a grid of at least 16×16. The bottom half mirrors the top, so a loader that flips V still finds the same colour. Every vertex's UV points at its swatch centre. All triangles of a swatch have the same UV, so the texture is always sampled at full resolution, and mipmaps never blend neighbours. A triangle whose corners have different colours takes the corner colour closest to their average.
- **Stable swatches.** `tools/models/palette.json` records the swatch of every colour. Each export keeps those places and gives a new colour the first free swatch, so GLBs that are no longer exported (hand-edited ones) keep their colours. A colour no model uses keeps its swatch until `--repack`. If the palette outgrows its grid (16×16 holds 128 colours), every swatch moves: the export warns and exports every `MODELS` entry again, `--only` or not. A hand-edited GLB outside `MODELS` then keeps the old swatches and shows wrong colours.
- **Recolouring.** Repaint a swatch in `T_Palette.png` to recolour every part that uses it, in every model. The next export rewrites the file from the code palette, so change the code colour too.
- **Toon.** `M_Toon` is `ENGINE.MeshToonNodeMaterialAsset` with `mapPath` the palette and `gradientMapPath` the 256 px `T_ToonRamp.png`. The ramp values are light multipliers, dark → lit: 90, 170, 255 (0.35, 0.67, 1.0). `ToonLightingModel` (`node_modules/three/src/nodes/functions/ToonLightingModel.js`) samples the ramp's red channel at `dot(normal, light) · 0.5 + 0.5`; without a ramp it uses two soft bands (0.7 and 1.0). The engine samples the ramp nearest with no mipmaps, so each texel is one hard band at any ramp width. The engine also ships ramps: `@engine/assets/textures/T_Toon_Cel_2Step.png`, `T_Toon_Anime_4Step.png`, `T_Toon_Anime_5Step.png` (`webgpu-tsl-node-material-assets`). The bands and the ink width need a look in Play.
- **Flat and soft.** `M_Flat` is `MeshStandardNodeMaterialAsset` with `flatShading` and roughness 0.85; the export also gives `FLAT` meshes one normal per face. `M_Soft` has roughness 0.6.
- **Glow.** `M_Glow` is `MeshStandardNodeMaterialAsset` with a near-black base, white `emissive`, the palette as `emissiveMapPath` and `emissiveIntensity` 2.5, so each glow part glows in its own swatch colour. Tune it in the editor within 2–4. Keep the bloom threshold at 0.9–1.0 (`genesys-lighting`).
- **Runtime tints.** Classic three.js materials render on the engine's `WebGPURenderer`, because its node library converts them (`MeshToonMaterial` → `MeshToonNodeMaterial`, `three/src/renderers/webgpu/nodes/StandardNodeLibrary.js`). `toonTint()` builds a classic `MeshToonMaterial` from the loaded material's `map` and `gradientMap`. Build each tint once, shared by every instance.
- **Ink cost.** The hull doubles the triangles and adds one draw call per pivot mesh. If a crowd costs frame time, drop the hull on the crowd first. About 20 live copies is a starting guide; measure it (`genesys-profiler`).
- **Warm-up.** The flash and every look compile a shader the first time they draw. Draw each model once on the title, flash included (`genesys-profiler`).
- **Build compression (not yet verified).** With the asset compiler on, PNGs become KTX2 and GLBs get Meshopt. Each 8 px swatch covers whole 4×4 blocks, so swatches should stay clean. Verify in Play that the material links and colours survive before you rely on it (`genesys-asset-compiler`).
