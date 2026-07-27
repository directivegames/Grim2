# Pause vs Gameplay Lock

## Two independent flags

The lifecycle system has two separate controls that are often confused:

`_paused` / `pauseGame` / `resumeGame` — controls whether physics steps. Sets `world.slomo = 0` to freeze all simulation. Used for death screens, pause menus, anything that needs time to fully stop.

`_gameplayUnlocked` / `setGameplayUnlocked` — gates game logic. Code that should not run during transitions (abilities, AI decisions, mission tick) calls `isGameplayUnlocked()` and returns early if false. Physics continues running.

## Why they are separate

During the transition from fail screen → map → mission intro:

- The fail screen needs both: physics frozen AND gameplay locked. Player cannot act, time has stopped.
- The map screen needs gameplay locked but physics running. The pawn is at the map, enemy pathfinding is not running, but physics steps so the teleport back to PlayerStart can commit on the next frame.
- The intro sequence needs gameplay locked but physics running. The pawn can be animated/moved, but the player cannot trigger abilities.
- After intro finishes: both unlocked. Normal gameplay.

## State table

| Phase            | `slomo` | `_gameplayUnlocked` | Input enabled |
|------------------|---------|---------------------|---------------|
| Gameplay         | 1.0     | true                | true          |
| Pause menu       | 0       | false               | false         |
| Fail screen      | 0       | false               | false         |
| Map screen       | 1.0     | false               | false         |
| Mission intro    | 1.0     | false               | false         |
| Gameplay unlocks | 1.0     | true                | true          |

## clearMissionPause vs resumeGame

`clearMissionPause` lifts `slomo = 0` and clears `_paused` but does NOT call `setInputEnabled(true)` or `setGameplayUnlocked(true)`. Use it at the start of cleanup to allow physics to step while input stays locked.

`resumeGame` also restores `slomo`, but additionally calls `setInputEnabled(true)`. Use it at the end of the intro when you want full gameplay to resume.
