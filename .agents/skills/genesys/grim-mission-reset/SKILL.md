---
name: grim-mission-reset
description: Critical knowledge for how Grim's mission reset, teleport, and death/visibility work in this Genesys project. Use when touching mission reset, player teleport, death handling, setHiddenInGame, returnToMap, cleanupAfterMission, prepareForMissionStart, or Grim's visibility after death.
---

# Grim Mission Reset — Critical Architecture

## How the physics body moves (READ THIS FIRST)

Grim's root component is `KinematicVelocityBased`. This means:

- **`sendPosition` is always `false`** in `IsometricMovementComponent._applyControllerMovement`
- Writing `rootComponent.position` directly **does nothing** — the physics body drives the component, not the reverse
- `physics.updateTransform(root)` **does nothing** for `KinematicVelocityBased` (no case for it in Rapier's `doUpdateTransform`)
- **The only way to teleport Grim** is `mc.setPawnWorldTransform({ position })`, which sets `this.teleportPosition` and is committed on the next physics tick by `_applyControllerMovement`

## How the teleport commit works

`IsometricMovementComponent._applyControllerMovement` runs every frame **even when gameplay is locked**, including during map / Ready-To-Reap. When `teleportPosition` is set it overrides the movement delta with `teleportPos - currentWorldPos` and passes `ignoreCollision: true` to the character controller. The Rapier body then moves via `setLinvel`.

**Prerequisite:** `world.slomo` must be > 0. Death calls `pauseGame()` which sets `slomo = 0`. Always call `clearMissionPause(world)` **before** triggering any teleport.

## Why Grim goes invisible on death

The engine's base `Actor.handleDeath()` calls `this.destroy()`. Since `IsometricPlayerPawn` originally had no override, the actor was destroyed/removed on zero HP.

**Fix:** `IsometricPlayerPawn` overrides `handleDeath` as a no-op:

```typescript
public override handleDeath(_hitInfo?: ENGINE.DamageHitInfo): void {
  /* no-op — mission fail is handled by _onHealthChanged → missionState.onGrimDied() */
}
```

Mission fail is signalled by `_onHealthChanged` → `missionState.onGrimDied()`, not by actor destruction.

## Why setHiddenInGame(false) alone wasn't enough

The engine's `setHiddenInGame` sets a flag and calls `world.setActorHiddenInGame`. Death can leave child mesh objects with render layers disabled (`obj.layers.disableAll()`). The base method does not re-enable child layers.

**Fix:** `IsometricPlayerPawn` overrides `setHiddenInGame` to traverse the full hierarchy:

```typescript
public override setHiddenInGame(hidden: boolean): void {
  super.setHiddenInGame(hidden);
  this.rootComponent.visible = !hidden;
  this.rootComponent.traverse(obj => {
    obj.visible = !hidden;
    if (hidden) { obj.layers.disableAll(); }
    else { obj.layers.enable(0); }
  });
  if (!hidden) { this.setGrimGrinderVisualHidden(false); }
}
```

## The correct reset sequence

In `cleanupAfterMission` (`src/utils/return-to-map.ts`):

1. `clearMissionPause(world)` — lift `slomo=0` so physics steps
2. `setGameplayUnlocked(false)` — keep input locked
3. `missionRunner.stop(world)` — stop horde/mission ticks
4. `resetMissionWorld(world, { restorePlacedEnemies: true, resetPlayer: true })` — which calls:
   - `pawn.prepareForMissionStart()` → `setHiddenInGame(false)` + restore health + `resetToMissionSpawn()`
   - `mc.setPawnWorldTransform({ position: playerStartPos + y+2 })` → queued teleport
5. Physics steps next frame → teleport commits → Grim is at PlayerStart

In `beginMissionFromMap` (`src/utils/begin-mission-from-map.ts`), `finishMissionIntro` calls `pawn.prepareForMissionStart('finish-intro')` again as a second safety net just before gameplay unlocks.

## Things that BREAK the teleport

| Pattern | Why it breaks |
|---|---|
| `mc.clearPendingTeleport()` after `setPawnWorldTransform` | Cancels the queued teleport before physics commits it |
| `physics.updateTransform(root)` expecting it to move KVB body | No-op for KinematicVelocityBased |
| Calling teleport while `slomo = 0` (pauseGame active) | Physics doesn't step, teleport is never committed |
| `root.position.copy(target)` | Physics body ignores it; body drives root, not reverse |

## Key files

| File | Role |
|---|---|
| `src/actors/IsometricPlayerPawn.ts` | `handleDeath` override, `setHiddenInGame` override, `prepareForMissionStart`, `resetToMissionSpawn` |
| `src/components/movement/IsometricMovementComponent.ts` | `resetRuntimeMotion`, `_applyControllerMovement` (teleport commit) |
| `src/utils/return-to-map.ts` | `cleanupAfterMission` — must call `clearMissionPause` first |
| `src/utils/reset-mission-world.ts` | `resetMissionWorld` — calls `prepareForMissionStart` when `resetPlayer: true` |
| `src/utils/begin-mission-from-map.ts` | `finishMissionIntro` — second safety net reset before gameplay unlock |
| `src/utils/game-pause.ts` | `clearMissionPause` — lifts slomo without unlocking gameplay/input |

## Build and deploy

After any code change:
```bash
pnpm build && pnpm build-project
```
`pnpm build` alone does NOT update the running game. `pnpm build-project` rebuilds `.dist/game.js` which the Genesys editor loads. Then stop play and restart in the editor.
