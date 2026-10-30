# Behavior tree overview

## How the system fits together

`BehaviorTreeNode` sits on an NPC root and runs a behavior tree every `tickInterval` seconds (default `0.1`; `0` = every frame). Before each run it calls `blackboard.updateGameState()` so nodes read fresh owner and player data.

At `beginPlay` the node creates the blackboard with the owner root, initializes `rootNode`, and starts the tree if `autoStart` is true. If only `behaviorTreePath` is set, it loads the JSON asynchronously, then initializes and auto-starts. At `endPlay` it stops the tree, destroys the root node, and clears the blackboard. Each tick it stops itself if the owner root is gone or its play has ended.

The tree is a hierarchy of nodes. Composite nodes (`SequenceNode`, `SelectorNode`) have children and delegate execution. Leaf nodes are actions; they perform gameplay (pathfinding, combat, waiting). Conditions gate whether a node may run. They attach to a node via `conditions: [...]` and are checked every time that node executes, before its own logic.

When the root returns `Success` or `Failure`, the node resets the tree and runs it again on the next tick. Design long-running NPC behavior as a root `Selector` whose branches cover fight, flee, patrol, idle, and so on. An exception thrown during execution is logged, the status becomes `Failure`, and the tree resets.

## Node semantics

| Node | Behavior |
| --- | --- |
| Sequence | Children left to right. Fails on the first child failure. Succeeds when every child succeeds. Stays `Running` while a child runs. |
| Selector | Children top to bottom by priority. Succeeds on the first child success. Fails when every child fails. Stays `Running` while a child runs, and does not re-check earlier children until it finishes, so a child that never finishes (default `FollowTarget`, `Wander`) locks the tree on that branch. |

Every node execution yields `Success`, `Failure`, or `Running` (see `BehaviorNode.ts`). A failed attached condition makes the node return `Failure` without running. A node that was `Running` is reset first: a composite rewinds and resets its children, and an action that was mid-run (a Follow, a MoveTo) gets `onExit` with `Failure`, which stops its movement command. Any `reset()` of an action mid-run does the same.

Composite API: `addChild`, `addChildren`, `removeChild`, `getChildren`. Base node API: `name`, `description`, `initialize(bb)`, `execute(bb, dt)`, `reset()`, `destroy()`, `getStatus()`, `isExecuting()`, `getExecutionPath()`, `getDebugInfo()`.

## Blackboard

The blackboard is a per-tree key/value store. Actions write outputs (for example, the next waypoint); conditions and sibling actions read them. The owner is available via `blackboard.getOwner()`.

API: `setValue(key, value)`, `getValue<T>(key)`, `hasValue`, `removeValue`, `clear`, `getKeys`, `getOwner`, `getDebugInfo`. A key is a string or a typed `BlackboardKey` (`BlackboardKey.boolean / number / string / vector3 / actor / array(name, elementType, default?)`). A typed key returns its `defaultValue` when unset.

Auto-updated keys, written by `Blackboard.updateGameState()` every tick:

| Key | Value |
|---|---|
| `SelfPosition` | Owner world position |
| `PlayerPosition` | `world.getFirstPlayerPawn()` world position |
| `PlayerActor` | That pawn (the possessed pawn: a vehicle while the hero drives) |
| `DistanceToPlayer` | Distance owner → player |
| `CurrentTime` | `world.getGameTime()` |

The player keys are only written when a player pawn exists. In multiplayer, "first player pawn" is one arbitrary player, so write your own target key from a custom action.

Keys written by built-in nodes (defaults): `SpawnPosition` (Wander), `CurrentWaypointIndex` and `CurrentWaypoint` (SetNextWaypoint, which reads `PatrolWaypoints`), `TacticalPosition` (CalculateTacticalPosition), `LastKnownPlayerPosition` plus `LastKnownPlayerPosition_Timestamp` (aerial track and search), `TimeLimitStartTime` (TimeLimit).

## Authoring

- **Programmatic**: build `SequenceNode` / `SelectorNode` trees in code and pass them as `rootNode`, or call `setRootNode()`.
- **JSON**: an asset referenced by `behaviorTreePath`. Types and options map to entries in the `BehaviorTreeLoader` registries. A top-level `blackboard` object seeds keys from each entry's `defaultValue`; `"type": "Vector3[]"` arrays of `{x,y,z}` become `THREE.Vector3` arrays. `loadFromFile(path)` and `loadFromJSON(json)` are public. `getRegisteredTypes()`, `getRegisteredConditionTypes()`, `isNodeTypeRegistered()`, and `isConditionTypeRegistered()` help debug.
- **Custom nodes**: built-ins are a starting point. Extend `BehaviorAction` or `ConditionEvaluator` for game-specific behavior. If you use JSON, register them with `registerNodeType` / `registerNodeTypes` / `registerConditionType` / `registerConditionTypes`. See `BehaviorAction.ts`, `ConditionEvaluator.ts`, and `BehaviorTreeLoader.ts`.

NPC pawns need movement and combat nodes that match the actions they use (for example, `NpcMovementNode` for ground pathing and `AerialMovementNode` for flying). Each action's source file enforces its requirements.

## `BehaviorTreeNode` options and methods

The short version is in [SKILL.md → Build](../SKILL.md#build). `BehaviorTreeNode` options: `rootNode`, `behaviorTreePath`, `tickInterval` (s; the old `updateInterval` alias is removed), `autoStart` (default `true`). Methods: `setRootNode(node)` (initializes it if already playing), `startBehaviorTree()`, `stopBehaviorTree()` (resets running nodes), `getBlackboard()`, `getCurrentStatus()`, `isRunningBehaviorTree()`, and debug helpers `getDebugInfo()`, `getCurrentExecutionPath()`, `getCurrentAction()`, `getCurrentBehaviorDescription()`.

## A tree in JSON

The short version is in [SKILL.md → Build](../SKILL.md#build).

Source: .engine/src/npc/behavior-tree/loader/BehaviorTreeLoader.ts
```json
{
  "name": "Guard",
  "blackboard": {
    "PatrolWaypoints": { "type": "Vector3[]", "defaultValue": [ {"x":0,"y":0,"z":0}, {"x":10,"y":0,"z":0} ] }
  },
  "rootNode": {
    "type": "Selector",
    "children": [
      { "type": "FollowTarget", "stopDistance": 2,
        "conditions": [ { "type": "CanSeeTarget", "maxDistance": 25 } ] },
      { "type": "Sequence", "children": [
        { "type": "SetNextWaypoint" },
        { "type": "MoveToPosition", "targetPositionKey": "CurrentWaypoint" },
        { "type": "Wait", "duration": 1.5 } ] }
    ]
  }
}
```

Reference it with `behaviorTreePath: '@project/assets/ai/guard.json'`. Every property other than `type`, `name`, `description`, `children`, `child`, `condition`, and `conditions` is passed to the node constructor as an option. Custom types need `ENGINE.BehaviorTreeLoader.registerNodeType('Charge', ChargeAction)` or `registerConditionType(...)` before the tree loads (module top level in game code works).

## Where to find more in engine source

Paths are relative to `.engine/src/npc/behavior-tree/`.

| Topic | File or folder |
| --- | --- |
| Exported API | `index.ts` |
| Node lifecycle, tick, JSON load, debug | `BehaviorTreeNode.ts` |
| Node base, status enum, condition gating | `BehaviorNode.ts` |
| Composite and leaf bases | `nodes/CompositeNode.ts`, `nodes/LeafNode.ts` |
| Sequence / Selector | `nodes/composite/SequenceNode.ts`, `SelectorNode.ts` |
| Action base class | `behaviors/BehaviorAction.ts` |
| Built-in actions | `behaviors/actions/` (`ground/`, `aerial/`, `combat/`, `utility/`, each with an `index.ts`) |
| Condition base class | `behaviors/ConditionEvaluator.ts` |
| Built-in conditions | `behaviors/conditions/` (+ `index.ts`) |
| Blackboard | `blackboard/Blackboard.ts`, `blackboard/BlackboardKey.ts` |
| JSON schema and type registry | `loader/BehaviorTreeLoader.ts` |

Read these files for constructor options, blackboard key names, JSON `type` strings, and custom registration (`registerNodeType`, `registerConditionType`).

## Traps

- JSON load throws "Unknown node type" → the type is not in the registry (a custom class, or a typo in the short name) → `registerNodeType` / `registerConditionType` first.
- The tree did nothing and the console says "Cannot start - no root node set" → `autoStart` with no `rootNode` and no `behaviorTreePath` → pass one.
- The whole tree stalls (no other branch reacts) → an `onUpdate` awaits a slow promise, and `BehaviorTreeNode` skips ticks until that run finishes → keep `onUpdate` fast: start the work, return `Running`, and poll for the result on later ticks.
