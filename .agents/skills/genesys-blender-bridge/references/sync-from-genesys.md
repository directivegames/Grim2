# Sync from Genesys to Blender

Rebuild a Blender mirror from the live Genesys scene. While MCP is available,
do not read `*.genesys-scene` for this inventory — use extract. Every file
below lives under `.scratch/blender-bridge/` in the game project.

## 1. Confirm scope

Ancestry rule: SKILL.md. Extract keeps:

- `ENGINE.ModelMeshNode`
- `ENGINE.MeshNode`
- required exact `ENGINE.SceneNode` ancestors of the above
- `ENGINE.*LightNode` only when their ancestry is also mirrorable

Blocked chains are counted in `skippedByBlockingClass`, keyed by the blocking
class (`GAME.Enemy`) or `prefab instance <prefabPath>`. For kept nodes,
`parentId === bridgeParentId`.

## 2. Probe Genesys

Source: scripts/extract_genesys_scene.js (this skill), MCP `query_editor`
```js
const state = await genesys.queryEditor({ operation: "getState" });
// require editorReady, documentType === "scene", playMode inactive
```

The extract body repeats these checks and throws when one fails.

## 3. Chunked extraction (MCP → disk)

```bash
python3 .agents/skills/genesys-blender-bridge/scripts/make_bridge_scripts.py extract --offset 0 --count 40
# -> .scratch/blender-bridge/run/extract-0000.js
```

Read that file and submit its text as `run_script(readOnly)` `code`. The
response is one object:

```json
{ "format": "genesys-blender-bridge-chunk-compressed", "encoding": "gzip+base64",
  "offset": 0, "count": 40, "total": 129, "nextOffset": 40, "done": false,
  "inventoryHash": "…", "skippedCount": 3, "skippedByBlockingClass": {}, "payload": "…" }
```

Write it unchanged to `.scratch/blender-bridge/chunks/chunk-0000.json`
(zero-padded offset, so the glob sorts). Generate the next body with
`--offset <nextOffset>` and repeat until `done: true`.

The extractor:

- walks full ancestry and skips blocked chains and prefab instances;
- aborts if a 500-result cap, a missing ancestor, or a truncated (`_meta`)
  internal result makes completeness uncertain;
- assigns `outlinePath` / `outlineOrder` from Genesys sibling order;
- resolves root order from one uncapped `getTree` pass that covers all bridge
  roots (throws rather than silently mis-ordering when the 500-node cap hides
  roots);
- keeps a node whose model URL or geometry cannot be read, with
  `unsupportedReason`, so Blender shows a placeholder instead of the whole
  extraction failing;
- halves its record count until the gzip+base64 payload is ≤ 150,000
  characters, so the response stays under the MCP response limit; `count`
  then is smaller than asked and `nextOffset` says where to continue.

Genesys sets `isWorldRoot: true` on **every** top-level node — there is no
synthetic world parent whose `childIds` lists the roots in order. Root order is
therefore the sequence of parentless nodes as `getTree` returns them; class
filters preserve relative order, so a narrower uncapped pass (for example
`ENGINE.`) is a valid ordering source when the unfiltered pass is capped.

## 4. Merge

```bash
python3 .agents/skills/genesys-blender-bridge/scripts/merge_manifest_chunks.py \
  .scratch/blender-bridge/chunks/chunk-*.json \
  --output .scratch/blender-bridge/manifest.json
```

Aborts on inventory hash mismatch (the scene changed between chunks:
re-extract from offset 0), offset holes, duplicate IDs, a truncated chunk
(`_meta`), or parent IDs that are not themselves mirrored. Schema:
[manifest.md](manifest.md).

## 5. Sync into Blender

```bash
bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh sync-from-genesys \
  --manifest .scratch/blender-bridge/manifest.json \
  --output .scratch/blender-bridge/default.blend --overwrite \
  [--from .scratch/blender-bridge/earlier.blend] [--target-level <collection>] [--replace-untagged]
```

- `--from` opens an existing `.blend` first (default: an empty factory scene).
- `--target-level` names the scene collection to build; default is the scene
  file name from `sourceScene` (`default.genesys-scene`).
- `--replace-untagged` allows replacing a target collection that holds objects
  the bridge did not create; they are deleted and listed in
  `swap.deletedUntagged`. Without it the sync refuses.
- `bridge.sh` finds Blender (`$BLENDER`, `/Applications/Blender.app`, PATH),
  prints the JSON result and `RESULT ok|fail`, and exits by that line.
  Without the wrapper: `blender -b [file.blend] --python
  .agents/skills/genesys-blender-bridge/scripts/blender_bridge.py -- sync-from-genesys --project-root .
  …`, and read the `RESULT` line, not Blender's exit status.

### What the sync builds

1. Canonical logical `@engine` and `@project` asset trees. Blender may suffix
   duplicate display names globally; `genesys_logical_path` remains canonical.
2. Imports every `@project/assets/models/**` GLB plus every model the scene
   references anywhere (`@project/packs/…`, other project folders, `@engine/…`)
   as viewport-visible, render-hidden library sources. GLBs that use
   `KHR_texture_basisu`, `EXT_meshopt_compression`, `EXT_texture_webp` or
   `KHR_mesh_quantization` (most engine models) are first converted by
   `genesys-blender-modeling/scripts/plain-glb.mjs` (needs `node` and the
   project's `node_modules`) into `.scratch/blender-bridge/plain-glb/`, reused
   while newer than the source.
3. Lays library sources out in a shelf-packed grid at `Z = -100` using raw mesh
   bounds (after `view_layer.update()`).
4. Creates orange FONT guide beside the grid:

   ```text
   THESE ARE YOUR PROJECT ASSETS:
   INSTANCE THESE (ALT+D) AND MOVE INTO THE SCENE FOLDER
   ```

   The guide is Blender-only. It must never receive a `genesys_node_id` and
   must never appear in a sync-to-Genesys delta.

5. Builds the scene collection named from the scene file
   (`default.genesys-scene`), linking all exported objects **directly** into it
   (no nested group collections).
6. Creates empties for SceneNodes, linked meshes for ModelMeshNodes, bmesh
   primitives for MeshNodes, lights for LightNodes (mapping in
   [architecture](architecture.md)).
7. Parents via `bridgeParentId` so hierarchy uses empties, not collections.
8. Preserves Genesys outliner order by linking in `outlineOrder` and disabling
   Outliner alphabetical sort.
9. Gives every object its Genesys name back once the previous mirror is gone
   (no `.001` drift on re-sync) and stores the final name in
   `genesys_blender_name`.
10. Reorders top-level collections: `@engine`, `@project`, scene.
11. Disables relationship lines.
12. Removes factory Cube / Camera / Light / empty "Collection".
13. Stores `GENESYS_BRIDGE_BASELINE` + `genesys_source_scene`.

**Per-record placeholders.** A MeshNode whose geometry is missing or of an
unsupported type, and a ModelMeshNode whose model is missing or failed to
import, become a wire-cube empty that still carries the node id, so its
transform round-trips. The result's `placeholders` lists `{ id, name, reason }`;
`librarySkipped` lists models that failed to import. Report both to the
creator. One bad record never aborts the sync.

## 6. Validate

Run this **immediately after** `sync-from-genesys`, before layout edits. It
compares object world transforms to `GENESYS_BRIDGE_BASELINE`, so it will fail
after you move things in Blender. After editing, use `diff`, not `validate`.

```bash
bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh validate .scratch/blender-bridge/default.blend
```

Validation reports `ok: false` unless there are zero hierarchy issues, object
transforms still match the baseline (position/scale within
max(1e-4, 1e-6·|value|), rotation within 1e-3 rad), the scene collection has no
nested child collections, top-level order is valid, relationship lines and
alphabetical sort are off, baseline outline order is preserved, the guide
exists, and the parent-ID invariant holds.

Optional: `diff` should report `changes: 0`, `additions: 0` immediately after a
sync from Genesys.
