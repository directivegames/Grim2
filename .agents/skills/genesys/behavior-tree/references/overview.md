# Behavior Tree Overview

## How the system fits together

`BehaviorTreeComponent` sits on an NPC actor and runs a behavior tree each `updateInterval` seconds. Before each run it calls `blackboard.updateGameState()` so nodes can read fresh owner and player data.

The tree is a hierarchy of **nodes**. **Composite** nodes (`Sequence`, `Selector`) have children and delegate execution. **Leaf** nodes are **actions** — they perform gameplay (pathfinding, combat, waiting). **Conditions** gate whether a node may run; they attach to a node via `conditions: [...]` and are checked before that node's logic.

When the root returns `Success` or `Failure`, the component resets the tree and will run it again on the next tick. Design long-running NPC behavior as a root `Selector` whose branches cover fight, flee, patrol, idle, etc.

## Node semantics

| Node | Behavior |
| --- | --- |
| **Sequence** | Children left to right. Fails on first child failure. Succeeds when every child succeeds. Stays `Running` while a child runs. |
| **Selector** | Children top to bottom by priority. Succeeds on first child success. Fails when every child fails. Stays `Running` while a child runs. |

Every node execution yields `Success`, `Failure`, or `Running` (see `BehaviorNode.ts`).

## Blackboard

The blackboard is a per-component key/value store. Actions write outputs (e.g. next waypoint); conditions and sibling actions read them. The component owner is available via `blackboard.getOwner()`. Auto-updated keys (player position, distance, etc.) are populated in `Blackboard.updateGameState()` — read that file for the current list.

## Authoring

- **Programmatic** — build `SequenceNode` / `SelectorNode` trees in code, pass as `rootNode` on the component.
- **JSON** — asset referenced by `behaviorTreePath`; types and options map to entries in `BehaviorTreeLoader` registries.
- **Custom nodes** — built-ins are a starting point; extend `BehaviorAction` or `ConditionEvaluator` for game-specific behavior, then register types with `BehaviorTreeLoader` if you use JSON. See `BehaviorAction.ts`, `ConditionEvaluator.ts`, and `BehaviorTreeLoader.ts`.

NPC pawns need movement and combat components that match the actions you use (e.g. `NpcMovementComponent` for ground pathing, `AerialMovementComponent` for flying). Component requirements are enforced in each action's source file.

## Where to find more in engine source

Paths below are relative to `.engine/npc/behavior-tree/` (game projects) or `packages/engine/src/npc/behavior-tree/` (monorepo).

| Topic | File or folder |
| --- | --- |
| Exported API | `index.ts` |
| Component lifecycle, tick, JSON load, debug | `BehaviorTreeComponent.ts` |
| Node base, status enum, condition gating | `BehaviorNode.ts` |
| Sequence / Selector | `nodes/composite/SequenceNode.ts`, `SelectorNode.ts` |
| Action base class | `behaviors/BehaviorAction.ts` |
| Built-in actions | `behaviors/actions/` (+ `behaviors/actions/index.ts`) |
| Condition base class | `behaviors/ConditionEvaluator.ts` |
| Built-in conditions | `behaviors/conditions/` (+ `behaviors/conditions/index.ts`) |
| Blackboard | `blackboard/Blackboard.ts`, `blackboard/BlackboardKey.ts` |
| JSON schema & type registry | `loader/BehaviorTreeLoader.ts` |

Read the files above for constructor options, blackboard key names, JSON `type` strings, and custom registration (`registerNodeType`, `registerConditionType`).
