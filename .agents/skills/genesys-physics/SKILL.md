---
name: genesys-physics
description: "Physics queries and bodies: raycasts, line of sight, overlaps, sweeps, pushing props, explosions, joints, collision channels, ignore pairs, CCD, debris; substitutes for ragdolls and bouncy or slippery materials (the engine has neither). Use for physics queries, collision layers, crates, hinges, chains, objects falling through walls, ragdoll, bouncy. Not for knockback (use `genesys-movement`), damage (use `genesys-combat`), doors (use `genesys-interactions`) or cars (use `genesys-vehicles`)."
metadata:
  tokens: 2873
---

# Physics

This skill maps the engine's physics API (Rapier is the only backend), owns collision profiles and channels, and lists what the engine does not have. The rule: **reach physics through `node.getPhysicsEngine()`, null-check it, and use the call that matches the body type — node-attached bodies and raw handles are separate systems, and kinematic characters ignore velocity writes.**

## Use another skill when
- A gun, hitscan, projectile, melee swing, or damage → `genesys-combat` (`InstantHitWeaponNode` already does the hitscan ray)
- Knocking back or launching a character or pawn → `genesys-movement` (jump-and-knockback reference)
- A door that opens and stops at an angle → `DoorNode` in `genesys-interactions`
- Triggers, pickups, moving platforms and their riders → `genesys-interactions`
- Walking, jumping, character movement → `genesys-movement` (it uses the character controller for you)
- A drivable car, wheels, suspension, `IPhysicsVehicle` → `genesys-vehicles`
- `PrimitiveNode` basics, class registration, `isRoot`, local vs world transforms → `genesys-engine`
- Predicted queries inside GSS abilities → `genesys-movement` (its GSS mechanics reference covers `GSSAbilityContext.world`)
- Physics cost and hitches → `genesys-profiler`

## Decide

| Need | Call |
|---|---|
| Line of sight, ground probe, "what is in front of me" | `raycast(options)` (nearest) / `raycastAll(options)` (all, nearest first) |
| Fat probe, "will this capsule fit" | `sweepShape(options)` |
| Explosion radius, area check now | `overlapShape(options)` |
| Is this point inside something / closest surface | `projectPoint(options)`, `overlapPoint(options)` |
| Are these two nodes touching, how deep | `contactBetweenNodes(a, b, maxDistance?)` |
| Will a fast mover hit that node this frame | `sweepBetweenNodes(a, velA, b, velB, maxTime)` |
| Who touched me after the last step | `getContactingNodes(node, includeTriggers?)` |
| Shove a Dynamic `PrimitiveNode` (crate, barrel, ball) | Add a velocity change (m/s) to `LinearVelocity` |
| Knock back a character or pawn | Not here: kinematic bodies ignore `LinearVelocity` → `genesys-movement` |
| Push a raw debris body | `applyImpulseToPhysicsBody(handle, impulse, worldSpace = true)` |
| Free swing: sign, chain, lamp, wrecking ball, flail | `createJoint({ type: Revolute / Spherical, ... })` |
| Door with an open angle | `DoorNode` (`genesys-interactions`); joints have no limits |
| Slider, piston | `JointType.Prismatic`; weld two bodies: `JointType.Fixed` |
| Hundreds of short-lived chunks not worth a node | `createPhysicsBody(desc)` raw bodies |
| Teleport a physics node | `teleportBody(node, position, rotation?)` |
| Small fast body tunnels through thin walls | `physicsOptions.enableCCD: true` |
| Two bodies must pass through each other | `setNodeCollisionIgnore(nodeA, nodeB, true)`. Profiles set channel-wide rules |

Query defaults: no `collisionProfile` means **no channel filter** — the query hits every non-trigger collider except what `ignoredRootNodes` / `ignoredNodes` remove. `InstantHitWeaponNode` relies on exactly that: `raycast` with no profile and `ignoredRootNodes: [its root]`. Triggers are excluded unless `includeTriggers: true`.

**Not in the engine — use the substitute.**

| Asked for | Engine has | Default substitute |
|---|---|---|
| Ragdoll | No ragdoll system. The `Ragdoll` collision profile exists; nothing builds one. | Death beat: tip-over/shrink tween + VFX (`genesys-creatures`). For a physical collapse, hide the model and spawn 1–3 Dynamic primitives (or raw bodies) with an outward 2–4 m/s velocity; despawn after 2–4 s. |
| Bouncy surface or ball | No restitution option on bodies. | On the collision event, write the reflected velocity × 0.6–0.8 with `setVectorParam` (verify in Play). Bounce pads for characters → `genesys-movement` (launch). |
| Slippery / sticky surface | No friction option on bodies (only vehicle wheels have friction). | Characters: movement tuning (lower deceleration) inside a trigger zone, `genesys-movement`. Props: raise `LinearDamping` for sticky; slippery props cannot be made. |

## Build

**Access.** Any `SceneNode` can reach physics: `node.getPhysicsEngine(): IPhysicsEngine | null`. It returns null before the node is in the world or when physics is not initialized.

**Direction is world space.** Query `direction` is world space. `node.forwardDirection()` is world space on any node, a child (muzzle, visual) included; `forwardDirection(false)` is the parent-space axis. For a three camera, `camera.getWorldDirection()` is its look direction (−Z). Three's `getWorldDirection()` on a non-camera node returns world **+Z**.

**Raycast.** Options: `origin`, `direction` (normalized internally), `maxDistance`, plus shared `collisionProfile`, `ignoredRootNodes`, `ignoredNodes`, `includeTriggers` (default false). Hits carry `hitLocation`, `hitNormal`, `hitNode`, `distance`; `performHitTest` is deprecated and does not normalize `direction`; use `raycast` or `raycastAll`. A query's `collisionProfile` takes a profile name (`ENGINE.DefaultCollisionProfile.X`) or a `CollisionProfile` object. Line of sight is a raycast with the `SpringArmCamera` profile (walls block, characters don't) that ignores both roots: `hasLineOfSight` in [queries](references/queries.md#line-of-sight).

**Push a dynamic body.** There is no impulse call for scene nodes. Add a velocity change in m/s, which needs no mass. Crate shove 3–6 m/s horizontal plus 1–2 m/s up; explosion 8–15 m/s falling off to 0 at the radius. This moves only `Dynamic` bodies.

Source: Composed — typechecked against 18.1.0-alpha.317 (`PhysicsEngine.ts` `PhysicsVectorParam`, `getVectorParam`, `setVectorParam`)
```ts
/** Shove a Dynamic PrimitiveNode by a velocity change in m/s (mass-independent). */
export function pushBody(body: ENGINE.PrimitiveNode, deltaV: THREE.Vector3): void {
  const physics = body.getPhysicsEngine();
  if (!physics) return;
  const v = physics.getVectorParam(body, ENGINE.PhysicsVectorParam.LinearVelocity) ?? [0, 0, 0];
  physics.setVectorParam(body, ENGINE.PhysicsVectorParam.LinearVelocity, [v[0] + deltaV.x, v[1] + deltaV.y, v[2] + deltaV.z]);
}
```

The explosion loop (overlap → `pushBody` with falloff) is in [queries](references/queries.md). Scalars: `PhysicsScalarParam.LinearDamping`, `AngularDamping`, `GravityScale` through `getScalarParam` / `setScalarParam`. `clearVectorParam` clears a vector param.

**Tunnelling.** A small body that moves more than its own size per frame (a 0.2 m ball at 30 m/s moves 0.5 m per 60 Hz frame) passes through thin walls. Set `physicsOptions: { enableCCD: true }` on it. `PrimitiveNode` defaults to `false`; `Projectile` already turns it on.

**Joints.** `createJoint`, `getActiveJoints` and `removeJoint(id)` are on `IPhysicsEngine`. `JointDesc` is `{ type, nodeA, nodeB, anchorA, anchorB, axis? }` (anchors local, `axis` required for `Revolute` / `Prismatic`) with **no limits and no motors**, so a `Revolute` hinge swings a full 360°. Create joints after `beginPlay`, between nodes that each resolve to exactly one body; raw handles join with `createJointFromBodies`. Snippet and joint uses: [bodies-and-joints](references/bodies-and-joints.md#joints-and-constraints).

**Collision profiles.** A body's profile sets its channel and how it responds (Block, Overlap, Ignore) to every other channel; unlisted channels Block. Set it on the node with `physicsOptions.collisionProfile: ENGINE.DefaultCollisionProfile.X` (enum or name string). Pass the looked-up profile object to queries. Defaults: static level geometry `BlockAll`; moving props `BlockAllDynamic`; triggers `Trigger`; pawns `Character` (set by `CharacterPawn`; it ignores the Pawn channel); invisible bounds `InvisibleWall`. The full table, custom channels, and custom profiles: [collision-profiles](references/collision-profiles.md).

Shape and node-pair queries: [queries](references/queries.md). Body identity, raw bodies, collision-ignore semantics, the character controller, and the source index: [bodies-and-joints](references/bodies-and-joints.md).

## Limitations
- Knockback on an enemy or the player does nothing → characters are kinematic, so `LinearVelocity` writes are ignored → `genesys-movement` (jump-and-knockback reference).
- A hinged door spins all the way round → joints have no limits → `DoorNode` (`genesys-interactions`).
- A "ragdoll" or "bouncy material" option invented in code → the engine has neither → the substitutes table above.

## Traps
- A ray from a camera or muzzle child goes the wrong way → three's `getWorldDirection()` on a non-camera node (+Z) or `forwardDirection(false)` → `node.forwardDirection()`, or the camera's `getWorldDirection()`.
- A hand-written hitscan weapon class → reinvents `InstantHitWeaponNode` → use it (`genesys-combat`).
- `getPhysicsEngine()` is null → called in `initialize` or before the node is in the world → call from `beginPlay` or later, and null-check.
- Ray hits the shooter → shooter not ignored → `ignoredRootNodes: [this.getRoot()!]`.
- Ray ignores a trigger zone the design needs → triggers excluded by default → `includeTriggers: true`.
- A fast ball or bolt passes through a wall → no CCD → `enableCCD: true`.
- `teleportBody` or `setPhysicsBodyPosition` silently does nothing → wrong system for the body → `teleportBody(node, …)` for node bodies, `setPhysicsBodyPosition(handle, …)` for raw handles.
- `applyImpulseToPhysicsBody` on a scene node fails → it only takes raw handles → add to `LinearVelocity`.
- `createJoint` returns null with a console error → a compound node (contributing children) or instanced mesh has several bodies → joint single-body nodes.
- Hand-written character controller jitters on steps and slopes → reimplemented layer → use the engine movement nodes (`genesys-movement`).
- Stored `IPhysicsVehicle` goes inert after the chassis changed (`isDestroyed()` true, `getState()` null) → removing the chassis body destroys its controller → create a new vehicle; check `isDestroyed()` before use (`genesys-vehicles`).

## Done
- In Play, the query hits exactly what it should: test a hit, a miss, the shooter, and a trigger.
- Pushes move dynamic bodies by a visible amount and never move static geometry.
- A fast mover fired at the thinnest wall 10 times never passes through.
- A joint holds under load: the sign swings on its axis and the anchor body stays put.
- No physics warnings or joint errors in the console (`read_console_messages`).
- The hit is also seen and heard (`genesys-game-feel`); evidence per `genesys-verification`.

## References
- [queries](references/queries.md) — raycast, sweep, overlap, point, and node-pair queries, with snippets and the explosion push
- [collision-profiles](references/collision-profiles.md) — every default profile, channels, modes, responses, custom profiles, query filtering
- [bodies-and-joints](references/bodies-and-joints.md) — node vs raw bodies, all body calls, joints, collision ignore, character controller, footguns, source index
