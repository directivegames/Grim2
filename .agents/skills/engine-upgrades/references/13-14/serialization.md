# 13 → 14 — Serialization, prefabs, spawn

Open this file when TypeScript calls removed serializer/prefab helpers, or when
confirming how to persist V3 after upgrade.

## Hard renames

| Before (13) | After (14) |
|---|---|
| `WorldSerializer.loadActor` / `loadActorSync` | `loadNode` / `loadNodeSync` |
| `WorldSerializer.duplicateActor` | `duplicateNode` |
| `WorldSerializer.createPrefabDataFromActor` / `exportAsPrefab` | `new ENGINE.Prefab(root)` then `WorldSerializer.exportObject(prefab)` |
| `setAsPrefabInstance` | `setPrefabInstance` |
| `loadPrefabTemplateInstance` / `loadPrefabTemplateActor` | `loadPrefabTemplateRoot` |
| `spawnPrefabActor` | `instantiatePrefab` / `spawn` |
| `prefabNodeId` | `prefabId` |
| `actor.getPrefabName()` | `node.prefabPath` |
| `actor.clearPrefab()` | `setPrefabInstance(node, null)` |

`instantiatePrefab(...): SceneNode | null` has no generic. Prefer it (or
`spawn` / `spawnAsync`) over `loadPrefabTemplateRoot` when spawning instances —
they stamp `prefabPath`, apply transforms, and remint node IDs.

`spawn` / `spawnAsync` keep generics (`spawn<T extends SceneNode>(...)`) and do
not type the result as `| null` (a prefab path casts the `instantiatePrefab`
result as `T`). At runtime a missing or failed prefab path can still yield
`null` — null-check before use. `Spawnable` / `spawn` / `spawnAsync` require
`T extends SceneNode`.

Removed with no shim: Actor `setPrefab` / `getPrefabData` /
`getPrefabInheritanceChain` / `stripRootLocalTransform`, and
`createPrefabDataFromActorWithParent`.

```ts
// Before (13)
const actor = await ENGINE.WorldSerializer.loadActor(data, prefabs, true);
const copy = ENGINE.WorldSerializer.duplicateActor(actor);

// After (14)
const root = await ENGINE.WorldSerializer.loadNode(data, prefabs, true);
const copy = root ? ENGINE.WorldSerializer.duplicateNode(root) : null;
```

## Persist V3 on disk

Supported V1/V2 scenes and prefabs migrate in memory on normal
`WorldSerializer` / `PrefabManager` / editor load. On-disk files stay at the old
`$version` until you save. After upgrading: open each scene and prefab,
inspect hierarchy/transforms/prefab overrides, then save. There is no 13→14
disk codemod — persistence is open → inspect → save.

New World saves dump authored roots under `children` (Object3D children). Load
still accepts legacy `sceneComponents` and `actors` lists. Do not hand-edit
JSON expecting the old write keys.

Do not hand-edit `.genesys-scene` / `.prefab.json` for this migration. Engine
loaders redirect many registered `ENGINE.*` names (not only `*Component` →
`*Node` — also aliases such as `InfoActor` → `InfoNode`, `VRActor` → `VRNode`,
`SkyboxComponent` → `SceneEnvironmentNode`, and other stamped renames). Custom
`GAME.*` class names are not auto-redirected. If you rename a game class
(e.g. `GAME.CollectibleActor` → `GAME.CollectibleNode`), register a redirect
so existing scenes/prefabs keep loading:

```ts
ENGINE.ClassRegistry.addClassesToRedirect({
  'GAME.CollectibleActor': 'GAME.CollectibleNode',
});
```

If game code feeds raw JSON to a bare Loader (bypassing
`WorldSerializer`/`PrefabManager`), call `prepareSerializedDataForLoad()` first.
For legacy Actor-rooted `.prefab.json`, pass
`{ convertPrefabDocument: true }` (what `PrefabManager` does). Pre-V1 data is
rejected.

Reference implementations: `systems/WorldSerialization.ts`, `game/Prefab.ts`,
`game/World.ts`, `utils/serialization/prefab.ts` in `.engine/src/`.
