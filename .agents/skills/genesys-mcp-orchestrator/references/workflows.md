# Genesys MCP Workflows

Open this reference only when the task matches a recipe below. Follow the `genesys-mcp-orchestrator` gate, channel probe, readiness check, and result-reliability rules first.

Prefer `query_node` / `action_node` for scene and prefab document trees.

## Find / inspect / select nodes

```text
Read-only inspect/count (no getState):
→ run_script(readOnly) — see “Count by name(s)” / “Count descendants” below
→ or query_node(getDetails | find | getTree, …) directly

Before first mutation:
→ query_editor(getState)
→ query_node(getDetails, componentIds=[…])   // when ids are already known
→ query_node(find | getTree, query=<string>, limit=…)
→ query_node(getDetails | getEditableProperties, componentIds=[…])
→ action_node(select, componentIds=[…])   // optional
```

Current selection: `query_editor(operation="getSelection")` (canonical; `query_node` also accepts `getSelection`).

- Known ids (from `@scene/Name [nodeUuid=…]`, selection, or a prior find): call `getDetails(componentIds=[…])` first — skip name `find`.
- One name substring: `find` with `query: '<string>'` (plain string only — never `{ name: [...] }`).
- Several exact names or subtree count: one `getTree(limit)` then filter/walk in script — never call both `find` and `getTree` for the same question.
- Prefer `find` / bounded `getTree` for discovery; reserve `getDetails` for chosen ids.
- `find` / `getTree` return a flat `nodes[]` with `parentId` and direct `childIds`. A `query` filter matches nodes only — it does not expand a subtree.
- Trust `childIds` on the first find hit; do not re-probe with `getTree` for the same name.
- Use `getEditableProperties` only before `action_node.setProperties` — never alongside bare `getDetails` on the same node.
- Compact summary: `query_node(getDocument)` or `genesysmcp://scene/summary`.

### Tree shape

- `query` is a plain string: a case-insensitive substring on name, className, id, or prefabPath. An object or array (`query: { name: ['A', 'B'] }`) fails Zod with `expected string, received object`, often surfacing as `script_threw`. Pass `query: 'A'`, or one `getTree(limit ≤ 500)` + `names.includes(n.name)` in script.
- `getTree` returns at most `limit` nodes (default 200, max 500); `find` defaults to 50. Both report `matchedNodes` and `truncated`. When `truncated` is true, a script filtering `nodes[]` misses nodes: narrow `query` (a class name such as `"DamageObjectActor"` matches) instead.
- Subtree size: walk `childIds` in one `run_script(readOnly)`, or use `childIds.length` when depth is known shallow. Do not chain exploratory `getDetails` after a `find` that already returned `childIds`.
- `getDetails` returns `components[]`; `transform.position` is a string such as `"(21.2, 14, 51.1)"`, not `properties.position`.

### Count descendants (attached roots)

One `run_script(readOnly)` — do not glob scene files or call both `find` and `getTree`.

```js
const rootIds = ['uuid-a', 'uuid-b']; // from [nodeUuid=…] markers or selection
const { nodes } = await genesys.queryNode({ operation: 'getTree', limit: 500 });
const byId = new Map(nodes.map((n) => [n.id, n]));
function countSubtree(id) {
  const node = byId.get(id);
  if (!node) return 0;
  return 1 + (node.childIds ?? []).reduce((sum, childId) => sum + countSubtree(childId), 0);
}
const perRoot = Object.fromEntries(rootIds.map((id) => [id, countSubtree(id)]));
return { perRoot, total: Object.values(perRoot).reduce((a, b) => a + b, 0) };
```

### Count by name(s)

One `run_script(readOnly)` — no `getState`, no `find`+`getTree` chain. `query` must be a string if you use `find` (e.g. `query: 'CircleBox'`) — not `{ name: [...] }`.

```js
const names = ['CircleBox_12', 'CircleBox_13'];
const wanted = new Set(names.map((n) => n.toLowerCase()));

const { nodes } = await genesys.queryNode({ operation: 'getTree', limit: 500 });
const byId = new Map(nodes.map((n) => [n.id, n]));

function countSubtree(id) {
  const node = byId.get(id);
  if (!node) return 0;
  return 1 + (node.childIds ?? []).reduce((sum, childId) => sum + countSubtree(childId), 0);
}

const roots = nodes.filter((n) => wanted.has(String(n.name ?? '').toLowerCase()));
const perName = Object.fromEntries(roots.map((n) => [n.name, countSubtree(n.id)]));

return {
  requested: names,
  found: roots.map((n) => n.name),
  perName,
  total: Object.values(perName).reduce((a, b) => a + b, 0),
};
```

## Bulk property / select / delete

One `run_script(apply, groupUndo=true)` — do not pre-query through the model.

```text
run_script(mode="apply", groupUndo=true, approval={ summary, operations: [...] }, code=...)
  → genesys.queryEditor({ operation: 'getState' })
  → genesys.queryNode({ operation: 'find', query: '<term>' })
  → genesys.queryNode({ operation: 'getEditableProperties', componentIds: [...] })
  → genesys.actionNode({ action: 'setProperties' | 'select' | 'delete', … })
  → genesys.actionScene({ action: 'save' })
  → return { matched, changed, saved }
```

Destructive deletes: prefer `dryRun` first, then apply with an explicit `approval.summary`. Prefab document roots and placed-prefab children are blocked from delete.

```js
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const { nodes } = await genesys.queryNode({ operation: 'find', query: 'Sphere', limit: 50 });
if (!nodes?.length) return { updated: 0, saved: false };
const ids = nodes.map((n) => n.id);
const editable = await genesys.queryNode({
  operation: 'getEditableProperties',
  componentIds: ids,
});
// Use property paths from `editable` — do not invent paths.
for (const id of ids) {
  await genesys.actionNode({
    action: 'setProperties',
    componentId: id,
    properties: { /* paths from getEditableProperties */ },
  });
}
await genesys.actionScene({ action: 'save' });
return { updated: ids.length, saved: true };
```

Trust the first `find` match set; widen the query only for criteria the user named that it did not cover.

## Add nodes (roots and children)

- Single world root: `query_editor(getState)` → `action_node(add, className="ENGINE.MeshNode")` (omit/`null` `parentComponentId`) → optional `setProperties` → `action_scene(save)`.
- Child under a parent: `action_node(add, className=…, parentComponentId=<parentUuid>)`.
- Computed / discovered placement: one `run_script(apply)` loop of `actionNode({ action: 'add', className, … })` then `setProperties` / save; return `{ created, saved, counts }` only.
- Already-known fixed list: `batch_execute` with N `action_node.add` ops (or `foreach`).

Confirm `className` with `query_editor(getRegisteredClasses, filter=…)` when unsure. Prefer `*Node` names (`ENGINE.MeshNode`, `ENGINE.ModelMeshNode`, `ENGINE.DirectionalLightNode`, `GAME.MyNode`). Legacy `*Component` aliases may still resolve, but new edits should use `*Node`.

```js
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const created = [];
for (let i = 0; i < 10; i++) {
  const result = await genesys.actionNode({
    action: 'add',
    className: 'ENGINE.MeshNode',
    // parentComponentId omitted → world root
  });
  created.push(result);
}
await genesys.actionScene({ action: 'save' });
return { created: created.length, saved: true };
```

Richer placement (transforms, reparent, bulk models) that is not covered by `action_node` ops goes through `run_script` / `batch_execute` using the same `actionNode` / property paths.

## Assemble nodes then merge to Model GLB

Use when you need a static Model asset (not a prefab) for runtime model URLs — e.g. a watchtower built from mesh nodes:

1. Create and parent nodes with `action_node(add, …)`.
2. `action_asset(mergeMeshes, …)` — compact-hidden: call via `run_script` / `batch_execute` directly (do not `describe_tool` first for known hidden tools). Keeps originals and writes a multi-mesh `.glb`. Pass `mergeGeometry: true` to weld into a single mesh (default preserves hierarchy). Consult `genesysmcp://api/typescript` or [compact-hidden-tools.md](compact-hidden-tools.md) if you need required id fields.
3. Optionally place the baked model later by adding a `ModelMeshNode` and setting its model property via `setProperties`.

Prefer prefabs when the assembly must stay editable as a hierarchy.

## Engine demo models

`query_asset(find)` does not index `@engine/...` (use `getDetails` only to check a known `@engine/...` path). Discover files only under `node_modules/@gnsx/genesys.js/assets/models/demo/...` (exact subtree — never recursive `node_modules` / `*tree*` searches), then place with `action_node.add` + `setProperties` (or a `run_script` loop):

```text
query_editor(getState)
→ discover demo GLB paths in the demo subtree only
→ action_node(add, className="ENGINE.ModelMeshNode") + setProperties(modelUrl / model path from getEditableProperties)
→ action_scene(save)
→ return { created, counts }
```

On Windows, bound discovery with `cmd /c dir /b node_modules\\@gnsx\\genesys.js\\assets\\models\\demo\\<subfolder>\\*.glb` — not `/s /b` across all of `node_modules`.

## Node property edit

Per-instance materials, colours, lights, enabled state — MCP, not `beginPlay` hacks:

```text
query_editor(getState)
→ query_editor(getSelection) | query_node(find)
→ query_node(getEditableProperties, componentIds=[…])
→ action_node(setProperties, componentId, properties={ material: "@project/assets/materials/Foo.material.json" })
→ action_scene(save)
→ query_node(getDetails, componentIds=[…])   // re-query: the path is set
```

On `MeshNode`, the editable property is `material`; on `ModelMeshNode` it is `modelMaterial` (one override) or `modelMaterials` (per slot). Confirm with `getEditableProperties`. The property is typed `string | THREE.Material`: a string is a `.material.json` asset path, which saves as a path and always persists. Hidden asset/diagnostics tools: dispatch via `run_script` / `batch_execute` — see [compact-hidden-tools.md](compact-hidden-tools.md).

Reuse first: an engine or project material file (`@engine/assets/materials/M_Floor.material.json`, `query_asset(find, assetType="material")`). Make a new one only for a new look (below). Colour properties, fog included, take `{ r, g, b }` or a hex string and persist (`genesys-lighting`).

### Material with a new colour

Set a material **path**, never an inline material or colour object (the object reads back fine and does not persist). One `run_script(apply)`:

Source: Composed — MCP shapes checked against the Sandbox Studio 18.1 MCP registry (dev build); syntax-checked (`action_asset.createMaterial` returns `assetPath`)
```js
const made = await genesys.actionAsset({
  action: 'createMaterial',
  materialClassName: 'ENGINE.MeshStandardNodeMaterialAsset',
  name: 'M_Ground',
  parentPath: 'assets/materials',
});
return { assetPath: made.assetPath };
```

List material classes with `query_editor(getNodeMaterialClasses)`. MCP has no op for a material file's fields, so edit the new file on disk (a file you created this session; format: `M_Floor.material.json`): `"color": { "$bc": "c", "_": [0.32, 0.45, 0.18] }` (linear 0–1), `"roughness": 0.8`, `"mapPath": "@project/assets/textures/ground.png"`. Then, in a second `run_script(apply)`: `setProperties({ material: '<assetPath>' })` on each target → `actionScene({ action: 'save' })` → `getDetails` to confirm. Emissive glow on standard materials: `genesys-lighting`.

## Play-test loop

Play is slow and costly. Diagnose in edit mode, then confirm once. Do not use Play to explore.

1. Answer hypotheses with queries (`query_node`, `query_editor`) before entering Play. For a spawn problem, run `query_node(operation="checkSpawnPoints")` first. Estimate heights with `checkSpawnPoints` or `raycast`, not screenshot pixels.
2. Make all code and scene edits, enter Play once, take every capture you need, exit once. Run `pnpm build` and `pnpm lint` once at the end, not between iterations.
3. Captures: start with `includeImage: false`; when you need the image, set `maxEdge` to 800 or less. Captures land in `.editor/captures/<day>/` by default (not project assets). Pass `saveLocation: 'none'` to skip the file, `'assets'` only when the user asks to keep the image in the game.
4. `query_node` returns `play_mode_active` during Play. Read the running world with `query_play` (compact-hidden: `genesys.queryPlay` in `run_script`, or `batch_execute`): `getPlayerPawns`, `getNodeTransform` (`{ nodeId | name }`), `raycast` (`{ origin, direction, maxDistance }`).

```text
query_node(checkSpawnPoints)                       edit mode: spawn problem? run this first
query_node(getDetails | find, …)                   edit mode: state is verified by query
action_editor(enterPlayMode)                       once; it saves the scene and rebuilds the project
action_editor(captureScreenshot, includeImage:false, saveLocation:'none')  metrics only
action_editor(captureScreenshot, maxEdge:800)                              image only when needed
run_script → genesys.queryPlay({ operation: "getPlayerPawns" })             play-world state
action_editor(exitPlayMode)                        once
pnpm build ; pnpm lint                             once, at the end
```

```js
const pawns = await genesys.queryPlay({ operation: 'getPlayerPawns' });  // class, world position and rotation, grounded, velocity
const node  = await genesys.queryPlay({ operation: 'getNodeTransform', name: 'Checkpoint_1' }); // or nodeId
const hit   = await genesys.queryPlay({ operation: 'raycast', origin: [x, 10, z], direction: [0, -1, 0], maxDistance: 20 });
return { pawns, node, hit };
```

## Register a code class

```text
edit TypeScript (@GameClass / @ENGINE.GameClass)
→ pnpm lint
→ action_build(action="buildProject")   // direct tool — separate from scene mutations
→ query_editor(getRegisteredClasses, filter="YourClass")
→ action_node(add, className="GAME.YourClass")
→ action_scene(save)
```

- Use this only for a new or renamed class. Do not run it before `enterPlayMode`: Play rebuilds on enter.
- `run_script(readOnly)` cannot call apply actions such as `actionBuild`.
- Empty `classes: []` with `ok: true` means not loaded yet — rebuild and query again.
- `buildLightmap` needs `scenePath`.
- Bundle proof (`.dist/game.js` contains the GameMode class) is owned by `genesys-game-boot`.

## Build, play, console, exit

`enterPlayMode` saves the scene and rebuilds the project, so a code change needs no `buildProject` first. The build order itself is owned by `genesys-game-boot`.

1. Only after adding or renaming a game class (a new GameMode): direct call `action_build(action="buildProject")`, wait for the result, then the bundle grep, `getRegisteredClasses`, and `query_diagnostics(operation="getBuildErrors")` per `genesys-game-boot`. Never in the same message as `enterPlayMode`.
2. One `run_script(mode="apply", approval={ summary: "Play the build, read the console, exit", operations: ["action_editor.enterPlayMode", "action_editor.exitPlayMode"] }, timeoutMs=120000)`. Smoke-test runs add the smoke flag step from `genesys-verification` before `enterPlayMode`.

Source: Composed — MCP shapes checked against the Sandbox Studio 18.1 MCP registry (dev build); syntax-checked (`getPlayModeState` → `{ isActive, isStarting }`; `getConsole` → `{ errors, warnings, resultIsAuthoritative }`)
```js
const before = await genesys.queryEditor({ operation: 'getPlayModeState' });
if (before.isActive || before.isStarting) return { skipped: 'Play already running (not started by this agent)' };
await genesys.actionEditor({ action: 'enterPlayMode' });
await new Promise((resolve) => setTimeout(resolve, 8000)); // let the game run; smoke runs need their own length
const consoleState = await genesys.queryDiagnostics({ operation: 'getConsole' });
const after = await genesys.queryEditor({ operation: 'getPlayModeState' });
if (after.isActive) await genesys.actionEditor({ action: 'exitPlayMode' });
return {
  authoritative: consoleState.resultIsAuthoritative !== false,
  errors: (consoleState.errors ?? []).slice(0, 40),
  warnings: (consoleState.warnings ?? []).length,
};
```

`run_script` runs in a worker with `setTimeout` but no `window` or `localStorage`; it reaches the editor only through `genesys.*`. `getConsole` returns errors and warnings only. `resultIsAuthoritative: false` means unknown, not clean.

## Screenshot

`action_editor` is a first-class compact tool — call directly; no `describe_tool` first.

Inline image (preferred in `auto` mode):

```text
action_editor({ action: "captureScreenshot", includeImage: true })
```

`includeImage` defaults to `true`. Captures are written by default to `@project/.editor/captures/<YYYY-MM-DD>/` (hidden, git-ignored, never shipped), not to project assets, so debug captures need no flag. Pass `saveLocation: 'none'` to skip the file write (`screenshotPath` is null; the image is still returned inline). Pass `saveLocation: 'assets'` only when the user asks to keep the image in the game's assets (`assets/screenshots/`). Legacy `saveToProject: false` still means `none`, but prefer `saveLocation`. Response: JSON metadata + one inline `image` block per surface (renders in Cursor chat). Explicit `genesys_request_approval` is only for prompt-mode pre-approval/token reuse — not required in `auto`.

`target` defaults to `"auto"`. While Play is running, that returns the game. `target: "editor"` is the edit-mode viewport and is blocked during Play. `surface` is `primary` (default), `client-N`, or `all`. `all` captures one surface after another (at most four; extra multiplayer surfaces come without metrics) and the result lists every live surface. Do not poll; capture when you need to look.

Metadata only: `includeImage: false`, then Read tool on `screenshot.screenshotPath`. Never emit markdown image links to absolute local disk paths.

State versus look: which nodes exist, where they sit, what is selected, and whether an edit landed are verified with `query_node` (`find`, `getTree`, `getDetails`) and `query_editor` (`getState`, `getSelection`, `getPlayModeState`); an image has no ids or bounds. How the result looks is verified with a framed capture plus `metrics`. Use it for a picture the user asked for, or a look check that `genesys-verification` requires.

Framed look check (edit mode):

```text
action_editor({ action: "frameNodes", nodeIds: [nodeA, nodeB], view: "iso", padding: 0.15 })
action_editor({ action: "captureScreenshot", focusNodeIds: [nodeA], views: ["hero", "overview"], maxEdge: 1280 })
```

- `frameNodes` frames a node with no mesh around its position, a PlayerStart around its capsule. A capture does not prove a node exists; query for that.
- `getState.viewportVisible: false` predicts `editor_hidden`: check it before a capture and ask the user to restore the Sandbox Studio window.
- `views` (<=4): `current`, `overview` (high three-quarter), `hero` (low three-quarter), `ground` (eye height). Bounds come from `focusNodeIds`, else the whole scene; sky domes and oceans are skipped.
- `camera: { position: [x,y,z], target: [x,y,z], fov? }` or `cameraNodeId` renders one frame from that pose without moving the editor camera. Use the scene's camera node id to see what players will see.
- `maxEdge` defaults to 1280 (aspect kept). `imageQuality` defaults to 0.8.
- Each record has `metrics`: read `warnings[].code` first (`flat_frame`, `subject_off_screen`, `subject_too_small`, `exposure_low`, `exposure_high`, `blown_highlights`, `crushed_blacks`, `single_hue`, `low_colourfulness`, `low_detail`, `sky_dominant`), then `nodeCoverage`.
- Play mode: `target: "play"` (or `auto` while playing) captures the running game. `camera`, `cameraNodeId` and `views` are edit-mode only. On `play_capture_unavailable`, capture in edit mode with `cameraNodeId`.
- Metrics-only pass: `includeImage: false` (cheaper); look at the image when the change is look-defining or a warning fires.

Motion, time and cost (edit mode):

```text
action_editor({ action: "captureScreenshot", focusNodeIds: [nodeA], frames: 4, intervalMs: 250 })   contact sheet + motion
action_editor({ action: "captureScreenshot", views: ["hero", "overview"], freezeTime: true })       same instant in every view
action_editor({ action: "captureScreenshot", timeSeconds: 3, includeRenderStats: true })            step 3 s, then capture with renderStats
query_editor({ operation: "getRenderStats" })                                                        draw calls, triangles, budget warnings
action_editor({ action: "enterPlayMode", seed: 1234 })                                               seeded world.random
```

- `frames > 1` cannot take `views` or `freezeTime`; during play it fails with `motion_capture_unavailable` (exit play, capture with target `editor`). Read `motion.value` and the `no_motion` warning.
- `timeSeconds` steps the editor world forward and does not rewind it. `freezeTime` and `timeSeconds` are edit-mode only.
- `getRenderStats` target `auto` reads the running game during play. `play_stats_unavailable`: call it with target `editor`. Act on `render_budget_high` (desktop 1500 draws or 3 M triangles; phone 300 or 500 k).

`run_script` / `batch_execute`: metadata only — image bytes stripped. Use the direct call for inline images.

Optional: `dryRun: true` to inspect the planned save path without writing.

## Outdoor world (recipe)

Build an outdoor scene from a declarative recipe, then audit and capture it. See [genesys-world-building](../../genesys-world-building/SKILL.md) for the recipe fields.

```text
action_scene({ action: "listWorldRecipes" })                                                   built-in and registered recipe ids
action_scene({ action: "applyWorld", world: "<recipe id>", dryRun: true })                    resolved recipe + validation warnings
action_scene({ action: "applyWorld", world: { extends: "<recipe id>", landform: { shape: "island" }, water: { role: "ocean" } }, seed: 7 })
action_scene({ action: "auditWorld" })                                                         errors/warnings with fixes
action_editor({ action: "captureScreenshot", views: ["hero", "overview"] })                    then check the image
```

- `world` is a recipe id or an object (`extends`, `landform`, `water`, `style`, `vegetation`, `sky`, `camera`, `look`). `replace` is `world` (default; removes sky, lights, fog, a root mesh named exactly `Ground`, terrain, water, orbit camera), `environment` (only the sky, lights, fog and `Ground`) or `none`.
- Scene with gameplay props: `applyWorld` never moves them onto the new ground and MCP cannot sample terrain height. Follow [existing-scene.md](../../genesys-world-building/references/existing-scene.md) before applying.
- A blocked result starting `Invalid world:` comes back as `invalid_arguments`: fix the recipe from the message and dry-run again.
- `applyWorld` needs approval and is one undo step. `auditWorld` and `listWorldRecipes` are read-only and need none. Fix every audit error, rerun `auditWorld`, and only then capture.

## Node materials

After adding/updating a `@ENGINE.GameClass({ isNodeMaterialAsset: true, ... })` class:

1. Direct `action_build(buildProject)` (separate from scene edits).
2. `query_editor(getNodeMaterialClasses, filter=...)` — not `getRegisteredClasses`.
3. One `run_script(apply)` for `actionAsset(createMaterial)` + `actionNode(setProperties)` + `actionScene(save)`.

Full class pattern: [webgpu-tsl-node-material-assets/SKILL.md](../../webgpu-tsl-node-material-assets/SKILL.md).

## Inspect / assets / diagnostics

- Scene slice: `run_script(readOnly)` — filter `queryNode(find|getTree)` in-script; return a small summary only.
- Assets: `query_asset(find)` → `getDetails` (project/packs; `@engine/...` via `getDetails` only).
- After TS edits: `buildProject` → optional `getBusyState` after a long build → `query_diagnostics(getBuildErrors)` when authoritative. Unavailable diagnostics = unknown, not success.
- After a prefab or layout rebuild: wait for busy to clear (below) **before** `buildProject`.

### Wait for busy to clear

A prefab save, apply or resync, a bulk layout, a scene load and a large `batch_execute` each trigger a `Scene world reset`. Until it ends, `buildProject` and `enterPlayMode` wait for it, for up to 30 s, then return `editor_busy`. `getBusyState` returns `{ isBusy, reasons }`, for example `{ "isBusy": true, "reasons": ["Scene world reset is in progress."] }`. Poll it from one `run_script`, then send `buildProject` as its own call:

```js
let s = {};
for (let i = 0; i < 28; i++) {                          // ~42 s cap: the MCP client can give up at 60 s
  s = await genesys.queryEditor({ operation: 'getBusyState' });
  if (!s.isBusy) break;
  await new Promise(r => setTimeout(r, 1500));
}
return s;
```

Still busy after 90 s → stop and report the reasons (`genesys-verification` → *Budget*, stuck editor). Never loop `buildProject` on `editor_busy`.

## Prefabs

Decision table and gotchas: [genesys-prefabs](../../genesys-prefabs/SKILL.md). Compact-hidden: `genesys.actionPrefab` / `batch_execute` (`tool: "action_prefab"`). Inspect with `query_node` + `query_asset(find, assetType: "prefab")`.

### Extract a branch

```js
const componentId = 'branch-root-uuid'; // selected branch root, not a placed instance
const created = await genesys.actionPrefab({ action: 'createFromNode', componentId });
return { prefabPath: created.prefabPath, status: created.status };
```

### Place N instances then save the scene

```js
const prefabPath = '@project/assets/prefabs/Crate.prefab.json';
const placedIds = [];
for (let i = 0; i < 3; i += 1) {
  const placed = await genesys.actionPrefab({
    action: 'instantiate',
    prefabPath,
    transform: { position: { x: i * 2, y: 0, z: 0 } },
  });
  placedIds.push(...(placed.affectedComponentIds ?? []));
}
await genesys.actionScene({ action: 'save' });
return { prefabPath, placedIds, counts: { placed: placedIds.length } };
```

### Edit source in isolation

```js
const prefabPath = '@project/assets/prefabs/Crate.prefab.json';
await genesys.actionPrefab({ action: 'open', prefabPath });
const { nodes } = await genesys.queryNode({ operation: 'getTree', limit: 200 });
const root = nodes.find((n) => n.isWorldRoot);
if (root) {
  await genesys.actionNode({
    action: 'setProperties',
    componentId: root.id,
    properties: { /* editable paths from getEditableProperties */ },
  });
}
await genesys.actionPrefab({ action: 'save' });
await genesys.actionPrefab({ action: 'close' });
return { prefabPath, edited: Boolean(root) };
```

Do not call `action_scene.save` while `queryEditor(getState).documentType === 'prefab'`. After `open`/`close`, discard previous `componentId`s.

### Apply vs resync vs unlink

Need a **placed instance root** (`isPrefabInstance`), not Prefab Editor:

```js
const componentId = 'placed-root-uuid';
await genesys.actionPrefab({ action: 'apply', componentId, dryRun: true });
// apply — write instance edits into the .prefab.json asset
// resync — discard instance overrides (keeps uuid / world transform / display name / editableChildren)
// unlink — bake into ordinary nodes (nested instances kept)
return { componentId };
```

`createFromNode` / `apply` / `resync` / `unlink` are not undoable. Engine `@engine/...` prefabs: place is OK; apply and unlink are blocked.

## Poly Builder mesh

Custom blockout or a modeled mesh in the open scene. Each piece is its own node under a Poly Mesh group. `polyMeshNodeId` is the group. `engineNodeId` is the piece. A box is an editable mesh. Read the `genesys-polybuilder` skill for topology ids and footguns. Do not add a `PolyMeshNode` with `action_node` or write `authoringJson`. Place, align and check joins with `query_polybuilder` and `query_node` on `engineNodeId` (bounds, face `worldCenter`), not a screenshot. Capture only to judge the look. Terrain, islands and landscapes are not Poly Builder work: use [genesys-world-building](../../genesys-world-building/SKILL.md).

Compact-hidden: `query_polybuilder` / `action_polybuilder` via `run_script` (`genesys.queryPolybuilder` / `genesys.actionPolybuilder`) or `batch_execute`. Use `groupUndo: true` around a multi-step build.

```js
const placed = await genesys.actionPolybuilder({
  action: 'placeBox',
  name: 'Block',
  size: { x: 2, y: 2, z: 2 },
  position: { x: 0, y: 0, z: 0 },
});
return {
  pieceIds: placed.pieceIds,
  engineNodeId: placed.pieces[0].engineNodeId,
  polyMeshNodeId: placed.polyMeshNodeId,
  bounds: placed.pieces[0].bounds,
};
```

## Profile a play session

Compact-hidden `query_profiler` / `action_profiler`. Use Insights first. Record a Trace only when timeline detail is needed. Process the report summary or the trace manifest. Never paste the `.json` trace body. Full rules: [genesys-profiler/SKILL.md](../../genesys-profiler/SKILL.md).

**A. Insights report.** Turn collection on, enter play, wait for samples, then save the report. `generateReport` returns `path`, `issues`, `timing` (`topScopes`, and `topGpuScopes` when the capture timed the GPU), and a compact `memory` summary. The report viewer shows the full tables. `setGpuDetail` (`pass`, `stage`, or `draw`) saves GPU timing detail for the next Play; a session that is already running keeps its current detail. Do not call `readReport` in the same turn. `listArtifacts` lists saved reports and traces without returning trace bodies. Heap and VRAM growth use [memory-profiling](../../memory-profiling/SKILL.md) (`compare-heap-captures.mjs`, `compare-gpu-captures.mjs`), not this report.

Check `getPlayModeState` first, as in "Build, play, console, exit". Each poll waits 1 s; without the wait the loop finishes before the first sample. `generateReport` also returns `timing.samples` (frame count).

Source: Composed — MCP shapes checked against the Sandbox Studio 18.1 MCP registry (dev build); syntax-checked
```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await genesys.actionProfiler({ action: 'setInsights', enabled: true });
await genesys.actionEditor({ action: 'enterPlayMode' });
let samples = 0;
for (let i = 0; i < 20 && samples === 0; i++) {
  await sleep(1000);
  const status = await genesys.queryProfiler({ operation: 'status' });
  samples = status.live?.insights?.samples ?? 0; // field path: verify on first use
}
await sleep(5000); // gather a few seconds of play
const report = await genesys.actionProfiler({ action: 'generateReport' });
return { path: report.path, issue: report.issues?.[0]?.id ?? null, samples: report.timing?.samples ?? samples };
```

**B. Trace from the first frame.** Arm with a stop limit, then enter play. Arming does not start the file; recording starts before the first frame of the next Play. If a session is already running, `nextStep` says to exit and enter Play again. Let the game run for the window you want **before** `stopTrace`; calling it straight after `enterPlayMode` stops the trace at ~0 s. When the limit fires first, the trace is already closed: `stopTrace` (still in Play) or `readTraceManifest` returns the manifest (verify on first use which one carries `stopReason`).

Source: Composed — MCP shapes checked against the Sandbox Studio 18.1 MCP registry (dev build); syntax-checked
```js
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
await genesys.actionProfiler({ action: 'armTraceForGameStart', maxDurationMs: 10000, maxBytes: 256 * 1024 * 1024 });
await genesys.actionEditor({ action: 'enterPlayMode' });
await sleep(11000); // past the 10 s limit
const capture = await genesys.actionProfiler({ action: 'stopTrace' });
const listing = await genesys.queryProfiler({ operation: 'readTraceManifest' });
await genesys.actionProfiler({ action: 'armTraceForGameStart', armed: false });
return { path: capture.tracePath ?? listing.tracePath, stopReason: capture.manifest?.stopReason ?? listing.sidecar?.stopReason ?? null, topScope: capture.manifest?.topScopes?.[0]?.label ?? null };
```

**C. Trace while play is running.** Pass a stop limit so the file cannot grow without a bound, and let it run before stopping.

Source: Composed — MCP shapes checked against the Sandbox Studio 18.1 MCP registry (dev build); syntax-checked
```js
const started = await genesys.actionProfiler({ action: 'startTrace', maxDurationMs: 5000, thresholdMs: 0.25 });
await new Promise((resolve) => setTimeout(resolve, 5500));
const capture = await genesys.actionProfiler({ action: 'stopTrace' });
return { path: started.trace?.path ?? capture.tracePath, stopReason: capture.manifest?.stopReason };
```

Recipe B disarms itself; otherwise disarm with `armTraceForGameStart` and `armed: false` when the user only wanted one capture. Stop Insights with `setInsights` and `enabled: false` when collection should not continue. The saved report stays on disk.
