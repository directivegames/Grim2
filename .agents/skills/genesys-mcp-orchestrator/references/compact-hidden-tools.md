# Compact-Hidden Tools Reference

> Generated from the MCP tool registry — do not edit by hand.

These tools are not first-class MCP tools in compact mode (the default). They are fully accessible through `run_script` (`genesys.*` API) or `batch_execute` (`tool:` field). Do not call `describe_tool` or `search_tools` for these tools before dispatching a known operation — go straight to the call.

| Tool | Kind | Operations |
| --- | --- | --- |
| `action_asset` | `action` | `createFolder`, `createMaterial`, `delete`, `import`, `installAssetPack`, `mergeMeshes`, `move`, `rename` |
| `action_navmesh` | `action` | `clear`, `export`, `generate`, `import`, `setSettings`, `toggleDebug` |
| `action_polybuilder` | `action` | `delete`, `meshOp`, `placeBox`, `placeShape`, `setMode`, `transform` |
| `action_prefab` | `action` | `apply`, `close`, `create`, `createFromNode`, `instantiate`, `open`, `resync`, `save`, `setEditableChildren`, `unlink` |
| `action_profiler` | `action` | `armTraceForGameStart`, `generateReport`, `setGpuDetail`, `setInsights`, `startTrace`, `stopTrace` |
| `action_store` | `action` | `createItem`, `deleteItem`, `linkGame`, `publish`, `setImage`, `takeDown`, `updateItem` |
| `query_asset` | `query` | `find`, `getDetails`, `getAssetPackInfo`, `getReferences` |
| `query_diagnostics` | `query` | `getBuildErrors`, `getConsole` |
| `query_navmesh` | `query` | `getInfo`, `getSettings` |
| `query_play` | `query` | `getPlayerPawns`, `getNodeTransform`, `raycast` |
| `query_polybuilder` | `query` | `getDocument` |
| `query_profiler` | `query` | `status`, `readReport`, `readTraceManifest`, `listArtifacts` |
| `query_store` | `query` | `getState`, `listItems` |

### `action_asset`

Action Asset · kind: `action`

Asset actions via the live editor when possible. Requires `action`. Ops: createFolder, createMaterial, move, rename, delete (destructive), import, installAssetPack (empty packs/<name>/ scaffold only — not catalog packs), mergeMeshes (export selected/nested meshes to a Model GLB under @project/assets/models). Bridged mutations need a ready editor; move/rename rewrite references.

Operations: `createFolder` *(undoable)*, `createMaterial` *(undoable)*, `delete` *(destructive, undoable)*, `import`, `installAssetPack`, `mergeMeshes`, `move`, `rename`

Dispatch via `run_script`:

```js
genesys.actionAsset({ action: 'createFolder', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_asset", args: { action: "createFolder", ... } }
```

### `action_navmesh`

Action NavMesh · kind: `action`

Generate, export, import, clear, configure, or toggle debug visualisation for the scene NavMesh. Requires `action`. Operations: generate, export, import, clear (destructive), setSettings, toggleDebug. Hidden in compact surface — call via run_script / batch_execute / search_tools.

Operations: `clear` *(destructive)*, `export`, `generate`, `import`, `setSettings` *(undoable)*, `toggleDebug`

Dispatch via `run_script`:

```js
genesys.actionNavmesh({ action: 'clear', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_navmesh", args: { action: "clear", ... } }
```

### `action_polybuilder`

Action Poly Builder · kind: `action`

Build Poly Builder pieces as separate scene nodes under a Poly Mesh group: place boxes and shapes, transform, mesh-edit, or delete pieces. A box is an editable mesh. Align and verify from the returned pivot, bounds, and frame.highEnd.worldCenter, then query_polybuilder and query_node on engineNodeId. polyMeshNodeId is the group. engineNodeId is the piece node. Place and check geometry by query; use captureScreenshot (after frameNodes) only to judge the look. Requires `action`. Turns Poly Builder mode on when geometry changes. Compact-hidden — call via run_script (genesys.actionPolybuilder) or batch_execute. Read the genesys-polybuilder skill first.

Operations: `delete` *(destructive, undoable)*, `meshOp` *(undoable)*, `placeBox` *(undoable)*, `placeShape` *(undoable)*, `setMode`, `transform` *(undoable)*

Dispatch via `run_script`:

```js
genesys.actionPolybuilder({ action: 'delete', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_polybuilder", args: { action: "delete", ... } }
```

### `action_prefab`

Action Prefab · kind: `action`

Create, place, isolate, apply, resync, or unlink Prefabs. Compact-hidden — call via run_script (genesys.actionPrefab) or batch_execute. Inspect with query_node and query_asset(find, assetType="prefab"). Requires `action`. Ops: create, createFromNode (destructive), instantiate, open, close, save, apply, resync, unlink (destructive), setEditableChildren. Isolation edits use action_node then action_prefab.save — never action_scene.save while a prefab document is open. instantiate does not autosave.

Operations: `apply` *(destructive)*, `close`, `create` *(undoable)*, `createFromNode` *(destructive)*, `instantiate` *(undoable)*, `open`, `resync` *(destructive)*, `save`, `setEditableChildren` *(undoable)*, `unlink` *(destructive)*

Dispatch via `run_script`:

```js
genesys.actionPrefab({ action: 'apply', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_prefab", args: { action: "apply", ... } }
```

### `action_profiler`

Action Profiler · kind: `action`

Start or stop Insights collection, save an Insights report, set GPU timing detail for the next Play, or control a desktop-streamed Trace. Compact-hidden — call via run_script (genesys.actionProfiler) or batch_execute. Ops: setInsights, setGpuDetail, generateReport, startTrace, stopTrace, armTraceForGameStart. Returns artifact paths. Trace bodies are never returned.

Operations: `armTraceForGameStart`, `generateReport`, `setGpuDetail`, `setInsights`, `startTrace`, `stopTrace`

Dispatch via `run_script`:

```js
genesys.actionProfiler({ action: 'armTraceForGameStart', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_profiler", args: { action: "armTraceForGameStart", ... } }
```

### `action_store`

Action Store · kind: `action`

Create and manage the game's store items on the creator's behalf (the editor holds the Studio login; no token is needed). Compact-hidden — call via run_script (genesys.actionStore) or batch_execute. Requires `action`. Ops: linkGame (registers the project as a game and writes gameId into <project>.genesys-project, exactly as opening Store Manager does; returns the existing id when already linked; no approval; result gameCreated is true when it created the game), createItem (name, description, coins or free, consumable, optional https imageUrl; new items are drafts — only the creator sees them in the editor), updateItem (sku plus any of name, description, coins / free, imageUrl or null), publish (players can buy), takeDown (back to draft), deleteItem (destructive; owners keep it), setImage (sku + filePath: a PNG, JPEG or WebP anywhere on this computer or @project/..., uploaded to the game's assets). Every op except linkGame returns the item's sku; applied writes link the game first when the project has none (gameCreated: true).

Operations: `createItem`, `deleteItem` *(destructive)*, `linkGame`, `publish`, `setImage`, `takeDown`, `updateItem`

Dispatch via `run_script`:

```js
genesys.actionStore({ action: 'createItem', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "action_store", args: { action: "createItem", ... } }
```

### `query_asset`

Query Asset · kind: `query`

Preferred MCP tool for listing and inspecting project assets and asset-pack assets. Requires `operation`. `find` does not index engine `@engine/...` assets; use `getDetails` to resolve/existence-check an `@engine/...` path against the installed `@gnsx/genesys.js` package. Operations: find, getDetails, getAssetPackInfo, getReferences (project-wide reverse references via the editor Find Asset References analyser). Use find with assetType scene for scene files; project results use project-relative forward-slash paths.

Operations: `find`, `getDetails`, `getAssetPackInfo`, `getReferences`

Dispatch via `run_script`:

```js
genesys.queryAsset({ operation: 'find', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_asset", args: { operation: "find", ... } }
```

### `query_diagnostics`

Query Diagnostics · kind: `query`

Read project and editor diagnostics. Requires `operation`. Operations: getBuildErrors, getConsole.

Operations: `getBuildErrors`, `getConsole`

Dispatch via `run_script`:

```js
genesys.queryDiagnostics({ operation: 'getBuildErrors', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_diagnostics", args: { operation: "getBuildErrors", ... } }
```

### `query_navmesh`

Query NavMesh · kind: `query`

Read NavMesh availability, baked mesh presence, debug overlay state, and generation settings from the live editor. Requires `operation`. Operations: getInfo, getSettings. Hidden in compact surface — call via run_script / batch_execute / search_tools.

Operations: `getInfo`, `getSettings`

Dispatch via `run_script`:

```js
genesys.queryNavmesh({ operation: 'getInfo', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_navmesh", args: { operation: "getInfo", ... } }
```

### `query_play`

Query Play · kind: `query`

Read the running game world during Play (query_node cannot: the editor scene is unloaded). Read-only. Compact-hidden — call via run_script (genesys.queryPlay) or batch_execute. Fails with play_not_active outside Play. Ops: getPlayerPawns (class, world position and rotation, grounded and linearVelocity when the movement node has them), getNodeTransform (nodeId or exact name; world position, rotation, scale), raycast (origin, direction, maxDistance default 100, max 1000; physics hit point, normal, distance and node, or hit null). Rotations are Euler XYZ radians.

Operations: `getPlayerPawns`, `getNodeTransform`, `raycast`

Dispatch via `run_script`:

```js
genesys.queryPlay({ operation: 'getPlayerPawns', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_play", args: { operation: "getPlayerPawns", ... } }
```

### `query_polybuilder`

Query Poly Builder · kind: `query`

Read Poly Builder pieces: world bounds, pivot, localBounds, engineNodeId, and a stair/ramp frame (highEnd.worldCenter, lowEnd). Topology faces include worldCenter and worldNormal. Place, align, and verify the scene from this data, query_node on engineNodeId, and query_editor: state is verified by query. Use captureScreenshot only to judge the look, after framing. Requires `operation` getDocument. Compact-hidden — call via run_script / batch_execute. Read the genesys-polybuilder skill before editing.

Operations: `getDocument`

Dispatch via `run_script`:

```js
genesys.queryPolybuilder({ operation: 'getDocument', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_polybuilder", args: { operation: "getDocument", ... } }
```

### `query_profiler`

Query Profiler · kind: `query`

Read independent Insights and Trace state. Compact-hidden — call via run_script (genesys.queryProfiler) or batch_execute. Ops: status, readReport (compact optimization report), readTraceManifest (trace metadata and top scopes), listArtifacts (names, sizes, and sidecar status). Never returns the Chrome trace JSON.

Operations: `status`, `readReport`, `readTraceManifest`, `listArtifacts`

Dispatch via `run_script`:

```js
genesys.queryProfiler({ operation: 'status', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_profiler", args: { operation: "status", ... } }
```

### `query_store`

Query Store · kind: `query`

Read the game's in-game store (Sandbox Silicon items sold to players). Compact-hidden — call via run_script (genesys.queryStore) or batch_execute. Ops: getState (game id or null when not linked yet, whether src/store is installed, who the store API recognises, environment, payment mode), listItems (every item including drafts: sku, name, description, price, consumable, imageUrl, draft). Runs in the editor with the creator's Studio login; a project must be open.

Operations: `getState`, `listItems`

Dispatch via `run_script`:

```js
genesys.queryStore({ operation: 'getState', ... })
```

Dispatch via `batch_execute`:

```text
{ tool: "query_store", args: { operation: "getState", ... } }
```
