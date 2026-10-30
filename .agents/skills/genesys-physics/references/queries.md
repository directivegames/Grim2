# Physics queries

Source: `.engine/src/physics/PhysicsEngine.ts` (query option and result types),
`.engine/src/physics/implementations/RapierPhysics.ts` (implementation).

All scene queries share `PhysicsQueryOptions`:

| Field | Default | Meaning |
|---|---|---|
| `collisionProfile` | none (no channel filter: hits every non-trigger collider) | A profile name (`ENGINE.DefaultCollisionProfile.X` or a custom name) or a `CollisionProfile` object. The query hits only colliders whose profile and this one both accept each other's channel ([collision-profiles](collision-profiles.md)) |
| `ignoredRootNodes` | none | Skip these roots and everything under them. Pass `node.getRoot()!`, never a visual child |
| `ignoredNodes` | none | Skip exactly these nodes |
| `includeTriggers` | false | Include trigger volumes |

## Raycasts / hit tests

Use `raycast(options): PhysicsQueryHit | null` for the nearest hit and
`raycastAll(options): PhysicsQueryHit[]` for every hit ordered nearest first.

- Options (`PhysicsRaycastOptions`): `origin`, `direction` (normalized internally), `maxDistance`,
  plus the shared fields.
- Results (`PhysicsQueryHit`): `hitLocation`, `hitNormal`, `hitNode` (`PrimitiveNode | null`),
  `distance`.
- `performHitTest` is deprecated and does not normalize `direction`. Use `raycast` or `raycastAll`.

## Line of sight

The short version is in [SKILL.md → Build](../SKILL.md#build). `hasLineOfSight` uses the `SpringArmCamera` profile so walls block and characters do not.

Source: Composed — typechecked against 18.1.0-alpha.317 (`PhysicsEngine.ts` `raycast`, `SpringArmNode.ts` profile lookup)
```ts
/** Walls block, characters don't: the SpringArmCamera profile ignores the Pawn channel. */
export function hasLineOfSight(from: ENGINE.SceneNode, to: ENGINE.SceneNode, eyeHeight = 1.5): boolean {
  const physics = from.getPhysicsEngine();
  if (!physics) return false;
  const eye = from.getWorldPosition(new THREE.Vector3());
  const target = to.getWorldPosition(new THREE.Vector3());
  eye.y += eyeHeight;
  target.y += eyeHeight;
  const toTarget = target.clone().sub(eye);
  const hit = physics.raycast({
    origin: eye,
    direction: toTarget,                        // normalized internally
    maxDistance: toTarget.length(),
    collisionProfile: ENGINE.DefaultCollisionProfile.SpringArmCamera,
    ignoredRootNodes: [from.getRoot()!, to.getRoot()!],
  });
  return hit === null;
}
```

## Sweeps, overlaps, and point queries

Shape queries take a `PhysicsShape` (`PhysicsShape.box(size)`, `.sphere(radius)`,
`.capsule(height, radius)`; each returns `PhysicsShape | null`), or a `PhysicsBodyShape` bag, which is
converted. Shape options add `position` and optional `rotation` (quaternion). Overlap results are
unique by node.

- `sweepShape(options)` returns the first hit along a unit `direction` up to `maxDistance`.
- `overlapShape(options)` returns nodes (`PhysicsOverlapHit`) overlapping a posed shape.
- `projectPoint(options)` returns the closest `point`, `isInside`, and `hitNode`.
- `overlapPoint(options)` returns nodes containing a `point`.

Directions are world space, and so is `forwardDirection()`, on a child node too.

Source: .engine/src/physics/PhysicsEngine.ts (`sweepShape`, `overlapShape`) — typechecked against 18.1.0-alpha.317
```typescript
const fwd = this.forwardDirection();
const sweep = physicsEngine.sweepShape({
  position: origin,
  shape: ENGINE.PhysicsShape.sphere(0.4)!,
  direction: fwd,                          // world space
  maxDistance: 8,
  ignoredRootNodes: [this.getRoot()!],
});
if (sweep?.hitNode) {
  console.log('swept into', sweep.hitNode.name, 'at', sweep.distance);
}

// Everything a camera boom would hit in a 2 m box: walls and props, not pawns.
const overlaps = physicsEngine.overlapShape({
  position: this.getWorldPosition(new THREE.Vector3()),
  shape: ENGINE.PhysicsShape.box(new THREE.Vector3(2, 2, 2))!,
  collisionProfile: ENGINE.DefaultCollisionProfile.SpringArmCamera,
});
```

## Node pair queries

These include all physics shapes attached to each `PrimitiveNode`, including compounds.

- `contactBetweenNodes(nodeA, nodeB, maxDistance?)` — closest points; negative `distance` is penetration.
- `sweepBetweenNodes(nodeA, velocityA, nodeB, velocityB, maxTime)` — first impact along world-space
  velocities. The hit (`PhysicsNodeSweepHit`) has `time` (seconds to impact), `nodeA`, `nodeB`,
  `pointA`, `pointB`, `normalA`, `normalB`.
- `getContactingNodes(node, includeTriggers?)` — nodes touching after the last physics step.

Source: .engine/src/physics/PhysicsEngine.ts (`contactBetweenNodes`, `sweepBetweenNodes`)
```typescript
const contact = physicsEngine.contactBetweenNodes(crateA, crateB, 0.05);
if (contact && contact.distance < 0) {
  console.log('penetrating by', -contact.distance);
}

const hit = physicsEngine.sweepBetweenNodes(projectile, velocity, wall, new THREE.Vector3(), dt);
if (hit) {
  console.log('impact at t=', hit.time);
}
```

## Explosion push

Overlap a sphere, then add a velocity change to every Dynamic body inside, falling off to 0 at the
radius. Kinematic characters ignore the push; knock them back with `genesys-movement`, and deal the
damage through `genesys-combat`.

Source: Composed — typechecked against 18.1.0-alpha.317 (`overlapShape`; `pushBody` from SKILL.md → *Build*)
```typescript
// Explosion: 8–15 m/s outward, falling off linearly to 0 at the radius.
export function blast(physics: ENGINE.IPhysicsEngine, center: THREE.Vector3, radius: number, strength = 12): void {
  for (const h of physics.overlapShape({ position: center, shape: ENGINE.PhysicsShape.sphere(radius)! })) {
    const body = h.hitNode;
    if (!body) continue;
    const away = body.getWorldPosition(new THREE.Vector3()).sub(center);
    const falloff = Math.max(0, 1 - away.length() / radius);
    pushBody(body, away.normalize().multiplyScalar(strength * falloff).setY(strength * falloff * 0.4));
  }
}
```

## Hitscan

There is no hitscan class to write here. `InstantHitWeaponNode` (`genesys-combat`) aims along the
screen-centre ray of its root's camera, calls `raycast` with no profile and `ignoredRootNodes: [root]`,
damages the hit root's `CharacterStatsNode`, spawns `hitSparks`, and
fires `onHit`. For a custom ray (line of sight, ground probe), use `raycast` as in *Line of sight*.

## Predicted queries

Inside GSS abilities, use `GSSAbilityContext.world.raycast`, `raycastAll`, `sweepShape`, and
`overlapShape` so the server rewinds player-owned nodes to the shooter's time. See `genesys-movement`
(GSS mechanics reference) and `genesys-multiplayer`.
