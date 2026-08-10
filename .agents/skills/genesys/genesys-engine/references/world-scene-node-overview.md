# World and SceneNode System

## World

The World is the runtime scene manager that owns the simulation. It coordinates the SceneNode tree, manages global systems, and processes each tick.

Responsibilities:
- Owns the Three.js Scene instance (World extends GenesysScene; use `getRenderScene()` for background/environment).
- Manages node lifecycle (add, tick, destroy).
- Coordinates input, timers, tweens, and networking; physics and navigation live on the GameLoop (`world.gameLoop?.physicsEngine` / `navigationServer`).
- Provides node queries and filtering (`getNodes*`, `getRootNodes`, `getNode`, `getPlayerControllerAt`).
- Handles level state serialization.

Key Systems:
- inputManager — Input routing (on World).
- timerSystem — Global timer events (on World).
- tweenManager — Interpolations (on World).
- physicsEngine / navigationServer — On `BaseGameLoop` (access via `world.gameLoop`).

Reference: See World.ts and GameLoop.ts in engine source.

## SceneNode tree

Placeable objects in the world are SceneNodes (or subclasses). A placeable is its own transform root — there is no separate Actor shell and nested `rootComponent`.

Characteristics:
- Semantic roots set `isRoot` (custom root classes: set `this.isRoot = true` in the constructor).
- Children attach with `children` options or `add(...)`.
- Supports serialization and prefabs.
- Networked roots use a `ReplicationGroup` (see the genesys-multiplayer skill).

Lifecycle:
1. `MyNode.create(options)` — Factory creation.
2. `world.add(node)` — Entry, `beginPlay()` called.
3. `tickPrePhysics(deltaTime)` — Update before physics.
4. `tickPostPhysics(deltaTime)` — Update after physics.
5. `node.destroy()` — Exit, `endPlay()` called.

| Use case | Prefer |
| --- | --- |
| Behaviour / lifecycle / tags | `SceneNode` |
| Placeable + physics | `PrimitiveNode` |
| Mesh / model as the placeable | `MeshNode` / `ModelMeshNode` with `isRoot: true` |

Reference: See SceneNode.ts, PrimitiveNode.ts in engine source (`nodes/`).

## Node types

### SceneNode

Base placeable / hierarchy node. Provides:
- Transform (position, rotation, scale).
- Lifecycle hooks (`beginPlay`, `tickPrePhysics`, etc.).
- Tags, ownership queries (`getRoot()`), child discovery (`getNode` / `getNodes`).

### PrimitiveNode

Extends SceneNode for geometry and physics. Provides:
- Physics options (motionType, density, collisionProfile, contributeToParentCollider).
- Collision and overlap delegates.

### Specialized nodes

- MeshNode / ModelMeshNode — Rendering.
- LightNode / Camera-related nodes — Scene setup.
- Movement nodes (e.g. CharacterMovementNode) — Character locomotion.

## Tick order

1. Timer System — Timer callbacks.
2. Tween Manager — Interpolations.
3. Pre-Physics Tick — Node updates.
4. Physics Simulation — Simulation step.
5. Post-Physics Tick — Response to physics.
6. Network Tick — Replication updates.

Reference: See World.tick() in World.ts.

## Deprecated

`ENGINE.Actor` remains a deprecated PrimitiveNode compatibility class. Prefer SceneNode/PrimitiveNode subclasses. Compat World APIs (`addActor`, `getActors*`) only return remaining Actor instances — use `world.add` / `getNodes*` instead. See `engine-upgrades` → `13-14`.
