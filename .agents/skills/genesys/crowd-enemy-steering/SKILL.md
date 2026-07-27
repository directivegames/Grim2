---
name: crowd-enemy-steering
description: Use when implementing NPCs that seek, surround, and orbit a target while avoiding each other. Covers seek, separation, and tangential-orbit vector steering with zero per-frame heap allocation. Use for any enemy type that should swarm or crowd a player.
---

Copy [assets/CrowdEnemySteering.ts](assets/CrowdEnemySteering.ts) into your project. The file has no ENGINE dependency — only THREE.

## Setup per agent

Allocate one `CrowdSteerScratch` and compute the tangential sign once at spawn. Never create these inside a tick.

```ts
import {
  createCrowdSteerScratch,
  tangentialSignFromSeed,
} from './CrowdEnemySteering.js';

// In beginPlay or initialize:
this._steerScratch = createCrowdSteerScratch();
this._tangentialSign = tangentialSignFromSeed(this._agentIndex);
```

`_agentIndex` must be a stable integer unique per agent (e.g. a spawn counter). Do not use `Math.random()` — the sign must not change between frames.

## Each tick

```ts
import {
  computeCrowdSteerGoal,
  ensureSteerGoalMinDistance,
  STEER_GOAL_STOP,
} from './CrowdEnemySteering.js';

// XZ seek direction toward target
this._steerScratch.toTarget.copy(targetPos).sub(myPos);
this._steerScratch.toTarget.y = 0;
const distToTarget = this._steerScratch.toTarget.length();
if (distToTarget < STEER_GOAL_STOP) return;
this._steerScratch.toTarget.normalize();

// Build separation vector from nearby agents (see references/integration-pattern.md)
const separation = this._buildSeparation(myPos);

const goal = computeCrowdSteerGoal({
  myPos,
  seekDir: this._steerScratch.toTarget,
  separation,
  tangentialSign: this._tangentialSign,
  distToTarget,
  attackRange: this.attackRange,
  scratch: this._steerScratch,
});

ensureSteerGoalMinDistance(myPos, goal, this._steerScratch.toTarget, this._steerScratch.goalDelta);

// pass `goal` to your nav or movement system
```

## Required constraints

- Call `ensureSteerGoalMinDistance` after `computeCrowdSteerGoal`. Skipping it lets the nav system receive a goal inside the agent's own capsule, causing jitter or stalling.
- Build `separation` yourself by iterating nearby agents before calling `computeCrowdSteerGoal`. See [references/integration-pattern.md](references/integration-pattern.md) for an example loop.
- `attackRange` controls where orbital blending fades out. Set it to your enemy's melee reach so agents stop orbiting and go straight in once close enough.

## Configurable constants

All tuning values are exported from the asset file. Override them or copy them into a project config:

- `STEER_SEPARATION_RADIUS` — radius within which agents push each other away (tune to capsule diameter)
- `STEER_SEPARATION_WEIGHT` — repulsion strength
- `STEER_TANGENTIAL_WEIGHT` — max orbital curve strength
- `STEER_TANGENTIAL_MIN_DIST` / `STEER_TANGENTIAL_MAX_DIST` — the ring band around the target where orbit blends in
- `STEER_LOOKAHEAD` — how far ahead of the agent the nav goal is placed
