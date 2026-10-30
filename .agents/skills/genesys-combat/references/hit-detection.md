# Hit detection

Every query below is on `IPhysicsEngine` (`.engine/src/physics/PhysicsEngine.ts`). Reach it with `node.getPhysicsEngine()`. Query mechanics, collision profiles, and ignore pairs are owned by `genesys-physics`. This file covers the combat choice.

## Pick the detector

| Attack | Detector | Why |
|---|---|---|
| Visible bullet, rocket, arrow, grenade | `Projectile` collision events (`onCollideWith` / `onOverlapWith`) | Built in. CCD stops tunneling at speed. Damage is already wired. |
| Instant bullet, laser, sniper | `InstantHitWeaponNode`, or `raycast` yourself | One query per shot. Exact hit point and normal. |
| Shotgun spread | N calls to `raycast` with `applySpread`-style cones, or N projectiles | `ShotgunNode` fires one projectile, so build the spread yourself. |
| Sword, punch, bite, explosion radius | `overlapShape` with a sphere or box | Catches every root in the volume once. |
| Fast melee lunge, thick beam | `sweepShape` | Volume moved along a path; returns first hit. |
| Stomp | `overlapShape` box under the feet while falling | Cheap and exact enough. |
| Hazard floor, lava, contact damage | `TriggerZoneNode` (`genesys-interactions`) with i-frames on the receiver | Enter/exit events with filters. |
| Line of sight before shooting | `raycast` from eye to target, or `CanSeeTargetCondition` in a tree | Prevents shots through walls. |
| Hundreds of bullets vs a few targets | Segment or radius test in the instanced bullet field | See `high-volume-projectiles.md`. |

A hand-written distance check (`a.distanceTo(b) < r`) is only right in the last row. Everywhere else it misses walls, ignores collider shapes, and duplicates engine code.

## Query shapes

`raycast(options) → PhysicsQueryHit | null` and `raycastAll(options) → PhysicsQueryHit[]` (nearest first)
- Options (`PhysicsRaycastOptions`): `origin`, `direction` (normalized for you), `maxDistance`, plus `PhysicsQueryOptions`: optional `collisionProfile` (a profile name such as `ENGINE.DefaultCollisionProfile.X`, or a `CollisionProfile` object; omit it to hit every non-trigger collider, as `InstantHitWeaponNode` does), `ignoredRootNodes`, `ignoredNodes`.
- Hit: `hitLocation`, `hitNormal`, `hitNode`, `distance`. Get the root with `hitNode?.getRoot()`.

`overlapShape(options) → PhysicsOverlapHit[]` (`{ hitNode }`)
- Options: `position`, optional `rotation` (quaternion), `shape`, plus `PhysicsQueryOptions`.

`sweepShape(options) → PhysicsQueryHit | null`
- Options: the overlap options plus `direction` and `maxDistance`.

`overlapPoint`, `projectPoint`, `getContactingNodes(node, includeTriggers?)`, `contactBetweenNodes(a, b, maxDistance?)`, `sweepBetweenNodes(a, velA, b, velB, maxTime)` are also available.

`PhysicsQueryOptions` (shared): `collisionProfile` (profile name or object, as above), `ignoredRootNodes`, `ignoredNodes`, `includeTriggers` (default `false`). Profiles and what each one filters: `genesys-physics` (collision-profiles reference).

`PhysicsShape` factories (return `null` for non-positive sizes): `PhysicsShape.box(fullExtents: Vector3)`, `sphere(radius)`, `cylinder(height, radius)`, `capsule(height, radius)`.

## Melee and stomp

The short version is in [SKILL.md → Melee and stomp](../SKILL.md#melee-and-stomp). The engine has no player melee weapon node: run an overlap during the active frames and damage each root once, working from the attacker's **root**.

Source: Composed — typechecked against 18.1.0-alpha.317 (`PhysicsEngine.ts` `overlapShape`, `SceneNode.forwardDirection`)
```ts
const root = attacker.getRoot()!;
const physics = root.getPhysicsEngine();
// Yawing pawn: the root turns, so root.forwardDirection() (−Z, world space) is its facing.
// Top-down pawn whose visual child turns instead:
// const fwd = visual.getWorldDirection(new THREE.Vector3()); // world +Z = front of a +Z-facing model
const fwd = root.forwardDirection();
const center = root.getWorldPosition(new THREE.Vector3()).addScaledVector(fwd, 1.2);
const hits = physics?.overlapShape({
  position: center,
  shape: ENGINE.PhysicsShape.sphere(0.8)!,
  ignoredRootNodes: [root],
}) ?? [];
for (const h of hits) {
  const target = h.hitNode?.getRoot();
  if (!target || struck.has(target)) continue;   // `struck`: a Set cleared at each swing start
  struck.add(target);
  target.getNode(ENGINE.CharacterStatsNode)?.takeDamage(20);
}
```

A stomp is the same query with `PhysicsShape.box(new THREE.Vector3(0.8, 0.2, 0.8))` under the feet, run only while falling. Bounce the player on a hit (`genesys-movement`).

## Rules

- Always ignore the attacker's root (`ignoredRootNodes: [attacker.getRoot()!]`), never a visual or weapon child. The engine weapons do this.
- Directions are world space. `forwardDirection()` is world space on any node; three's `getWorldDirection()` on a non-camera node is world +Z, the back of a −Z-facing pawn.
- Dedupe by root. One swing that overlaps an enemy's body and weapon colliders must deal damage once.
- Melee active frames: query once per frame for 80–150 ms and keep a per-swing `Set` of struck roots.
- Triggers are skipped by default. A query that should find trigger volumes needs `includeTriggers: true`.
- A target with no physics collider is invisible to every query. The enemy baseline in `genesys-creatures` requires a collider.
- Collision events need `generateCollisionEvents: true` on the primitive. `Projectile` sets it; your own hazards must too.

## Traps

- A melee swing hits behind the attacker → three's `getWorldDirection()` is +Z, the pawn faces −Z → `root.forwardDirection()` on a yawing root.
- A melee swing damages the attacker → `ignoredRootNodes` got a child, not the root → `ignoredRootNodes: [attacker.getRoot()!]`.
