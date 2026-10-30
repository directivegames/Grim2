# Three.js extension

The engine augments `THREE.Object3D` with world-space operations, node discovery, and lifecycle hooks. Every SceneNode, and every plain Object3D in the scene, has these methods.

Source: .engine/src/utils/ThreeJsExtensions.ts

## World-space transform setters

Native Three.js only sets local transforms. The extension adds:
- `setWorldPosition(pos)`
- `setWorldRotation(rot)`
- `setWorldQuaternion(quat)`
- `setWorldScale(scale)`
- `setWorldTransform({ position, rotation, scale })`

## World-space transform queries

- `getWorldTransform()` → `{ position, rotation, scale }`
- `getWorldPosition(target?)`
- `getWorldRotation(target?)`
- `getWorldScale(target?)`

## Absolute transform flags

Keep an object's world value fixed regardless of parent movement:
- `useAbsolutePosition`
- `useAbsoluteRotation`
- `useAbsoluteScale`

`updateWorldMatrix()` and `updateMatrixWorld()` respect these flags.

## Local transform setters

Fluent (each returns `this`):
- `setLocalPosition(pos)`
- `setLocalRotation(rot)`
- `setLocalScale(scale)`
- `addLocalPosition(delta)`

## Node discovery

- `getNode(Type)` — first match in this subtree (depth-first).
- `getNodes(Type)` — all matches in this subtree.
- `getNodesByPredicate(predicate, maxCount?)` — SceneNodes matching a predicate.
- `getNodesByTag(tag)` — SceneNodes carrying a tag.
- `getPathName()` — hierarchical path name (for logging).

## Root association

- `getRoot()` — walk up to the placeable root SceneNode.

## Lifecycle hooks

Propagated through the scene graph by the extension:
- `beginPlay()` — the object enters an active world.
- `endPlay()` — the object leaves an active world.
- `tickInEditor(deltaTime)` — update while the editor is running.

`tickPrePhysics(deltaTime)` / `tickPostPhysics(deltaTime)` are defined on `SceneNode` and driven by the tick manager; see [scene-node](scene-node.md).

## Serialization support

- `asExportedObject()` — serialize to JSON.
- `describe(options?)` — structured debug description.
- `isTransient()` / `setTransient(transient)` — mark as non-persistent.

## Visibility

- `isHidden()` — true when `!visible || selfHidden`. To show or hide an object and its subtree, set `visible`.

## Physics options

- `replacePhysicsOptions(options, propagateToChildren)` / `overridePhysicsOptions(options, propagateToChildren)`. Physics behaviour is owned by `genesys-physics`.

## Wrapping a three.js addon

The engine already wraps several three.js addons as nodes: `SkyNode`, `WaterNode`, `TerrainMeshNode`, `ScatterNode`, `ProceduralPropNode`, `MirrorNode`, cascaded shadows on `DirectionalLightNode`, and the post-processing stack. Check [genesys-world-building](../../genesys-world-building/SKILL.md) before writing your own. When no node exists, extend `ENGINE.ThreeObjectNode` (`nodes/visual/ThreeObjectNode.ts`) in an `@ENGINE.GameClass()`: implement `buildObject(ctx)` from `@property` fields, and the base handles the transient child, rebuilds on edits (`markDirty()` from code), per-frame `updateObject`, disposal and error containment. Never add objects to `world.scene` directly. Rules and skeleton: [escape-hatch.md](../../genesys-world-building/references/escape-hatch.md).
