# Component

## Component Hierarchy

Components extend Three.js Object3D and form a modular tree structure under an Actor's root component.

- Every component has a parent (another component or the Actor's root).
- Components inherit transforms from their parents.
- Child components automatically follow their parent's transform.

## Component Types

SceneComponent — The base class for all components. Provides transform and lifecycle hooks.

PrimitiveComponent — Extends SceneComponent for components with geometry or physics. Handles collision and physics simulation.

Specialized Components — Built-in types for meshes, lights, cameras, effects, and movement.

Reference: See components/ folder in engine source.

## Actor Attachment

Components automatically determine their owning Actor by walking up the parent chain via getActor().

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

Components use standard Three.js Object3D hierarchy:

```typescript
// Add as child
parentComponent.add(childComponent);

// Remove from parent
childComponent.removeFromParent();
```

## Construction Sequences

From Component.create():
1. Constructor
2. initialize(options)
3. Added to parent component
4. beginPlay() when actor enters world

From serialized data (prefabs, saved scenes):
1. Constructor
2. Deserialize properties
3. postLoad()
4. Added to parent component
5. beginPlay() when actor enters world

## Lifecycle Events

Components follow the same lifecycle as their owning Actor. See SceneComponent.ts in engine source for details.

## Related Systems

- [World, Actor, and Component Overview](world-actor-component-overview.md)
- [Actor](actor.md)
