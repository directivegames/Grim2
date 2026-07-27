# mission-lifecycle — Rationale

## Why cleanup order is strictly defined

Each step in `cleanupAfterMission` depends on the previous. Swapping steps causes hard-to-reproduce bugs:

- `clearMissionPause` before `resetLevelWorld`: the teleport inside `prepareForMissionStart` must commit during the map/intro phase. Physics needs to step for that to happen.
- `missionRunner.stop` before modifying the world: a running horde tick can spawn new enemies or fire callbacks against actors you are about to destroy.
- `setGameplayUnlocked(false)` before clearing UI: UI close callbacks may try to resume gameplay.

The skill documents the proven order rather than leaving it to per-project discovery.

## Why prepareForMissionStart is called twice

The first call (during `resetLevelWorld`) restores the player during the transition so they arrive at PlayerStart while the map is visible. The second call (in `finishMissionIntro`) is a safety net: the intro sequence may run callbacks, trigger events, or toggle flags that partially reset pawn state. Calling it again right before unlocking gameplay guarantees a clean baseline regardless of what the intro did.

## Why gameplay lock and physics pause are separate flags

A pause menu needs both. A map/transition screen needs physics running (for teleport) but gameplay locked (no abilities or AI). Merging the two flags into one would require either freezing physics on the map screen (breaks teleport) or running gameplay during the pause menu (breaks game feel). Two independent flags handle all cases cleanly.

## Why transient actors need explicit tracking

`world.getActors()` includes both scene-placed and runtime-spawned actors. A naive `world.destroy(a)` loop on all actors would destroy the level geometry, spawn points, and camera. Explicit tracking (either a `Set<Actor>` or a `userData` marker) makes the cleanup scope unambiguous and safe to call from any reset path.

## Relationship to grim-mission-reset skill

The `grim-mission-reset` skill documents Grim's specific traps — KinematicVelocityBased teleport, the `setHiddenInGame` hierarchy override, the exact file sequence. This skill documents the underlying patterns that any Genesys game can follow. Use both when working on Grim; use only this one when starting a new project.
