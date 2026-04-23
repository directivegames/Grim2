# Three.js Extension

## Overview

The **Three.js Extension** augments native Three.js classes with convenience methods tailored for the Genesys engine. It adds world-space transform operations, component discovery, lifecycle hooks, and serialization support directly to `THREE.Object3D` and related classes.

**Source:** See full implementation in `node_modules/@gnsx/genesys.js/src/utils/ThreeJsExtensions.ts`

## Key Concepts

### World-Space Transform Operations

Standard Three.js only provides local-space transform manipulation. The extension adds world-space setters that automatically handle the matrix math for converting between coordinate spaces.

- **`setWorldPosition(pos)`** — Set world position regardless of parent hierarchy
- **`setWorldRotation(rot)`** — Set world rotation using Euler angles
- **`setWorldQuaternion(quat)`** — Set world rotation using quaternions
- **`setWorldScale(scale)`** — Set world scale compensating for parent transforms
- **`setWorldTransform({position, rotation, scale})`** — Set multiple properties at once

### World-Space Transform Queries

Convenience getters that retrieve world-space values without manual matrix calculations.

- **`getWorldTransform()`** — Get all transform components as a single object
- **`getWorldPosition(target?)`** — Get world position
- **`getWorldRotation(target?)`** — Get world rotation as Euler angles
- **`getWorldScale(target?)`** — Get world scale
- **`getWorldQuaternion(target?)`** — Get world rotation as quaternion

### Absolute Transform Flags

Special flags that change how transforms are interpreted, useful for objects that need fixed world positions regardless of parent movement.

- **`useAbsolutePosition`** — Position is stored and used directly as world position
- **`useAbsoluteRotation`** — Rotation is stored and used directly as world rotation
- **`useAbsoluteScale`** — Scale is stored and used directly as world scale

When enabled, the object maintains its world transform even when parented to moving objects. The `updateWorldMatrix()` and `updateMatrixWorld()` methods respect these flags.

### Component Discovery

Methods for finding components within the scene graph hierarchy, similar to Unity's GetComponent pattern.

- **`getComponent(Type)`** — Find first object of specified type in this subtree (depth-first search)
- **`getComponents(Type)`** — Find all objects of specified type in this subtree

These methods work with any class that extends `THREE.Object3D`, including Genesys components.

### Lifecycle Hooks

Standardized lifecycle methods that propagate through the scene graph, called automatically by the engine.

- **`beginPlay()`** — Called when object enters play mode (added to active world)
- **`endPlay()`** — Called when object exits play mode
- **`tickPrePhysics(deltaTime)`** — Update called before physics simulation
- **`tickPostPhysics(deltaTime)`** — Update called after physics simulation

These methods recursively call through all children, allowing components to react to world state changes.

### Actor Association

Trace ownership through the scene graph hierarchy.

- **`getActor()`** — Traverse up parent hierarchy to find the owning Actor, returns null if not part of an Actor

### Serialization Support

Integration with the Genesys serialization system.

- **`asExportedObject(includeDefaults?)`** — Serialize to a format suitable for saving/loading
- **`describe(options?)`** — Generate structured description for debugging and AI assistants
- **`isTransient()`** — Check if object is marked as non-persistent
- **`setTransient(boolean)`** — Mark object as temporary (excluded from serialization)

### Visibility Utilities

Enhanced visibility controls with propagation.

- **`isHidden()`** — Check if object is not visible
- **`setHidden(hidden, propagateToChildren?)`** — Set visibility and optionally apply to all descendants

### Debug and Development Tools

Utilities for debugging and inspecting scene graphs.

- **`getPathName()`** — Get dot-separated hierarchical path (e.g., "Actor.RootComponent.Mesh")
- **`printHierarchy(depth?, printTransform?)`** — Generate string representation of hierarchy
- **`generateDebugNode()`** — Create structured data for scene graph visualization tools

### Local Transform Setters

Fluent API for setting local transforms, returning `this` for method chaining.

- **`setLocalPosition(pos)`** — Set position relative to parent
- **`setLocalRotation(rot)`** — Set rotation using Euler angles
- **`setLocalQuaternion(quat)`** — Set rotation using quaternion
- **`setLocalScale(scale)`** — Set scale relative to parent
- **`setLocalTransform({position, rotation, scale})`** — Set multiple properties at once
- **`addLocalPosition(delta)`** — Add offset to current local position
- **`addLocalRotation(delta)`** — Add rotation offset to current local rotation

## Material Extensions

`THREE.Material` gains serialization support.

- **`asExportedObject(includeDefaults?)`** — Serialize material for saving/loading

## Math Extensions

Approximate equality comparisons for vectors and rotations, useful for testing if transforms have reached target values.

- **`Vector3.almostEquals(other, epsilon?)`** — Check if vectors are approximately equal
- **`Euler.almostEquals(other, epsilon?)`** — Check if rotations are approximately equal

## Scene Extensions

`THREE.Scene` gains world association.

- **`getWorld()`** — Get the World instance that owns this scene
- **`setWorld(world)`** — Associate this scene with a World instance
