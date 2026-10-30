# SceneNode

Source: .engine/src/nodes/SceneNode.ts, .engine/src/nodes/PrimitiveNode.ts, .engine/src/utils/Spawn.ts

## Placeable roots

A placeable `SceneNode` (or `PrimitiveNode` / `MeshNode` subclass) is its own transform root. Child nodes attach under it.

- Custom classes that are always world roots: set `this.isRoot = true` in the constructor.
- One-off built-ins: `.create({ isRoot: true, ... })`.
- Do not use `super.initialize({ ...options, isRoot: true })` as the custom-root pattern.

Every code-built gameplay root (enemy, pickup, crate, hazard) needs `isRoot: true`: damage, pickups, triggers and projectiles find what they touched through `getRoot()` ([contracts](contracts.md)).

Source: .engine/src/nodes/SceneNode.ts, .engine/src/nodes/PrimitiveNode.ts
```typescript
// Placeholder look: replace with the model from the GAME.md Assets table.
const geometry = new THREE.SphereGeometry(0.3); // placeholder
const material = new THREE.MeshStandardMaterial({ color: 0xffd400 }); // placeholder

@ENGINE.GameClass()
export class Pickup extends ENGINE.PrimitiveNode {
  @ENGINE.property({ type: 'number', min: 0, description: 'Points awarded' })
  public points = 10;

  constructor() {
    super();
    this.isRoot = true;
  }

  public override initialize(options?: ENGINE.PrimitiveNodeOptions): void {
    super.initialize(options);
    this.add(
      ENGINE.MeshNode.create({ geometry, material }),
      ENGINE.InteractionNode.create(),
    );
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    // setup that needs the world
    return true;
  }
}
```

## Lifecycle

1. Creation — `MyNode.create(options)` instantiates and calls `initialize(options)`.
2. World entry — `world.add(node)` triggers `beginPlay()`.
3. Ticking — `tickPrePhysics()` → physics → `tickPostPhysics()` every frame.
4. World exit — `node.destroy()` triggers `endPlay()`. `removeFromParent()` / `world.remove()` only detach the graph.

`create(options, beforeInitialize?)` also accepts a factory function for options and an optional callback that runs on the instance before `initialize`. `initialize` runs only for `create()`, never when the node is deserialized from a save.

## Creating placeables

Use `.create()` when you have the class imported. Use `spawn()` when you only have a registered class name. Use `await spawnAsync()` for a prefab path. Neither adds the node to the world; call `world.add(node)`.

- A string argument needs the generic: `spawn<Enemy>('GAME.Enemy', …)`. Without it the options type is `never` and the call does not typecheck.
- Registered class names need the `GAME.` / `ENGINE.` prefix; anything else is treated as a prefab path.
- Prefabs: `spawnAsync<T>('@project/assets/prefabs/….prefab.json', { position, rotation, scale })` with the full literal path. Sync `spawn()` on a prefab path throws unless that prefab is already cached, and `spawnAsync` ignores `prefabData`.

Source: .engine/src/utils/Spawn.ts, .engine/src/utils/serialization/instantiationOptions.ts; typechecked against 18.1.0-alpha.317
```typescript
import { Enemy } from './enemies/Enemy';
import { Boss } from './enemies/Boss';

const enemy = Enemy.create({ position: new THREE.Vector3(0, 10, 0) });
world.add(enemy);

const enemy2 = ENGINE.spawn(Enemy, { position: new THREE.Vector3(0, 10, 0) }); // type inferred
world.add(enemy2);
const enemy3 = ENGINE.spawn<Enemy>('GAME.Enemy', { position: new THREE.Vector3(5, 10, 0) });
world.add(enemy3);

const boss = await ENGINE.spawnAsync<Boss>('@project/assets/prefabs/boss.prefab.json', { position: new THREE.Vector3(20, 0, 0) });
world.add(boss);
```

Editor placement of the same asset uses MCP `action_prefab.instantiate` (see `genesys-prefabs`). Runtime `spawn` / `instantiatePrefabAsync` does not go through MCP.

## Construction sequences

From `.create()` or `spawn()`:
1. Constructor
2. `initialize(options)`
3. `world.add()` → `beginPlay()`

From serialized data (levels, prefabs):
1. Constructor
2. Deserialize properties
3. `postLoad()`
4. `world.add()` → `beginPlay()`

## Choosing an initialization hook

| Hook | Use for |
|---|---|
| Constructor | Setup identical for every instance, including `this.isRoot = true` |
| `initialize(options)` | Values passed to `create()` / `spawn()`; add children here |
| `postLoad()` | Reacting to values loaded from saved files or prefabs |
| `beginPlay()` | Setup that needs the node in the world |
| `endPlay()` | Teardown when leaving the world |

```typescript
public override beginPlay(): boolean {
  if (!super.beginPlay()) {
    return false;
  }
  // custom setup
  return true;
}
```

`endPlay()` follows the same pattern. Do not use `beginPlay` to patch one editor-placed node's colour, transform, or mesh; that is editor state (MCP).

## Ticking

Source: .engine/src/nodes/SceneNode.ts
- Override `tickPrePhysics(deltaTime)` / `tickPostPhysics(deltaTime)` and always call `super` first. The base pre-physics tick runs the lifespan countdown and the `onTickPrePhysics` delegate.
- Subscribe without subclassing: `node.onTickPrePhysics` / `node.onTickPostPhysics` delegates, signature `(node, deltaTime)`.
- `tickEnabled` (create option, default true) or `setTickEnabled(false)` stops ticking for the node and its subtree.
- `tickInterval` (create option, seconds, 0 = every frame) or `setTickInterval(seconds)` throttles a slow system.
- `setLifeSpan(seconds)` destroys the node after that many seconds of play (0 = forever). Use it for short-lived effects and debris instead of a manual timer.

## Identification and tags

- `uuid` — permanent unique identifier generated at creation.
- `name` — human-readable identifier (auto-generated, customizable).
- `tags` — string array for categorization and filtering. Set with the `tags` create option or `setTags` / `addTag` / `removeTag`; read with `getTags`, `hasTag`, `hasAnyTag`, `hasAllTags`; find with `getNodesByTag(tag)` on any node or the world. The `tags` field itself is protected.

## Child management

```typescript
root.add(meshNode);
root.add(child1, child2, child3);
const mesh = root.getNode(ENGINE.MeshNode);
const allMeshes = root.getNodes(ENGINE.MeshNode);
```

Use `getRoot()` to find the placeable root from a descendant.

## Transforms

SceneNode provides world-space position, rotation, and scale access (see [threejs-extension](threejs-extension.md)), plus `forwardDirection()` / `rightDirection()`. Those two are world space; pass `false` for the axis in the parent's space ([contracts](contracts.md#local-vs-world-transforms)).

## Visibility and editor controls

```typescript
node.setHiddenInGame(true);
node.setEditorOnly(true);
node.setTransient(true); // runtime-only, not saved
```

## Description

```typescript
const description = node.describe({ includeNodesDetails: true });
```

## Removed

`ENGINE.Actor` is removed. Use a `SceneNode` / `PrimitiveNode` with `isRoot`. See `engine-upgrades` (`18-19`).

## Related

- [world-scene-node-overview](world-scene-node-overview.md)
- [building-node-trees](building-node-trees.md)
- [property-serialization-system](property-serialization-system.md)
