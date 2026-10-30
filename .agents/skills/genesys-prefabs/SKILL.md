---
name: genesys-prefabs
description: "Prefabs: when to use them vs scene nodes, classes, or models; Prefab Editor isolation; place, apply, resync, unlink via MCP; spawning a prefab from game code. Use for repeated assemblies, reusable props, templates, .prefab.json, Save Branch as Prefab, spawn a prefab at runtime. Not for rule-based bulk placement (use `genesys-level-authoring`) or networked spawns (use `genesys-multiplayer`)."
metadata:
  tokens: 2730
---

# Genesys Prefabs

A Prefab is a reusable authored hierarchy saved as `.prefab.json` under `assets/` (commonly `assets/prefabs/`). Choosing one is a **routing decision**, not "always make a prefab". Create, place, and isolate through MCP. Never hand-edit `.prefab.json`. The one tool that writes prefab files is the layout generator (`genesys-level-authoring` → *Bulk placement*). Its prefabs are edited through their layout or the Prefab Editor, never by hand.

JS recipes for extract, place, isolate, and apply vs resync vs unlink live in `genesys-mcp-orchestrator` (`references/workflows.md`, Prefabs section). Open that file before scripting.

## Use another skill when
- Choosing how to build the play space as a whole → `genesys-level-authoring`
- Placing dozens or hundreds of rule-based props (streets, fence runs, rings) → `genesys-level-authoring` (*Bulk placement*: layout file → generated prefab)
- MCP availability gate, `run_script` / `batch_execute`, approvals → `genesys-mcp-orchestrator`
- Spawning anything else from code, `spawn` by class, `isRoot` → `genesys-engine` (`references/scene-node.md`); the prefab form is in *Spawn from code* below
- Spawning a prefab in an online game (replicated to every client) → `genesys-multiplayer` (`MultiplayerSpawner.spawnPrefab`)
- Behaviour and defaults shared by every instance → a `GAME.*` class, `genesys-engine`
- Moving a prefab and its classes into an asset pack → `asset-pack-authoring`
- Enemies spawned in waves → `genesys-creatures`; pickups and doors → `genesys-interactions`

## Decide

Use a Prefab when the same authored hierarchy will be placed more than once, updated in one place, spawned at runtime, or reused across scenes or packs:

- Repeated props, pickups, enemies, doors, spawners, room kits.
- Shared look and structure that should stay in sync (`apply` / `resync`).
- Runtime spawn from game code (*Spawn from code*). Runtime spawn does not go through MCP.
- Nested composition (a room prefab that contains furniture prefabs).

Use something else when:

| Situation | Use instead |
| --- | --- |
| One-off scenery | Duplicate or place nodes in the scene |
| Behaviour or defaults that belong on a class | A `GAME.*` class (`@ENGINE.GameClass()`, constructor / `initialize` defaults), not duplicated JSON |
| A static mesh is enough | `action_asset.mergeMeshes`, then a `ModelMeshNode`. A Prefab keeps an **editable hierarchy**; a Model does not. |
| A single MeshNode or light with no children | Place the node |
| Every instance would immediately `unlink` for per-instance uniqueness | Keep scene nodes |

In prefab and serialized data, reference engine classes as `ENGINE.<Class>` and game classes as `GAME.<Class>`.

## Keep it cheap

- Prefer **one Prefab edit + N instances** over reconstructing the same subtree with `action_node(action="add")`.
- Discover with `query_asset(find, assetType: "prefab")`. Never grep `.prefab.json` or `.genesys-scene`.
- Instance-only tweaks (world transform, display name): `action_node(action="setProperties")` on the **placed root**. Do not open the Prefab Editor.
- Shared structure, material, or children: `open` → `action_node` on the **source** → `save` / `close`. Do not patch every instance.
- After place or apply, return compact `{ path, placedIds, counts }` from `run_script`. Never dump `getDetails` on every child.
- Sparse scene JSON (`$base.$path` + overrides) is not a readable source of truth. Missing fields mean inherit, not unset.

## Build

`action_prefab` is **not** on the compact MCP list. Call `genesys.actionPrefab` inside `run_script`, or `batch_execute` with `tool: "action_prefab"`. Do not `describe_tool` first.

Inspect with `query_node` (the tree includes `prefabPath`, `isPrefabInstance`, `editableChildren`) and `query_asset(find, assetType: "prefab")`.

| Need | Op |
| --- | --- |
| Empty prefab asset | `create` (`name`; optional `directory`, `className`). Does **not** isolate unless `open: true`. |
| Branch → prefab, replace with instance | `createFromNode` (`componentId`). Irreversible; autosaves the scene. |
| Place instance | `instantiate` (`prefabPath`; optional `parentComponentId`, `transform`). Undoable; **does not autosave**. |
| Prefab Editor | `open` (`prefabPath` or instance `componentId`) |
| Leave Prefab Editor | `close`. Autosaves the prefab, reloads the parked scene. |
| Flush isolation | `save` while `query_editor(getState).documentType === "prefab"` |
| Push instance edits to asset | `apply` on a **placed root** |
| Discard instance overrides | `resync` on a **placed root** (keeps uuid, world transform, display name, `editableChildren`) |
| Bake instance into ordinary nodes | `unlink` on a **placed root** |
| Edit template children on an instance | `setEditableChildren`, then `action_node` |

Source: `genesys-mcp-orchestrator` `references/workflows.md` ("Place N instances then save the scene")
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

Source: `genesys-mcp-orchestrator` `references/workflows.md` ("Apply vs resync vs unlink")
```js
const componentId = 'placed-root-uuid';
await genesys.actionPrefab({ action: 'apply', componentId, dryRun: true });
// apply  — write instance edits into the .prefab.json asset
// resync — discard instance overrides
// unlink — bake into ordinary nodes (nested instances kept)
return { componentId };
```

Never `action_scene(action="save")` while isolated. After `instantiate` in a scene, flush with `action_scene(action="save")`, then re-query the placed roots. Engine `@engine/...` prefabs: placing is fine; **apply and unlink are blocked**.

`createFromNode`, `apply`, `resync`, and `unlink` are not undoable. `dryRun: true` is accepted on every `action_prefab` call and skips the approval; a dry run that previews without changing anything is confirmed for `apply` only. For `createFromNode`, `resync` and `unlink`, read the dry-run result: if it does not describe the change, save the scene first so a bad result can be reverted by reopening it.

## Spawn from code

Game code spawns a prefab with its full literal path (the build copies only `@project/...` paths that appear whole in the bundle; a path built at runtime needs `alwaysCopyAssets` in `.genesys-project`, `genesys-engine`). Use the async form: the sync `ENGINE.spawn(path)` throws unless the prefab file is already cached. Neither form adds the node to the world.

Source: `.engine/src/utils/Spawn.ts` (`spawnAsync`, `SpawnOptions`), `.engine/src/utils/serialization/prefab.ts` (`instantiatePrefabAsync`), `.engine/src/utils/serialization/instantiationOptions.ts`
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';
declare const world: ENGINE.World;
declare class Crate extends ENGINE.SceneNode {} // your GAME class on the prefab root

export async function spawnCrates(): Promise<void> {
  // Typed spawn: loads the prefab file on first use, then instantiates it. Not added to the world yet.
  const crate = await ENGINE.spawnAsync<Crate>('@project/assets/prefabs/Crate.prefab.json', {
    position: new THREE.Vector3(0, 0, -6),
  });
  world.add(crate);

  // Untyped form; returns null when the file is not a prefab.
  const root = await ENGINE.instantiatePrefabAsync('@project/assets/prefabs/Crate.prefab.json', {
    position: new THREE.Vector3(2, 0, -6),
    rotation: new THREE.Euler(0, Math.PI / 2, 0),
  });
  if (root) world.add(root);
}
```

For a burst (a wave of enemies, a volley of props), `await` one `spawnAsync` on the title screen or at level load so the file is cached; later spawns in the burst then skip the load (`genesys-profiler` → warm-up). In an online game, a prefab spawned this way exists on one machine only; use `MultiplayerSpawner.spawnPrefab` (`genesys-multiplayer`).

## Isolation

When `query_editor(operation="getState").documentType === 'prefab'`: mutate with `action_node`, flush with `action_prefab.save`, then `close`. `create` does not isolate unless `open: true`.

`apply` / `resync` / `unlink` need a **placed instance**, not the Prefab Editor. Isolation edits use `action_node` + `action_prefab.save`.

After `open` / `close`, previous document `componentId`s are invalid. Do not batch isolation switches with node mutations from the other document.

## Limitations

- Transform, reparent, and duplicate inside a prefab stay UI-only, or `setProperties` for editable transform paths.

## Traps

- `save` fails in isolation → the prefab definition must wrap **exactly one** authored root. Reparent extras under one root.
- `action_node(action="delete")` on the prefab document root is blocked → it is the definition root; edit its children instead.
- Other instances look stale while isolated → the parked scene is not live; they refresh on `close`.
- Stamps with `editableChildren` omitted load as `false` (the field default); MCP reports the live boolean.
- Nested instances are kept on `unlink`.
- Instances lost after an `instantiate` batch → the scene was not saved. `instantiate` does not autosave.
- A hand-edited `.prefab.json` breaks instances → use `open` → `action_node` → `save` / `close`.
- `ENGINE.spawn('…prefab.json')` throws `MissingPrefabDataError` → the sync form needs the file cached → `await ENGINE.spawnAsync<T>(…)`.
- `spawn('GAME.Enemy', { … })` options rejected by the typechecker → the string form has no type without a generic → `ENGINE.spawn<Enemy>(…)` or pass the class itself (`genesys-engine`).
- A runtime-spawned prefab is missing from the exported build → its path was assembled from pieces → write the full `'@project/assets/prefabs/….prefab.json'` literal, or list it in `alwaysCopyAssets`.
- Spawned prefab never appears → it was never added → `world.add(node)` (or `parent.add`).

## Done

- `query_asset(find, assetType: "prefab")` lists the prefab at the intended `@project/assets/...` path.
- `query_node` shows each placed root with `isPrefabInstance: true` and the expected `prefabPath`.
- `query_editor(getState).documentType` is back to the scene, and the scene is saved.
- Runtime-spawned prefabs appear in Play at the expected spawn points (playtest, `genesys-verification`).
