---
name: genesys-prefabs
description: When to use Genesys Prefabs versus scene nodes, GAME classes, or baked Models; editor Prefab isolation; place/apply/resync/unlink. Use for repeated assemblies, .prefab.json, Prefab Editor, Save Branch as Prefab, or instance apply/resync/unlink.
---

# Genesys Prefabs

Reusable authored hierarchies (`.prefab.json`). This is a **routing decision**, not “always make a prefab”.

JS recipes live in [genesys-mcp-orchestrator/references/workflows.md](../genesys-mcp-orchestrator/references/workflows.md) — open that file for extract / place / isolate / apply vs resync vs unlink.

## When to use a Prefab

Use a Prefab when the same authored hierarchy will be placed more than once, updated in one place, spawned at runtime, or reused across scenes/packs:

- Repeated props, pickups, enemies, doors, spawners, room kits.
- Shared look/structure that should stay in sync (`apply` / `resync`).
- Runtime spawn via `spawn('…prefab.json')` / `instantiatePrefabAsync` (see [scene-node.md](../genesys-engine/references/scene-node.md)).
- Nested composition (a room prefab that contains furniture prefabs).

Do **not** use a Prefab when:

- One-off scenery — duplicate or place nodes in the scene.
- Behaviour/defaults belong on a `GAME.*` class (`@GameClass`, constructor/`initialize` defaults), not duplicated JSON.
- A static mesh is enough — `action_asset.mergeMeshes` then a `ModelMeshNode`. A Prefab keeps an **editable hierarchy**; a Model does not.
- A single MeshNode/light with no children — just place the node.
- Per-instance uniqueness that would immediately `unlink` — keep it as scene nodes.

## Token / maintainability

- Prefer **one Prefab edit + N instances** over reconstructing the same subtree with `action_node.add`.
- Discover with `query_asset(find, assetType: "prefab")`. Never grep `.prefab.json` or `.genesys-scene`.
- Instance-only tweaks (world transform, display name): `action_node.setProperties` on the **placed root**. Do not open Prefab Editor.
- Shared structure/material/children: `open` → `action_node` on the **source** → `save` / `close`. Do not patch every instance.
- After place/apply, return compact `{ path, placedIds, counts }` from `run_script` — never dump `getDetails` on every child.
- Sparse scene JSON (`$base.$path` + overrides) is not a readable source of truth — missing fields mean inherit, not unset.

## Dispatch (compact-hidden)

`action_prefab` is **not** on the compact MCP list. Call `genesys.actionPrefab` inside `run_script`, or `batch_execute` with `tool: "action_prefab"`. Do not `describe_tool` first.

Inspect with `query_node` (tree includes `prefabPath`, `isPrefabInstance`, `editableChildren`) and `query_asset(find, assetType: "prefab")`.

| Need | Op |
| --- | --- |
| Empty prefab asset | `create` (`name`; optional `directory`, `className`). Does **not** isolate unless `open: true`. |
| Branch → prefab, replace with instance | `createFromNode` (`componentId`) — irreversible; autosaves the scene |
| Place instance | `instantiate` (`prefabPath`; optional `parentComponentId`, `transform`) — undoable; **does not autosave** |
| Prefab Editor | `open` (`prefabPath` or instance `componentId`) |
| Leave Prefab Editor | `close` — autosaves prefab, reloads parked scene |
| Flush isolation | `save` while `query_editor(getState).documentType === "prefab"` |
| Push instance edits to asset | `apply` on a **placed root** |
| Discard instance overrides | `resync` on a **placed root** |
| Bake instance into ordinary nodes | `unlink` on a **placed root** |
| Edit template children on an instance | `setEditableChildren` then `action_node` |

Never `action_scene.save` while isolated. After `instantiate` in a scene, flush with `action_scene.save`. Engine `@engine/...` prefabs: place is OK; **apply and unlink are blocked**.

`createFromNode`, `apply`, `resync`, `unlink` are not undoable — prefer `dryRun` first.

## Isolation

When `getState.documentType === 'prefab'`: mutate with `action_node`, flush with `action_prefab.save`, then `close`. `create` does not isolate unless `open: true`.

`apply` / `resync` / `unlink` need a **placed instance**, not Prefab Editor. Isolation edits use `action_node` + `action_prefab.save`.

After `open` / `close`, previous document `componentId`s are invalid. Do not batch isolation switches with node mutations from the other document.

## Constraints

- Prefab definition wraps **exactly one** authored root — `save` fails if isolation has more than one.
- Prefab document root is blocked from `action_node.delete`.
- While isolated, the parked scene is not live; other instances refresh on `close`.
- `editableChildren` omitted on old stamps loads as `true`; MCP reports the live boolean.
- Nested instances are kept on `unlink`.
- Transform / reparent / duplicate stay UI-only (or `setProperties` for editable transform paths).
- Do not hand-edit `.prefab.json`.
