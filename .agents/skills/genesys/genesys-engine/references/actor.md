# Actor

## Overview

An **Actor** is the base class for any object that can exist in a Genesys world. It serves as a container for components and provides lifecycle management, networking support, and spatial operations.

## Key Concepts

### Root Component Architecture

Every Actor has exactly one **root SceneComponent** that serves as its transform anchor. All other components attach to this root, forming a hierarchical tree.

- The root component provides the Actor's world position, rotation, and scale
- Components added to the Actor are automatically parented to the root
- You can replace the root component dynamically with `setRootComponent()`

**Reference:** See `node_modules/@gnsx/genesys.js/src/actors/Actor.ts` for the root component implementation.

### Actor Lifecycle

Actors follow a strict lifecycle managed by the World:

1. **Creation** — `Actor.create(options)` factory method instantiates and initializes
2. **World Entry** — `world.addActor(actor)` triggers `beginPlay()`
3. **Ticking** — `tickPrePhysics()` → [physics simulation] → `tickPostPhysics()` every frame
4. **World Exit** — `actor.destroy()` or `world.removeActor(actor)` triggers `endPlay()` and cleanup

**Reference:** See lifecycle methods in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts` (lines ~247-290, ~475-515).

### Identification & Tags

Actors support multiple identification mechanisms:

- **`uuid`** — Permanent unique identifier generated at creation
- **`name`** — Human-readable identifier (auto-generated, customizable)
- **`actorTags`** — String array for categorization and filtering

## Usage Patterns

### Creating Actors

**Rule of thumb:** Use `Actor.create()` when you have the class imported. Use `spawn()` when you only have a registered class name or prefab path.

Both methods instantiate and initialize an Actor. **Neither adds it to the world** — you must call `world.addActor(actor)` separately.

```typescript
// When you have the class reference:
import { MyEnemy } from './MyEnemy';
const enemy = MyEnemy.create({ position: new THREE.Vector3(0, 10, 0) });
world.addActor(enemy);

// When you have a registered class name:
const enemy = spawn("MyEnemy", { position: new THREE.Vector3(0, 10, 0) });
world.addActor(enemy);

// When spawning a prefab:
const boss = spawn("prefabs/enemies/boss", { position: new THREE.Vector3(20, 0, 0) });
world.addActor(boss);

// Or use the async version for non-blocking behavior:
const hero = await spawnAsync("prefabs/characters/hero", { position: new THREE.Vector3(0, 0, 0) });
world.addActor(hero);
```

**Reference:** See `Actor.create()` in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts` and `spawn()` in `node_modules/@gnsx/genesys.js/src/utils/Spawn.ts`.

### Construction Sequences

**From `Actor.create()` or `spawn()`:**
1. Constructor
2. `initialize(options)`
3. `world.addActor()` → `beginPlay()`

**From serialized data (levels, prefabs):**
1. Constructor
2. Deserialize properties
3. `postLoad()`
4. `world.addActor()` → `beginPlay()`

**Which pattern to use:**
- **Constructor** — Setup that is identical for every instance (creating internal objects, setting up defaults)
- **Initialize** — Setup that uses values passed from `create()` or `spawn()` (runtime configuration)
- **PostLoad** — Setup that reacts to values loaded from saved files or prefabs (deserialized configuration)
- **BeginPlay** — Setup that requires the actor to be in the world (finding other actors, registering with systems)

### Component Management

Add components to build Actor functionality:

```typescript
// Add a single component
actor.addComponent(meshComponent);

// Add multiple components
actor.addComponents(component1, component2, component3);

// Query components
const mesh = actor.getComponent(MeshComponent);
const allMeshes = actor.getComponents(MeshComponent);
```

**Reference:** See `addComponent()`, `getComponent()` methods in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts`.

### Transform Operations

Actors provide world-space position, rotation, and scale access through their root component. You can read or write the complete transform at once, or work with individual values like position only. Actors also expose direction vectors (forward, right, up) based on their current rotation, useful for movement and aiming logic.

**Reference:** See transform methods in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts`.

## Lifecycle Events

Actors expose delegates for lifecycle events including world entry and exit, pre- and post-physics ticks, collision and overlap changes, and editor interaction events. Subscribe to these to react to actor state changes without subclassing.

**Reference:** See delegate declarations in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts`.

## Common Actor Types

The engine provides built-in Actor subclasses for characters, controllers, projectiles, spawn points, visual effects, and game logic containers.

**Reference:** See actor subclasses in `node_modules/@gnsx/genesys.js/src/actors/`.

## Visibility & Editor

Actors support editor and runtime visibility controls:

```typescript
// Hide in game (still visible in editor)
actor.setHiddenInGame(true);

// Editor-only actor (not spawned in game)
actor.setEditorOnly(true);

// Temporary actor (not serialized)
actor.setTransient(true);
```

### Description System

Actors can generate structured descriptions for debugging and AI assistants:

```typescript
const description = actor.describe({
  includeComponentsDetails: true  // Include full component tree
});
```

**Reference:** See `describe()` in `node_modules/@gnsx/genesys.js/src/actors/Actor.ts` (lines ~1086-1128).

## Related Systems

- `SKILL_DIR/references/world-actor-component-overview.md` — Relationship between world, actors, and components
- `SKILL_DIR/references/property-serialization-system.md` — How actors are saved and loaded
