# Game Loop

The Genesys engine uses a centralized game loop that drives frame updates, manages world lifecycle, and coordinates all game subsystems.

## Core Components

### BaseGameLoop

`BaseGameLoop` is the main entry point that initializes the engine and drives the frame update cycle:

- Creates the `Renderer`, `GameContext`, and `NetWorld`
- Manages `requestAnimationFrame` callbacks
- Calculates delta time between frames
- Orchestrates world lifecycle (load, tick, render)

**Location:** `node_modules/@gnsx/genesys.js/src/game/GameLoop.ts`

### GameContext

`GameContext` manages persistent game state throughout the application's lifetime:

- Persists across world/level transitions
- Coordinates world and GameMode lifecycle
- Manages multiplayer connection state
- Handles scene loading from file paths

**Location:** `node_modules/@gnsx/genesys.js/src/game/GameContext.ts`

## Initialization Flow

The game loop follows this startup sequence:

```
1. GameLoop.start()
   └─ 2. GameContext.startGameContext()
      └─ 3. World creation
         └─ 4. Physics engine initialization
   └─ 5. Resource loading
   └─ 6. preStart() hook
   └─ 7. Navigation server creation
   └─ 8. Manifold creation
   └─ 9. Lightmap manager creation
   └─ 10. world.beginPlay()
   └─ 11. Animation loop registration
   └─ 12. postStart() hook
```

## Tick Update Cycle

Each frame follows this update order:

```
tick(deltaTimeMS)
└─ 1. Stats begin
└─ 2. Delta time calculation
└─ 3. World.tick(deltaTime)
   └─ a. Timer system tick
   └─ b. Tween manager update
   └─ c. Actor.prePhysicsTick()
   └─ d. Physics engine tick
   └─ e. Actor.postPhysicsTick()
   └─ f. NetWorld tick (replication)
   └─ g. Stats display update
   └─ h. Audio listener sync
└─ 4. Render world
└─ 5. Stats end
```

### Physics Tick Order

Actors tick components in this order:

1. **PrePhysics** - Input handling, AI decisions, animation preparation
2. **[Physics Step]** - Physics simulation runs (Rapier)
3. **PostPhysics** - Camera updates, visual feedback, state machine transitions
