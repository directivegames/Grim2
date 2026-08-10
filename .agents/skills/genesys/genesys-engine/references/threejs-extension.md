# Three.js Extension

The engine augments native Three.js classes with world-space operations, node discovery, and lifecycle hooks.

Reference: See ThreeJsExtensions.ts in engine source.

## World-space transform operations

Native Three.js only provides local-space transform manipulation. The extension adds world-space setters:

- setWorldPosition(pos)
- setWorldRotation(rot)
- setWorldQuaternion(quat)
- setWorldScale(scale)
- setWorldTransform({position, rotation, scale})

## World-space transform queries

- getWorldTransform()
- getWorldPosition(target?)
- getWorldRotation(target?)
- getWorldScale(target?)

## Absolute transform flags

Flags that ensure objects maintain fixed world positions regardless of parent movement:

- useAbsolutePosition
- useAbsoluteRotation
- useAbsoluteScale

The updateWorldMatrix() and updateMatrixWorld() methods respect these flags.

## Node discovery

Methods for finding nodes within the scene graph hierarchy:

- getNode(Type) — Find first object of specified type in this subtree (depth-first).
- getNodes(Type) — Find all objects of specified type in this subtree.

## Lifecycle hooks

Standardized methods propagated through the scene graph:

- beginPlay() — Called when object enters an active world.
- endPlay() — Called when object exits an active world.
- tickPrePhysics(deltaTime) — Update called before physics.
- tickPostPhysics(deltaTime) — Update called after physics.

## Root association

- getRoot() — Traverse up the parent hierarchy to find the placeable root SceneNode.
- getActor() — Deprecated; returns an Actor root only, otherwise null. Prefer getRoot().

## Serialization support

- asExportedObject() — Serialize to JSON format.
- describe(options?) — Generate structured debug description.
- isTransient() / setTransient(boolean) — Mark object as non-persistent.

## Visibility utilities

- isHidden()
- setHidden(hidden, propagateToChildren?)

## Local transform setters

Fluent API for setting local transforms:

- setLocalPosition(pos)
- setLocalRotation(rot)
- setLocalScale(scale)
- addLocalPosition(delta)
