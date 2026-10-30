# Game loop

Source: .engine/src/game/GameLoop.ts, .engine/src/game/World.ts

## Core pieces

**BaseGameLoop** — the entry point that initializes the engine and drives the frame cycle.
- Creates the renderer, the World, and the NetWorld.
- Manages `requestAnimationFrame` callbacks (or the XR loop).
- Orchestrates the world lifecycle (load, tick, render).
- Owns `physicsEngine` and `navigationServer` (getters on the loop; reach them as `world.gameLoop?.physicsEngine`).

**World lifecycle** — owned by `BaseGameLoop`:
- A private `startWorldLifecycle()` creates the World and initializes physics and navigation on the loop.
- Loop state persists across world/level transitions.
- Coordinates the World, the GameMode, and scene loading. The GameMode class comes from `defaultGameModeClass` in `BaseGameLoopOptions`.

## Initialization flow

1. `GameLoop.start()`
2. Create the renderer (non-headless)
3. `startWorldLifecycle()` — world creation and physics/nav setup
4. `enterPlayMode()` → `world.beginPlay()`
5. Register the animation loop (`requestAnimationFrame` / XR loop)
6. `resourceManager.waitForResources(...)`, then the protected `postStart()` hook

## Tick cycle

1. `World.tick(deltaTime)`
   1. Next-tick functions (`runInNextTick`)
   2. Timer system
   3. Tween manager
   4. SceneNode pre-physics tick
   5. Physics engine tick (`gameLoop.physicsEngine`)
   6. SceneNode post-physics tick
   7. NetWorld tick (replication)
2. Render the world

`World.tick` returns early when play state is not Playing, when the world is paused, or when `deltaTime <= 0`.

## What goes in each phase

1. **Pre-physics** — input handling, AI decisions, movement intent, animation preparation.
2. **Physics step** — the simulation runs (Rapier).
3. **Post-physics** — camera updates, visual feedback, state machines that react to collisions.

Screen state (title, play, pause, result) is a GameMode concern; see `genesys-game-boot`.
