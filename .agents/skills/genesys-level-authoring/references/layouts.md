# Layouts: bulk placement from a JSON file

A layout is a short JSON file of placement rules (rows, rings, mirrors, seeded jitter). `scripts/layout.mjs` expands it into one generated prefab. MCP places that prefab with a single `instantiate`. Later builds rewrite the prefab file, and the editor reloads every placed instance on its own.

Measured in the editor: about 0.6 s per MCP mutation, so a node placed with `action_node.add` + `setProperties` costs about 1.2 s. A 300-node street takes about 6 minutes, and long scripts hit the MCP client's 300 s timeout. The same 300 nodes as a generated prefab instantiate in about 0.2 s.

## When to use which

| Situation | Route |
|---|---|
| Fewer than ~30 nodes, or editing nodes that already exist | MCP directly (`genesys-mcp-orchestrator`) |
| Dozens or more placements that follow rules: streets, rows of houses, fences, trees, kit grids, rings of pillars or rocks, track barriers | Layout → generated prefab |
| Repeated dressing above ~10 copies of one model (grass, hedges, fences, trees, rocks) | Layout item with `"instanced": true` (*Instancing*) |
| One authored assembly reused in several places (a market stall, a room kit) | Normal prefab (`genesys-prefabs`) |
| Walkable geometry sculpted in the scene | `genesys-polybuilder` |

## Loop

```bash
node .agents/skills/genesys-level-authoring/scripts/layout.mjs build levels/street.layout.json
```
Run it from the game project root (it reads and writes paths relative to the current folder). Run it with no arguments to print the exact command for this install.

1. Write the layout under `levels/` at the project root (beside `blender/`, not under `assets/`).
2. `build` writes the prefab (`layout.prefab`), plus `levels/street.generated.json`, the record of what it wrote. Read the `PREFAB … nodes N` line. It should match what you meant.
3. First time only: `action_prefab` `instantiate` with the printed `prefabPath`, then `action_scene(save)`.
4. Iterate: edit the layout and `build` again. Placed instances update within a few seconds. If one does not update, `action_prefab` `resync` on the placed root.
5. Verify with `query_node` (group child counts, a few transforms), then the look in Play.

Keep one layout per layer that changes on its own (road, houses, props, foliage). Rebuilding one then leaves the others alone.

## Hand edits

The layout is the source of truth. A placed instance follows its prefab file, and edits made on the instance in the scene are thrown away when the file changes. Make hand edits in the Prefab Editor instead:

1. `action_prefab` `open` the generated prefab, move, delete, re-property or add nodes with `action_node`, then `save` and `close`.
2. `layout.mjs pull <layout>` walks the whole prefab tree and copies the edits into `levels/<name>.overrides.json`, keyed by item (`Houses/house#3`), group (`Houses/`) or `root`:
   - moved, rotated or scaled nodes at any depth, including groups and the root;
   - changed or removed properties (`props` / `unset`, e.g. a `castShadow` turned off);
   - deleted nodes (`"deleted": true`);
   - nodes added anywhere, kept verbatim under their parent's key (`added`);
   - moved instances of an instanced node (keyed like a normal copy) and instances painted on the end (`addedInstances`).
3. Later builds apply the overrides, so the edits survive. `build` refuses to run while Prefab Editor edits are unpulled. `build --force` discards them.

`pull`, `status` and `build` stop with `FAIL` on edits a layout cannot represent, so nothing is dropped silently: a generated node reparented (or moved under a node added in the editor), instances removed from an instanced node, shared `$objects` / `$ref` entries in the file, or a replaced root. Undo that edit in the Prefab Editor, or `build --force` to discard it, or `unlink` (below) when the scene should own the nodes.

`layout.mjs status <layout>` prints node counts and pending edits. A `generated.json` written by an older `layout.mjs` tracks item transforms only; the next build upgrades it.

**Hand-off.** When the level is final and needs free per-node work in the scene, `action_prefab` `unlink` the placed root. From then on the scene owns those nodes and the layout no longer applies. A later build makes a new prefab instance to place, so stop editing the layout once you unlink.

## Instancing

Repeated dressing above ~10 copies of one model (grass tufts, hedges, lawn tiles, fence runs, trees, rocks, lamps) goes on one `ENGINE.InstancedModelMeshNode` instead of one `ModelMeshNode` per copy. Add `"instanced": true` to the item, or to a group's `defaults`:

```json
{ "name": "Grass", "defaults": { "instanced": true, "physics": false, "castShadow": false }, "items": [
  { "key": "tuft", "asset": "grass", "ring": { "count": 64, "radius": 22 }, "jitter": { "position": [3, 0, 3], "rotation": [0, 180, 0], "scale": 0.4 } }
]}
```

- One instanced node per item per model: an item whose `asset` is a list of three models becomes three nodes. Repeat, ring, mirror, jitter and stable keys work as before; each copy becomes one entry in the node's `instances` list.
- `"instanced": { "cullDistance": 120, "lods": [{ "asset": "treeFar", "distance": 40 }] }` sets the engine's per-instance cull distance (0 = off) and LOD tiers (pre-made lower-detail GLBs; single-asset items only).
- `physics` applies per instance (the engine builds one body per instance), so keep `false` on scatter and use `"boundingBox"` on hedges or fences the pawn must not cross.
- `build` prints a `HINT` for every model placed more than 10 times as separate nodes. Add `"instanced": false` to an item to keep separate nodes on purpose (gameplay code finds each one, or each gets its own prefab overrides) and silence the hint.
- **Per-instance culling and pivots.** Each frame the engine hides instances whose sphere is outside the view (`perInstanceFrustumCulling`, default on). The sphere is centred on the instance's pivot, with the bounding radius of the model's first submesh (`BaseInstancedMeshNode.runCullAndLODPass`), so a model that reaches far from its pivot is hidden while part of it is still on screen. A corner-pivot 8 m wall reaches 11.5 m from its pivot against a 5.7 m sphere; tall bottom-pivot trees and rocks miss by several metres too. `build` reads each instanced model's GLB and prints a `HINT` when the model reaches more than 1 m past the sphere, naming the items. Fix it per item with `"props": { "perInstanceFrustumCulling": false }`: every copy is then drawn, which costs little for a few hundred kit pieces. Keep culling on for big fields of small scatter, where the hint stays quiet.
- Measured on a copy of a real backyard layout: 416 `ModelMeshNode`s became 90 nodes (31 instanced nodes holding 357 copies) with the same placements. The draw-call drop in Play is not measured; check it with `genesys-profiler`.

The serialized form (`instances: [{ position: {$bc:"v3"}, rotation: {$bc:"e"}, scale: {$bc:"v3"} }]`, `maxInstances` written above the engine default of 1000) was checked against the engine serializer and loader. Verify the look in Play on first use.

## Other engine nodes in a layout

An item with a `className` other than `ENGINE.ModelMeshNode` may omit `asset` and carry its serialized fields in `props`. Use it for a spline road or river whose `points` would otherwise be typed through MCP one vector at a time:

```json
{ "key": "loop", "className": "ENGINE.SplineMeshNode", "physics": "trimesh", "castShadow": false,
  "props": { "closed": true, "width": 12, "segments": 300, "materialPath": "@engine/assets/materials/M_Floor.material.json",
    "points": [ { "$bc": "v3", "_": [0, 0, 0] }, { "$bc": "v3", "_": [150, 0, 0] }, { "$bc": "v3", "_": [220, 0, 120] },
                { "$bc": "v3", "_": [150, 0, 240] }, { "$bc": "v3", "_": [0, 0, 240] }, { "$bc": "v3", "_": [-70, 0, 120] } ] } }
```

Loaded through the engine loader: 6 points, closed, width 12, trimesh physics. Field names are the class's `@property` names (`.engine/src/nodes/visual/SplineMeshNode.ts`); vectors are `{ "$bc": "v3", "_": [x, y, z] }`, rotations `{ "$bc": "e", "_": [rx, ry, rz] }` in radians.

## Format

```json
{
  "prefab": "assets/prefabs/levels/Street.prefab.json",
  "name": "Street",
  "seed": 7,
  "root": { "position": [0, 0, 0], "rotation": [-6, 0, 0] },
  "assets": { "road": "@project/assets/models/town/SM_Road_20m.glb", "houseA": "@project/assets/models/town/SM_House_A.glb" },
  "defaults": { "physics": false, "castShadow": true, "receiveShadow": true },
  "groups": [
    { "name": "Road", "defaults": { "castShadow": false }, "items": [
      { "key": "road", "asset": "road", "position": [0, 0, 10], "repeat": { "count": 32, "step": [0, 0, -20] } }
    ]},
    { "name": "Houses", "items": [
      { "key": "house", "asset": ["houseA", "houseB", "houseC"], "position": [17, 0.42, 0], "rotation": [0, -90, 0],
        "repeat": { "count": 39, "step": [0, 0, -16] }, "mirror": "x", "jitter": { "position": [1, 0, 0.8] } }
    ]}
  ]
}
```

| Field | Meaning |
|---|---|
| `prefab` | Output file, a project path ending in `.prefab.json` under `assets/` |
| `name` | Name of the root node (defaults to the file name) |
| `seed` | Seed for jitter and random asset picks. The same layout always builds the same prefab. |
| `root` | Transform of the root node (`position`, `rotation` in degrees, `scale`). Use it for a slope or to offset the whole layout. |
| `assets` | Short names → `@project/...` or `@engine/...` model paths. Items may also use a full path directly. |
| `assetPick` | `"cycle"` (default: list entries in order) or `"random"` (seeded) for items whose `asset` is a list |
| `defaults` | Applied to every item. A group's `defaults` override the layout's, and the item's own fields override both. |
| `groups[].name` | One child `SceneNode` of the root per group. Names are unique. Optional `position` / `rotation` (degrees). |
| `items[].key` | **Required**, unique within the group. Forms the stable id, so never rename a key you want to keep. |
| `asset` | Short name, path, or a list (cycled or random per repeat index) |
| `position` / `rotation` / `scale` | Local to the group. Rotation in degrees. `scale` is a number or `[x, y, z]`. |
| `repeat` | `{ "count": N, "step": [dx, dy, dz], "rotationStep": [rx, ry, rz] }` makes N copies |
| `ring` | `{ "count": N, "radius": r, "startDeg": 0, "faceCenter": true }` makes N copies on a circle around `position` in the XZ plane, each yawed to its angle (`faceCenter` turns the front, +Z, inward). Use `repeat` or `ring` on an item, not both. |
| `mirror` | `"x"` adds a copy at −x, with yaw and roll negated (both sides of a street face the middle) |
| `jitter` | `{ "position": [dx, dy, dz], "rotation": [rx, ry, rz], "scale": s }` gives a seeded ± offset per copy |
| `physics` | `false` (no collider, best for dressing), `true` (engine default: static convex hull), or an engine `CollisionMeshType`: `"trimesh"` (concave: road with curbs, arches), `"convexHull"`, `"boundingBox"` (alias `"box"`: houses, crates, walls), `"boundingSphere"` (alias `"sphere"`), `"voxels"`; or a raw `physicsOptions` object |
| `castShadow` / `receiveShadow` | Default `true` / `true` |
| `className` | Defaults to `ENGINE.ModelMeshNode`. Another class may omit `asset` (*Other engine nodes*). |
| `instanced` | `true`, `false` or `{ "cullDistance": m, "lods": [{ "asset", "distance" }] }`. `true` emits one `ENGINE.InstancedModelMeshNode` per model (*Instancing*). `false` silences the instancing hint. |
| `name` | Display name prefix (default: the key, `_<i>` per copy, `_L` on the mirrored copy) |
| `props` | Raw serialized fields merged into the node (spline points, a `material` path, `cullDistance`) |

**Stable ids.** Each copy's `prefabId` is a hash of the prefab path and `<group>/<key>#<index>` (mirrored copies add `~mx`); an instanced node's is `<group>/<key>@<asset>`. Changing a count, step, asset or jitter keeps the ids of copies that still exist, so overrides and editor selections stay valid. Renaming a key or a group creates new ids.

## Files

| File | Commit it? | What |
|---|---|---|
| `levels/<name>.layout.json` | yes | The rules, written by the agent |
| `levels/<name>.overrides.json` | yes | Hand edits pulled from the Prefab Editor: `nodes` (transform, `props`, `unset`, `deleted` per key), `added` (`{ parent, node }`), `addedInstances` (per instanced node) |
| `levels/<name>.generated.json` | yes | What the last build wrote (parent, transform and fields per node, instance lists). Lets `build` detect unpulled edits. |
| `assets/prefabs/levels/<name>.prefab.json` | yes | The generated prefab. Never edit it by hand; use the Prefab Editor, then `pull`. |

## Traps

- `FAIL … Prefab Editor edit(s) not in the layout` → someone saved the prefab in the Prefab Editor → `pull`, then `build`.
- Hand-moved piece snapped back → it was moved on the placed instance in the scene, then `resync` re-instantiated the prefab fresh (a rebuild alone keeps scene overrides) → redo it in the Prefab Editor and `pull`.
- Mirrored props face the wrong way → the item's yaw was written for the −x side → write the +x side; `mirror` negates yaw.
- Console `Invalid collision mesh type: box` from a layout built before the alias existed → rebuild the layout; the script now writes `boundingBox`.
- Thousands of colliders slow the scene → dressing kept engine-default physics → `"physics": false` in `defaults`, and enable it only on what the player touches.
- Hundreds of draw calls from one layout, `HINT … separate ModelMeshNodes` in the build output → repeated dressing placed as separate nodes → `"instanced": true` on those items (*Instancing*).
- `FAIL … reparent`, `… instance(s) removed`, `… shared $objects` → a Prefab Editor edit the layout cannot hold → undo it in the Prefab Editor, or `build --force` to discard it, or unlink for good.
- The log warns `instances exceed maxInstances` → saved copies outnumber the node's capacity, so the engine raised it to fit → set `maxInstances` to at least the copy count on that node (an override can lower what the script wrote).
- Instanced scatter casts heavy shadows → `castShadow` left on the default `true` → `"castShadow": false` on small scatter (grass, pebbles, flowers).
- Instanced walls or floor tiles disappear when the player turns, while part of them is still in view → per-instance culling uses a sphere around each pivot, and the model reaches past it (corner pivots, tall bottom-pivot models) → `"props": { "perInstanceFrustumCulling": false }` on the items the build `HINT` names (*Instancing*).
- Pieces vanish after renaming a key → the stable ids changed and the old overrides no longer match → keep keys stable, or move the overrides to the new key.
