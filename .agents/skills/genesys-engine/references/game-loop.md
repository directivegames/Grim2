# Game Loop

## Core Components

BaseGameLoop — Main entry point that initializes the engine and drives the frame update cycle.
- Creates Renderer, GameContext, and NetWorld.
- Manages requestAnimationFrame callbacks.
- Orchestrates world lifecycle (load, tick, render).

Reference: See GameLoop.ts in engine source.

GameContext — Manages persistent game state throughout the application's lifetime.
- Persists across world/level transitions.
- Coordinates world and GameMode lifecycle.
- Handles scene loading from file paths.

Reference: See GameContext.ts in engine source.

## Initialization Flow

1. GameLoop.start()
2. GameContext.startGameContext()
3. World creation and physics initialization
4. Resource loading
5. world.beginPlay()
6. Animation loop registration

## Tick Update Cycle

1. World.tick(deltaTime)
   a. Timer system tick
   b. Tween manager update
   c. Actor.prePhysicsTick()
   d. Physics engine tick
   e. Actor.postPhysicsTick()
   f. NetWorld tick (replication)
2. Render world

## Physics Tick Order

1. PrePhysics — Input handling, AI decisions, animation preparation.
2. Physics Step — Physics simulation runs (Rapier).
3. PostPhysics — Camera updates, visual feedback, state machines.
