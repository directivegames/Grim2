# Architecture

## State ownership

| Concern | Owner |
| --- | --- |
| Live scene graph, transforms, model URLs | Genesys editor via MCP |
| Blender mirror layout, library grid, viewport prefs | `scripts/blender_bridge.py` |
| Actors, gameplay components, triggers | Game TypeScript — never mirrored |
| Serialized `.genesys-scene` file | Editor save only — never hand-edit |

Pipeline: extract → merge → `sync-from-genesys` → edit in Blender → `diff` →
`apply_genesys_delta.js`. Default transport is Blender CLI; optional live
Blender MCP is [setup.md](setup.md).

## Identity

Never key round-trips on Blender object names. Use custom properties:

| Property | On | Meaning |
| --- | --- | --- |
| `genesys_node_id` | scene objects | Live Genesys UUID |
| `genesys_asset_path` | meshes | Original `@project` / `@engine` URL |
| `genesys_library_source` | library meshes | Library source, not a placement |
| `genesys_bridge_parent_id` | scene objects | Mirrored parent UUID |
| `genesys_outline_order` | scene objects | Genesys sibling order index |
| `genesys_class_name` | scene objects | Engine class string |
| `genesys_library_guide` | guide text | Asset-grid instruction (never pushed) |
| `genesys_logical_path` | collections | Canonical `@engine` / `@project` folder path (ignore Blender numeric suffixes) |

Scene-level: `genesys_source_scene` and text datablock `GENESYS_BRIDGE_BASELINE`.

## Blender representation

- exact `ENGINE.SceneNode` ancestors → empties;
- `ENGINE.ModelMeshNode` → linked GLB instances;
- `ENGINE.MeshNode` → generated primitives;
- `ENGINE.*LightNode` → Blender lights (transform only — colour / intensity /
  shadows are not round-tripped);
- project and referenced-engine GLBs as a viewport-visible library grid at
  `Z = -100`.

Ancestry filtering is defined in SKILL.md. Outliner order is Genesys→Blender
only.

## Coordinates

Genesys/Three.js is Y-up; Blender is Z-up. Convert through basis conjugation —
never by swapping Euler fields:

```text
P_blender = (gx, -gz, gy)
S_blender = (sx, sz, sy)
R_blender = Aᵀ × R_genesys × A
```

glTF import already converts Y-up mesh data; do not apply a second -90° fix.
Compare rotations by quaternion angle. Epsilons: [manifest.md](manifest.md).

## Transaction model

Sync from Genesys builds into a temporary collection, validates, then swaps
into the scene collection. Factory Cube/Camera/Light and the default
"Collection" are removed. Top-level collections are re-linked in order
`@engine`, `@project`, scene. Deletion policy: SKILL.md and [push.md](push.md).

## Safety

- Extraction returns gzip+base64 chunks so the `run_script` result stays under
  MCP response limits. Internal `getTree` / `getEditableProperties` calls can
  still truncate; abort if completeness cannot be proven.
- Missing `@engine` GLBs may fall back to a unique same-basename `@project`
  file for geometry only; the logical URL stays `@engine/...`.
- Failed GLB imports are skipped and reported; the scene sync continues.
- After a successful push, refresh `GENESYS_BRIDGE_BASELINE` via a new
  `sync-from-genesys` into a new `.blend` — [push.md](push.md).
