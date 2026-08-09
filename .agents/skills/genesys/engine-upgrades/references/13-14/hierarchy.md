# 13 → 14 — Hierarchy, naming, World, queries

Open this file when migrating roots, `*Component` → `*Node`, lifecycle,
World/Level/GameLoop APIs, ownership queries, or tags.

## 1. Use semantic `SceneNode` roots

`Actor` is now a deprecated `PrimitiveNode` compatibility class and is its own
transform, lifecycle, physics, tag, and child root. Its deprecated
`rootComponent` getter returns the Actor itself — use the node / `getRoot()`,
not a nested-body lookup, unless you intentionally want a named child.

`ActorOptions.rootComponent` and `sceneComponents` still load as compatibility
options, but new and rewritten call sites must drop them. Prefer
`SceneNodeOptions.children` or `this.add(...)` in `initialize`.

Do not add `isRoot: true` to existing Actor subclasses: every Actor is already a
semantic root.

### Choose the replacement by child count

| Old setup | Prefer |
|---|---|
| Only `rootComponent`, no `sceneComponents` | Promote that node to the world root — **no wrapper** around a single child |
| `rootComponent` + one or more `sceneComponents` | Compound placeable (`PrimitiveNode` / subclass) with `children` |
| Behaviour / tags only | `SceneNode` |
| Placeable + physics | `PrimitiveNode` |
| Mesh / model as the placeable | `MeshNode` / `ModelMeshNode` with `isRoot: true` |

### Single former root — promote (do not wrap)

```ts
// Before (13) — Actor shell around one body
MyActor.create({
  rootComponent: ENGINE.MeshComponent.create({
    geometry,
    material,
    physicsOptions: { enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic },
  }),
  position,
});

// After (14) — that body is the placeable
ENGINE.MeshNode.create({
  isRoot: true,
  position,
  geometry,
  material,
  physicsOptions: { enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic },
});
```

Keep physics on that same node. Do **not** introduce
`PrimitiveNode.create({ children: [onlyChild] })` when the Actor had nothing
else. Same rule for a lone `ModelMeshNode`, `SoundNode`, etc.

### Compound placeable — flat children + physics lift

Historically the nested `rootComponent` usually held `physicsOptions`. After
migration the **placeable root** owns the rigid body; the former body typically
only contributes its collider (same pattern as
`PrimitiveNode.applyLegacyRootComponent` / `CharacterPawn`):

1. Copy the old root’s physics onto the **new placeable** via `physicsOptions`,
   with `contributeToParentCollider: false` (root owns the body).
2. On the **former body** child, keep geometry/collision shape and set
   `contributeToParentCollider: true` (usually still `enabled: true`).
3. Put world transform on the new root; reset the child’s local transform to
   identity if it previously carried the actor pose.

```ts
// Before (13) — physics on ActorOptions.rootComponent
const capsule = ENGINE.MeshComponent.create({
  geometry: capsuleGeo,
  physicsOptions: {
    enabled: true,
    motionType: ENGINE.PhysicsMotionType.Dynamic,
    collisionProfile: ENGINE.DefaultCollisionProfile.Default,
  },
});
MyActor.create({
  rootComponent: capsule,
  sceneComponents: [mesh, door],
  position,
});

// After (14) — root owns body; capsule contributes collider
ENGINE.PrimitiveNode.create({
  isRoot: true,
  position,
  physicsOptions: {
    enabled: true,
    motionType: ENGINE.PhysicsMotionType.Dynamic,
    collisionProfile: ENGINE.DefaultCollisionProfile.Default,
    contributeToParentCollider: false,
  },
  children: [
    ENGINE.MeshNode.create({
      geometry: capsuleGeo,
      physicsOptions: {
        enabled: true,
        contributeToParentCollider: true,
      },
    }),
    mesh,
    door,
  ],
});
```

**Do not** leave motion/`collisionProfile` only on a nested child while the
root stays physics-disabled if gameplay expects one moving body. Visual-only
former roots (`physicsOptions.enabled: false`) need no lift — put them in
`children` and omit root physics.

Custom classes that are always placeable roots should set `isRoot` in the
**constructor**, then build children in `initialize`:

```ts
// After (14), preferred custom root
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

An existing Actor can be migrated incrementally without changing its class —
still prefer promote-vs-compound when rewriting `rootComponent` /
`sceneComponents`:

```ts
// After (14), Actor compatibility path
const actor = ENGINE.Actor.create(options);
actor.add(
  ENGINE.MeshNode.create({ geometry, material }),
  ENGINE.InteractionNode.create(),
);
world.add(actor);
```

`Actor.setRootComponent()` has no equivalent because the Actor is the root.
Remove `collapseRootComponent()`; there is no wrapper root to collapse.
Treat `setRootComponent` contextually — `Prefab` exposes `rootNode` for the
prefab document root.

### Framework types that left `Actor`

These no longer extend `Actor` (symbol names and package-root imports are
unchanged). Most live under `.engine/src/entities/`; `GameMode` is under
`game/`, and `VRNode` under `xr/`:

| Type | Extends |
|---|---|
| `Pawn` and pawn subclasses | `PrimitiveNode` |
| `Controller` / `PlayerController` / `AIController` | `SceneNode` |
| `PlayerStart`, `InfoNode` (`InfoActor` alias), `GameMode`, `PlayerInfo`, `GameSessionInfo` | `SceneNode` |
| `Projectile` | `PrimitiveNode` |
| `VRNode` (`VRActor` alias) | `SceneNode` |
| `ModelMeshActor`, `GlobalParticleManager` | `SceneNode` |

Only the deprecated `Actor` shell remains under `actors/`. Prefer
`ModelMeshNode` with `isRoot: true` over `ModelMeshActor`, and `InfoNode` /
`VRNode` over the deprecated `InfoActor` / `VRActor` aliases.

Audit call sites that assumed these were Actors:

- `instanceof ENGINE.Actor` (now false for all of the above);
- parameters / collections typed as `Actor`;
- deprecated `world.getActors*` queries (only return remaining `Actor`
  instances — pawns, controllers, starts, projectiles, VR, and info objects
  are excluded);
- `getActor()` (returns null when the root is not an `Actor` — use
  `getRoot()`);
- Actor-only net helpers (`replicateTransform`, `netLocalRole`,
  `setAutonomousProxy`, …) — use `getReplicationGroup()` instead.

`hasAuthority()` without a replication group is `true` on Actor but `false` on
`SceneNode`. Unreplicated Controllers / GameModes / InfoNodes that relied on
the old Actor default must not assume authority from `hasAuthority()` alone.

### Pawn transform replication

`PawnOptions.rootComponent` / `sceneComponents` are gone; use
`PawnOptions.children`. Pawn still creates a `ReplicationGroup` in
`initialize`, but that group does not automatically replicate the Pawn
transform. In version 13 every plain Pawn enabled snap transform replication by
default (`replicateTransform = true`); that default is gone.

Prefer a configured `MovementPawn` subclass: it replicates `PawnNetTransform`
and applies remotes through `onRepPawnNetTransform` → `NetMovementPredictor`
(the movement node consumes the predictor). Do **not** copy Actor-only
`replicateTransform` / `NetTransform` onto a Pawn. Custom non-movement roots
that need transform sync must implement their own replicated property plus
authority-side write and remote `onRep` application — merely adding a property
does not move remote instances.

### ReplicationGroup on non-Actor roots

Setting `replicated = true` auto-adds a `ReplicationGroup` on **Actor** (setter
/ `beginPlay`) and on **Pawn** (`initialize` when `replicated`). Custom
`SceneNode` / `PrimitiveNode` roots (Controllers, InfoNode subclasses, and
other placeables that are not Actor or Pawn) must add the group explicitly:

```ts
this.replicated = true;
ENGINE.ensureReplicationGroup(this);
// or: this.add(ENGINE.ReplicationGroup.create());
```

`PlayerController` already does this. Custom InfoNode / Controller subclasses
that set `replicated = true` without `ensureReplicationGroup` will not register
as net entities.

### Multiplayer hard renames (no aliases)

If game code touches net packets, custom NetWorld helpers, map load RPCs, or
replicated property metadata:

| Before (13) | After (14) |
|---|---|
| `ActorUpdateType` / `ActorUpdate` / `ActorAck*` | `GroupUpdateType` / `GroupUpdate` / `GroupAck*` |
| packet field `actors` | `groups` |
| `NetWorld.clearActors` | `clearGroups` |
| `PlayerController.requestLoadMap` / `notifyMapLoaded` | session `sendLoadLevel` / `sendLevelLoaded` |
| `getNetSubId()` as string / empty root id | `NodePath \| null` (`null` at group root) |
| `netType: 'actorRef'` (and dangling/session `actorRef`) | `netType: 'nodeRef'` |

`actorRef` is removed from `ReplicationNetType` — rewrite
`@ENGINE.property({ replicate: true, net: { netType: 'actorRef' }})` to
`'nodeRef'`, and prefer `nodeRef` in dangling/session refs.

## 2. Rename scene `*Component` classes to `*Node`

The scene package and canonical class names changed from components to nodes.
The main `@gnsx/genesys.js` barrel still exports deprecated aliases and the
loader redirects old serialized `ENGINE.*Component` names, so saved assets
continue to load. Update TypeScript to the canonical names:

| Before (13) | After (14) |
|---|---|
| `SceneComponent` | `SceneNode` |
| `PrimitiveComponent` | `PrimitiveNode` |
| `MeshComponent` | `MeshNode` |
| `ModelMeshComponent`, `GLTFMeshComponent` | `ModelMeshNode` |
| `CollisionShapeComponent` | `CollisionShapeNode` |
| `LightComponent` and concrete `*LightComponent` classes | `LightNode` and `*LightNode` |
| movement `*Component` classes | movement `*Node` classes |
| gameplay `*Component` classes | gameplay `*Node` classes |
| `AnimationStateMachineComponent` | `AnimationStateMachineNode` |
| `BehaviorTreeComponent` | `BehaviorTreeNode` |
| `VFXComponent` | `VFXNode` |
| `SkyboxComponent` | `SceneEnvironmentNode` |
| XR `CanvasUIComponent`, `VR*Component` classes | corresponding `CanvasUINode`, `VR*Node` classes |

Rename related option and delegate types only where the engine exports a
corresponding Node name, for example `SceneComponentOptions` →
`SceneNodeOptions`,
`MoverComponentOptions` → `MoverNodeOptions`, and
`ComponentTickDelegate` → `NodeTickDelegate`. Do not mechanically rename every
type containing "Component": types such as `AnimationStateMachineOptions`,
`CharacterMovementOptions`, and class-specific delegates keep their names.

Do not mechanically rewrite other non-scene components; only migrate classes
for which the engine exports a corresponding Node class and deprecated alias.
Imports from the package root keep working through aliases, but deep imports
from deleted `components/**`, `vfx/VFXComponent`, behavior-tree component, or
XR component paths must move to their new Node paths or the package root.

## 3. Override the guarded boolean lifecycle

`doBeginPlay()` and `doEndPlay()` were removed. Override public
`beginPlay(): boolean` and `endPlay(): boolean`; call `super` first and stop when
the transition is rejected.

```ts
// Before (13)
protected override doBeginPlay(): void {
  super.doBeginPlay();
  this.startGameplay();
}

protected override doEndPlay(): void {
  this.stopGameplay();
  super.doEndPlay();
}

// After (14)
public override beginPlay(): boolean {
  if (!super.beginPlay()) {
    return false;
  }
  this.startGameplay();
  return true;
}

public override endPlay(): boolean {
  if (!super.endPlay()) {
    return false;
  }
  this.stopGameplay();
  return true;
}
```

The same contract applies to custom nodes, Worlds, and other `IPlayable`
subclasses. Genesys also propagates lifecycle through `Object3D.add()` and
`remove()` while the semantic root is playing. Remove manual child
`beginPlay()`/`endPlay()` calls around reparenting.

## 4. Treat `World` as the scene graph

`World` now extends `GenesysScene`; there is no private `World.scene` child.
The deprecated `world.scene` getter returns the World itself. Add roots
directly to the World and remove them through `removeFromParent()` or
`world.remove()`.

Play-mode rendering still parents the World under `GameLoop.rootScene`. For
background, environment, or other render-scene targets prefer
`world.getRenderScene()` (falls back to the World when no GameLoop is attached).

```ts
// Before (13)
world.scene.background = background;
world.addActor(actor);
world.addSceneComponents(componentRoot);
world.removeActor(actor);

// After (14)
world.getRenderScene().background = background;
world.add(actor, componentRoot);
actor.removeFromParent();
```

`addActor(s)`, `addSceneComponent(s)`, `removeActor(s)`,
`removeSceneComponent(s)`, `getActors()`, and `getSceneComponents()` remain as
deprecated compatibility shims. Prefer:

```ts
// Before (13)
const enemies = world.getActorsByTag('enemy');
const player = world.getPlayerController(0);
const camera = world.getComponent(ENGINE.ViewTargetCameraComponent);

// After (14)
const enemies = world.getNodesByTag('enemy');
const player = world.getPlayerControllerAt(0);
const camera = world.getNode(ENGINE.ViewTargetCameraNode);

// Topology-based World roots, including transient system roots:
const roots = world.getRootNodes();
```

`world.getWorldRootNodes()` was removed with **no** shim — use
`world.getRootNodes()`.

Choose queries deliberately:

- `getRootNodes()` returns topology-based World roots;
- `getNode()` / `getNodes()` traverse the full subtree;
- `getNodesByTag()` includes matching descendants, not only top-level Actors;
- deprecated Actor queries only return objects that are still `Actor`
  instances — not Pawns, Controllers, PlayerStarts, Projectiles, or InfoActors.

World roots are determined by topology, not the `isRoot` flag, and include
transient system roots. For authored/outliner roots use:

```ts
const authoredRoots = world
  .getRootNodes()
  .filter(node => !node.isTransient());
```

`World.addBox()`, `addSphere()`, `addBasicGeometry()`, and `addAxesHelper()`
were removed. Construct a `SceneNode`/`PrimitiveNode` root directly or use
`WorldCommands.placePrimitives()`.

`GameBuilder` helpers likewise return nodes rather than Actors:

| Before (13) | After (14) |
|---|---|
| `createDefaultGround(): Actor` | `SceneNode` |
| `createDefaultFog(): Actor` | `SceneNode` (`FogNodeOptions`) |
| `createDefaultEnvironment(): SceneEnvironmentComponent` | `SceneEnvironmentNode` |
| `createDefaultLighting()` light components | `DirectionalLightNode` / `AmbientLightNode` |

`Level` now stores arbitrary World-root nodes:

| Before (13) | After (14) |
|---|---|
| `level.actors` | `level.nodes` |
| `level.addActor(actor)` | `level.addNode(node)` |
| `level.getActorsOfType(T)` | `level.getNodesOfType(T)` |

Custom `GameLoop` subclasses that override level-transition hooks must rename:

| Before (13) | After (14) |
|---|---|
| `collectActorsToPreserveAcrossLevelTransition()` | `collectRootsToPreserveAcrossLevelTransition()` |
| `detachPreservedActorsAcrossLevelTransition()` | `detachPreservedRootsAcrossLevelTransition()` |
| `reinsertPreservedActorsAcrossLevelTransition()` | `reinsertPreservedRootsAcrossLevelTransition()` |

World uses a different verb order:
`detachRootsPreservingAcrossLevelTransition()`. The deprecated
`detachActorsPreservingAcrossLevelTransition()` Actor-only shim remains.

Rename `OpenLevelOptions.preserveActors` to `preserveRoots`.

## 5. Replace Actor ownership and component queries

Any `SceneNode` can now be a semantic root, so `getActor()` is too narrow.
Replace it with `getRoot()`. Replace component query names with node query
names.

```ts
// Before (13)
const actor = mesh.getActor();
const movement = actor?.getComponent(ENGINE.CharacterMovementComponent);
const lights = actor?.getComponents(ENGINE.LightComponent) ?? [];

// After (14)
const root = mesh.getRoot();
const movement = root?.getNode(ENGINE.CharacterMovementNode);
const lights = root?.getNodes(ENGINE.LightNode) ?? [];
```

`getActor()`, `getComponent()`, `getComponents()`,
`waitForComponentsToLoad()`, `addComponent()`, and `addComponents()` remain as
deprecated shims. Use `getRoot()`, `getNode()`, `getNodes()`,
`waitForNodesToLoad()`, and `Object3D.add()`.

Use the `isRoot` property for semantic-root checks. `isRootComponent()` remains
deprecated; there is no `isRootNode()` method.

`THREE.Scene.getWorld()` / `setWorld()` were removed. Call
`sceneNode.getWorld()` from a node in the hierarchy, or pass the `World`
reference explicitly.

## 6. Move Actor tags to every `SceneNode`

Actor-only `actorTags` and its helper methods were removed. Tags now live on
all `SceneNode`s.

```ts
// Before (13)
actor.addActorTag('enemy');
actor.hasActorTag('enemy');
actor.setActorTags(['enemy', 'flying']);

// After (14)
node.addTag('enemy');
node.hasTag('enemy');
node.setTags(['enemy', 'flying']);
```

Also replace `ActorOptions.actorTags` → `tags`, `getActorTags()` →
`getTags()`, `removeActorTag()` → `removeTag()`, `hasAnyActorTag()` →
`hasAnyTag()`, and `hasAllActorTags()` → `hasAllTags()`.

Serialized `actorTags` migrate to `tags`. If a project uses `MoverComponent`
sync-state tags, rename `hasTag(tag, exactMatch)` to
`MoverNode.hasSyncTag(tag, exactMatch)` so it is not confused with the new
general node tags.

Reference implementations: `nodes/SceneNode.ts`, `actors/Actor.ts`,
`entities/Pawn.ts`, `entities/Controller.ts`, `entities/InfoNode.ts`,
`xr/VRNode.ts`, `game/World.ts`, `game/Level.ts`, `game/GameLoop.ts`,
`game/GameBuilder.ts`, `game/Playable.ts`, `utils/ThreeJsExtensions.ts` in
`.engine/src/`.
