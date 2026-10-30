---
name: genesys-polybuilder
description: "Build and edit Poly Mesh geometry in the open scene with MCP Poly Builder tools: boxes, planes, stairs, ramps, mesh edit, materials on pieces. Use to block out, greybox or sculpt level geometry: walls, floors, platforms, stairs, ramps, rooms. Not for terrain, islands or water (use `genesys-world-building`), or plain primitives, placed models or bulk layouts (use `genesys-level-authoring`)."
metadata:
  tokens: 2825
---

# Poly Builder

A **Poly Mesh** group in the open scene parents one node per piece. Play and the Outliner select those nodes. Every piece is an editable mesh, including a box. Piece `position` is local to that group. The group starts at the world origin, so a new blockout matches world coordinates. `polyMeshNodeId` is the group. `engineNodeId` on each piece is the Outliner node.

**Version gate.** `action_polybuilder` and `query_polybuilder` exist only in Sandbox Studio 18.1+. If `search_tools` does not find them, the app is older: say so in one line and build the blockout with the editor's Poly Builder UI (`genesys-editor-manual`) or with primitives (`genesys-level-authoring`). Do not write `authoringJson` by hand instead.

The most important rule: verify with numbers, not pictures. `captureScreenshot` is not a check that a piece exists, sits in the right place, meets another face, or that a mesh op landed. An image has no piece id, bounds, or face centre.

Not Poly Builder work: terrain, islands, hills, oceans and other landscapes. Use `TerrainMeshNode`, `WaterNode` and `ScatterNode` (`genesys-world-building`). Poly Builder cones are not islands.

## Use another skill when
- Deciding whether a space should be Poly Builder, primitives, models, prefabs, or a pack → `genesys-level-authoring`
- MCP availability gate, `run_script` / `batch_execute` dispatch, approvals → `genesys-mcp-orchestrator`
- The same assembly repeats or spawns at runtime → `genesys-prefabs`
- A static merged GLB from scene meshes (`action_asset.mergeMeshes`) → `genesys-mcp-orchestrator`
- Doors, lifts, moving platforms → `genesys-interactions`
- Collision profiles and physics bodies beyond enabling a piece → `genesys-physics`
- Making a new material, or a shipped node material (triplanar, toon) for the pieces → `webgpu-tsl-node-material-assets`; the MCP material route → `genesys-mcp-orchestrator`
- Editing the level in Blender → `genesys-blender-bridge`

## Read the scene

Read the scene with MCP:

- `query_polybuilder` `getDocument` — each piece's `engineNodeId`, `pivot`, world `bounds`, `localBounds`, and `frame`. With `includeTopology` and `nodeId`, faces include `worldCenter` and `worldNormal`; vertices include `worldPosition`.
- `query_node` `find` or `getTree` — the **Poly Mesh** group and the piece node for `engineNodeId`. That node's transform is the piece pose.
- `query_editor(operation="getPlayModeState")` before an edit, and `query_editor(operation="getSelection")` when the selected node matters.

Compare those numbers (a stair `frame.highEnd.worldCenter` against a box `bounds`). If they are wrong, `transform` or `meshOp` and query again. Use `captureScreenshot` only when the user asks for a picture.

Tools are compact-hidden. Call them from `run_script` or `batch_execute`:

- `genesys.queryPolybuilder({ operation: 'getDocument' })`
- `genesys.actionPolybuilder({ action, ... })`

Do not `action_node(action="add")` a `PolyMeshNode`, and do not write `authoringJson`.

## Build

Wrap a whole build in one `run_script` with `groupUndo: true` so Ctrl+Z undoes it as one step. A geometry action turns Poly Builder mode on so the user can see the pieces. Each apply returns `pieces` for the ids it changed, including `pivot` and `frame`.

Source: MCP `action_polybuilder` (compact-hidden tool catalog, `genesys-mcp-orchestrator`)
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

Source: MCP `action_polybuilder` `placeShape`
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

Source: MCP `query_polybuilder` / `action_polybuilder` `meshOp`
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

## Materials on pieces

Poly Builder has no material action. Each piece is a `PolyMeshNode` (a `MeshNode`), so its look is the node's `material` property (`.engine/src/nodes/visual/MeshNode.ts`), set on the piece's `engineNodeId`:

1. Finish the geometry first. Then `query_node(operation="getEditableProperties")` on `engineNodeId` to confirm the `material` path.
2. `action_node(action="setProperties", componentId: <engineNodeId>, properties: { material: "@engine/assets/materials/M_Floor.material.json" })`. Use a `.material.json` path (`@engine/...` or `@project/...`), never an inline material or colour object.
3. `action_scene(action="save")`, then re-query the piece.
4. After a later Poly Builder op on that piece, re-query `material` once (verify on first use that the op keeps it).

New pieces start with `M_Wall.material.json`. Blockout defaults: `M_Floor.material.json` on floors and platforms, `M_Wall.material.json` on walls (engine grid, world-scaled UVs). A new look (a brick or stone material) is a `.material.json` made through `action_asset(action="createMaterial")` or `webgpu-tsl-node-material-assets`, then set the same way.

## Bugs

- The pawn falls through a Poly floor or walks through a Poly wall → piece nodes are created with physics off (`PolyMeshNode` defaults `physicsOptions.enabled` to false, `.engine/src/nodes/poly-mesh/PolyMeshNode.ts`) → enable physics on the pieces that must collide with `action_node(action="setProperties")` on `engineNodeId` (read the path with `getEditableProperties`), or bound the space another way (`genesys-level-authoring`).

## Traps

- Each piece is its own node under the Poly Mesh group. `polyMeshNodeId` is that group, not a merged mesh. Move a piece with `action_polybuilder` `transform`, or `action_node` `setProperties` on `engineNodeId`; `query_node` only reads. There is no Select or Transform tool.
- Pieces are not CSG-unioned. Overlapping pieces look solid until one is moved. Confirm a join with bounds and face `worldCenter`, not a screenshot.
- An edit fails or vanishes → play mode was running. Stop play mode before editing (`query_editor` `getPlayModeState`).
- `action` `delete` removes a piece by id. In the viewport, Delete is the normal scene delete of the selected piece node.
- Leaving the mode with `setMode: false` does not discard geometry.
- If a call says Poly Builder is not enabled, stop. The feature is off for this editor.
- `search_tools` finds no `action_polybuilder` → the app is older than 18.1 → use the UI route (*Version gate*).
- A piece lost its material after reopening the scene → the scene was not saved → save, re-query (*Materials on pieces*).

## Done

- `getDocument` lists every intended piece with the expected `bounds`; joins match on face `worldCenter` or `frame` values.
- `query_node` finds the Poly Mesh group and each `engineNodeId`.
- Pieces the pawn must stand on or be stopped by have physics enabled, confirmed by re-querying the piece properties.
- Every visible piece has a `material` path (grid materials for blockout), confirmed by re-query after the save.
- The scene is saved (`action_scene(action="save")`).
