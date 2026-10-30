# Built-in nodes

Every class below is exported from `@gnsx/genesys.js` (`ENGINE.<Class>`). "JSON type" is the string registered in `BehaviorTreeLoader`. Defaults come from each constructor in `.engine/src/npc/behavior-tree/behaviors/`. Every action also accepts `name`, `description`, and `conditions`. Every condition also accepts `name`, `description`, and `invert`.

## Composites

| Class | JSON type | Options |
|---|---|---|
| `SequenceNode` | `Sequence` | `children` |
| `SelectorNode` | `Selector` | `children` |

## Ground actions (need `NpcMovementNode` on the owner)

| Class | JSON type | Options (default) | Notes |
|---|---|---|---|
| `MoveToPositionAction` | `MoveToPosition` | `targetPosition`, `targetPositionKey`, `acceptanceRadius` (2.0), `useNavigation` (true) | Default name `MoveTo`. `useNavigation` is stored but not read; `NpcMovementNode` decides whether to use the navmesh. |
| `SetNextWaypointAction` | `SetNextWaypoint` | `waypointsKey` (`PatrolWaypoints`), `indexKey` (`CurrentWaypointIndex`), `currentWaypointKey` (`CurrentWaypoint`), `loop` (true) | Writes the next waypoint for `MoveToPosition`. |
| `FollowTargetAction` | `FollowTarget`, `FollowActor` | `targetActorKey` (`PlayerActor`), `stopDistance` (2.0), `continueAfterReached` (true) | Default name `FollowActor`. With the default `continueAfterReached: true` it returns `Running` forever, even in range; set `false` to get `Success` within `stopDistance`. Clears the followed actor in `onExit`, which also runs when a failed condition or a reset cuts it off. |
| `FleeFromTargetAction` | `FleeFromTarget` | `targetActorKey` (`PlayerActor`), `targetPositionKey`, `fleeDistance` (15.0) | `maxFleeDistance`, `fleeSpeedMultiplier`, and `useNavigation` are declared but not read. |
| `WanderAction` | `Wander` | `wanderRadius` (10.0), `minWaitTime` (2.0), `maxWaitTime` (5.0), `spawnPositionKey` (`SpawnPosition`) | Stores its spawn position on first run and wanders around it. Always returns `Running`, so it needs a condition (inverted `CanSeeTarget`) to yield. Wall-clock waits. |

## Aerial actions (need `AerialMovementNode` on the owner)

| Class | JSON type | Options (default) |
|---|---|---|
| `AerialMoveToTargetAction` | `AerialMoveToTarget` | `targetActorKey` (`PlayerActor` unless the key is passed explicitly), `targetPositionKey`, `acceptanceRadius` (5.0), `hoverAboveTarget` (true), `hoverHeightOffset` (15.0) |
| `AerialSearchAction` | `AerialSearch` | `lastKnownPositionKey` (`LastKnownPlayerPosition`), `playerActorKey` (`PlayerActor`), `searchRadius` (15.0), `searchHeight` (20.0), `searchDuration` (10.0) |
| `AerialTrackTargetAction` | `AerialTrackTarget` | `targetActorKey` (`PlayerActor`), `lastKnownPositionKey` (`LastKnownPlayerPosition`), `updateInterval` (0.5) |
| `AerialWanderAction` | `AerialWander` | `wanderRadius` (30.0), `wanderHeight` (20.0), `heightVariation` (8.0), `waitTime` (3.0), `speedMultiplier` (0.7) |

Track and search write `LastKnownPlayerPosition` and `LastKnownPlayerPosition_Timestamp`.

## Combat actions

| Class | JSON type | Options (default) | Requires / does |
|---|---|---|---|
| `MeleeAttackAction` | `MeleeAttack` | `targetActorKey` (`PlayerActor`), `attackRange` (3.0), `damage` (10), `attackCooldown` (2.0 s), `attackDuration` (0.5 s) | `NpcMovementNode` (calls `stop()` on the strike). Distance check only, then `takeDamage(damage)` on the target's `CharacterStatsNode` with no hit info, instantly, with no wind-up. Returns `Running` through the cooldown while in range, `Success` after `attackDuration`, `Failure` when out of range. No telegraph, effects, or sounds; add them in a subclass (a 0.3–0.8 s wind-up before `takeDamage`, `genesys-creatures`) or a sibling action. |
| `ShootAction` | `Shoot` | `targetActorKey` (`PlayerActor`), `shootRange` (20.0), `shootCooldown` (1.5 s), `aimDuration` (0.5 s) | A `ProjectileWeaponNode` anywhere under the owner. Aims for `aimDuration`, then `tryFireAtTarget(targetPosition)`. No line-of-sight check; gate with `CanSeeTargetCondition`. Fails when out of range. |

Both time with game time (`blackboard.getGameTime()`), so pause stops them and slow motion slows them. The first attack or shot is not held back by the cooldown.

## Utility actions

| Class | JSON type | Options (default) | Notes |
|---|---|---|---|
| `WaitAction` | `Wait` | `duration` (1.0 s), `randomDuration` (false = exact; true = random 0..duration) | Wall clock. |
| `LookAtTargetAction` | `LookAtTarget` | `targetActorKey` (`PlayerActor`), `targetPositionKey`, `angleThreshold` (π/16 ≈ 11.25°), `rotationSpeed` (3.0 rad/s), `horizontalOnly` (true), `speed` (1.0) | Default name `LookAt`. Works with `NpcMovementNode` or `AerialMovementNode`. |
| `CalculateTacticalPositionAction` | `CalculateTacticalPosition` | `targetActorKey` (`PlayerActor`), `outputPositionKey` (`TacticalPosition`), `distance` (25.0), `useNavigation` (true), `angleOffset` (0) | Writes a position at `distance` from the target, snapped to the navmesh when ready. |

## Conditions

| Class | JSON type | Options (default) | Notes |
|---|---|---|---|
| `IsPlayerNearCondition` | `IsPlayerNear` | `range` (10.0) | Reads `DistanceToPlayer`. |
| `CanSeeTargetCondition` | `CanSeeTarget` | `targetActorKey` (`PlayerActor`), `targetPositionKey`, `maxDistance` (50.0), `eyeHeightOffset` (1.7), `targetHeightOffset` (1.7) | Line of sight with a `THREE.Raycaster` over scene meshes (render geometry, not physics colliders). Costly in dense scenes; raise `tickInterval` or write a physics `raycast` condition. |
| `TargetInConeCondition` | `TargetInCone` | `targetActorKey` (`PlayerActor`), `targetPositionKey`, `coneAngle` (60° total), `maxDistance` (20.0) | Vision cone for guards. |
| `HpAbovePercentCondition` | `HpAbovePercent` | `percentage` (50), `percentageKey`, `targetActorKey`, `checkOwner` (true) | Reads `CharacterStatsNode`. Use `invert` for "below". |
| `TargetBelowHpPercentCondition` | `TargetBelowHpPercent` | `percentage` (25), `targetActorKey` (`PlayerActor`) | Finishers and opportunists. |
| `HasLastKnownPositionCondition` | `HasLastKnownPosition` | `lastKnownPositionKey` (`LastKnownPlayerPosition`), `maxAge` | Clears the key once older than `maxAge` (uses the `_Timestamp` key). |
| `TimeLimitCondition` | `TimeLimit` | `timeLimit` (10.0 s), `startTimeKey` (`TimeLimitStartTime`), `autoSetStartTime` (true) | Bound a branch's duration. |
| `BlackboardValueCondition` | `BlackboardValue` | `key` (required), `value`, `operator` (`equals`) | Operators: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`, `lessThan`, `lessThanOrEqual`, `exists`, `notExists`. |

## Registry quirks

- `FollowActor` and `FollowTarget` both map to `FollowTargetAction`.
- `clearCustomRegistrations()` rebuilds the registry from a shorter list. It drops all aerial actions and `HasLastKnownPosition`. Re-register them afterwards.
- Registering an existing name replaces it, which lets a game swap in a subclass (for example a `MeleeAttack` with effects).

## Starter trees

Every long-running branch either finishes (`continueAfterReached: false`) or carries a condition that fails when a higher branch should take over, so the root keeps re-checking from the top. Grunt is `buildGruntTree` in SKILL.md.

Source: Composed — typechecked against 18.1.0-alpha.317 (built-in actions and conditions above)
```ts
const seen = (m: number) => new ENGINE.CanSeeTargetCondition({ maxDistance: m });
const notSeen = (m: number) => new ENGINE.CanSeeTargetCondition({ maxDistance: m, invert: true });
const near = (m: number) => new ENGINE.IsPlayerNearCondition({ range: m });

// Ranged: shoot when seen within 20 m; close in to 15 m when seen within 40 m; else wander.
export function ranged(): ENGINE.BehaviorNode {
  return new ENGINE.SelectorNode({ children: [
    new ENGINE.SequenceNode({ conditions: [seen(20), near(20)],
      children: [new ENGINE.LookAtTargetAction(), new ENGINE.ShootAction({ shootRange: 20 })] }),
    new ENGINE.FollowTargetAction({ stopDistance: 15, continueAfterReached: false, conditions: [seen(40)] }),
    new ENGINE.WanderAction({ wanderRadius: 8, conditions: [notSeen(40)] }),
  ] });
}

// Guard: patrol PatrolWaypoints; chase what enters the 60° cone; patrol yields while the target is in the cone.
export function guard(): ENGINE.BehaviorNode {
  return new ENGINE.SelectorNode({ children: [
    new ENGINE.MeleeAttackAction({ attackRange: 2.5, conditions: [near(2.5)] }),
    new ENGINE.FollowTargetAction({ stopDistance: 2.0, continueAfterReached: false,
      conditions: [new ENGINE.TargetInConeCondition({ coneAngle: 60 }), seen(25)] }),
    new ENGINE.SequenceNode({
      conditions: [new ENGINE.TargetInConeCondition({ coneAngle: 60, invert: true })],
      children: [
        new ENGINE.SetNextWaypointAction(),
        new ENGINE.MoveToPositionAction({ targetPositionKey: 'CurrentWaypoint' }),
        new ENGINE.WaitAction({ duration: 1.5 }),
      ] }),
  ] });
}

// Coward: flee below 30% HP, otherwise fight.
export function coward(): ENGINE.BehaviorNode {
  const healthy = () => new ENGINE.HpAbovePercentCondition({ percentage: 30 });
  return new ENGINE.SelectorNode({ children: [
    new ENGINE.FleeFromTargetAction({ conditions: [new ENGINE.HpAbovePercentCondition({ percentage: 30, invert: true })] }),
    new ENGINE.MeleeAttackAction({ attackRange: 2.5, conditions: [near(2.5)] }),
    new ENGINE.FollowTargetAction({ stopDistance: 2.0, continueAfterReached: false, conditions: [healthy()] }),
  ] });
}
```

The Guard's patrol `Sequence` re-runs `SetNextWaypoint` each time it restarts, so an interrupted leg skips to the next waypoint (verify in Play that the route still reads as a patrol). The Ranged shooter needs a `ProjectileWeaponNode` under the owner.

## Custom target conditions

`PlayerActor`, `PlayerPosition`, and `DistanceToPlayer` come from `world.getFirstPlayerPawn()` every tick, so they follow possession: while the hero drives, they describe the car. Writing `PlayerActor` yourself is overwritten next tick. Gate the root with a condition, or write the hero into your own key and pass `targetActorKey` to the actions (`IsPlayerNear` still reads `DistanceToPlayer`; write a distance condition on your key if you need one).

Source: Composed — typechecked against 18.1.0-alpha.317 (`ConditionEvaluator.ts`, `Blackboard.updateGameState`)
```ts
/** Succeeds only while the possessed pawn is the hero on foot (PlayerActor becomes the car while driving). */
export class HeroOnFootCondition extends ENGINE.ConditionEvaluator {
  protected override async onEvaluate(bb: ENGINE.Blackboard): Promise<ENGINE.BehaviorStatus> {
    const pawn = bb.getValue<ENGINE.SceneNode>('PlayerActor');
    return pawn instanceof ENGINE.CharacterPawn ? ENGINE.BehaviorStatus.Success : ENGINE.BehaviorStatus.Failure;
  }
}
```

Swap `ENGINE.CharacterPawn` for the hero's own class when the hero is a GSS or custom pawn.
