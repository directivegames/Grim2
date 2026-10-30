# Code-model recipes

Open this when you build a model kind for the first time. Every recipe uses `part()`, `merge()`, `inkHull()` and the look roles from [kit](kit.md) in `tools/models/`. Sizes are metres, front toward −Z, base at y = 0.

## Shape helpers

Source: Composed — typechecked against @gnsx/genesys.js 18.1.0-alpha.317 (three 0.186)
```ts
import * as THREE from 'three';

/** Revolved profile: [radius, height] pairs from bottom to top. Barrels, trunks, bottles, mushrooms, vases. */
export function lathe(profile: Array<[number, number]>, segments = 12): THREE.LatheGeometry {
  return new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(r, y)), segments);
}

/** Flat outline pushed into depth, centred on z. Blades, wings, signs, car bodies seen from the side, leaves. */
export function extrude(outline: Array<[number, number]>, depth: number, bevel = 0.01): THREE.ExtrudeGeometry {
  const s = new THREE.Shape();
  outline.forEach(([x, y], i) => (i === 0 ? s.moveTo(x, y) : s.lineTo(x, y)));
  const g = new THREE.ExtrudeGeometry(s, {
    depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 1,
  });
  g.translate(0, 0, -depth / 2);
  return g;
}

/** Hand-made wobble. The offset is a function of the vertex position, so shared corners move together (no cracks). */
export function jitter<T extends THREE.BufferGeometry>(g: T, amount: number, seed = 1): T {
  const p = g.getAttribute('position');
  const h = (x: number, y: number, z: number, k: number) => {
    const s = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719 + seed * 4.1 + k * 17.3) * 43758.5453;
    return (s - Math.floor(s)) * 2 - 1;
  };
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i, x + h(x, y, z, 0) * amount, y + h(x, y, z, 1) * amount, z + h(x, y, z, 2) * amount);
  }
  g.computeVertexNormals();
  return g;
}

// Examples
export const BARREL = lathe([[0, 0], [0.3, 0], [0.36, 0.25], [0.38, 0.45], [0.36, 0.65], [0.3, 0.9], [0, 0.9]], 14);
export const BLADE = extrude([[0, 0], [0.05, 0.08], [0.04, 0.85], [0, 0.95], [-0.04, 0.85], [-0.05, 0.08]], 0.02, 0.004);
export const CANOPY = jitter(new THREE.IcosahedronGeometry(0.9, 1), 0.08, 3);
```

- Jitter 1–2 % of the part size. More reads as broken, not hand-made.
- Close a lathe profile at radius 0 at both ends, or the top and bottom stay open.
- An extrude outline is drawn in the XY plane. Rotate the part to lay it flat or turn it sideways.

## Part lists by role

Each row is a starting point. Change proportions to fit the brief. Values: **base**, *shade* (darker), accent (light or saturated).

| Model | Parts (pivot groups in brackets) | Identity feature | Height |
|---|---|---|---|
| Chibi humanoid hero | **torso** capsule; *hips* squashed sphere; [head] sphere 35–45 % of height, hair from 3–6 squashed spheres or cones, eyes (white, pupil, glint), brows as thin boxes; [armL] [armR] capsules with sphere hands; [legL] [legR] capsules with squashed-sphere boots; belt torus; one role accessory | The accessory (hat, hood, sword, satchel) | 1.6–1.8 m |
| Quadruped (fox, dog, boar) | **body** capsule on its side; [head] sphere plus cone snout and sphere nose; ears as cones; [legFL] [legFR] [legBL] [legBR] capsules; [tail] cone chain or lathe; *belly* squashed sphere | Ears and tail shape | 0.5–1.0 m |
| Bird or flyer | **body** squashed sphere; [head] sphere with cone beak; [wingL] [wingR] extruded outlines; tail fan of 3 cones | Wing outline | 0.3–0.8 m |
| Slime or blob | **body** lathe dome with a flat base; *base ring* torus; eyes and glint; mouth as a dark squashed sphere | Squashed base and big eyes | 0.5–1.2 m |
| Tree | **trunk** lathe, wide root flare, 8–10 segments; 3–5 jittered icosahedrons in 2 greens; 1 accent (fruit, blossom) | Canopy outline | 2.5–5 m |
| Rock | 2–3 jittered icosahedrons (detail 0–1), *shade* on the lower one, moss cap in green | Flat base, angular top | 0.4–2 m |
| Crystal cluster | 3–5 octahedrons scaled tall (y × 2–3), tilted ±0.5 rad; base rock; core in `GLOW` | Spikes and glow | 0.5–1.5 m |
| Chest | **body** box with bevelled look from 4 thin trim boxes; [lid] half-cylinder with the hinge at its back edge; lock as torus plus box | Lid and lock | 0.6–0.9 m |
| Barrel | **body** `BARREL` lathe; 3 torus hoops in *shade*; lid disc | Hoops | 0.9 m |
| Coin or gem pickup | Coin: cylinder plus torus rim plus an extruded star. Gem: octahedron, 8-segment cone pair | Silhouette at 10 m, a glint | 0.3–0.5 m |
| Potion | Body lathe bottle; cork cylinder; liquid lathe in accent; glint sphere | Cork and bottle neck | 0.3–0.4 m |
| Sword or axe | `BLADE` extrude; guard box or torus; grip cylinder; pommel sphere | Blade outline | 0.9–1.2 m |
| Car or kart | **body** extruded side profile; cabin extrude or squashed box; [wheelFL] [wheelFR] [wheelBL] [wheelBR] cylinders plus torus tyres; lights in `GLOW` | Side profile | 1.5–4 m |
| Turret | Base lathe; [yaw] head box with bevel trims; [pitch] barrel cylinders; eye in `GLOW` | Barrel and eye | 1–2 m |

## Many copies

If one model repeats dozens to hundreds of times, export it once and draw it with one `InstancedModelMeshNode`: one draw call per mesh in the GLB for all copies. The node loads the GLB like a `ModelMeshNode`, so the material link applies (verify the look on first use). It also takes pre-built lower-detail GLBs in `lods`. Build the copies at runtime for spawned or rule-placed dressing. Scatter placement rules, layouts and placing instanced dressing with MCP: `genesys-level-authoring`.

Source: .engine/src/nodes/visual/InstancedModelMeshNode.ts, .engine/src/nodes/visual/BaseInstancedMeshNode.ts (`InstanceTransform`) — typechecked against 19.0.0-alpha.351
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Dozens to hundreds of one exported model: one InstancedModelMeshNode, one draw call per mesh in the GLB. */
export function scatterCrystals(world: ENGINE.World, spots: THREE.Vector3[]): ENGINE.InstancedModelMeshNode {
  const node = ENGINE.InstancedModelMeshNode.create({
    modelUrl: '@project/assets/models/crystal.glb',
    instances: spots.map((p, i) => ({
      position: p,
      rotation: new THREE.Euler(0, i * 2.4, 0),
      scale: new THREE.Vector3().setScalar(0.8 + (i % 5) * 0.1),
    })),
    physicsOptions: { enabled: false }, // dressing: no colliders
  });
  world.add(node);
  return node;
}
```

`PrimitiveNode` physics defaults to enabled and static, so dressing sets `physicsOptions: { enabled: false }`. Keep each mass-copied model to 1–2 meshes, because each mesh is one draw call. Swaying trees or grass in an instanced field: `VertexWaveNodeMaterialAsset` (`webgpu-tsl-node-material-assets`), not a tick per copy.

## More motion

Each line runs in `tickPrePhysics` of the model's `GlbModel` class; `t` is `world.getGameTime()`, `dt` the frame time. Find each pivot with `part(name)` in `onRigReady`. Animate pivots and the rig, never the gameplay root.

| Motion | Pivot | Formula |
|---|---|---|
| Pickup hover and spin | rig | `rotation.y += 1.5 * dt`; `position.y = 0.1 * Math.sin(t * 2)` |
| Wing flap | `wingL` / `wingR` | `rotation.z = ±0.6 * Math.sin(t * rate)`; rate 14 while flying, 4 while gliding |
| Tail sway | `tail` | `rotation.y = 0.3 * Math.sin(t * 3)`; double the rate while running |
| Quadruped gait | legs | Diagonal pairs share a phase: FL with BR, FR with BL; swing 0.5 rad |
| Arm swing | `armL` / `armR` | Opposite to the leg on the same side, 0.6 × the leg swing |
| Wheel spin | wheels | `rotation.x -= speed / radius * dt` |
| Turret aim | `yaw`, `pitch` | The look-at yaw from the skill on `yaw`; pitch the same way on `pitch`, clamped ±0.6 rad |
| Lid open | `lid` | Hinge at the back edge; tween `rotation.x` 0 → 1.9 rad (front edge lifts) over 0.35 s (`genesys-interactions` owns the trigger) |
| Land squash | rig | On landing: scale y 0.8, x and z 1.12, back to 1 over 0.15 s |
| Attack wind-up | rig | Stretch scale z +8 % over the telegraph time (`genesys-creatures`) |
