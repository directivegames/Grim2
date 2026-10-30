# Engine nodes for the space

The short owner table is in [SKILL.md → Decide: which owner](../SKILL.md#decide-which-owner). This file holds the full table with each class's options and proof, the kill-volume class, and runtime scatter from code. Engine classes are in `.engine/src/nodes/`.

## Owners in full

| Need | Owner | Proof |
|---|---|---|
| Rooms, ground, stairs, ramps, platforms, or a mesh sculpted in the open scene | `genesys-polybuilder` | `query_polybuilder` bounds, not a screenshot |
| A box, sphere, or other physics prop the engine primitive can be | `ENGINE.MeshNode` / `PrimitiveNode`, placed with MCP | The node exists in `query_node` |
| The same hierarchy in more than one place, or spawned at runtime | `genesys-prefabs` | The instance is linked (`isPrefabInstance`), not a hand-edited `.prefab.json` |
| A model already in `assets/`, `packs/`, or `@engine/assets/models/` | `ENGINE.ModelMeshNode` via MCP, `modelUrl` = `@project/...` or `@engine/...` | The path is the logical path, not a rewritten URL |
| Fewer than about 30 placements | One `batch_execute` call through MCP; no layout file (`genesys-mcp-orchestrator`) | `query_node` shows each placed node |
| Dozens or more placements that follow rules (a street of houses, fence runs, tree lines, kit grids, rings of pillars) | A layout file → generated prefab (*Bulk placement*) | `layout.mjs build` prints the node count; `query_node` shows the group counts on the placed root |
| Hundreds of identical props in a built space: hedges, fences, rocks, lamps, lawn tufts (on terrain, grass and plants are `genesys-world-building` `GrassNode` / `ScatterNode`) | `ENGINE.InstancedModelMeshNode` (`visual/InstancedModelMeshNode.ts`): one node, many per-instance transforms, optional `lods` and `cullDistance`. Layout item `"instanced": true`, or code for runtime scatter (below) | `query_node` shows one node per model; no `HINT` lines from `layout.mjs build` |
| Many copies of one engine geometry (boxes, spheres) rather than a GLB | `ENGINE.InstancedMeshNode` (`visual/InstancedMeshNode.ts`: `geometry`, `material`, `lods` of `{ geometry, distance }`) from code | `getInstanceCount()` |
| Survival or open-area ground: terrain, islands, water, grass, forests | `genesys-world-building`: an `applyWorld` recipe writes `TerrainMeshNode` (static heightfield collider), `GrassNode` and `ScatterNode` children, and `WaterNode`; MCP cannot sample terrain height, so props on it follow its existing-scene reference | `auditWorld` reports no errors; pawn walks the slopes in Play |
| Roads, paths, race loops (rivers are `genesys-world-building` water) | `ENGINE.SplineMeshNode` (`visual/SplineMeshNode.ts`): a flat ribbon on a Catmull-Rom curve; `points` (local metres), `width` 1, `segments` 50, `closed`, `tension` 0.5, `uvScale`, `materialPath`. Physics is off by default; a drivable road needs `trimesh`. Author `points` in a layout item ([layouts](layouts.md#other-engine-nodes-in-a-layout)) rather than vector by vector through MCP | Loop closes in `query_node`; wheels stay on it in Play |
| Blockout solids with holes cut in (doorways, windows, arches) | CSG (`csg/`): an `ENGINE.CSGCombiner` root with `CSGCubeNode` (`dimensions`), `CSGSphereNode` (`radius`), `CSGCylinderNode` (`height`, `radiusTop`, `radiusBottom`) children, each with `operation` `add`/`subtract`/`intersect` and `materialUrl`. The combiner's collider is static `trimesh` | Pawn walks through the cut opening |
| Blocky voxel props or terrain from MagicaVoxel | `ENGINE.VoxelMeshNode` (`voxel/VoxelMeshNode.ts`): `voxPath` (`.vox`), `voxelSize` 1, `paletteOverrides` | The model shows in the editor without code |
| Invisible wall or blocker | `ENGINE.CollisionShapeNode`: an invisible `MeshNode`; its shape is its `geometry` (a 1 m box by default) and its size is the node scale | `query_node`; pawn stops in Play |
| Review the scene in Blender and push transforms back | `genesys-blender-bridge` | The bridge manifest flow, not a new level file exported over the scene |
| A kit piece or prop nobody has yet | `genesys-code-modeling` (route via `genesys-assets`) | An exported GLB, placed with MCP as a `ModelMeshNode` and confirmed with `query_node` |
| A door, lift, or moving prop | `genesys-interactions` | Gameplay motion, not a baked mesh |

## Kill volume

Source: `.engine/src/nodes/gameplay/TriggerZoneNode.ts` (`onActorEntered`, `TriggerFilter`)
```ts
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class KillVolume extends ENGINE.TriggerZoneNode {
  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.onActorEntered.add((actor) => {
      // hand off to the GameMode: respawn at checkpoint or end the run
    });
    return true;
  }
}
```

Place the volume with MCP (`action_node(action="add", className: "GAME.KillVolume")`), size it with scale, set `filter` to `playerOnly`, save. Build first so the class registers (`genesys-game-boot`).

## Runtime scatter from code

Dressing spawned with the level (not authored in the scene) uses the same instanced class from code. A real 416-node backyard layout (148 grass tufts, 48 hedges, 48 lawn tiles, 39 oaks…) came to an estimated 1,800 draw calls on a phone target as separate nodes; instanced, it drops to 90 nodes, 31 of them instanced.

Source: `.engine/src/nodes/visual/InstancedModelMeshNode.ts`, `BaseInstancedMeshNode.ts` (`instances`, `maxInstances`, `cullDistance`); engine demo `instanced-mesh.ts`
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';
declare const parent: ENGINE.SceneNode;

const transforms: ENGINE.InstanceTransform[] = [];
for (let i = 0; i < 300; i++) {
  transforms.push({
    position: new THREE.Vector3((Math.random() - 0.5) * 80, 0, (Math.random() - 0.5) * 80),
    rotation: new THREE.Euler(0, Math.random() * Math.PI * 2, 0),
    scale: new THREE.Vector3(1, 1, 1).multiplyScalar(0.8 + Math.random() * 0.4),
  });
}
const grass = ENGINE.InstancedModelMeshNode.create({
  modelUrl: '@engine/assets/models/demo/LowPoly/SM_Grass01.glb',
  instances: transforms,          // local to this node
  maxInstances: 300,              // engine default 1000; addInstance past it fails, saved copies past it raise it
  castShadow: false,
  physicsOptions: { enabled: false },
  cullDistance: 120,              // 0 = never cull per instance
});
parent.add(grass);
```
