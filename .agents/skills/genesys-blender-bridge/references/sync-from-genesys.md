# Sync from Genesys to Blender

Rebuild a Blender mirror from the live Genesys scene. While MCP is available,
do not read `*.genesys-scene` for this inventory — use extract.

## 1. Confirm scope

Ancestry rule: SKILL.md. Extract keeps:

- `ENGINE.ModelMeshNode`
- `ENGINE.MeshNode`
- required exact `ENGINE.SceneNode` ancestors of the above
- `ENGINE.*LightNode` only when their ancestry is also mirrorable

Blocked chains are counted in `skippedByBlockingClass`. For kept nodes,
`parentId === bridgeParentId`.

## 2. Probe Genesys

```js
const state = await genesys.queryEditor({ operation: "getState" });
// require editorReady, documentType === "scene", playMode inactive
```

## 3. Chunked extraction

Submit `scripts/extract_genesys_scene.js` via `run_script(readOnly)` with
`OFFSET` / `COUNT` (default `COUNT = 40`). Repeat until
`offset + count >= total`.

Each call returns a gzip+base64 payload. Save every wrapper JSON.

The extractor:

- walks full ancestry and skips blocked chains (`skippedByBlockingClass`);
- aborts if a 500-result cap or missing ancestor makes completeness uncertain;
- assigns `outlinePath` / `outlineOrder` from Genesys sibling order;
- resolves root order from one uncapped `getTree` pass that covers all bridge
  roots (throws rather than silently mis-ordering when the 500-node cap hides
  roots).

Genesys sets `isWorldRoot: true` on **every** top-level node — there is no
synthetic world parent whose `childIds` lists the roots in order. Root order is
therefore the sequence of parentless nodes as `getTree` returns them; class
filters preserve relative order, so a narrower uncapped pass (for example
`ENGINE.`) is a valid ordering source when the unfiltered pass is capped.

## 4. Merge

```bash
python .agents/skills/genesys-blender-bridge/scripts/merge_manifest_chunks.py \
  chunk*.json --output manifest.json
```

Abort on inventory hash mismatch, offset holes, duplicate IDs, or parent IDs
that are not themselves mirrored. Schema: [manifest.md](manifest.md).

## 5. Sync into Blender

```bash
blender --background path/to/empty-or-prior.blend \
  --python .agents/skills/genesys-blender-bridge/scripts/blender_bridge.py -- \
  sync-from-genesys --manifest manifest.json --project-root . \
  --output Sandbox_Genesys_Sync.blend --overwrite
```

### What the sync builds

1. Canonical logical `@engine` and `@project` asset trees. Blender may suffix
   duplicate display names globally; `genesys_logical_path` remains canonical.
2. Imports every `@project/assets/models/**` GLB plus scene-referenced `@engine`
   models as viewport-visible, render-hidden library sources.
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
6. Creates empties for SceneNodes, linked meshes for ModelMeshNodes, primitives
   for MeshNodes, lights for LightNodes.
7. Parents via `bridgeParentId` so hierarchy uses empties, not collections.
8. Preserves Genesys outliner order by linking in `outlineOrder` and disabling
   Outliner alphabetical sort.
9. Reorders top-level collections: `@engine`, `@project`, scene.
10. Disables relationship lines.
11. Removes factory Cube / Camera / Light / empty "Collection".
12. Stores `GENESYS_BRIDGE_BASELINE` + `genesys_source_scene`.

Failed GLB imports are skipped and listed; the scene sync continues.

## 6. Validate

Run this **immediately after** `sync-from-genesys`, before layout edits. It
compares object world transforms to `GENESYS_BRIDGE_BASELINE`, so it will fail
after you move things in Blender. After editing, use `diff`, not `validate`.

```bash
blender --background Sandbox_Genesys_Sync.blend \
  --python .agents/skills/genesys-blender-bridge/scripts/blender_bridge.py -- \
  validate
```

Validation exits nonzero unless there are zero hierarchy issues, object
transforms still match the baseline, the scene collection has no nested
child collections, top-level order is valid, relationship lines and
alphabetical sort are off, baseline outline order is preserved, the guide
exists, and the parent-ID invariant holds.

Optional: `diff` should report `changes: 0`, `additions: 0` immediately after a
sync from Genesys.
