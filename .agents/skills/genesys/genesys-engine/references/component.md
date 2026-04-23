# Component

## Overview

A **Component** is a modular piece of functionality that attaches to Actors. Components extend Three.js `Object3D` and form a parent-child hierarchy, allowing you to build complex objects from simple building blocks.

Components handle rendering, physics, animation, input, and gameplay logic. An Actor's behavior is defined by the components attached to it.

## Key Concepts

### Component Hierarchy

Components form a tree structure under an Actor's root component:

- Every component has a parent (another component or the Actor's root)
- Components inherit transforms from their parents
- Components can be added, removed, and rearranged at runtime
- Child components automatically follow their parent's transform

### Component Types

**SceneComponent** — The base class for all components. Provides transform, lifecycle hooks, and actor attachment.

**PrimitiveComponent** — Extends SceneComponent for components with geometry or physics. Handles collision, physics simulation, and visual representation.

**Specialized Components** — Built-in types for meshes, lights, cameras, effects, movement, and gameplay logic.

**Reference:** See component classes in `node_modules/@gnsx/genesys.js/src/components/`.

### Actor Attachment

Components automatically determine their owning Actor by walking up the parent chain. This means any component in the hierarchy can access the Actor it belongs to, regardless of how deep it is nested.

## Usage Patterns

### Creating Components

Use the static factory method for proper initialization:

```typescript
const mesh = MeshComponent.create({
  position: new THREE.Vector3(0, 1, 0),
  castShadow: true
});

actor.addComponent(mesh);
```

### Component Queries

Find components within an Actor's hierarchy:

```typescript
// Get first component of type
const mesh = actor.getComponent(MeshComponent);

// Get all components of type
const meshes = actor.getComponents(MeshComponent);

// Get from specific component
const childMesh = rootComponent.getComponent(MeshComponent);
```

### Parent-Child Relationships

Components form a standard Three.js Object3D hierarchy:

```typescript
// Add as child
parentComponent.add(childComponent);

// Remove from parent
childComponent.removeFromParent();

// Check if attached to an actor
const owner = component.getActor();
```

## Construction Sequences

**From `Component.create()`:**
1. Constructor
2. `initialize(options)`
3. Added to parent component
4. `beginPlay()` when actor enters world

**From serialized data (prefabs, saved scenes):**
1. Constructor
2. Deserialize properties
3. `postLoad()`
4. Added to parent component
5. `beginPlay()` when actor enters world

**Which pattern to use:**
- **Constructor** — Setup identical for every instance (internal objects, default values)
- **Initialize** — Setup using values passed from `create()` (runtime configuration)
- **PostLoad** — Setup based on deserialized property values (saved configuration)
- **BeginPlay** — Setup requiring the component to be in the world (finding siblings, registering)

## Lifecycle Events

Components follow the same lifecycle as their owning Actor. Events include world entry and exit, pre- and post-physics ticks, and collision state changes.

**Reference:** See lifecycle methods in `node_modules/@gnsx/genesys.js/src/components/SceneComponent.ts`.

## Common Component Types

The engine provides components for rendering, physics, lighting, cameras, effects, character movement, and gameplay systems.

**Reference:** See component classes in `node_modules/@gnsx/genesys.js/src/components/`.

## Related Systems

- `SKILL_DIR/references/world-actor-component-overview.md` — Relationship between world, actors, and components
- `SKILL_DIR/references/actor.md` — The container that owns components
