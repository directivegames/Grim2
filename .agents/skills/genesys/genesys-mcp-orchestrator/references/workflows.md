# Genesys MCP Workflows

Open this reference only when the task matches a recipe below. Follow the orchestrator skill gate, readiness probe, and result-reliability rules first.

Prefer `query_node` / `action_node` for scene and prefab document trees.

## Find / inspect / select nodes

```text
query_editor(getState)
→ query_node(find | getTree, query=…, limit=…)
→ query_node(getDetails | getEditableProperties, componentIds=[…])
→ action_node(select, componentIds=[…])   // optional
```

- Prefer `find` / bounded `getTree` for discovery; reserve `getDetails` for chosen ids.
- Use `getEditableProperties` only before `action_node.setProperties` — never alongside bare `getDetails` on the same node.
- Compact summary: `query_node(getDocument)` or `genesysmcp://scene/summary`.

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

- **Single world root:** `query_editor(getState)` → `action_node(add, className="ENGINE.MeshNode")` (omit/`null` `parentComponentId`) → optional `setProperties` → `action_scene(save)`.
- **Child under a parent:** `action_node(add, className=…, parentComponentId=<parentUuid>)`.
- **Computed / discovered placement:** one `run_script(apply)` loop of `actionNode({ action: 'add', className, … })` then `setProperties` / save; return `{ created, saved, counts }` only.
- **Already-known fixed list:** `batch_execute` with N `action_node.add` ops (or `foreach`).

Confirm `className` with `query_editor(getRegisteredClasses, filter=…)` when unsure. Prefer v14 names (`ENGINE.MeshNode`, `ENGINE.ModelMeshNode`, `ENGINE.DirectionalLightNode`, `GAME.MyNode`). Legacy `*Component` aliases may still resolve, but new edits should use `*Node`.

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

Use when you need a **static Model asset** (not a prefab) for runtime model URLs — e.g. a watchtower built from mesh nodes:

1. Create and parent nodes with `action_node(add, …)`.
2. `action_asset(mergeMeshes, …)` — compact-hidden: call via `run_script` / `batch_execute` directly (do **not** `describe_tool` first for known hidden tools). Keeps originals and writes a multi-mesh `.glb`. Pass `mergeGeometry: true` to weld into a single mesh (default preserves hierarchy). Consult `genesysmcp://api/typescript` or [compact-hidden-tools.md](compact-hidden-tools.md) if you need required id fields.
3. Optionally place the baked model later by adding a `ModelMeshNode` and setting its model property via `setProperties`.

Prefer prefabs when the assembly must stay editable as a hierarchy.

## Engine demo models

`query_asset(find)` does **not** index `@engine/...` (use `getDetails` only to check a known `@engine/...` path). Discover files only under `node_modules/@gnsx/genesys.js/assets/models/demo/...` (exact subtree — never recursive `node_modules` / `*tree*` searches), then place with `action_node.add` + `setProperties` (or a `run_script` loop):

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
→ query_node(getSelection | find)
→ query_node(getEditableProperties, componentIds=[…])
→ action_node(setProperties, componentId, properties={ material: "@project/assets/materials/Foo.material.json" })
→ action_scene(save)
```

On `MeshNode`, the editable property is typically `material` (confirm with `getEditableProperties`). Hidden asset/diagnostics tools: dispatch via `run_script` / `batch_execute` — see [compact-hidden-tools.md](compact-hidden-tools.md).

## Register a code class

```text
edit TypeScript (@GameClass / @ENGINE.GameClass)
→ pnpm lint
→ action_build(action="buildProject")   // direct tool — separate from scene mutations
→ query_editor(getRegisteredClasses, filter="YourClass")
→ action_node(add, className="GAME.YourClass")
→ action_scene(save)
```

- `run_script(readOnly)` cannot call apply actions such as `actionBuild`.
- Empty `classes: []` with `ok: true` means not loaded yet — rebuild and query again.
- `buildProject` ≠ game `pnpm build-project`. Also: `buildLightmap` (needs `scenePath`).

## Screenshot

`action_editor` is a first-class compact tool — call directly; no `describe_tool` first.

**Inline image (preferred in `auto` mode):**

```text
action_editor({ action: "captureScreenshot", includeImage: true })
```

`includeImage` defaults to `true`. Response: JSON metadata + inline `image` block (renders in Cursor chat). Explicit `genesys_request_approval` is only for prompt-mode pre-approval/token reuse — not required in `auto`.

**Metadata only:** `includeImage: false`, then Read tool on `screenshot.screenshotPath`. Never emit markdown image links to absolute local disk paths.

**`run_script` / `batch_execute`:** metadata only — image bytes stripped. Use the direct call for inline images.

Optional: `dryRun: true` to inspect the planned save path without writing.

## Node materials

After adding/updating a `@ENGINE.GameClass({ isNodeMaterialAsset: true, ... })` class:

1. Direct `action_build(buildProject)` (separate from scene edits).
2. `query_editor(getNodeMaterialClasses, filter=...)` — not `getRegisteredClasses`.
3. One `run_script(apply)` for `actionAsset(createMaterial)` + `actionNode(setProperties)` + `actionScene(save)`.

Full class pattern: [webgpu-tsl-node-material-assets/SKILL.md](../../webgpu-tsl-node-material-assets/SKILL.md).

## Inspect / assets / diagnostics

- **Scene slice:** `run_script(readOnly)` — filter `queryNode(find|getTree)` in-script; return a small summary only.
- **Assets:** `query_asset(find)` → `getDetails` (project/packs; `@engine/...` via `getDetails` only).
- **After TS edits:** `buildProject` → optional `getBusyState` after a long build → `query_diagnostics(getBuildErrors)` when authoritative. Unavailable diagnostics = unknown, not success.
