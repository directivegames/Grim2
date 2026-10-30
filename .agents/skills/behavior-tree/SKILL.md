---
name: behavior-tree
description: "Behavior tree API: BehaviorTreeNode, blackboard, Selector/Sequence semantics, built-in and custom actions and conditions, JSON trees, starter trees that actually attack. Use for NPC brains, AI logic, patrol, chase, flee, guard, attack decisions, an enemy that never attacks or keeps following. Not for which enemy to build, waves, or the enemy baseline (use `genesys-creatures`), or movement tuning (use `genesys-movement`)."
metadata:
  tokens: 2653
---

# Behavior trees

Genesys behavior trees drive NPC decisions. A `BehaviorTreeNode` on the NPC root owns a blackboard and a tree of nodes, and runs the tree every `tickInterval` seconds. The rule: **use the built-in nodes first, and add custom `BehaviorAction` / `ConditionEvaluator` classes for game-specific logic**, instead of writing the brain as a long `tick` of if-statements.

All APIs, built-in nodes, and JSON registries live in `.engine/src/npc/behavior-tree/`. Start with `BehaviorTreeNode.ts` and `index.ts`. When this skill and the source disagree, the source wins.

## Use another skill when
- Which enemy needs a tree at all, enemy baseline, attack telegraphs and reactions, spawning, waves → `genesys-creatures`
- Navmesh bake and path queries the move actions rely on → `genesys-navigation`
- `NpcMovementNode`, `AerialMovementNode`, `AIController` tuning → `genesys-movement`
- Damage the attack actions deal, health the HP conditions read → `genesys-combat`
- Placing the NPC in the scene → `genesys-mcp-orchestrator`, `genesys-prefabs`

## Core concepts

- Every node returns `Success`, `Failure`, or `Running` (`BehaviorStatus`). Parents decide what to do next from that status.
- **Sequence**: run children in order; all must succeed (logical AND).
- **Selector**: try children in order; the first success wins (priority / logical OR). Child order matters. While a child returns `Running`, the Selector resumes **that child** next tick and does not re-check earlier children until it finishes. A child that never finishes (`FollowTarget` with the default `continueAfterReached: true`, `Wander`) locks the tree on that branch.
- **Conditions** attach to any node through `conditions: [...]`. All must pass before that node runs, and they are re-checked every time the node executes. They are not separate tree children. A failed condition returns `Failure`; if the node was `Running`, it is reset first, so a cut-off action runs `onExit` (with `Failure`) and stops what it started on the movement node.
- **Actions** are leaves that do work over one or more ticks (move, attack, wait).
- **Blackboard**: keys for targets, positions, and waypoints shared across the tree. Prefer keys over hard-coded `SceneNode` references.
- **Looping**: when the root finishes (`Success` or `Failure`), the tree resets and runs again on the next tick. Continuous AI uses a root `Selector`.

## Decide

| Need | Default |
|---|---|
| Authoring | TypeScript (`rootNode`) for game code. JSON (`behaviorTreePath`) when designers edit trees as assets. |
| Root | `SelectorNode` with branches in priority order: react (hurt/flee) → attack → chase → patrol/wander → idle. |
| Tick rate | `tickInterval` 0.1 s (default, 10 Hz). 0.05 s for twitchy melee. 0.2–0.5 s for background NPCs. |
| Target | `PlayerActor` (auto-filled each tick with `world.getFirstPlayerPawn()`, the possessed pawn) unless the game has multiple targets or vehicles; then write the target into a custom key from a custom action. |
| Long-running branches | Every branch ends or carries a condition that fails when a higher branch should take over: `FollowTarget` gets `continueAfterReached: false` and a `stopDistance` inside the attack range; `Wander` and patrols get an inverted "player seen" condition. |
| Timing inside custom nodes | `world.getGameTime()`, so pause and slow motion apply. |
| Movement node | `NpcMovementNode` for ground actions, `AerialMovementNode` for aerial actions. |

## Build

### A tree in TypeScript

Source: .engine/src/npc/behavior-tree/index.ts (exports), nodes/composite/SelectorNode.ts, behaviors/actions/ground/FollowTargetAction.ts — typechecked against 18.1.0-alpha.317
```ts
export function buildGruntTree(): ENGINE.BehaviorNode {
  return new ENGINE.SelectorNode({
    name: 'Root',
    children: [
      new ENGINE.MeleeAttackAction({
        damage: 15, attackRange: 2.5, attackCooldown: 1.2,
        conditions: [new ENGINE.IsPlayerNearCondition({ range: 2.5 })],
      }),
      new ENGINE.FollowTargetAction({
        stopDistance: 2.0,               // inside the melee range
        continueAfterReached: false,     // Success on arrival, so the root restarts and re-checks Melee
        conditions: [new ENGINE.CanSeeTargetCondition({ maxDistance: 30 })],
      }),
      new ENGINE.WanderAction({
        wanderRadius: 8,
        // Wander never finishes on its own; this makes it fail once the player is seen.
        conditions: [new ENGINE.CanSeeTargetCondition({ maxDistance: 30, invert: true })],
      }),
    ],
  });
}

// On the NPC root (a CharacterPawn whose movement node is NpcMovementNode):
// this.add(ENGINE.BehaviorTreeNode.create({ rootNode: buildGruntTree(), tickInterval: 0.1 }));
```

How it flows: player unseen → Melee and Follow fail, Wander runs. Player seen → Wander's condition fails, every branch has failed, the root resets, and next tick Follow runs. Follow reaches 2 m → `Success` → reset → Melee (in range) attacks; Melee returns `Running` through its cooldown and `Failure` once the player steps out of range, which falls through to Follow again. Ranged, Guard, and Coward starters with the same fixes: [built-in-nodes](references/built-in-nodes.md) → *Starter trees*.

`BehaviorTreeNode` takes `rootNode` or `behaviorTreePath`, `tickInterval` (s) and `autoStart` (default `true`); `stopBehaviorTree()` stops it, `getCurrentBehaviorDescription()` and the other debug helpers show what runs. Full options and methods: [overview](references/overview.md#behaviortreenode-options-and-methods).

### A custom action

Source: .engine/src/npc/behavior-tree/behaviors/BehaviorAction.ts
```ts
export interface ChargeActionOptions extends ENGINE.BehaviorActionOptions { duration?: number }

export class ChargeAction extends ENGINE.BehaviorAction {
  private readonly duration: number;
  private endAt = 0;

  constructor(options: ChargeActionOptions = {}) {
    super({ name: 'Charge', ...options });
    this.duration = options.duration ?? 0.8;
  }

  protected override onInitialize(_bb: ENGINE.Blackboard): void {}   // required (abstract)

  protected override onEnter(bb: ENGINE.Blackboard): void {
    this.endAt = (this.getWorld(bb)?.getGameTime() ?? 0) + this.duration;
  }

  protected override async onUpdate(bb: ENGINE.Blackboard, _dt: number): Promise<ENGINE.BehaviorStatus> {
    const now = this.getWorld(bb)?.getGameTime() ?? 0;
    return now >= this.endAt ? ENGINE.BehaviorStatus.Success : ENGINE.BehaviorStatus.Running;
  }
}
```

Lifecycle: `onInitialize` once, `onEnter` on the first update after (re)entry, `onUpdate` every tick, `onExit(bb, status)` when it returns non-`Running` or when a reset or failed condition cuts it off mid-run (status `Failure`), `onReset` when the tree resets. Release movement commands and saved state in `onExit`. `getOwner(bb)` returns the NPC root.

A custom condition extends `ConditionEvaluator` and implements `async onEvaluate(bb): Promise<BehaviorStatus>`. Every condition accepts `invert: true`.

### A tree in JSON

Reference a JSON asset with `behaviorTreePath: '@project/assets/ai/guard.json'`: a `rootNode` of typed nodes plus an optional `blackboard` seed. Every property other than `type`, `name`, `description`, `children`, `child`, `condition` and `conditions` is passed to the node constructor. Custom types need `ENGINE.BehaviorTreeLoader.registerNodeType('Charge', ChargeAction)` or `registerConditionType(...)` before the tree loads. Example Guard tree: [overview](references/overview.md#a-tree-in-json).

## Traps

- An NPC with ground actions stands still and logs "No NpcMovementNode found" → the root has no `NpcMovementNode` → use a `CharacterPawn` subclass whose `createMovementNode` returns one (`genesys-creatures`).
- `ShootAction` never fires → no `ProjectileWeaponNode` under the owner → add one (`genesys-combat`).
- The NPC chases the player forever and never attacks → `FollowTargetAction` defaults to `continueAfterReached: true` and returns `Running` even in range, so the Selector never re-checks the attack branch → `continueAfterReached: false` with `stopDistance` inside the attack range, or an inverted `IsPlayerNear` condition on Follow.
- The NPC wanders and ignores the player → `WanderAction` always returns `Running` → give it an inverted `CanSeeTarget` condition.
- A low-priority branch keeps running after a higher one should take over → a `Selector` does not re-check earlier children while a later child is `Running` → attach a condition to the long-running action so it fails when the situation changes; the root then finishes and restarts from the top next tick.
- Enemies chase or attack the car while the hero drives → `PlayerActor` is `world.getFirstPlayerPawn()`, the possessed pawn → gate the tree with a hero-on-foot condition ([built-in-nodes](references/built-in-nodes.md) → *Custom target conditions*), or write the hero into your own key and pass `targetActorKey`.
- Waits and cooldowns in a custom node ignore pause and slow motion → it times with `Date.now()` → use `blackboard.getGameTime()`, as the built-in nodes do.
- A dead NPC keeps acting → the tree still runs → `stopBehaviorTree()` in the death handler (the tree also stops itself once the owner's play has ended).
- JSON "Unknown node type", registrations lost after `clearCustomRegistrations()`, "Cannot start - no root node set", a tree stalled on a slow async `onUpdate`: [overview](references/overview.md#traps).

## Done

- `query_node` on the NPC shows a `BehaviorTreeNode` with the intended `tickInterval` and `autoStart`, and the movement node its actions need.
- In Play, `getCurrentBehaviorDescription()` (via a read-only `run_script`, `genesys-mcp-orchestrator`) changes as you approach, hide, and retreat.
- Each branch is seen at least once: idle or patrol with the player away, chase when seen, attack in range, and the react branch when hurt.
- Stand still in front of a chasing NPC: within 5 s of it arriving, it attacks (the player's health drops). Walk 3 m away: it follows again. Break line of sight: it stops following and returns to wander or patrol.
- Pausing the game freezes the NPC. Resuming does not fire a burst of queued attacks.

## References
- [overview](references/overview.md) — how the system fits together, node semantics, blackboard, authoring, `BehaviorTreeNode` options and methods, a JSON tree example, source map, loader traps
- [built-in-nodes](references/built-in-nodes.md) — every built-in action and condition with options, defaults, JSON type names, and requirements
