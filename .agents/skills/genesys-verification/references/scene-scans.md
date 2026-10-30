# Scene scans: z-fight and texture stretch

These are two optional scans that list *candidates* for a look problem. They do not fail a build. Each name they print still needs a capture before you call it a defect. Use them after Poly Builder work, stacked primitives, or scaled engine materials.

Both run **inside Play, as smoke steps**, not as `run_script`. In `run_script`, `genesys` exposes only the MCP tool proxies, not the three.js scene. In Play, the smoke node holds `world`, which is the scene root (`World` extends the engine's scene class, so `traverseVisible` works). Unverified in Play: the logic typechecks, but it has not been run against a live scene.

## Z-fight

Two meshes z-fight when faces that point the same way lie in one plane and overlap. Examples are two floor pieces at the same height, or a decal plane on a floor. The scan compares world bounding boxes. It reports pairs whose top faces (or bottom faces) on one axis sit within 2 mm of each other, where the overlap on the other two axes is at least 0.01 m². A crate resting on a floor is not reported, because the crate's bottom face meets the floor's top face.

It is accurate for axis-aligned meshes. A rotated mesh has a loose box, so its results can be wrong in either direction. Instanced and skinned meshes are skipped.

## Stretch

The scan reports a textured mesh whose world scale differs by more than 3× between its two largest axes, because a texture with an even repeat stretches along the long axis. Fix it with UV repeat or a tiling material (`webgpu-tsl-node-material-assets`), or by building the shape at its real size instead of scaling it.

Composed — typechecked against 18.1.0-alpha.317
```ts
type Axis = 'x' | 'y' | 'z';
const AXES: Axis[] = ['x', 'y', 'z'];

export function zFightScan(world: ENGINE.World, eps = 0.002, minArea = 0.01, maxMeshes = 400): string[] {
  const boxes: { name: string; b: THREE.Box3 }[] = [];
  world.traverseVisible(o => {
    if (boxes.length >= maxMeshes || !(o instanceof THREE.Mesh)) return;
    if (o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh) return;
    const b = new THREE.Box3().setFromObject(o);
    if (!b.isEmpty()) boxes.push({ name: o.name || o.parent?.name || o.uuid.slice(0, 8), b });
  });
  const out: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i].b, c = boxes[j].b;
    for (const axis of AXES) {
      const [u, v] = AXES.filter(k => k !== axis);
      const ou = Math.min(a.max[u], c.max[u]) - Math.max(a.min[u], c.min[u]);
      const ov = Math.min(a.max[v], c.max[v]) - Math.max(a.min[v], c.min[v]);
      if (ou <= 0 || ov <= 0 || ou * ov < minArea) continue;
      const top = Math.abs(a.max[axis] - c.max[axis]) < eps, bottom = Math.abs(a.min[axis] - c.min[axis]) < eps;
      if (top || bottom) { out.push(`${boxes[i].name} × ${boxes[j].name} share a ${axis} face (${(ou * ov).toFixed(2)} m²)`); break; }
    }
  }
  return out;
}

export function stretchScan(world: ENGINE.World, ratio = 3): string[] {
  const out: string[] = [];
  const s = new THREE.Vector3();
  world.traverseVisible(o => {
    if (!(o instanceof THREE.Mesh)) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]) as THREE.Material[];
    if (!mats.some(m => 'map' in m && m.map instanceof THREE.Texture)) return;
    o.getWorldScale(s);
    const [big, mid] = [Math.abs(s.x), Math.abs(s.y), Math.abs(s.z)].sort((p, q) => q - p);
    if (mid > 0 && big / mid > ratio) out.push(`${o.name || o.parent?.name || o.uuid.slice(0, 8)} scale ${s.x.toFixed(1)},${s.y.toFixed(1)},${s.z.toFixed(1)}`);
  });
  return out;
}
```

## As a report-only step

Add one step after S02, while the play space is loaded. It logs and passes.

Composed — typechecked against 18.1.0-alpha.317
```ts
{ id: 'S20', name: 'scene scans (report only)', wait: 0.1, check: () => {
  const z = zFightScan(world), st = stretchScan(world);
  smokeLog(`S20 z-fight ${z.length}: ${z.slice(0, 8).join(' | ')}`);
  smokeLog(`S20 stretch ${st.length}: ${st.slice(0, 8).join(' | ')}`);
  return true;
} },
```

For each candidate, capture the spot (stand the pawn there in a step, then `capture`) or look at it from the editor (`captureScreenshot`, labelled as an editor capture). Fix the geometry through MCP (`genesys-polybuilder`, `genesys-level-authoring`).

## Future work

- A texel-density scan, comparing UV area against world area per triangle, would replace the scale heuristic. It needs geometry walks that are too slow for a smoke step.
- A z-fight check for rotated meshes would use oriented boxes, or a per-face plane test.
