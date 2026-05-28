# Three.js Extension

The engine augments native Three.js classes with world-space operations, component discovery, and lifecycle hooks.

Reference: See ThreeJsExtensions.ts in engine source.

## World-Space Transform Operations

Native Three.js only provides local-space transform manipulation. The extension adds world-space setters:

- setWorldPosition(pos)
- setWorldRotation(rot)
- setWorldQuaternion(quat)
- setWorldScale(scale)
- setWorldTransform({position, rotation, scale})

## World-Space Transform Queries

- getWorldTransform()
- getWorldPosition(target?)
- getWorldRotation(target?)
- getWorldScale(target?)

## Absolute Transform Flags

Flags that ensure objects maintain fixed world positions regardless of parent movement:

- useAbsolutePosition
- useAbsoluteRotation
- useAbsoluteScale

The updateWorldMatrix() and updateMatrixWorld() methods respect these flags.

## Component Discovery

Methods for finding components within the scene graph hierarchy:

- getComponent(Type) — Find first object of specified type in this subtree (depth-first).
- getComponents(Type) — Find all objects of specified type in this subtree.

## Lifecycle Hooks

Standardized methods propagated through the scene graph:

- beginPlay() — Called when object enters an active world.
- endPlay() — Called when object exits an active world.
- tickPrePhysics(deltaTime) — Update called before physics.
- tickPostPhysics(deltaTime) — Update called after physics.

## Actor Association

- getActor() — Traverse up parent hierarchy to find the owning Actor.

## Serialization Support

- asExportedObject() — Serialize to JSON format.
- describe(options?) — Generate structured debug description.
- isTransient() / setTransient(boolean) — Mark object as non-persistent.

## Visibility Utilities

- isHidden()
- setHidden(hidden, propagateToChildren?)

## Local Transform Setters

Fluent API for setting local transforms:

- setLocalPosition(pos)
- setLocalRotation(rot)
- setLocalScale(scale)
- addLocalPosition(delta)
