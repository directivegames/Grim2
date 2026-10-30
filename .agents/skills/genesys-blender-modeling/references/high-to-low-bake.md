# High → low bake (opt-in detailed assets)

The default route is flat palette materials on modest geometry (gkit, `SKILL.md`). It is fast, small and fits the stylised look of most Genesys games. Use this route **only when the creator asks for that level of detail**: "realistic", "painterly", "textured", "surface detail", "like this concept art", a hero building or prop they want to hold up close. Never switch a whole game to it on your own.

The idea is the standard game-art pipeline: model every detail on a **high-poly source** that never ships, build a **low-poly game mesh** with clean UVs, and **bake** the high model's colour, normals and ambient occlusion onto the low mesh's textures. The player sees the detail; the engine draws a few thousand triangles.

Worked example: `.agents/skills/genesys-blender-modeling/examples/baked-crate` (planked crate → one 12-triangle box, 512 px, 65 KB). A full building took 38 k triangles of source detail down to about 1.9 k triangles and 1.5 MB.

## The steps

Name the step scripts so they run in this order:

| Step | What | Helpers |
|---|---|---|
| `00-materials.py` | Procedural Cycles materials for the high model: grain, worn patches, per-piece tone, grime from the ground, brick | `proc_mat` |
| `01…49` | The high-poly model. Every detail is real geometry (boards, shingles, casings, louvres, bolts). Give high objects a common prefix (`hd_`, `hi_`). Thousands of small pieces go through `BoxBatch` | `box`, `BoxBatch` |
| `50-low.py` | The low-poly game mesh: **shell** surfaces that receive the detail (walls, roof slabs, a crate's box) plus **kept** silhouette pieces copied from the high model (posts, railings, stairs, trim boards) | `low_copy`, `drop_faces` |
| `90-bake.py` | UV the low mesh, bake, assign one baked material, remove the high model | `bake_high_to_low` |
| `asset.json` | `"role"` (`prop` or `building`) and a `tris` range for the LOW mesh; tangents export automatically for the baked normal map | |

```python
# 50-low.py
box('low_box', (0.84, 0.84, 0.8))                      # shell: just outside the outermost detail
originals = [o for o in meshes('hd_') if o.name.startswith(('hd_post', 'hd_rail'))]
low_copy(originals)                                     # kept pieces: real geometry in the low mesh
for o in originals:
    o.name = 'hk_' + o.name[3:]                         # not a shell bake source any more

# 90-bake.py
bake_high_to_low(high=meshes('hd_'), shell=meshes('low_'), kept=meshes('low_kept_'), discard=meshes('hk_'),
                 name='SM_Asset', size=2048, cage=0.15, ray=0.35)
```

Then `blender.sh build blender/<asset>` and `blender.sh preview <the exported glb>`: open the preview (`.scratch/blender/sheets/project.<name>-preview.png`; Cycles, sun, four angles). The Workbench contact sheet shows textures but not normal-map relief, so it cannot judge a bake.

## Building the low mesh

- **Shell** = the big simple surfaces. Put each one just outside the outermost high detail on that side (a wall plane 1–2 cm proud of the siding boards; a roof slab whose top sits at the shingle surface). Detail between the shell and `cage` metres in front of it gets baked.
- **Kept** = anything whose silhouette matters at gameplay distance and that a flat surface cannot fake: posts, balusters, stair treads and stringers, chimneys, overhanging trim (rake and fascia boards, soffits), footings. `low_copy` drops their bevels and keeps their procedural materials; they bake from **themselves**, so they never pick up a twin surface.
- **No hidden faces.** Undersides that face the inside of the model (a roof slab's attic side, the back of a slab against a wall) still take UV space and bake garbage. `drop_faces(obj, direction)` removes them.
- **Budget.** Props 12–500 triangles, buildings 1–3 k. Texture: 512 px for a prop, 1024 px for a building (about 0.5 px per cm on a house). A 2048 px bake is about 1.4 MB and fails the `building` budget (600 KB, `genesys-assets` → *Weight budgets*); use it only for a hero building the creator asked to see up close, with the role the parent sets for it. Bigger textures cost download size and memory on phones.

## What `bake_high_to_low` does

1. Joins the high objects, joins shell + kept into the low mesh.
2. Smart-UV projects the low mesh, averages island scale (even texel density), packs islands with margins.
3. Bakes in Cycles: **base colour** (DIFFUSE, colour only), **ambient occlusion**, **tangent-space normal**. The shell ray-casts onto the high model (selected-to-active, `cage` / `ray`); kept pieces bake their own materials with the high model hidden, and still shadow the shell's AO.
4. Multiplies AO into the colour (`ao` 0–1), packs both images into the GLB, and leaves copies at `.scratch/blender/<name>-albedo.jpg` and `-normal.png` for inspection.
5. Assigns one Principled material (base colour + normal map), removes the high model and unused materials.

Blender bakes normals in the OpenGL convention that glTF expects; no channel flip is needed.

## Traps

- **The dense model shipped with a texture on it.** Baking the procedural materials onto the high mesh itself (UV-unwrapping thousands of boards) gives a 40 k-triangle model whose atlas is thousands of tiny islands. Detailed modelling only pays off when it is baked onto a separate low mesh.
- **Black or wrong-coloured specks on the shell next to kept pieces** (dots along a deck edge under a railing). The shell's rays started inside the high copy of a kept piece. Discard the high originals of kept pieces (`discard=`) so only detail without a low twin feeds the shell.
- **A solid olive / flat-coloured island in the normal map.** That face had nothing to hit: usually a hidden underside. Remove it with `drop_faces`, or make sure `cage` reaches the detail.
- **A black band where two pieces meet.** Two coplanar faces (a rail cap exactly as wide as the post) fight in the bake and in the engine. Make one 1–2 cm narrower in the high model.
- **Detail missing from the bake.** It sits more than `cage` in front of the shell, or behind it. Move the shell outward or raise `cage`; keep `ray` above `cage`.
- **Siding laps or shingle rows barely show.** The high-model relief is too shallow for the normal map at this texture size. Tilt boards 6–8°, raise shingle butts, or bake at a larger size.
- **Shading seams or a dented look in the engine.** The normal map exported without tangents: `asset.json` sets `"tangents": false`, or the normal map is not wired through a Normal Map node. Remove the override, or wire the texture through a Normal Map node.
