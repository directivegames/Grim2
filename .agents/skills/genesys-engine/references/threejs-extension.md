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
## Serialization support

- asExportedObject() — Serialize to JSON format.
- describe(options?) — Generate structured debug description.
- isTransient() / setTransient(boolean) — Mark object as non-persistent.

## Visibility utilities

- isHidden() — true when `!visible || selfHidden`. To show/hide an object (and its subtree), set `visible` directly.

## Local transform setters

Fluent API for setting local transforms:

- setLocalPosition(pos)
- setLocalRotation(rot)
- setLocalScale(scale)
- addLocalPosition(delta)

## Addons and the escape hatch

The engine already wraps several three.js addons as nodes: `SkyNode` (Sky / SkyMesh with clouds and an environment map), `WaterNode` (realistic, stylized, simple and liquid techniques with presets, quality tiers, refraction, caustics, underwater view and an optional planar mirror), `TerrainMeshNode`, `ScatterNode`, `ProceduralPropNode` (seeded props), cascaded shadows on `DirectionalLightNode`, and the post-processing stack. Check [genesys-world-building](../../genesys-world-building/SKILL.md) before writing your own.

When no node exists, extend `ENGINE.ThreeObjectNode` (`nodes/visual/ThreeObjectNode.ts`) in a `@ENGINE.GameClass()`: implement `buildObject(ctx)` from `@property` fields and the base handles the transient child, rebuilds on edits (`markDirty()` from code), per-frame `updateObject`, disposal and error containment. Never add objects to `world.scene` directly. Rules and skeleton: [escape-hatch.md](../../genesys-world-building/references/escape-hatch.md).
