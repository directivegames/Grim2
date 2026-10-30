# Brains

The short version is in [SKILL.md → Decide](../SKILL.md#decide). How each kind of creature decides and moves. Locomotion internals belong to `genesys-movement`. Tree node APIs belong to `behavior-tree`. Path queries belong to `genesys-navigation`.

## Pattern movers

For enemies whose motion is a shape, not a decision: shmup formations, bullet-hell turrets, sweepers, platformer patrols, hazards with a rhythm.

| Motion | Engine piece |
|---|---|
| Straight line, sine, spiral, orbit | Code in `tickPrePhysics` on game time (`dt`, `world.getGameTime()`) |
| Fixed route through points, back and forth | `PathMovementNode` (`path: THREE.Curve<THREE.Vector3>`, `speed` u/s, `loop: 'NoLoop' \| 'Loop' \| 'PingPong'`, `autoStart`). It also drives kinematic velocity, so riders and contacts stay in sync. |
| A → B once with easing | `TweenMovementNode` or `world.tweenManager` (`genesys-interactions`) |
| Formation | One parent root moved by code; members are children that keep local offsets. Detach a member (re-add to the world at its world transform) when it breaks off to dive. |

Rules:
- Movement runs on `dt` so pause and slow motion apply.
- A moving collider needs a kinematic body (`KinematicPositionBased`). Moving a node whose body is `Static` leaves a stale or jittering collider.
- Despawn outside the play bounds. Count it as "left", not "killed".
- Firing is a timer on game time. Telegraph each volley 0.3–0.6 s. Many bullets → the instanced field in `genesys-combat`.

### Worked example: a sine diver

Source: Composed — typechecked against 18.1.0-alpha.317 (`SceneNode.ts` `tickPrePhysics`, `isRoot`; fps-advanced `enemies.ts` constructor)
```ts
@ENGINE.GameClass()
export class SineDiver extends ENGINE.PrimitiveNode {
  @ENGINE.property() public speed: number = 6;
  @ENGINE.property() public amplitude: number = 3;
  private startX = 0;
  private t = 0;

  constructor() {
    super();
    this.isRoot = true;   // damage and pickups resolve through getRoot()
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.startX = this.position.x;
    return true;
  }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    this.t += dt;
    this.position.z += this.speed * dt;                        // advance
    this.position.x = this.startX + Math.sin(this.t * 2) * this.amplitude;
  }
}
```

Create it with `physicsOptions: { enabled: true, motionType: ENGINE.PhysicsMotionType.KinematicPositionBased, collisionProfile: ENGINE.DefaultCollisionProfile.BlockAll }` and a collider child (`contributeToParentCollider: true`), so moving the transform moves the collider. Add `EnemyHealth` like any enemy. For fixed routes, use `PathMovementNode` (`PingPong`, kinematic-aware) or `TweenMovementNode` (`genesys-interactions`). Despawn pattern movers that leave the play bounds.

## Seekers (open arena, no navmesh)

Steer toward the player every tick. Options:
- A `CharacterPawn` with `NpcMovementNode` and `setTargetActor(player, followDistance)`. With no navmesh ready, it paths in a straight line, which is what an open arena wants. Add a navmesh later and the same code walks around obstacles.
- A kinematic primitive moved by code toward the player's position at a capped speed, with a turn rate (3–6 rad/s) so it can be dodged.

Add separation so a horde does not stack into one blob: offset each seeker's target by a small per-enemy angle and radius around the player, or vary `stopDistance` between 1.2 and 2.0.

## Behavior-tree walkers (levels with walls)

**Classic stack (default).** A `CharacterPawn` subclass whose `createMovementNode()` returns `NpcMovementNode`, plus a `BehaviorTreeNode` and a `CharacterStatsNode`. Every built-in ground action (`MoveToPosition`, `FollowTarget`, `FleeFromTarget`, `Wander`, `MeleeAttack`) calls `owner.getNode(NpcMovementNode)` and warns when it is missing. `LookAtTarget` works with `NpcMovementNode` or `AerialMovementNode`. `Shoot` needs a `ProjectileWeaponNode` anywhere under the owner.

`NpcMovementNode` API: `setTargetPosition(pos, stopDistance?)`, `setPath(points, looped?)`, `setTargetActor(actor, followDistance?, continueAfterReached?)`, `followActor` / `setFollowedActor`, `getFollowedActor()`, `setLookAtTarget(pos, threshold?)`, `stop()` (clears path, target, and followed actor), `stopMovement()` (zeroes input only; keeps the target and look-at), `canUseNavigationServer()`, `getCurrentTarget()`, `getCurrentPath()`. Options: `maxSpeed` (20 m/s when omitted), `lookRightSpeed` (10 when omitted), `stopDistance` (1), `pathFollowingAccuracy` (0.5), `actorFollowingDistance` (4), `useNavigationServer` (true).

**GSS stack.** A `GSSCharacterPawn` possessed by an `AIController` (`controller.possess(pawn)`, on the server or standalone). `AIController` methods: `moveToPosition(dest, acceptanceRadius?)`, `moveToTarget(target, followDistance?, continueAfterReached?)`, `followPath(points, looped?)`, `stopMovement()`, `setLookAtTarget(target | point, threshold?)`, `clearLookAtTarget()`, `isLookingAtTargetComplete()`. Options: `pathFollowingAccuracy` 0.5, `acceptanceRadius` 1.0, `followDistance` 4.0, `turnSpeed` 10, `useNavigationServer` true, `debugVisualization`. `AIController` is not replicated; AI runs on the authority. The built-in ground tree actions do not drive it, so write custom `BehaviorAction`s that call these methods. Use this stack when the player is a GSS pawn that bumps, shoots, or dashes through these enemies online (`genesys-movement` covers rewind and prediction). A pawn that acts but never walks uses `GSSIdleMode`. `MoverNode` was removed in engine 19.

**Starter trees** (built from engine nodes; full code in `behavior-tree` → built-in-nodes → *Starter trees*). A `Selector` re-checks earlier branches only after the running branch finishes, so every long-running branch must end (`continueAfterReached: false`) or carry a condition that fails when a higher branch should take over. `Follow` is `FollowTargetAction`; when its condition fails it stops following.
- Grunt: `Selector[ MeleeAttack (IsPlayerNear 2.5), Follow (CanSeeTarget 30; stopDistance 2, continueAfterReached false), Wander (CanSeeTarget 30, invert) ]`
- Ranged: `Selector[ Sequence[ LookAtTarget, Shoot ] (CanSeeTarget 20, IsPlayerNear 20), Follow (CanSeeTarget 40; stopDistance 15, continueAfterReached false), Wander (CanSeeTarget 40, invert) ]`. Ground enemies never get `LastKnownPlayerPosition` (only the aerial track/search actions write it), so do not gate them on `HasLastKnownPosition`.
- Guard: `Selector[ MeleeAttack (IsPlayerNear 2.5), Follow (TargetInCone 60°, CanSeeTarget 25; stopDistance 2, continueAfterReached false), Sequence (TargetInCone 60°, invert)[ SetNextWaypoint, MoveToPosition(targetPositionKey: 'CurrentWaypoint'), Wait 1.5 ] ]` with `PatrolWaypoints` (Vector3 array) on the blackboard
- Coward: `Selector[ FleeFromTarget (HpAbovePercent 30, invert), MeleeAttack (IsPlayerNear 2.5), Follow (HpAbovePercent 30; stopDistance 2, continueAfterReached false) ]`

`PlayerActor` is whatever pawn the player possesses: while the hero drives a vehicle it is the car, so enemies chase and "melee" the car. Gate the tree with a hero-on-foot condition (`behavior-tree` Traps) when that is wrong for the design.

### Worked example: a grunt

`NpcMovementNode` reads `maxSpeed`, `lookRightSpeed`, `stopDistance`, `pathFollowingAccuracy`, `actorFollowingDistance`, and `useNavigationServer`. Omit `maxSpeed` and the speed is the player's 5 m/s. A spring arm traces only while its camera is the rendered view, so an enemy pawn does not pay for a camera ray.

Source: Composed — typechecked against 18.1.0-alpha.317 (`NpcMovementNode.ts` `initialize`, `SpringArmNode.ts` `tracesForActiveView`)
```ts
@ENGINE.GameClass()
export class Grunt extends ENGINE.CharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return ENGINE.NpcMovementNode.create({
      name: 'MovementNode',
      maxSpeed: 4,
      lookRightSpeed: 8,
      stopDistance: 1.5,
      pathFollowingAccuracy: 0.5,
      actorFollowingDistance: 4,
    });
  }

  public override initialize(options?: ENGINE.CharacterPawnOptions): void {
    super.initialize(options);
    this.add(
      EnemyHealth.create({ name: 'Health', maxHealth: 60, healthRegen: 0 }), // genesys-combat
      ENGINE.BehaviorTreeNode.create({ rootNode: buildGruntTree() }),        // behavior-tree
    );
  }
}
```

The tree reads `PlayerActor`, `PlayerPosition`, and `DistanceToPlayer` from the blackboard (refreshed each tick). The first tree is `Selector[ melee in range → chase until in range → wander while unseen ]`; `buildGruntTree` is in `behavior-tree`. Its Follow uses `continueAfterReached: false` (or the enemy chases forever and never attacks). More starters: the starter trees above.

## Aerial

A root with `AerialMovementNode` (options: `maxSpeed`, `accelerationLambda`, `decelerationLambda`, `hoverHeight`, `hoverVariation`, `rotationSpeed`, `maxTiltAngle`; API: `setTargetPosition`, `clearTarget`, `setLookAtTarget`, `getCurrentVelocity`). It has no navigation. Tree actions: `AerialMoveToTarget`, `AerialSearch`, `AerialTrackTarget`, `AerialWander`.

## Turrets and stationary enemies

A static root with a collider, health, and a weapon node. Each tick (or every 0.2 s): find the target (player or nearest enemy in range), rotate the visual head toward it at a capped turn rate, check line of sight with `raycast`, and `tryFireAtTarget(targetPos)`. Telegraph with a charge glow before the shot.

## Friendly NPCs

No `CharacterStatsNode` unless they can be hurt. Movement as above. Talking, trading, or quest prompts use a `ProximityInteractableNode` subclass (`genesys-interactions`). Never show dialogue from network or player strings with `innerHTML` (`genesys-ui` Safe UI).

## Bosses

- One root, several attacks, phases from HP. Subscribe to `onHealthChanged(current, max)` and switch phase when `current / max` crosses 0.66 and 0.33. In a tree, gate branches with `HpAbovePercentCondition` (`checkOwner: true`).
- Phase transition: 1 s of invulnerability (the `takeDamage` override in `genesys-combat`), a roar or flash, and a camera beat.
- Every attack has a 0.5–1.0 s telegraph and a punish window after it.
- Boss bar on the HUD top center (`genesys-ui`). Name label through a text setter.
- Death is the biggest moment in the game: longer reaction (1–2 s), hitstop, music sting (`genesys-game-feel`, `genesys-audio`).

## Animation

A rigged character's animation is driven by the pawn's `AnimationStateMachineNode` (`CharacterPawn.setupAnimationNode`, config `mannequin.animconfig.json`). Read its class file in the API digest, then its source at those line ranges (`genesys-engine` → Find an engine class), before changing it. Do not build a second retarget pipeline.

**What exists.** The engine mannequin (`@engine/assets/character/mannequinG.glb`, the `CharacterPawn` default) ships Idle, Walk, Run, RunBackward, StrafeLeft, StrafeRight, and Jump. There are no attack, hit, or death clips. Custom clips are authored on the mannequin rig in `genesys-blender-modeling`; when they exist, play hit and death clips from `onHealthChanged` and `onDeath`, hold the last death frame ~0.5 s, then the burst VFX: **animation first, particles second.** Until then, use the procedural defaults below.

**Attacking while moving.** `AnimationStateMachineNode` supports one masked `layer` (`layer.mask` naming an entry in `masks`, bone or role selectors) so an upper-body attack plays over the walk. The built-in `MeleeAttackAction` calls `NpcMovementNode.stop()` when it strikes; for an enemy that presses forward, use a custom attack action that keeps following (`behavior-tree`).

**Instances animate independently.** `ModelMeshNode` clones the loaded scene per instance (`SkeletonUtils.clone`), and each `AnimationStateMachineNode` owns its own `AnimationMixer`, so enemies do not animate in lockstep. A hand-rolled `THREE.AnimationMixer` on a shared, cached glTF scene does: clone the scene per instance.

**Facing.** Wrap every model in a visual child and give it a per-model yaw correction (the mannequin's is π, as `CharacterPawn.setupVisualNode` does). Find each new model's value by looking at it from the front in Play, 10 s per type. Never negative scale.

**Procedural motion** for unrigged or clip-less bodies, applied to the visual child each tick:

Source: Composed — typechecked against 18.1.0-alpha.317 (`World.tweenManager`, `TweenManager.createTween` / `getCurrentTime`)
```ts
/** Procedural motion for an unrigged body. Call each tick on the VISUAL child, never the root. */
export function animateBody(
  visual: THREE.Object3D, baseY: number, t: number,
  speed: number,        // current planar speed, m/s
  windUp: number,       // 0..1 during the attack telegraph, else 0
  quadruped = false,
): void {
  const stride = 4 + speed * 1.5;                       // rad/s; faster gait at speed
  const moving = Math.min(1, speed / 2);
  visual.position.y = baseY + moving * 0.05 * Math.abs(Math.sin(t * stride));   // gait bob
  visual.rotation.z = quadruped
    ? moving * 0.06 * Math.sin(t * stride)                                    // quadruped roll
    : (1 - moving) * 0.02 * (Math.sin(t * 1.3) + 0.5 * Math.sin(t * 2.9));    // idle sway
  visual.scale.set(1, 1, 1 + 0.08 * windUp);           // lunge stretch +8% Z on wind-up
}

/** Death beat without a death clip: tip over and shrink over `seconds`, after the hit VFX. */
export function playDeathBeat(world: ENGINE.World, visual: THREE.Object3D, seconds = 0.4): void {
  const s = { t: 0 };
  const startScale = visual.scale.clone();
  const startTilt = visual.rotation.x;
  world.tweenManager.createTween(s)
    .to({ t: 1 }, seconds * 1000)                       // tween durations are milliseconds
    .onUpdate(() => {
      visual.rotation.x = startTilt - (Math.PI / 2) * s.t * s.t;
      visual.scale.copy(startScale).multiplyScalar(1 - 0.5 * s.t);
    })
    .start(world.tweenManager.getCurrentTime());
}
```

Call `playDeathBeat` from the enemy's `onDeath` listener with its visual child; `EnemyHealth` (`genesys-combat`) removes the root 0.5 s later. Feel numbers are starting points (verify in Play). The hit pop and flash are `genesys-game-feel`'s.

## Limitations

- Code asks the mannequin for "Attack", "Hit", or "Death" clips and nothing plays → those clips do not exist → procedural reactions (*Animation*), or custom clips (`genesys-blender-modeling`).

## Traps

- Enemies pile into one spot → same target and no spread (`Character` profiles do not block each other) → offset targets per enemy (`CalculateTacticalPositionAction` with `angleOffset`), or vary `stopDistance`.
- A "smart" enemy is a 200-line `tick` of if-statements → hand-rolled brain → behavior tree with conditions on branches.
- A walker plays its idle clip while it moves → `CharacterPawn` sets `isRunning` only above `runSpeedThreshold` (default 2 m/s) → lower it on the enemy pawn (`genesys-blender-modeling` → rigged-characters).
