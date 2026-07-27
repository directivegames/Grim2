# crowd-enemy-steering

Extracted from Grim2's zombie swarm system (`src/actors/zombie-steering.ts`).

## Why this steering model

Simple seek-only steering causes all agents to converge on the same point and stack on top of each other. Adding separation pushes them apart but they still form a chaotic blob. The tangential orbit component curves agents into a stable ring around the target — they stop jostling once they reach attack range and spread around the circumference instead.

The three forces are blended by distance:
- Far away: seek dominates, agents rush in.
- Mid ring: tangential orbit blends in, agents start curving around.
- Close (within attackRange): orbital weight fades to zero, agents commit to the attack.

## Why scratch objects

All `THREE.Vector3` instances are pre-allocated at agent spawn and reused each frame. This avoids GC pressure from thousands of per-frame allocations in a large crowd.

## Why a stable tangential sign

The sign (+1 or -1) determines which way each agent orbits. It is derived from a hash of the agent's spawn index so it is deterministic and consistent across frames. A random sign computed each tick causes the tangential force to flip direction every frame, which makes agents vibrate horizontally rather than orbit smoothly.

## Source

Extracted from `src/actors/zombie-steering.ts` in Grim2. Renamed from `ZOMBIE_STEER_*` to `STEER_*` and from `ZombieSteerScratch` / `computeZombieSteerGoal` to `CrowdSteerScratch` / `computeCrowdSteerGoal`. No logic was changed.
