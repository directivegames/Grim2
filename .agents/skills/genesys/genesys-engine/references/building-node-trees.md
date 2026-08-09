# Building Node Trees

## Hierarchy

SceneNodes extend Three.js Object3D and form a modular parent–child tree under a placeable root.

- Every node has a parent (another node or the world root attachment).
- Children inherit transforms from their parents.
- Child nodes automatically follow their parent's transform.

## Node types

**SceneNode** — Base class. Transform, lifecycle, tags, discovery.

**PrimitiveNode** — Geometry and physics. Collision/overlap delegates; `physicsOptions` (motionType, collisionProfile, contributeToParentCollider).

**Specialized nodes** — MeshNode, ModelMeshNode, lights, cameras, movement, interaction, etc. under `.engine/src/nodes/`.

## Ownership

Walk to the placeable with `getRoot()`. Prefer `getRoot()` over deprecated `getActor()` (null when the root is not an Actor).

## Usage patterns

### Creating child nodes

```typescript
const mesh = ENGINE.MeshNode.create({
  position: new THREE.Vector3(0, 1, 0),
  castShadow: true,
});

root.add(mesh);
```

Or pass `children` in create/initialize options on the parent.

### Node queries

```typescript
const mesh = root.getNode(ENGINE.MeshNode);
const meshes = root.getNodes(ENGINE.MeshNode);
const childMesh = someNode.getNode(ENGINE.MeshNode);
```

### Parent–child relationships

```typescript
parent.add(child);
child.removeFromParent();
```

### Compound placeables and physics

When a placeable has multiple physical pieces, the **root** typically owns the rigid body (`contributeToParentCollider: false` on the root's physics). Former body children contribute colliders with `contributeToParentCollider: true`. See `engine-upgrades` → `13-14/hierarchy.md`.

Single mesh placeables: promote the mesh itself with `isRoot: true` — do not wrap a lone child in an empty PrimitiveNode.

## Construction sequences

From `Node.create()`:
1. Constructor
2. `initialize(options)`
3. Added to parent
4. `beginPlay()` when the tree enters the world

From serialized data:
1. Constructor
2. Deserialize properties
3. `postLoad()`
4. Hierarchy attachment
5. `beginPlay()` when the tree enters the world

## Lifecycle

Child nodes follow the same lifecycle as their placeable root once in the world. See SceneNode.ts in engine source.

## Related systems

- [World and SceneNode Overview](world-scene-node-overview.md)
- [SceneNode](scene-node.md)
