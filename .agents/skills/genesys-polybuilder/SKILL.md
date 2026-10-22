---
name: genesys-polybuilder
description: Build a scene Poly Mesh with Genesys MCP Poly Builder tools — boxes, planes, cylinders, spheres, cones, stairs, ramps, polygons, and mesh edit. Use when the user asks to block out, model, or sculpt a mesh in the open scene. Not for terrain, islands or landscapes (genesys-world-building), a plain MeshNode primitive (action_node), or baking meshes to a GLB (action_asset.mergeMeshes).
metadata:
  tokens: 1897
---

# Poly Builder

A **Poly Mesh** group in the open scene parents one node per piece. Play and the Outliner select those nodes. Every piece is an editable mesh, including a box. Piece `position` is local to that group. The group starts at the world origin, so a new blockout matches world coordinates. `polyMeshNodeId` is the group. `engineNodeId` on each piece is the Outliner node.

**Do not screenshot to verify the scene.** `captureScreenshot` is not a check that a piece exists, sits in the right place, meets another face, or that a mesh op landed. An image has no piece id, bounds, or face centre.

Not Poly Builder work: terrain, islands, hills, oceans and other landscapes. Use `TerrainMeshNode`, `WaterNode` and `ScatterNode` from [genesys-world-building](../genesys-world-building/SKILL.md). Poly Builder cones are not islands.

Read the scene with MCP instead:

- `query_polybuilder` `getDocument` — each piece's `engineNodeId`, `pivot`, world `bounds`, `localBounds`, and `frame`. With `includeTopology` and `nodeId`, faces include `worldCenter` and `worldNormal`; vertices include `worldPosition`.
- `query_node` `find` or `getTree` — the **Poly Mesh** group and the piece node for `engineNodeId`. That node's transform is the piece pose.
- `query_editor` `getPlayModeState` before an edit, and `getSelection` when the selected node matters.

Compare those numbers (a stair `frame.highEnd.worldCenter` against a box `bounds`). If they are wrong, `transform` or `meshOp` and query again. Use `captureScreenshot` only when the user asks for a picture.

Tools are compact-hidden. Call them from `run_script` or `batch_execute`:

- `genesys.queryPolybuilder({ operation: 'getDocument' })`
- `genesys.actionPolybuilder({ action, ... })`

Do not `action_node.add` a `PolyMeshNode`, and do not write `authoringJson`.

## Build

Wrap a whole build in one `run_script` with `groupUndo: true` so Ctrl+Z undoes it as one step. A geometry action turns Poly Builder mode on so the user can see the pieces. Each apply returns `pieces` for the ids it changed, including `pivot` and `frame`.

```js
const box = await genesys.actionPolybuilder({
  action: 'placeBox',
  name: 'Wall',
  size: { x: 4, y: 3, z: 0.4 },
  position: { x: 0, y: 0, z: 0 },
});
const pieceId = box.pieceIds[0];
const doc = await genesys.queryPolybuilder({
  operation: 'getDocument',
  includeTopology: true,
  nodeId: pieceId,
});
const top = doc.topology.faces.find((face) => face.id === 'top');
await genesys.actionPolybuilder({
  action: 'meshOp',
  nodeId: pieceId,
  meshOperation: 'extrude',
  selection: { faceIds: [top.id] },
  parameters: { amount: 1 },
});
return { pieceId, engineNodeId: box.pieces[0].engineNodeId, polyMeshNodeId: box.polyMeshNodeId };
```

`placeBox` `position` is the center of the bottom face. Local Y runs from 0 to the height. `bounds` is the world AABB. `frame` is null. `meshOp` works on the box immediately. Face ids change after a mesh op, so query topology again.

`placeShape` does not take `size`. `position` is the bottom contact.

| Shape | Arguments | Pivot | Align to |
| --- | --- | --- | --- |
| `plane` | `width` (local X), `depth` (local Z), optional `thickness` (default 0.05) | center of the bottom face | `frame.top.worldCenter` |
| `cylinder` | `radius`, `height` | center of the base | `frame.top.worldCenter` |
| `cone` | `radius`, `height` | center of the base | `frame.top.worldCenter` (the apex; `faceId` is null) |
| `sphere` | `radius` | bottom contact | `frame.center.worldCenter` |
| `custom-polygon` | `points` (at least 3 `{x, z}` in local XZ), `height` | center of the outline bounds, on the bottom | `frame.top.worldCenter` |
| `stairs`, `ramp` | `run`, `rise`, `width` | bottom of the low end | `frame.highEnd.worldCenter` |

Unrotated, cylinder, cone, sphere, and plane height is local +Y. Stairs and ramps run along local +X, rise along +Y, and width is centered on Z. Stairs default to `stepCount: 6`. `landingDepth` and `topLandingDepth` default to 0 and are included in `run` (the treads use what is left).

`frame.kind` is `cylinder`, `cone`, `plane`, `polygon`, `sphere`, `stairs`, or `ramp`. Cap frames use `base` and `top`. A sphere uses `center` and `rest`. Stairs and ramps use `lowEnd` and `highEnd`. Vertex topology includes `worldPosition`.

```js
const stairs = await genesys.actionPolybuilder({
  action: 'placeShape',
  shape: 'stairs',
  name: 'Stairs',
  run: 3,
  rise: 2,
  width: 1.2,
  position: { x: 0, y: 0, z: 0 },
});
const high = stairs.pieces[0].frame.highEnd.worldCenter;
```

Put `high` on the platform you are joining (a box `bounds.max` on the meeting axis, or another piece's face `worldCenter`). Then `transform` if the run must point another way, and read `frame` again — it follows the piece. After a `meshOp`, face ids change and `frame` may be null; query topology and use `worldCenter` / `worldNormal`.

`setMode` only shows or hides the viewport tools. It is not an undo step.

## Actions

Every piece takes `transform`, `meshOp`, and `delete`. `placeBox` creates a mesh, so `meshOp` does not need a separate promote step.

## Mesh ops

Query topology for one piece, then pass those ids. Ids change after every mesh op, so query again before the next one. Align to `worldCenter` and `worldNormal`, not the local fields.

```js
const doc = await genesys.queryPolybuilder({
  operation: 'getDocument',
  includeTopology: true,
  nodeId: pieceId,
});
const faceId = doc.topology.faces[0].id;
await genesys.actionPolybuilder({
  action: 'meshOp',
  nodeId: pieceId,
  meshOperation: 'extrude',
  selection: { faceIds: [faceId] },
  parameters: { amount: 1 },
});
```

`meshOperation` is the geometry op (`extrude`, `fill`, `subdivide`, and the rest). It is not the router `action`. Bevel is not available.

## Footguns

- Each piece is its own node under the Poly Mesh group. `polyMeshNodeId` is that group, not a merged mesh. Move a piece with `transform` or `query_node` on `engineNodeId`. There is no Select or Transform tool.
- Pieces are not CSG-unioned. Overlapping pieces look solid until one is moved. Confirm a join with bounds and face `worldCenter`, not a screenshot.
- Piece nodes are created with physics off.
- Stop play mode before editing (`query_editor` `getPlayModeState`).
- `action` `delete` removes a piece by id. In the viewport, Delete is the normal scene delete of the selected piece node.
- Leaving the mode with `setMode: false` does not discard geometry.
- If a call says Poly Builder is not enabled, stop. The feature is off for this editor.
