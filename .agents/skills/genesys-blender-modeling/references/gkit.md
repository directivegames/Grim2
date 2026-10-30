# gkit and garch reference

Every helper below is preloaded in every step script. Docstrings: [gkit.py](../scripts/gkit.py), [garch.py](../scripts/garch.py), [grig.py](../scripts/grig.py), [gbake.py](../scripts/gbake.py).

Coordinates are Blender's: metres, X right, **Y depth, Z up**. The **front faces −Y** (exports as glTF +Z; the engine's visual child yaws π). `at` is the centre of the bottom face for `box`/`cyl`, so pieces stack on z.

## gkit

| Call | Makes |
|---|---|
| `mat(name, '#hex', rough, metal, emit='#hex', emit_strength, alpha)` | Material, cached by name (a second call with another colour warns and returns the first). Use palette hexes. `alpha<1` = glass, ghost, slime |
| `shades(name, '#hex', n, spread)` / `mix('#a', '#b', t)` | n close variants for repeated stones and planks / a blend of two palette colours (trims, faded roofs) |
| `box(name, (w, d, h), at, m, rot, bevel)` | Box; `bevel` 0.01–0.04 m makes it catch light |
| `cyl(name, r, h, at, m, seg, r2, rot)` | Cylinder; `r2` tapers, `r2=0` is a cone |
| `sphere(name, r, at, m, seg, rings, scale)` / `ico(...)` / `blob(name, r, at, m, scale, lumpy)` | Sphere / icosphere by centre / soft lumpy puff (foliage, clouds, bushes) |
| `lathe(name, [(radius, z), …], m, seg, at)` | Revolved profile: bottles, vases, lamp shades, columns, bowls |
| `rod(name, a, b, r, m, seg)` / `sweep(name, points, radii, m, seg)` | Straight bar between two points / tube through points: limbs, sleeves, straps, cables |
| `torus`, `plane`, `mesh(name, verts, faces)` | Rings, flat panels, any custom profile |
| `marker(name, at)` | Empty exported as a named node: sockets, spawn points, light spots |
| `cut(obj, cutter)` | Boolean difference, applied; cutter removed. Keep to a handful per asset |
| `jitter(obj, amount)` | Random vertex offsets — chipped, hand-made look |
| `join(name, objs)` / `meshes(prefix)` | Merge into one object (one draw call per material). `join` applies modifiers first, so bevels survive |
| `smooth(obj, angle)` / `add_bevel(obj, w)` | Shading and edge bevels |
| `ground()` | Drop everything so the lowest vertex is at z = 0 |
| `decimate(obj, tris)` / `shrink_textures(px)` / `clamp_metal(objs)` | For imported or generated models: thin a dense mesh to a triangle count / cap image maps at px / tame mirror metal (metal > 0.85 and rough < 0.2 → 0.6 / 0.35) |
| `mirror_x(obj)` | Symmetric copy across X |
| `import_glb('@engine/...' / '@project/...', at, rot, scale)` | Bring in an existing model (engine KTX2 models are converted once into `.scratch/blender/cache`) |
| `camera`, `sun`, `point_light`, `world` | Staging for stills |
| `seed(n)`, `rnd(a, b)` | Deterministic randomness — the same scripts rebuild the same asset |

Materials made without gkit `mat` have no `diffuse_color` and render grey on the sheet.

## garch — buildings

`window(name, cx, cz, w, h, frame, glass, face='-y', plane=…, sill, cross, shutters)`, `door(name, cx, cz, w, h, leaf, frame, face, plane, glass, knob)`, `gable_roof(name, (a0, a1), (b0, b1), eave_z, ridge_z, roof, gable, overhang, ridge_x, cap)`, `rail_run(name, p0, p1, z, h, post, rail, spacing)`. `face` is the wall's outward side (`-y` front, `+y`, `-x`, `+x`), `plane` its surface coordinate; pieces stand proud of a solid wall, so no boolean cuts. Each returns a list of objects.

## Other helpers and scope

- Rigging (grig): `mannequin_rig`, `joint`, `region`, `bind_rigid`, `bind_nearest`, `skin`, `pose_check` — [rigged-characters](rigged-characters.md).
- Opt-in bake (gbake): `proc_mat`, `BoxBatch`, `low_copy`, `drop_faces`, `bake_high_to_low` — [high-to-low-bake](high-to-low-bake.md).
- `bpy`, `math` and `Vector` are in scope for anything else.
- Curves and text objects (`bpy.data.curves.new(type='FONT')` for signage) are converted to meshes before export, so they ship (`NOTE` line). Render-hidden objects (`hide_render`) are neither counted nor exported; a sign or curve missing from the export was hidden from render or had no faces (`NOTE … dropped`).

## Using named parts and markers in the game

Moving parts are separate named objects with the pivot where they rotate (`chest_lid`, `door_leaf`, `turret_head`, `wheel_FL`). After the model loads, find a part by name and animate it:

Source: .engine/src/nodes/visual/ModelMeshNode.ts (`onMeshLoaded`)
```ts
this.mesh.onMeshLoaded.add((_node, object) => {
  this.lid = object.getObjectByName('chest_lid') ?? null; // rotate lid.rotation.x to open
});
```

A marker works the same way: `object.getObjectByName('light_socket')` gives the local position for a `PointLightNode` or VFX. A skinned model is one mesh, so named parts are gone after `skin`; animate it through clips ([rigged-characters](rigged-characters.md)).
