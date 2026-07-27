# Actor

## Root Component Architecture

Every Actor has exactly one root SceneComponent that serves as its transform anchor. All other components attach to this root, forming a hierarchical tree.

- The root component provides the Actor's world position, rotation, and scale.
- Components added to the Actor are automatically parented to the root.
- Replace the root component dynamically with setRootComponent().

Reference: See Actor.ts in the engine source.

## Actor Lifecycle

Actors follow a strict lifecycle managed by the World:

1. Creation — Actor.create(options) factory method instantiates and initializes.
2. World Entry — world.addActor(actor) triggers beginPlay(), which calls your doBeginPlay() override.
3. Ticking — tickPrePhysics() -> [physics simulation] -> tickPostPhysics() every frame.
4. World Exit — actor.destroy() or world.removeActor(actor) triggers endPlay(), which calls your doEndPlay() override and cleanup.

Reference: See lifecycle methods in Actor.ts.

## Identification and Tags

Actors support multiple identification mechanisms:

- uuid — Permanent unique identifier generated at creation.
- name — Human-readable identifier (auto-generated, customizable).
- actorTags — String array for categorization and filtering.

## Usage Patterns

### Creating Actors

Use Actor.create() when you have the class imported. Use spawn() when you only have a registered class name or prefab path.

Neither method adds the actor to the world — you must call world.addActor(actor) separately.

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
```

Reference: See Actor.ts and Spawn.ts in the engine source.

### Construction Sequences

From Actor.create() or spawn():
1. Constructor
2. initialize(options)
3. world.addActor() -> beginPlay() -> doBeginPlay()

From serialized data (levels, prefabs):
1. Constructor
2. Deserialize properties
3. postLoad()
4. world.addActor() -> beginPlay() -> doBeginPlay()

### Choosing an Initialization Hook

- Constructor — Setup identical for every instance (internal objects, default values).
- Initialize — Setup using values passed from create() or spawn().
- PostLoad — Setup reacting to values loaded from saved files or prefabs.
- doBeginPlay — Setup requiring the actor to be in the world (finding other actors, registering).
- doEndPlay — Teardown and cleanup when leaving the world.

Do not override beginPlay()/endPlay() directly. The lint rule custom/no-override-methods enforces overriding doBeginPlay()/doEndPlay() instead. The same rule also blocks overriding Actor transform internals such as setWorldPosition/setWorldRotation/setWorldScale/setWorldQuaternion.

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

Reference: See Actor.ts in the engine source.

### Transform Operations

Actors provide world-space position, rotation, and scale access through their root component. Actors also expose direction vectors (forward, right, up) based on their current rotation.

Reference: See Actor.ts in the engine source.

## Lifecycle Events

Actors expose delegates for lifecycle events including world entry and exit, pre- and post-physics ticks, collision and overlap changes, and editor interaction events.

Reference: See Actor.ts in the engine source.

## Common Actor Types

The engine provides built-in Actor subclasses for characters, controllers, projectiles, spawn points, visual effects, and game logic containers.

Reference: See actors/ folder in engine source.

## Visibility and Editor Controls

```typescript
// Hide in game (still visible in editor)
actor.setHiddenInGame(true);

// Editor-only actor (not spawned in game)
actor.setEditorOnly(true);

// Temporary actor (not serialized)
actor.setTransient(true);
```

### Description System

Generate structured descriptions for debugging:

```typescript
const description = actor.describe({
  includeComponentsDetails: true
});
```

Reference: See Actor.ts in the engine source.

## Related Systems

- [World, Actor, and Component Overview](world-actor-component-overview.md)
- [Property and Serialization System](property-serialization-system.md)
