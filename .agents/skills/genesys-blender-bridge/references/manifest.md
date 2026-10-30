# Manifest and delta schema

## Bridge manifest

```json
{
  "format": "genesys-blender-bridge",
  "version": 1,
  "sourceScene": "@project/assets/default.genesys-scene",
  "totalNodes": 539,
  "inventoryHash": "edf3a839",
  "skippedCount": 116,
  "skippedByBlockingClass": { "GAME.DamageObjectActor": 11 },
  "records": []
}
```

### Record fields

| Field | Meaning |
| --- | --- |
| `id` | Genesys UUID |
| `name` | Display name |
| `className` | `ENGINE.SceneNode` / `MeshNode` / `ModelMeshNode` / `*LightNode` |
| `parentId` | Genesys parent UUID or `null` |
| `bridgeParentId` | Mirrored parent UUID (equals `parentId` under the actor rule) |
| `siblingIndex` | Index among Genesys siblings |
| `outlinePath` | Root-to-node sibling index path |
| `outlineOrder` | Contiguous 0..N-1 sync order |
| `group` / `groupId` | Display group (usually mirrored parent) |
| `position` / `rotation` / `scale` | Genesys **world** transform; rotation is three.js Euler `'XYZ'` in radians |
| `parentTransform` | Parent Genesys world transform or `null` |
| `visible` | Visibility hint |
| `modelUrl` | `@project` / `@engine` GLB for ModelMeshNode |
| `geometry` / `material` | Three.js JSON for MeshNode |
| `unsupportedReason` | Set when the model URL or geometry could not be read; Blender shows a placeholder |

### Invariants

- Every `parentId` that is non-null must also appear as a mirrored record.
- `bridgeParentId === parentId` (or both null) under the actor-ancestry rule.
- `outlineOrder` is contiguous after merge.

## Extraction chunk

```json
{
  "format": "genesys-blender-bridge-chunk",
  "version": 1,
  "sourceScene": "...",
  "total": 129,
  "offset": 0,
  "count": 40,
  "inventoryHash": "...",
  "records": []
}
```

MCP transfer wrapper (the `run_script` response, saved as
`.scratch/blender-bridge/chunks/chunk-<offset>.json`):

```json
{
  "format": "genesys-blender-bridge-chunk-compressed",
  "version": 1,
  "encoding": "gzip+base64",
  "sourceScene": "...",
  "offset": 0,
  "count": 40,
  "total": 129,
  "nextOffset": 40,
  "done": false,
  "inventoryHash": "...",
  "skippedCount": 3,
  "skippedByBlockingClass": {},
  "payload": "..."
}
```

`count` can be smaller than requested: the body halves its records until the
payload is ≤ 150,000 characters. Continue at `nextOffset` until `done`. A
response carrying `_meta` was cut by the MCP response limit; the merge refuses
it.

Merge via `merge_manifest_chunks.py` as part of
[sync-from-genesys.md](sync-from-genesys.md).

## Bridge delta

```json
{
  "format": "genesys-blender-bridge-delta",
  "version": 1,
  "sourceScene": "@project/assets/default.genesys-scene",
  "changes": [],
  "additions": [],
  "unsupported": [],
  "missingBaselineIds": [],
  "repairedDuplicates": []
}
```

`make_bridge_scripts.py apply` splits it into batches; each embedded batch
also carries `"batch": "02/05"`.

### `changes[]` (`updateTransform`)

Includes `id`, `name`, `className`, `parentId`, `bridgeParentId`,
`baselineWorld`, `baselineParentWorld`, `desiredWorld`, `desiredLocal`.

`desiredLocal` is Genesys local space relative to the (possibly updated) parent
world as computed by `diff`. `apply_genesys_delta.js` writes that field as-is
into `action_node.setProperties`. Never write Blender world values.

### `additions[]` (`addModel`)

Includes `name`, `parentId` (mirrored SceneNode or `null` for scene root),
`modelUrl`, `desiredWorld`, `desiredLocal`.

Null `parentId` means create at the Genesys scene root. Do not ask.

### `missingBaselineIds`

Informational. Not a delete request. Deletions go in an explicit `DELETIONS`
array embedded beside the delta in `apply_genesys_delta.js`.

## Tolerances

| Quantity | Epsilon |
| --- | --- |
| Position / scale (largest per-axis difference in Python, vector distance in the apply script) | `max(1e-4, 1e-6 · abs(largest component))` |
| Rotation (quaternion angle) | `1e-3` rad |

MCP returns rounded decimals and Blender stores float32, so the old fixed
`1e-5` sat inside the noise. The same rule decides "changed", "conflict",
"already applied" and post-apply verification.
