# Game Loop

## Core pieces

BaseGameLoop — Main entry point that initializes the engine and drives the frame update cycle.
- Creates Renderer, World (via `startWorldLifecycle`), and NetWorld.
- Manages requestAnimationFrame callbacks.
- Orchestrates world lifecycle (load, tick, render).

Reference: See GameLoop.ts in engine source.

World lifecycle (formerly GameContext) — Owned by BaseGameLoop:
- `startWorldLifecycle()` creates the World and initializes physics/navigation on the game loop.
- Persists across world/level transitions via GameLoop state.
- Coordinates world and GameMode lifecycle and scene loading.

There is no separate `GameContext` class.

## Initialization flow

1. `GameLoop.start()`
2. Create renderer (non-headless)
3. `startWorldLifecycle()` — world creation and physics/nav setup on the game loop
4. `enterPlayMode` / `world.beginPlay()`
5. Register animation loop (`requestAnimationFrame` / XR loop)
6. `waitForResources` then `postStart()`

## Tick update cycle

1. World.tick(deltaTime)
   a. Timer system tick
   b. Tween manager update
   c. SceneNode pre-physics tick
   d. Physics engine tick (`gameLoop.physicsEngine`)
   e. SceneNode post-physics tick
   f. NetWorld tick (replication)
2. Render world

## Physics tick order

1. PrePhysics — Input handling, AI decisions, animation preparation.
2. Physics Step — Physics simulation runs (Rapier).
3. PostPhysics — Camera updates, visual feedback, state machines.
