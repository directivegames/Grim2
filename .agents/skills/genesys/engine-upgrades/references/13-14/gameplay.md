# 13 → 14 — Collision, helpers, interaction

Open this file when migrating physics delegates, hit tests, Actor helpers,
character collision factories, or Actor→`SceneNode` widenings (triggers, BT,
XR).

## 1. Handle collisions on `PrimitiveNode`

Actor-level five-argument collision delegates were replaced by three-argument
delegates on each colliding `PrimitiveNode`.

```ts
// Before (13)
actor.onCollideWith.add((
  selfActor,
  selfComponent,
  otherActor,
  otherComponent,
  event,
) => {
  this.handleHit(otherActor, otherComponent, event);
});

// After (14)
primitive.onCollideWith.add((self, other, event) => {
  this.handleHit(other.getRoot(), other, event);
});
```

The same signature applies to `onOverlapWith`, `onStopCollidingWith`, and
`onStopOverlappingWith`. Subscribe to each relevant primitive when a root has
independent child physics bodies.

Hit-test option and result names also changed:

```ts
// Before (13)
const hits = physics.performHitTest({
  ...options,
  ignoredActors: [player],
  ignoredComponents: [weaponMesh],
});
const actor = hits[0]?.hitActor;

// After (14)
const hits = physics.performHitTest({
  ...options,
  ignoredRootNodes: [player],
  ignoredNodes: [weaponMesh],
});
const root = hits[0]?.hitRoot ?? null; // SceneNode | null
const primitive = hits[0]?.hitNode ?? null; // PrimitiveNode | null
```

`CollisionEvent` fields are `thisNode` / `otherNode` (not `thisComponent` /
`otherComponent`).

`InstantHitWeaponNode` hit payloads still expose `hitActor` as a
`SceneNode | null` alias of the hit root; do not rewrite that field when
migrating weapon code.

Physics-enabled roots can own compound bodies. Set
`physicsOptions.contributeToParentCollider` explicitly on child primitives when
they should join an ancestor body; do not rely on the feature-flag default.
Legacy Actor root-component physics is lifted onto the Actor root during load,
and its former body contributes upward.

`ProjectileOptions.owner`, `Projectile.getOwner()` / `setOwner()`, and custom
`Projectile.onHit()` parameters now use `SceneNode` rather than Actor/component
types. Note `getOwner(): SceneNode | undefined` (optional field), not `| null`.

## 2. Replace removed or changed Actor helpers

Most transform, lifecycle, controller, description, bounds, hidden-in-game, and
subtree helpers now live on `SceneNode` or `THREE.Object3D`. Apply these
specific changes:

- Actor-level `handleDeath()` is removed; call `destroy()` or implement
  game-specific death handling. `CharacterStatsNode` still has protected
  `handleDeath()` (it destroys the root) — override that on stats subclasses.
- `getBoundingBox()` is removed; call `calcBoundingBox()` and clone the returned
  readonly box before mutating it.
- `ActorDescriptionOptions.includeComponentsDetails` becomes
  `NodeDescriptionOptions.includeNodesDetails`.
- `WorldDescriptionOptions.specifiedActors` becomes `specifiedRoots`, and
  `World.describe()` returns `roots` / `rootsNumber` rather than
  `actors` / `actorsNumber`.
- `setHidden(hidden)` becomes `setHidden(hidden, propagateToChildren)`. The
  Object3D default is `false`; old Actor helpers always propagated, so pass
  `true` to keep the previous subtree behavior.
- `setOverrideMaterial(material)` becomes
  `setOverrideMaterial(material, recursive)`. Pass `true` for the old Actor
  recursive override.
- `onAddedToWorld` is removed; use `beginPlay()` for runtime setup and
  `onEditorAddToWorld()` for editor-only setup.
- `onClicked` / `clicked()` are removed; route interaction through the
  project's input, interaction, or raycast handling.
- `upDirection()` is removed; derive a direction from the node quaternion when
  needed.
- `getCanEverTick()` is removed with no public equivalent. Subclasses may read
  protected `canEverTick`; `isTickEnabled()` reports runtime enablement, which
  is a different state.
- `world.setActorHiddenInGame()` and
  `world.setSceneComponentHiddenInGame()` become
  `node.setHiddenInGame()`.
  **Do not** call `this.rootComponent.setHiddenInGame(...)` from an
  `Actor` subclass override — `rootComponent` is `this`, so that recurses
  forever. Use `super.setHiddenInGame(hidden)` and then mutate `this` /
  children (see [hierarchy.md](hierarchy.md) trap).

`onBeginPlay`, `onEndPlay`, `onTickPrePhysics`, and `onTickPostPhysics` still
exist on `SceneNode`, but their delegate payload is `SceneNode` rather than
`Actor`.

`Actor` and `World` are no longer nominal subclasses of `Playable`; code that
accepts either should type against `IPlayable` instead of relying on
`instanceof Playable`.

Custom `CharacterPawn` / `MoverCharacterPawn` subclasses must rename factory
overrides (no method aliases on CharacterPawn):

```ts
// Before (13)
class MyCharacter13 extends ENGINE.CharacterPawn {
  protected override createRootComponent(): ENGINE.SceneComponent {
    return ENGINE.MeshComponent.create(collisionOptions);
  }
  protected override createMovementComponent(): ENGINE.CharacterMovementComponent {
    return ENGINE.CharacterMovementComponent.create();
  }
  protected override setupAnimationComponent() { /* ... */ }
  protected override setupVisualComponent() { /* ... */ }
}

// After (14), CharacterPawn
class MyCharacter14 extends ENGINE.CharacterPawn {
  protected override createCollision(): ENGINE.SceneNode | null {
    return ENGINE.MeshNode.create(collisionOptions);
  }
  protected override createMovementNode(): ENGINE.CharacterMovementNode {
    return ENGINE.CharacterMovementNode.create();
  }
  protected override setupAnimationNode() { /* ... */ }
  protected override setupVisualNode() { /* ... */ }
}

// After (14), MoverCharacterPawn — extends Pawn, not MovementPawn
class MyMoverCharacter14 extends ENGINE.MoverCharacterPawn {
  protected override createCollision(): ENGINE.SceneNode {
    return ENGINE.MeshNode.create(collisionOptions);
  }
  // Movement customization is createMoverNode() (not createMovementNode).
  protected override createMoverNode(): ENGINE.MoverNode {
    return ENGINE.MoverNode.create();
  }
  // Optional: deprecated setupAnimationComponent / setupVisualComponent shims
  // still exist on MoverCharacterPawn only; prefer setupAnimationNode / setupVisualNode.
}
```

`MovementPawnOptions.movementComponent` is now `movementNode` (a deprecated
`movementComponent` getter/setter remains on the instance).

`getInteractionComponent()` is renamed to `getInteractionNode()` (deprecated
`getInteractionComponent` alias remains on GameplayPawn / DefaultCharacterPawn).

`IInteractable` player parameters and `TriggerActorDelegate` payloads also
widen from `Actor` to `SceneNode`.

`TriggerZoneNode.getActorsInZone()` and `isActorInZone()` retain their names but
now return/accept `SceneNode`.

Behavior-tree `Blackboard.getOwner()` returns `SceneNode | null`.
`BehaviorAction.getOwner(blackboard)` and `ConditionEvaluator.getOwner(blackboard)`
are helpers that read the blackboard owner (same `SceneNode | null`). XR grab
attachment APIs such as `VRGrabNode.getAttachedActor()` and their callbacks
likewise widen from Actor to `SceneNode`.

Reference implementations: `nodes/PrimitiveNode.ts`, `nodes/SceneNode.ts`,
`entities/CharacterPawn.ts`, `entities/MoverCharacterPawn.ts`,
`entities/MovementPawn.ts`, `physics/PhysicsEngine.ts`,
`nodes/gameplay/InstantHitWeaponNode.ts`, `utils/ThreeJsExtensions.ts` in
`.engine/src/`.
