# Building node trees

## Hierarchy

SceneNodes extend Three.js `Object3D` and form a parent–child tree under a placeable root.

- Every node has a parent (another node or the world).
- Children inherit and follow their parent's transform.

## Node types

- `SceneNode` — base class: transform, lifecycle, tags, discovery.
- `PrimitiveNode` — geometry and physics: collision/overlap delegates; `physicsOptions` (`motionType`, `collisionProfile`, `contributeToParentCollider`). Choosing a profile: `genesys-physics` → `references/collision-profiles.md` (the default `Character` profile ignores other pawns).
- Specialized nodes — `MeshNode`, `ModelMeshNode`, lights, cameras, movement, interaction, and more under `.engine/src/nodes/`.

## Ownership

Walk to the placeable with `getRoot()`.

## Creating child nodes

Source: .engine/src/nodes/visual/MeshNode.ts
```typescript
const mesh = ENGINE.MeshNode.create({
  position: new THREE.Vector3(0, 1, 0),
  castShadow: true,
});
root.add(mesh);
```

Or pass `children` in the parent's create options.

## Queries

```typescript
const mesh = root.getNode(ENGINE.MeshNode);
const meshes = root.getNodes(ENGINE.MeshNode);
const enemies = world.getNodesByTag('enemy');
const alive = root.getNodesByPredicate((n) => n.hasTag('enemy') && n.visible);
```

## Parent–child relationships

```typescript
parent.add(child);
child.destroy(); // teardown; use removeFromParent() only to reparent
```

## Compound placeables and physics

When a placeable has several physical pieces, the root owns the rigid body (`contributeToParentCollider: false` on the root's physics). Former body children contribute colliders with `contributeToParentCollider: true`. Details: `engine-upgrades` (`13-14/hierarchy.md`). Physics behaviour beyond these options is owned by `genesys-physics`.

Single-mesh placeables: promote the mesh itself with `isRoot: true`. Do not wrap a lone child in an empty `PrimitiveNode`.

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

Child nodes follow the same lifecycle as their placeable root once in the world. See `SceneNode.ts`.

## Related

- [world-scene-node-overview](world-scene-node-overview.md)
- [scene-node](scene-node.md)
- Reusable assemblies placed more than once → `genesys-prefabs`
