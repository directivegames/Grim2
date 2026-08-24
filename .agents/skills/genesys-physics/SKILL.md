---
name: genesys-physics
description: Genesys physics beyond basic PrimitiveNode setup - raycasts/hit tests, joints/constraints, impulses, raw physics bodies, collision-ignore pairs, character-controller internals, and vehicle physics (wheels, suspension, friction, steering). Use for shooting, ragdolls, hinges, or drivable vehicles. Basic PrimitiveNode options live in genesys-engine; vehicle pawn integration lives in genesys-movement.
---

# Genesys Physics (Advanced)

Engine physics lives under `.engine/src/physics/` — `PhysicsEngine.ts` (public types/interface), `BasePhysicsEngine.ts` (shared logic, node/joint/body bookkeeping), `IPhysicsVehicle.ts` (vehicle contract), `PhysicsTypes.ts` (motion types, collision mesh types), `implementations/RapierPhysics.ts` + `implementations/RapierVehicle.ts` (the only backend — Rapier). Read source for exact signatures; this skill maps what exists and flags non-obvious behavior.

## Accessing the engine

Any `SceneNode` (not just `PrimitiveNode`) can reach physics: `node.getPhysicsEngine(): IPhysicsEngine | null` (`.engine/src/nodes/SceneNode.ts`). Returns null before the node is in the world or if physics isn't initialized — always null-check.

## Two body identity systems — do not mix them

- Node-attached bodies — created automatically when a physics-enabled `PrimitiveNode` enters the world (`registerPhysicsBody`/`addNode`). Addressed by the `PrimitiveNode` itself: `hasNode`/`addNode`/`removeNode` (manual use is rare — mainly to pull a node out of the sim without destroying it), `getScalarParam`/`setScalarParam`, `getVectorParam`/`setVectorParam`/`clearVectorParam`, `teleportBody(node, position, rotation?)`, `getNodeState(node)`, `createJoint(desc)` (takes `nodeA`/`nodeB`), `setNodeCollisionIgnore(nodeA, nodeB, ignore)`.
- Raw/direct bodies — created via `createPhysicsBody(desc): PhysicsBodyHandle | null`, not tied to any `SceneNode` (e.g. debris, procedural physics props). Addressed by an opaque string handle: `removePhysicsBody`, `isValidPhysicsBody`, `getPhysicsBodyPosition`/`getPhysicsBodyRotation`, `setPhysicsBodyPosition`/`setPhysicsBodyRotation`, `applyImpulseToPhysicsBody(handle, impulse, worldSpace = true)`, `setPhysicsBodyEnabled`, `createJointFromBodies(...)` (joins two handles).

There is no impulse method for node-attached bodies — to push one, add to its `LinearVelocity` via `setVectorParam` (there's no additive "applyImpulse" for nodes, so read the current value first if you want to add rather than replace).

Use `createJoint` to join two nodes, or `createJointFromBodies` to join two raw handles. Other joint-creation overloads on the engine are for internal use.

## Raycasts / hit tests

`performHitTest(options: HitTestOptions): HitTestResult[]`.

- `HitTestOptions`: `origin`, `direction` (a unit vector; scaled by `maxDistance` for the ray), `maxDistance`, `stopOnFirstHit`, optional `collisionProfile`, `ignoredRootNodes`, `ignoredNodes`.
- `HitTestResult`: `origin`, `direction`, `hitLocation`, `hitNormal`, `hitNode: PrimitiveNode | null`, `hitRoot: SceneNode | null`.
- Sensor/trigger colliders are always excluded from hit tests — a raycast never reports a trigger volume.
- `stopOnFirstHit: false` returns every collider the ray intersects, not sorted by distance.

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

@ENGINE.GameClass()
export class HitscanWeaponNode extends ENGINE.SceneNode {
  @ENGINE.property()
  public damage: number = 10;

  @ENGINE.property()
  public range: number = 100;

  public fire(): void {
    const physicsEngine = this.getPhysicsEngine();
    if (!physicsEngine) {
      return;
    }

    const origin = new THREE.Vector3();
    this.getWorldPosition(origin);

    const results = physicsEngine.performHitTest({
      origin,
      direction: this.forwardDirection(),
      maxDistance: this.range,
      stopOnFirstHit: true,
      collisionProfile: ENGINE.DefaultCollisionProfile.BlockAllDynamic,
      ignoredRootNodes: [this.getRoot()!],
    });

    const hit = results[0];
    if (!hit?.hitNode) {
      return;
    }

    console.log(`Hit ${hit.hitNode.name} at`, hit.hitLocation, 'normal', hit.hitNormal);
    // Spawn impact VFX at hit.hitLocation oriented to hit.hitNormal, then apply
    // this.damage to hit.hitNode / hit.hitRoot if it exposes a health API.
  }
}
```

## Joints and constraints

`JointType`: `Spherical`, `Fixed`, `Revolute`, `Prismatic`. `JointDesc`: `{ type, nodeA, nodeB, anchorA, anchorB, axis? }` — anchors are local to each body; `axis` is required for `Revolute`/`Prismatic`.

`createJoint(desc)` fails (returns `null`, logs) unless `nodeA` and `nodeB` each resolve to exactly one physics body — a compound node (contributing children) or an instanced-mesh node has multiple records and cannot be jointed directly. Manage with `removeJoint(id)` and `getActiveJoints()`.

```typescript
const jointId = physicsEngine.createJoint({
  type: ENGINE.JointType.Revolute,
  nodeA: hingeMount,               // static or kinematic anchor body
  nodeB: door,                     // dynamic PrimitiveNode that swings
  anchorA: new THREE.Vector3(0, 1, 0),   // local to hingeMount
  anchorB: new THREE.Vector3(-0.5, 1, 0), // local to door
  axis: new THREE.Vector3(0, 1, 0),
});
```

## Collision ignore pairs

`setNodeCollisionIgnore(nodeA, nodeB, ignore)` only suppresses the `onCollideWith`/`onOverlapWith` (and stop-*) event pair between the two nodes — it does not disable the physical contact response. The bodies still solidly push against each other; only the JS notification is skipped. To make two dynamic bodies pass through each other physically, use collision profiles/channels (`genesys-engine`), not this call.

## Character controller internals

`createCharacterController(node, options)` / `removeCharacterController(node)` / `computeCharacterMovement(...)` back every kinematic movement node's ground/step/slope handling (`CharacterControllerOptions`: offset, gravity scale, slope angles, auto-step, snap-to-ground — see `.engine/src/physics/PhysicsEngine.ts`). Call these directly only when authoring a fully custom movement node from scratch; standard character movement should go through the engine's existing movement nodes rather than reimplementing this layer.

## Vehicle physics

`createVehicle(movementNode, chassisNode): IPhysicsVehicle | null` turns an existing Dynamic `PrimitiveNode` chassis (already registered with physics) into a wheeled vehicle. Wheel tuning (`addWheel`, suspension/friction parameters, engine/brake/steering, state queries) is substantial enough to have its own reference: [vehicle-physics](references/vehicle-physics.md). Pawn-level driving integration (`VehicleMovementNode`, `VehicleMode`, input wiring) is owned by the `genesys-movement` skill — this reference covers only the underlying `IPhysicsVehicle` API those classes call into.

## Footguns

- `teleportBody` vs handle-based body control are different systems — `teleportBody(node, ...)` only works for node-attached bodies; raw bodies from `createPhysicsBody` use `setPhysicsBodyPosition`/`setPhysicsBodyRotation` instead. Calling the wrong one for a given body silently no-ops (node not found in the relevant map).
- Joints need single-body nodes — see Joints above; compound/instanced nodes fail `createJoint` with a console error, not a thrown exception.
- Vehicle chassis must already be in the sim as Dynamic — `createVehicle` looks up the chassis's existing physics record; call it after the chassis `PrimitiveNode` has a body (post-`beginPlay`), not before.
- Destroying/rebuilding a vehicle's chassis body invalidates the controller — check `vehicle.isDestroyed()` before reusing a stored `IPhysicsVehicle` reference; removing the chassis node destroys its vehicle controller automatically.
- `applyImpulseToPhysicsBody` only targets raw handles — there is no impulse call for node-attached bodies (see Two body identity systems above).

## Source index

| File | Contents |
| --- | --- |
| `.engine/src/physics/PhysicsEngine.ts` | `IPhysicsEngine` interface, `HitTestOptions`/`Result`, `PhysicsBodyDesc`/`Shape`, scalar/vector param enums, `CharacterControllerOptions` |
| `.engine/src/physics/BasePhysicsEngine.ts` | Shared engine logic; `JointType`, `JointDesc`; node/joint/direct-body bookkeeping |
| `.engine/src/physics/IPhysicsVehicle.ts` | `VehicleWheelConfig`, `VehicleWheelState`, `VehicleState`, `IPhysicsVehicle` |
| `.engine/src/physics/PhysicsTypes.ts` | `PhysicsMotionType`, `CollisionMeshType`, `NodePhysicsOptions`, voxel/heightfield collision descriptors |
| `.engine/src/physics/createPhysicsEngine.ts` | Backend factory (Rapier only) |
| `.engine/src/physics/implementations/RapierPhysics.ts` | Rapier backend: raycasts, joints, direct bodies, collision groups/ignore, character controller |
| `.engine/src/physics/implementations/RapierVehicle.ts` | Rapier `DynamicRayCastVehicleController` wrapper backing `IPhysicsVehicle` |
| `.engine/src/nodes/SceneNode.ts` | `getPhysicsEngine()` accessor |
