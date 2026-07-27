---
name: behavior-tree
description: Genesys behavior tree AI — component, blackboard, nodes, custom actions/conditions. Use for NPC AI, behavior trees, patrol/combat/aerial setups, or mentions of BT, blackboard, Selector, Sequence, BehaviorTreeComponent.
---

# What It Is

Genesys behavior trees drive NPC AI. An actor carries `BehaviorTreeComponent`, which owns a **blackboard** (shared memory) and a **tree of nodes** evaluated on a timer. Each tick the component refreshes game state on the blackboard, runs the root node, and keeps going until a branch finishes or stays `Running`.

Trees are built in TypeScript (`rootNode`) or loaded from JSON (`behaviorTreePath`). Built-in **actions** and **conditions** cover common NPC tasks; for game-specific logic you can (and usually should) add custom nodes by extending `BehaviorAction` or `ConditionEvaluator` in your project.

# Core Concepts

- **Nodes** return `Success`, `Failure`, or `Running`. Parents decide what to do next based on that status.
- **Sequence** — run children in order; all must succeed (logical AND).
- **Selector** — try children in order; first success wins (priority / logical OR). Child order matters.
- **Conditions** — attached to any node; all must pass before that node runs. Not separate tree children.
- **Actions** — leaf nodes that do work over one or more ticks (move, attack, wait).
- **Blackboard** — keys for targets, positions, and waypoints shared across the tree. Prefer keys over hard-coded actor references.
- **Looping** — when the root finishes (`Success` or `Failure`), the tree resets and runs again; continuous AI usually uses a root `Selector`.

For a fuller walkthrough, read [overview](references/overview.md).

# Engine Source

All APIs, built-in nodes, and JSON registries are defined in engine source — consult there, not this skill.

| Context | Path |
| --- | --- |
| Game project | `.engine/npc/behavior-tree/` |
| Monorepo | `packages/engine/src/npc/behavior-tree/` |

Start with `BehaviorTreeComponent.ts` and `index.ts`, then open the subfolder that matches your need. The [overview](references/overview.md) source table maps topics to files.
