# World, Actor, and Component System

## Overview

The Genesys engine uses a **World-Actor-Component** architecture that organizes game objects into a clear hierarchy. This pattern separates concerns between scene management (World), game entities (Actors), and functional building blocks (Components).

## Key Concepts

### World

The **World** is the runtime scene manager that owns the entire simulation. It coordinates all actors, manages global systems, and processes each tick driven by the GameLoop.

**Responsibilities:**
- Owns the Three.js `Scene` instance
- Manages actor lifecycle (spawn, tick, destroy)
- Coordinates global systems (physics, navigation, audio, particles)
- Provides actor queries and filtering
- Handles serialization of level state

**Key Systems Managed:**
- `physicsEngine` - Created via `createPhysicsEngine()`
- `navigationServer` - Created via `createNavigationServer()`
- `inputManager` - Input handling for the world
- `timerSystem` - Global timer events
- `tweenManager` - Animation interpolation
- `globalParticleManager` - World-space particle effects
- `netWorld` - Multiplayer replication

**Reference:** See `node_modules/@gnsx/genesys.js/src/game/World.ts`

### Actor

An **Actor** is any object that can exist in the world. It serves as a container for components and provides lifecycle hooks and networking support.

**Core Characteristics:**
- Every Actor has exactly one **root SceneComponent** (the transform anchor)
- Actors exist in a World (or none, if not yet spawned)
- Actors can have tags for identification and filtering
- Actors support full serialization and prefab instantiation
- Actors can be replicated over the network

**Lifecycle:**
1. `Actor.create(options)` - Factory method creates and initializes
2. `world.addActor(actor)` - Actor enters the world, `beginPlay()` called
3. `tickPrePhysics(deltaTime)` - Update before physics
4. `tickPostPhysics(deltaTime)` - Update after physics
5. `actor.destroy()` or `world.removeActor(actor)` - `endPlay()` called, cleanup

**Key Properties:**
- `uuid` - Unique identifier
- `name` - Human-readable identifier
- `rootComponent` - The transform anchor component
- `actorTags` - Array of string tags for grouping
- `replicated` - Whether this actor replicates over network

**Reference:** See `node_modules/@gnsx/genesys.js/src/actors/Actor.ts`

### Component Hierarchy

Components extend Three.js `Object3D` and form a parent-child hierarchy. There are three main component types:

#### SceneComponent

The base component class extending `THREE.Object3D`. Provides:
- Transform (position, rotation, scale)
- Lifecycle hooks (`beginPlay`, `endPlay`, `tickPrePhysics`, `tickPostPhysics`)
- Actor attachment via `getActor()`
- World position/rotation queries
- Editor integration hooks

**Key Delegates:**
- `onTickPrePhysics` - Called before physics each frame
- `onTickPostPhysics` - Called after physics each frame
- `onBeginPlay` - Called when component starts
- `onEndPlay` - Called when component ends

**Reference:** See `node_modules/@gnsx/genesys.js/src/components/SceneComponent.ts`

#### PrimitiveComponent

Extends SceneComponent for components with geometry (renderable or collision). Provides:
- Physics options management
- Collision/overlap delegates
- Physics transform sync (send/receive position and rotation)

**Physics Options:**
- `enabled` - Whether physics is active
- `motionType` - Static, Kinematic, or Dynamic
- `density`, `gravityScale` - Physical properties
- `collisionProfile` - Collision filtering
- `generateCollisionEvents` - Whether to fire collision events

**Reference:** See `node_modules/@gnsx/genesys.js/src/components/PrimitiveComponent.ts`

#### Specialized Components

Common component subclasses include:
- `MeshComponent` - Basic mesh rendering
- `GLTFMeshComponent` - GLTF model loading
- `VFXComponent` - Particle effects
- `LightComponent` - Light sources
- `CameraComponent` - Camera rendering
- `MovementComponent` - Character movement

## Component Tick Order

The World drives component ticking in a specific order:

1. **Timer System** - Process timer callbacks
2. **Tween Manager** - Update interpolations
3. **Pre-Physics Tick** - All actors and components update
4. **Physics Simulation** - Physics engine steps
5. **Post-Physics Tick** - All actors and components respond to physics
6. **Network Tick** - Replication updates

**Reference:** See `World.tick()` in `node_modules/@gnsx/genesys.js/src/game/World.ts`
