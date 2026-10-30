# Bodies, joints, collision ignore, and the character controller

Engine physics lives under `.engine/src/physics/`: `PhysicsEngine.ts` (public types and the
`IPhysicsEngine` interface), `BasePhysicsEngine.ts` (shared logic; node, joint, and body bookkeeping),
`IPhysicsVehicle.ts` (vehicle contract), `PhysicsTypes.ts` (motion types, collision mesh types), and
`implementations/RapierPhysics.ts` + `implementations/RapierVehicle.ts` (the only backend, Rapier).
Read the source for exact signatures.

## Accessing the engine

Any `SceneNode` (not just `PrimitiveNode`) can reach physics: `node.getPhysicsEngine(): IPhysicsEngine | null`
(`.engine/src/nodes/SceneNode.ts`). It returns null before the node is in the world or if physics is
not initialized. Always null-check.

## Two body identity systems — do not mix them

**Node-attached bodies** are created automatically when a physics-enabled `PrimitiveNode` enters the
world (`registerPhysicsBody` / `addNode`). They are addressed by the `PrimitiveNode` itself:

- `hasNode` / `addNode` / `removeNode` — manual use is rare, mainly to pull a node out of the sim
  without destroying it.
- `getScalarParam` / `setScalarParam` (`PhysicsScalarParam.LinearDamping`, `AngularDamping`,
  `GravityScale`).
- `getVectorParam` / `setVectorParam` / `clearVectorParam` (`PhysicsVectorParam.LinearVelocity` m/s,
  `AngularVelocity` rad/s; values are `[x, y, z]` arrays).
- `teleportBody(node, position, rotation?)`, `getNodeState(node)`.
- `createJoint(desc)` (takes `nodeA` / `nodeB`), `setNodeCollisionIgnore(nodeA, nodeB, ignore)`.

**Raw / direct bodies** are created with `createPhysicsBody(desc): PhysicsBodyHandle | null` and are not
tied to any `SceneNode` (debris, procedural physics props). They are addressed by an opaque string
handle: `removePhysicsBody`, `isValidPhysicsBody`, `getPhysicsBodyPosition` / `getPhysicsBodyRotation`,
`setPhysicsBodyPosition` / `setPhysicsBodyRotation`, `applyImpulseToPhysicsBody(handle, impulse,
worldSpace = true)`, `setPhysicsBodyEnabled`, `createJointFromBodies(...)` (joins two handles).
`PhysicsBodyDesc` and `PhysicsBodyShape` are in `PhysicsEngine.ts`.

There is no impulse method for node-attached bodies. To push one, add a velocity change (m/s) to its
`LinearVelocity` via `setVectorParam`; there is no additive call, so read the current value first if you
want to add rather than replace (`pushBody` in SKILL.md → *Build*). Only `Dynamic` bodies respond. Kinematic bodies
(`CharacterPawn`, GSS pawns, pattern movers) are moved by their own code each tick, so a `LinearVelocity`
write does nothing to them; knock characters back through `genesys-movement`.

Use `createJoint` to join two nodes, or `createJointFromBodies` to join two raw handles. Other
joint-creation overloads on the engine (`createJointFromRecords`) are for internal use.

## Joints and constraints

`JointType`: `Spherical`, `Fixed`, `Revolute`, `Prismatic`. `JointDesc`:
`{ type, nodeA, nodeB, anchorA, anchorB, axis? }`. Anchors are local to each body; `axis` is required
for `Revolute` / `Prismatic`. There are no angle or distance limits, springs, or motors: a `Revolute` joint
spins a full 360°, and a `Prismatic` joint slides without end stops. A door that must stop at 90° is a
`DoorNode` (`genesys-interactions`); a piston with end stops is a tween (`genesys-interactions`).

`createJoint(desc): string | null`, `getActiveJoints(): string[]` and `removeJoint(id)` are on
`IPhysicsEngine`, so call them on `getPhysicsEngine()` directly.

`createJoint` fails (returns `null` and logs) unless `nodeA` and `nodeB` each resolve to exactly one
physics body. A compound node (contributing children) or an instanced-mesh node has multiple records
and cannot be jointed directly.

Source: .engine/src/physics/BasePhysicsEngine.ts (`createJoint`)
```typescript
const jointId = this.getPhysicsEngine()?.createJoint({
  type: ENGINE.JointType.Revolute,
  nodeA: hingeMount,                      // static or kinematic anchor body
  nodeB: sign,                            // dynamic PrimitiveNode that swings freely
  anchorA: new THREE.Vector3(0, 1, 0),    // local to hingeMount
  anchorB: new THREE.Vector3(-0.5, 1, 0), // local to sign
  axis: new THREE.Vector3(0, 1, 0),
});
```

| Joint | Typical use |
|---|---|
| `Revolute` | Swinging sign, free-spinning wheel or turnstile, pendulum (no limits, so not a door) |
| `Spherical` | Chain link, hanging lamp, wrecking ball, flail |
| `Prismatic` | Free slider on a rail (no end stops) |
| `Fixed` | Weld a breakable part on until it is detached |

## Collision ignore pairs

`setNodeCollisionIgnore(nodeA, nodeB, true)` drops the contact pair, so the bodies pass through each other.
The same pair skips intersection tests, so overlap events do not fire either.
Call it with `false` to restore the contact.
Channel-wide rules still belong on collision profiles.

## Character controller internals

`createCharacterController(node, options)` / `removeCharacterController(node)` /
`computeCharacterMovement(...)` back every kinematic movement node's ground, step, and slope handling.
`CharacterControllerOptions` covers offset, simulated gravity scale, slope angles, auto-step,
snap-to-ground, sliding, and impulses on dynamic bodies (`.engine/src/physics/PhysicsEngine.ts`;
the defaults are listed in `genesys-movement`). Call these directly only when authoring a fully custom
movement node or GSS mode from scratch. Standard character movement goes through the engine's
existing movement nodes and modes.

## Vehicle physics

`createVehicle(movementNode, chassisNode): IPhysicsVehicle | null` turns an existing Dynamic
`PrimitiveNode` chassis into a wheeled vehicle. Wheel tuning and pawn integration are in
`genesys-vehicles`.

## Footguns

- `teleportBody` vs handle-based body control are different systems. `teleportBody(node, ...)` only
  works for node-attached bodies; raw bodies use `setPhysicsBodyPosition` / `setPhysicsBodyRotation`.
  Calling the wrong one silently no-ops (node not found in the relevant map).
- Joints need single-body nodes. Compound and instanced nodes fail `createJoint` with a console error,
  not a thrown exception.
- `applyImpulseToPhysicsBody` only targets raw handles.
- `LinearVelocity` writes do nothing to kinematic bodies (characters, pattern movers).
- Joints have no limits or motors; a hinge spins freely.
- There is no ragdoll system and no per-body friction or restitution (SKILL.md → *Not in the engine*).
- Vehicle chassis must already be in the sim as Dynamic, and a rebuilt chassis body invalidates the
  vehicle controller (`genesys-vehicles`).

## Source index

| File | Contents |
| --- | --- |
| `.engine/src/physics/PhysicsEngine.ts` | `IPhysicsEngine`, `PhysicsShape`, ray/sweep/overlap/point/node-contact query types, `PhysicsBodyDesc` / `PhysicsBodyShape`, scalar/vector param enums, `CharacterControllerOptions` |
| `.engine/src/physics/BasePhysicsEngine.ts` | Shared engine logic; `JointType`, `JointDesc`, `createJoint`, `getActiveJoints`; node/joint/direct-body bookkeeping |
| `.engine/src/physics/IPhysicsVehicle.ts` | `VehicleWheelConfig`, `VehicleWheelState`, `VehicleState`, `IPhysicsVehicle` |
| `.engine/src/physics/PhysicsTypes.ts` | `PhysicsMotionType`, `CollisionMeshType`, `NodePhysicsOptions`, voxel/heightfield collision descriptors |
| `.engine/src/physics/createPhysicsEngine.ts` | Backend factory (Rapier only) |
| `.engine/src/physics/implementations/RapierPhysics.ts` | Rapier backend: scene queries, joints, direct bodies, collision groups/ignore, character controller |
| `.engine/src/physics/implementations/RapierVehicle.ts` | Rapier `DynamicRayCastVehicleController` wrapper backing `IPhysicsVehicle` |
| `.engine/src/nodes/SceneNode.ts` | `getPhysicsEngine()` accessor |
| `.engine/src/systems/collision/CollisionTypes.ts` | `DefaultCollisionProfile` (BlockAll, BlockAllDynamic, Character, Vehicle, Trigger, Ragdoll, …), `CollisionChannel`, `CollisionMode`, `CollisionResponse` |
| `.engine/src/systems/collision/CollisionConfig.ts` | Default profile table, `CollisionConfig.getInstance()`, `getProfile(name)`, `setup(config)` ([collision-profiles](collision-profiles.md)) |
