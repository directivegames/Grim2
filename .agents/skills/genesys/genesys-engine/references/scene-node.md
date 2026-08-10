# SceneNode

## Placeable roots

A placeable SceneNode (or PrimitiveNode / MeshNode subclass) is its own transform root. Child nodes attach under it; there is no nested `rootComponent`.

- Custom classes that are always world roots: set `this.isRoot = true` in the **constructor**.
- One-off built-ins: `.create({ isRoot: true, ... })`.
- Do not teach `super.initialize({ ...options, isRoot: true })` as the preferred custom-root pattern.

```typescript
@ENGINE.GameClass()
class PickupRoot extends ENGINE.PrimitiveNode {
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
}
```

Reference: See SceneNode.ts / PrimitiveNode.ts in the engine source.

## Lifecycle

Nodes follow a lifecycle managed by the World:

1. Creation — `MyNode.create(options)` factory method instantiates and initializes.
2. World Entry — `world.add(node)` triggers `beginPlay()`. Override `beginPlay()`, call super, and run custom logic only when it returns true.
3. Ticking — `tickPrePhysics()` → [physics simulation] → `tickPostPhysics()` every frame.
4. World Exit — `node.destroy()` or remove from world triggers `endPlay()`. Override `endPlay()`, call super, and run custom logic only when it returns true.

## Identification and tags

- uuid — Permanent unique identifier generated at creation.
- name — Human-readable identifier (auto-generated, customizable).
- tags — String array for categorization and filtering on SceneNode.

## Usage patterns

### Creating placeables

Use `.create()` when you have the class imported. Use `spawn()` when you only have a registered class name or prefab path.

Neither method adds the node to the world — call `world.add(node)` separately.

```typescript
import { MyEnemy } from './MyEnemy';
const enemy = MyEnemy.create({ position: new THREE.Vector3(0, 10, 0) });
world.add(enemy);

// Registered class names need the GAME./ENGINE. prefix (bare names are treated as prefab paths).
const enemy2 = spawn(MyEnemy, { position: new THREE.Vector3(0, 10, 0) });
world.add(enemy2);
const enemy3 = spawn('GAME.MyEnemy', { position: new THREE.Vector3(5, 10, 0) });
world.add(enemy3);

const boss = spawn('prefabs/enemies/boss', { position: new THREE.Vector3(20, 0, 0) });
world.add(boss);
```

### Construction sequences

From `.create()` or `spawn()`:
1. Constructor
2. `initialize(options)`
3. `world.add()` → `beginPlay()`

From serialized data (levels, prefabs):
1. Constructor
2. Deserialize properties
3. `postLoad()`
4. `world.add()` → `beginPlay()`

### Choosing an initialization hook

- Constructor — Setup identical for every instance (including `this.isRoot = true` for root classes).
- Initialize — Setup using values passed from `create()` or `spawn()`; add children here.
- PostLoad — Setup reacting to values loaded from saved files or prefabs.
- beginPlay — Setup requiring the node to be in the world. Call `super.beginPlay()` first and only continue when it returns `true`.
- endPlay — Teardown when leaving the world. Call `super.endPlay()` first and only continue when it returns `true`.

```typescript
public override beginPlay(): boolean {
  if (!super.beginPlay()) {
    return false;
  }
  // custom setup
  return true;
}
```

### Child management

```typescript
root.add(meshNode);
root.add(child1, child2, child3);

const mesh = root.getNode(ENGINE.MeshNode);
const allMeshes = root.getNodes(ENGINE.MeshNode);
```

Use `getRoot()` to find the placeable root from a descendant. Deprecated `getActor()` returns null when the root is not an `Actor`.

### Transform operations

SceneNode provides world-space position, rotation, and scale access, plus `forwardDirection()` / `rightDirection()`.

## Visibility and editor controls

```typescript
node.setHiddenInGame(true);
node.setEditorOnly(true);
node.setTransient(true);
```

### Description system

```typescript
const description = node.describe({
  includeNodesDetails: true,
});
```

## Related systems

- [World and SceneNode Overview](world-scene-node-overview.md)
- [Building Node Trees](building-node-trees.md)
- [Property and Serialization System](property-serialization-system.md)

## Deprecated

`ENGINE.Actor` is a deprecated compatibility root. Prefer SceneNode/PrimitiveNode. See `engine-upgrades` → `13-14`.
