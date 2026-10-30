# Engine assets for building spaces

The engine ships these under `node_modules/@gnsx/genesys.js/assets/`. Reference them as `@engine/assets/...`. `query_asset(find)` does not index `@engine/...`; search with `node .agents/skills/genesys-assets/scripts/asset-search.mjs <words>` (sizes, triangles, animation clips) and look at a model before you place it: an editor screenshot, or `.agents/skills/genesys-blender-modeling/scripts/blender.sh sheet <path>` when Blender is installed. Place models as `ENGINE.ModelMeshNode` with MCP (`genesys-mcp-orchestrator`, "Engine demo models").

## Primitives and blockout

| Path | Contents |
|---|---|
| `@engine/assets/models/` | `SM_Cube`, `SM_ChamferCube`, `SM_Sphere`, `SM_Cylinder`, `SM_Capsule`, `SM_Cone`, `SM_Pyramid`, `SM_Plane`, `SM_Torus`, `SM_Wedge` (`.glb`) |
| `@engine/assets/materials/M_Floor.material.json` | Grid floor (`DynamicUVNodeMaterialAsset`, world-scaled UVs) |
| `@engine/assets/materials/M_Wall.material.json` | Grid wall |
| `@engine/assets/textures/` | Grid and checkerboard textures, a mossy stone PBR set, parallax set, toon ramps, `matcaps/` |

## Dressing kits (`@engine/assets/models/demo/`)

| Folder | Count | Examples |
|---|---|---|
| `SandboxAsset/Dungeon/` | 24 | `SM_SB_Arch`, `SM_SB_AngledWall`, `SM_SB_Beams` |
| `SandboxAsset/Walls/` | 15 | `SM_SB_Aztec_Wall_01`, `SM_SB_Brick01` |
| `SandboxAsset/Floors/` | 2 | `SM_SB_Floor_01`, `SM_SB_Floor_02` |
| `SandboxAsset/Blocks/` | 13 | `SM_SB_Block`, `SM_SB_Block_Dirt`, `SM_SB_Block_Grass02` |
| `SandboxAsset/Trims/` | 10 | `SM_SB_TrimA` … |
| `SandboxAsset/Decorations/` | 15 | `SM_SB_AztecStatue`, `SM_SB_Claypot_01` |
| `SandboxAsset/GameItems/` | 11 | arrows, hanging bridge pieces |
| `SandboxAsset/Slides/` | 5 | slide corners and edges |
| `SandboxAsset/Foliage/`, `Flowers/`, `Trees/`, `Rocks/`, `Clouds/` | 13 / 6 / 9 / 2 / 13 | beach grass, cactus, pines, coconut trees, rocks, clouds |
| `SandboxAsset/Characters/` | 9 | `SKM_SB_Adventurer_F01`, `SKM_SB_Adventurer_M01`, `SKM_Arachnids_Large_Spider` |
| `LowPoly/` | 24 | trees, bushes, rocks, mushrooms, grass, `SM_GeneratedLandscape`, `low_poly_ship_wreck` |
| `Characters/` | 2 | `Knightdude`, `Spacedude` |

Other: `@engine/assets/models/Weapons/SM_ShotGun_01.glb`, `@engine/assets/models/PickupActors/` (`SM_Pickup_Health`, `SM_Pickup_Station`), `@engine/assets/prefabs/` (demo health pickup and spawner prefabs).

## Skies

`@engine/assets/textures/skybox/citrus_orchard_road_puresky_2k.hdr`, `qwantani_dusk_2_puresky_2k.hdr`, `satara_night_no_lamps_2k.hdr` and `venice_sunset_4k.hdr` for `SceneEnvironmentNode` (`genesys-lighting`).

This inventory was read from the installed engine package. Re-list the folder when the engine version changes.
