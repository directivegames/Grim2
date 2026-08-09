# Genesys MCP Workflows

Open this reference only when the task matches a recipe below. Follow the orchestrator skill gate, readiness probe, and result-reliability rules first.

## Bulk transform / rename / delete

One `run_script(apply, groupUndo=true)` — do not pre-query through the model.

```text
run_script(mode="apply", groupUndo=true, approval={ summary, operations: [...] }, code=...)
  → genesys.queryEditor({ operation: 'getState' })
  → genesys.queryScene({ operation: 'findActors', query: '<term>' })
  → genesys.queryActor({ operation: 'getTransform' | 'getBounds', actorIds: [...] })
  → genesys.actionActor(...)
  → genesys.actionScene({ action: 'save' })
  → return { matched, changed, saved }
```

Destructive deletes: prefer `dryRun` first, then apply with an explicit `approval.summary`.

Transform values from `getTransform` are strings like `"(0.4, 0.4, 0.4)"` — parse in-script:

```js
const factor = 0.5; // halve; use 2 to double
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const { actors } = await genesys.queryScene({ operation: 'findActors', query: 'Sphere' });
if (actors.length === 0) return { scaled: 0, saved: false };
const parseVec = (s) => String(s).replace(/[()]/g, '').split(',').map((n) => Number(n.trim()));
const { actors: details } = await genesys.queryActor({
  actorIds: actors.map((a) => a.id),
  operation: 'getTransform',
});
for (const d of details) {
  const [x, y, z] = parseVec(d.transform.scale);
  await genesys.actionActor({
    action: 'setTransform',
    actorId: d.id,
    scale: [x * factor, y * factor, z * factor],
  });
}
await genesys.actionScene({ action: 'save' });
return { scaled: details.length, factor, saved: true };
```

Trust the first `findActors` match set; widen the query only for criteria the user named that it did not cover.

## Single and bulk primitives

- **Single:** `query_editor(getState)` → find ground → `getTransform`/`getBounds` → `action_actor(create, primitiveType, position)` → `action_scene(save)`.
- **Computed / discovered placement:** one `run_script(apply)` loop of `actionActor({ action: 'create', primitiveType, … })` then save; return `{ created, saved, counts }` only.
- **Already-known fixed list:** `batch_execute` with N `action_actor.create(primitiveType=...)` ops — not `createMany` (`createMany` does not support `primitiveType`).

Basic `primitiveType` values: `cube`, `sphere`, `cone`, `cylinder`, `torus`, `capsule`. Do not fetch `genesysmcp://catalog/geometry-types` for those.

```js
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const { actors } = await genesys.queryScene({ operation: 'findActors', query: 'ground', limit: 5 });
const groundId = actors[0]?.id;
if (!groundId) throw new Error('No ground actor found');
const { transforms } = await genesys.queryActor({ actorIds: [groundId], operation: 'getTransform' });
const groundY = transforms[0]?.position?.[1] ?? 0;
const primitiveTypes = ['cube', 'sphere', 'cone', 'cylinder', 'torus', 'capsule'];
let created = 0;
for (let i = 0; i < 100; i++) {
  await genesys.actionActor({
    action: 'create',
    primitiveType: primitiveTypes[i % primitiveTypes.length],
    position: [(i % 10) * 2, groundY + 1, Math.floor(i / 10) * 2],
    name: `Primitive ${i + 1}`,
  });
  created++;
}
await genesys.actionScene({ action: 'save' });
return { created, saved: true, counts: { actors: created } };
```

## Assemble primitives then merge to Model GLB

Use when you need a **static Model asset** (not a prefab) for runtime `placeGltfs` / `modelUrl` — e.g. a watchtower or car built from primitives:

1. Create and reparent primitives with `action_actor` / `action_component`.
2. `action_asset(mergeMeshes, actorIds=[rootId], destinationPath='@project/assets/models', fileName='watchtower_merged')` — keeps originals; writes a hierarchy-preserving multi-mesh `.glb` (folders/actors as nested nodes). Pass `mergeGeometry: true` to weld into a single mesh instead.
3. Optionally place the baked model later: `action_actor(create, assetPath='@project/assets/models/watchtower_merged.glb')`.

Prefer prefabs when the assembly must stay editable as a hierarchy. `mergeMeshes` is compact-hidden — call via `run_script` / `batch_execute` / `search_tools`.

```js
const merge = await genesys.actionAsset({
  action: 'mergeMeshes',
  actorIds: [rootActorId],
  destinationPath: '@project/assets/models',
  fileName: 'watchtower_merged',
  // mergeGeometry: true, // optional: weld into one mesh
});
return { assetPath: merge.assetPath, meshCount: merge.meshCount, warnings: merge.warnings };
```

## Engine demo models

`query_asset(find)` does **not** index `@engine/...` (use `getDetails` only to check a known `@engine/...` path). Discover files only under `node_modules/@gnsx/genesys.js/assets/models/demo/...` (exact subtree — never recursive `node_modules` / `*tree*` searches), then bulk-place:

```text
query_editor(getState)
→ find ground + getBounds for top Y
→ discover demo GLB paths in the demo subtree only
→ action_actor(createMany, dryRun=true, payload={ version: 1, templates, actors })
→ action_actor(createMany, payload={...})   // auto-saves on success
→ return { created, counts }
```

For a single model, `action_actor(create, assetPath=...)` still works. Do **not** fall back to dozens of sequential `create` calls when `createMany` can place the same models.

On Windows, bound discovery with `cmd /c dir /b node_modules\\@gnsx\\genesys.js\\assets\\models\\demo\\<subfolder>\\*.glb` — not `/s /b` across all of `node_modules`.

## createMany (templated models / components)

For dozens of similar model/material/component instances — not primitives:

```text
query_editor(getState)
→ action_actor(createMany, dryRun=true, payload={ version: 1, templates, actors })
→ action_actor(createMany, payload={...})   // auto-saves; no redundant action_scene(save)
```

**Model placement (`assetPath`)** — same semantics as single `create(assetPath)` / `placeGltfs`:

```json
{
  "version": 1,
  "templates": {
    "tree": { "assetPath": "@engine/assets/models/demo/trees/pine.glb" }
  },
  "actors": [
    { "key": "tree_1", "template": "tree", "name": "Tree 1", "position": [0, 0, 0] },
    { "key": "tree_2", "template": "tree", "name": "Tree 2", "position": [2, 0, 1] }
  ]
}
```

**Component template placement** — when you need non-model components or property overrides:

```json
{
  "version": 1,
  "templates": {
    "tree": {
      "className": "ENGINE.Actor",
      "components": [{
        "key": "model",
        "className": "ENGINE.ModelMeshComponent",
        "properties": {
          "modelUrl": "@project/assets/models/tree.glb",
          "castShadow": true,
          "receiveShadow": true
        }
      }]
    }
  },
  "actors": [{ "key": "tree_1", "template": "tree", "position": [0, 0, 0] }]
}
```

Rules:

- `assetPath` and `components` are **mutually exclusive** on the same template/actor.
- Omitted or bare `Actor` class names normalise to `ENGINE.Actor`.
- On validation failure, fix the payload and retry once — do not fall back to N× `create`.
- Report actual `counts` / `warnings` from the result; never hard-code requested counts.
- For repeated shared geometry, prefer **one** `ENGINE.InstancedModelMeshComponent` with many instance transforms — not one instanced component per actor.

## Component property edit

Per-instance materials, colours, lights, enabled state — MCP, not `BeginPlay` hacks:

```text
query_editor(getState)
→ query_scene(getSelection | findActors)
→ action_component(setProperties, actorId, properties={ material: "@project/assets/materials/Foo.material.json" })
  — omit componentId for root; MeshComponent property is `material`, not `materialPath`
→ action_scene(save)
```

After `action_actor(create)`, use `rootComponentId` from the result for root property sets. For batch create + non-root props: `componentIdFrom: "createOp.affectedComponentIds.0"`.

Hidden tool: dispatch via `run_script` / `batch_execute` — see [compact-hidden-tools.md](compact-hidden-tools.md).

## Register a code class

```text
edit TypeScript (@GameClass / @ENGINE.GameClass)
→ pnpm lint
→ action_build(action="buildProject")   // direct tool — separate from scene mutations
→ query_editor(getRegisteredClasses, filter="YourClass")
→ action_actor(create, className="GAME.YourClass", position=...)
→ action_scene(save)
```

- `run_script(readOnly)` cannot call apply actions such as `actionBuild`.
- Empty `classes: []` with `ok: true` means not loaded yet — rebuild and query again.
- `buildProject` ≠ game `pnpm build-project`. Also: `validatePrefabs`, `buildLightmap` (needs `scenePath`).

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
3. One `run_script(apply)` for `actionAsset(createMaterial)` + `actionComponent(setProperties)` + `actionScene(save)`.

Full class pattern: [webgpu-tsl-node-material-assets/SKILL.md](../../webgpu-tsl-node-material-assets/SKILL.md).

## Inspect / assets / diagnostics

- **Scene slice:** `run_script(readOnly)` — filter `getGraph` / `findActors` in-script; return a small summary only.
- **Assets:** `query_asset(find)` → `getDetails` (project/packs; `@engine/...` via `getDetails` only).
- **After TS edits:** `buildProject` → optional `getBusyState` after a long build → `query_diagnostics(getBuildErrors)` when authoritative. Unavailable diagnostics = unknown, not success.
