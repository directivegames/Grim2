# World, Actor, and Component System

## World

The World is the runtime scene manager that owns the simulation. It coordinates actors, manages global systems, and processes each tick.

Responsibilities:
- Owns the Three.js Scene instance.
- Manages actor lifecycle (spawn, tick, destroy).
- Coordinates global systems (physics, navigation, input, timers).
- Provides actor queries and filtering.
- Handles level state serialization.

Key Systems:
- physicsEngine — Physics simulation.
- navigationServer — Pathfinding and navmesh.
- inputManager — Input routing.
- timerSystem — Global timer events.

Reference: See World.ts in engine source.

## Actor

An Actor is any object that can exist in the world. It serves as a container for components.

Characteristics:
- Has exactly one root SceneComponent (transform anchor).
- Exists in a World.
- Supports serialization and prefabs.
- Can be replicated over the network.

Lifecycle:
1. Actor.create(options) — Factory creation.
2. world.addActor(actor) — Entry, beginPlay() called.
3. tickPrePhysics(deltaTime) — Update before physics.
4. tickPostPhysics(deltaTime) — Update after physics.
5. actor.destroy() — Exit, endPlay() called.

Reference: See Actor.ts in engine source.

## Component Hierarchy

Components extend Three.js Object3D and form a parent-child hierarchy.

### SceneComponent

Base class for all components. Provides:
- Transform (position, rotation, scale).
- Lifecycle hooks (beginPlay, tickPrePhysics, etc.).
- Actor attachment via getActor().

Reference: See SceneComponent.ts in engine source.

### PrimitiveComponent

Extends SceneComponent for geometry and physics. Provides:
- Physics options (motionType, density, collisionProfile).
- Collision and overlap delegates.

Reference: See PrimitiveComponent.ts in engine source.

### Specialized Components

- MeshComponent / GLTFMeshComponent — Rendering.
- LightComponent / CameraComponent — Scene setup.
- MovementComponent — Character locomotion.

## Component Tick Order

1. Timer System — Timer callbacks.
2. Tween Manager — Interpolations.
3. Pre-Physics Tick — Actor and component updates.
4. Physics Simulation — Simulation step.
5. Post-Physics Tick — Response to physics.
6. Network Tick — Replication updates.

Reference: See World.tick() in World.ts.
