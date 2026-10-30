# Architecture

## State ownership

| Concern | Owner |
| --- | --- |
| Live scene graph, transforms, model URLs | Genesys editor via MCP |
| Blender mirror layout, library grid, viewport prefs | `scripts/blender_bridge.py` |
| Actors, gameplay components, triggers | Game TypeScript — never mirrored |
| Prefab instances and their children | The prefab (`genesys-prefabs`) — never mirrored |
| Serialized `.genesys-scene` file | Editor save only — never hand-edit |
| Bridge files (chunks, manifest, `.blend`, delta, run bodies, converted GLBs) | `.scratch/blender-bridge/` |

Pipeline: extract → merge → `sync-from-genesys` → edit in Blender → `diff` →
batch → preview → apply → refresh. Transport is Blender's CLI through
`bridge.sh`; a live Blender MCP is optional ([setup.md](setup.md)).

## Data movement

| Step | From → to | Carrier |
| --- | --- | --- |
| Extract | Editor → disk | `run_script(readOnly)` response (gzip+base64 chunk, ≤ 150,000 payload chars), saved by the agent as `chunks/chunk-<offset>.json` |
| Merge | disk → disk | `merge_manifest_chunks.py` → `manifest.json` |
| Sync / diff / validate | disk ↔ Blender | `bridge.sh` (`blender -b … --python blender_bridge.py`) → `.blend`, `changes.bridge-delta.json`, one JSON line + `RESULT` |
| Batch | disk → disk | `make_bridge_scripts.py apply` injects DELTA / APPLY / DELETIONS into `run/apply-NN.*.js` |
| Preview / apply | disk → editor | the agent passes each body's text as `run_script` `code` |

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
| `genesys_blender_name` | scene objects | The object's name right after sync; tells the original from Blender duplicates that copied its properties |
| `genesys_placeholder_reason` | placeholder objects | Why a mesh or model became a placeholder |
| `genesys_library_guide` | guide text | Asset-grid instruction (never pushed) |
| `genesys_logical_path` | collections | Canonical `@engine` / `@project` folder path (ignore Blender numeric suffixes) |

Scene-level: `genesys_source_scene` and text datablock `GENESYS_BRIDGE_BASELINE`.

## Blender representation

| Genesys | Blender |
| --- | --- |
| exact `ENGINE.SceneNode` ancestor | empty (plain axes) |
| `ENGINE.ModelMeshNode` | linked instance of the library source mesh; wire-cube placeholder when the model is missing or failed to import |
| `ENGINE.MeshNode` | bmesh primitive: Box, Sphere, Cylinder, Cone, Capsule (UV sphere split at the equator; Blender has no capsule operator), Plane, Circle, Torus, Icosahedron, or raw `BufferGeometry` position/index data; anything else a wire-cube placeholder |
| `DirectionalLightNode` | Sun |
| `SpotLightNode` | Spot |
| `PointLightNode` | Point |
| `RectAreaLightNode` | Area |
| `AmbientLightNode`, `HemisphereLightNode` | sphere empty (Blender has no ambient light; it is world lighting there) |

Lights round-trip transform only — colour, intensity, shadows and aim
targets are not mirrored. Project GLBs and referenced models form a
viewport-visible library grid at `Z = -100`. Materials on primitives are one
Principled BSDF per colour, found by node type (`BSDF_PRINCIPLED`), never by
the localized node name.

Ancestry filtering is defined in SKILL.md. Outliner order is Genesys→Blender
only.

## Coordinates and rotation order

Genesys/three.js is Y-up; Blender is Z-up. Convert through basis conjugation —
never by swapping Euler fields:

```text
P_blender = (gx, -gz, gy)
S_blender = (sx, sz, sy)
M_blender = Aᵀ · M_genesys · A        A = [[1,0,0],[0,0,1],[0,-1,0]] (Blender → Genesys axes)
```

Genesys rotations are three.js Euler angles (radians) in order `'XYZ'`:
R = Rx(x)·Ry(y)·Rz(z), intrinsic X then Y then Z. Blender's rotation mode
`'XYZ'` is the other way round, Rz·Ry·Rx; the three.js matrix is mathutils
`Euler((x, y, z), 'ZYX')`. Reading three.js `'XYZ'` as Blender `'XYZ'` was the
bug that tilted multi-axis rotations. The bridge now builds and decomposes
matrices in double precision with three.js's own formulas (`_compose`,
`_decompose`); the Euler extraction is stabilised near gimbal lock (y = ±90°),
where float32 storage otherwise drifts by up to 3e-4 rad. The apply script's
`quaternionXYZ` is three.js's `setFromEuler('XYZ')`.

glTF import already converts Y-up mesh data; do not apply a second -90° fix.
Compare rotations by quaternion angle. Epsilons: [manifest.md](manifest.md).

`scripts/test_euler_roundtrip.mjs` (`bridge.sh test`) proves it against
three.js: Blender world matrix = C·M·C⁻¹ (C maps Genesys to Blender axes),
Genesys → Blender → Genesys reproduces the matrix, primitive sizes and axes,
and diff output composes back to the edited world transform, all within 1e-5.

## Transaction model

Sync from Genesys builds into a temporary collection, validates, then swaps
into the scene collection. Factory Cube/Camera/Light and the default
"Collection" are removed. Top-level collections are re-linked in order
`@engine`, `@project`, scene. Deletion policy: SKILL.md and [push.md](push.md).

## Safety

- Extraction returns gzip+base64 chunks that shrink themselves to stay under
  the MCP response limit. Internal `getTree` / `getDetails` /
  `getEditableProperties` results are checked for a `_meta` truncation block;
  extraction and apply abort when completeness cannot be proven.
- Missing `@engine` GLBs may fall back to a unique same-basename `@project`
  file for geometry only; the logical URL stays `@engine/...`.
- GLBs Blender cannot read are converted through `plain-glb.mjs` first;
  imports that still fail are skipped and reported, and their nodes become
  placeholders; the scene sync continues.
- Apply bodies are idempotent per batch (see [push.md](push.md)).
- After a successful push, refresh `GENESYS_BRIDGE_BASELINE` via a new
  `sync-from-genesys` into a new `.blend` — [push.md](push.md).
