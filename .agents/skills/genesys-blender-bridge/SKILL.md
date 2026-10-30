---
name: genesys-blender-bridge
description: "Mirror the live Genesys scene into Blender and push reviewed Blender layout edits (moves, rotations, scales, added linked models, approved deletions) back through MCP. Use for Blender sync, Blender bridge, edit or lay out the level in Blender, round-trip the scene through Blender, send the scene to Blender. Not for building new models, characters, icons or title art in Blender (use `genesys-blender-modeling`)."
metadata:
  tokens: 2505
---

# Genesys Blender Bridge

Add-on-free, two-way layout sync between a live Sandbox Studio (Genesys) scene and Blender. The most important rule: every live scene change goes through Genesys MCP in reviewed, idempotent batches, never through a hand-edited `*.genesys-scene`.

`.agents/skills/genesys-blender-bridge` below is the folder that holds this `SKILL.md`. Run every command from the game project root. All files the bridge writes live under `.scratch/blender-bridge/` (chunks, manifest, `.blend`, delta, generated run_script bodies, converted GLBs).

## Use another skill when
- Modelling a new asset, rig, still or icon in headless Blender → `genesys-blender-modeling`
- Probing the editor, `run_script` / `batch_execute` dispatch, approvals, limits → `genesys-mcp-orchestrator`
- Blocking out or dressing a level inside the editor, or placing hundreds of props → `genesys-level-authoring`
- Modelling a mesh with Poly Builder in the open scene → `genesys-polybuilder`
- Moving or editing prefab instances, or a repeated assembly → `genesys-prefabs`
- Where a new mesh comes from → `genesys-assets`

## Boundaries

1. Never edit `*.genesys-scene` by hand. Live mutations go through MCP (`run_script` with the bridge's apply body).
2. **Ancestry rule:** mirror `ENGINE.MeshNode`, `ENGINE.ModelMeshNode`, their exact `ENGINE.SceneNode` ancestors, and `ENGINE.*LightNode` nodes whose ancestry is mirrorable. Anything under an Actor or any other class is excluded, nested lights and meshes included. **Prefab instances** (a node or ancestor with `prefabPath` / `isPrefabInstance`) are skipped whole and counted as `prefab instance <path>` in `skippedByBlockingClass`; edit them with `genesys-prefabs`.
3. Push only **position / rotation / scale** for mirrored nodes, plus reviewed model additions and **explicitly approved** deletions.
4. Do not push outliner order or reparenting Blender→Genesys. Order travels Genesys→Blender only; a reparented object is reported as unsupported.
5. Never infer deletions from absence in Blender. `missingBaselineIds` is informational until the creator names IDs.
6. Unparented objects in the Blender scene collection become **Genesys scene roots** on push. Do not ask; do not invent a parent.

## Workflow and data flow

MCP results reach disk only through you: read each generated body file, pass its text as the `run_script` `code`, and write the response object to the named file with the file tool, unchanged.

1. **Probe.** `query_editor(operation="getState")`: `editorReady`, `documentType: "scene"`, Play stopped (`genesys-mcp-orchestrator`).
2. **Extract**, chunk by chunk: `python3 .agents/skills/genesys-blender-bridge/scripts/make_bridge_scripts.py extract --offset 0` writes `.scratch/blender-bridge/run/extract-0000.js` (OFFSET/COUNT injected). Submit it with `run_script(readOnly)`; save the response as `.scratch/blender-bridge/chunks/chunk-0000.json`. Repeat with `--offset <nextOffset>` until the response has `done: true`. A chunk shrinks itself when its payload would pass 150,000 characters, so `count` can be smaller than asked.
3. **Merge:** `python3 .agents/skills/genesys-blender-bridge/scripts/merge_manifest_chunks.py .scratch/blender-bridge/chunks/chunk-*.json --output .scratch/blender-bridge/manifest.json`.
4. **Sync into Blender:** `bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh sync-from-genesys --manifest .scratch/blender-bridge/manifest.json --output .scratch/blender-bridge/<scene>.blend --overwrite`, then `bridge.sh validate .scratch/blender-bridge/<scene>.blend`. Report `placeholders` and `librarySkipped` from the result.
5. **Edit in Blender** (the creator, or you through the live Blender MCP when it is connected). Save the `.blend`.
6. **Diff:** `bridge.sh diff .scratch/blender-bridge/<scene>.blend --output .scratch/blender-bridge/changes.bridge-delta.json`. Review changes, additions, unsupported, `missingBaselineIds`.
7. **Batch:** `python3 .agents/skills/genesys-blender-bridge/scripts/make_bridge_scripts.py apply --delta .scratch/blender-bridge/changes.bridge-delta.json [--deletions approved.json]` writes `apply-NN.preview.js` / `apply-NN.apply.js` and `apply-index.json`.
8. **Preview** every batch with `run_script(readOnly)`; show the summed counts (updates, additions, already applied, deletions, conflicts) and ask for approval once for the whole set.
9. **Apply** batches in order, one `run_script(apply, groupUndo: true)` per message. Each batch verifies its transforms, saves the scene, and returns counts. Re-query a few changed nodes afterwards (`query_node(operation="getDetails")`).
10. **Refresh the baseline:** extract again and sync into a **new** `.blend` before further edits (see [push](references/push.md)).

Details: [sync-from-genesys](references/sync-from-genesys.md), [push](references/push.md), [manifest](references/manifest.md), [architecture](references/architecture.md), [setup](references/setup.md).

## Limits the scripts respect

| Limit | How the bridge stays inside it |
|---|---|
| `run_script` code ≤ 100,000 characters | Generated bodies stay ≤ 90,000 (`--max-chars`); the generator refuses anything larger |
| Response > 200 KB is cut to 100 items + `_meta` | Extract payload ≤ 150,000 characters and self-shrinks; every internal `genesys.*` result and every saved chunk is checked for `_meta` and stops with "truncated" |
| MCP client aborts after 300 s | ≤ 80 mutation units per batch (change 1, addition 3, deletion 1, about 0.6 s each) |
| `getTree` / `find` capped at 500 | Extraction stops when a class reaches 500 (completeness unprovable); `find` passes `limit: 500` |

## Rotations and axes

Genesys is three.js: Y-up, Euler order `'XYZ'`, so R = Rx·Ry·Rz. Blender is Z-up, and its own `'XYZ'` mode means Rz·Ry·Rx; the three.js matrix is mathutils `'ZYX'`. The bridge does all transform math in double precision with three.js's formulas and maps axes Genesys (x, y, z) → Blender (x, −z, y). Proof: `bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh test` (313 transforms, world matrices and round trips within 1e-5 of three.js, plus sync and diff on a synthetic scene).

## Limitations

- A mesh shows as a wire cube → its geometry is unsupported or unreadable → it is a placeholder; its transform still round-trips. The sync result lists it with a reason.

## Traps

- Engine models show as cubes or are listed in `librarySkipped` → KTX2 / Meshopt GLBs Blender cannot import, and `node` or `genesys-blender-modeling` is missing → install node and keep both skills; the bridge converts through `plain-glb.mjs` into `.scratch/blender-bridge/plain-glb/`.
- `Ambiguous duplicate genesys_node_id` on diff → several Blender objects share one node id and none still has its synced name → delete the extra copies or rename one back to the synced name (`genesys_blender_name` property), then diff again.
- Additions duplicated in Sandbox → a second diff ran from the pre-apply `.blend` and an added object was moved in between → apply skips an addition only when one with the same model, parent and world transform already exists, so the moved one lands again → re-sync to refresh the baseline after every apply, before more edits.
- `result was truncated by the MCP response limit` → a query or chunk passed the response cap → extract with a smaller `--count`, or apply with smaller `--max-units`.

## Recovery
- **MCP off or editor not ready:** stop after step 4 at most; Blender-side steps work without MCP, pushes do not. Never hand-edit the scene file; tell the creator the push waits for the editor (`genesys-mcp-orchestrator` → MCP-off playbook).
- **Blender not found:** `bridge.sh` exits 3. Install Blender 4.2+ or set `BLENDER=/path/to/Blender`. Never rely on Blender's exit status; read the `RESULT ok|fail` line.
- **More than 500 nodes of one class:** extraction stops. Mirror is not possible for this scene; lay out with `genesys-level-authoring` (bulk layout) instead.
- **Partial apply** (timeout, error mid-batch): re-run the same `apply-NN.apply.js`. Changes already at their target, additions already present and deletions already gone count as `alreadyApplied`; nothing is duplicated. Then continue with the next batch.
- **Conflict in preview** (node changed in Sandbox since extract): do not force it. Re-extract, re-sync, redo the edit, or ask the creator which IDs to overwrite.

## Done
- `bridge.sh validate` returns `ok: true` right after sync, and `diff` on the untouched file reports 0 changes and 0 additions.
- Every placeholder and skipped library is reported to the creator with its reason.
- Each batch preview was shown and approved; each apply returned `applied: true` and `saved: true` (a transform that misses its target throws instead).
- Re-queried nodes match the delta's `desiredWorld`; the baseline was refreshed into a new `.blend`.

## Scripts

| Script | Role |
| --- | --- |
| `scripts/make_bridge_scripts.py` | python3: writes extract bodies (OFFSET/COUNT) and batched preview/apply bodies (DELTA/APPLY/DELETIONS) |
| `scripts/extract_genesys_scene.js` | `run_script(readOnly)` body template: one self-sizing chunk of the live scene |
| `scripts/merge_manifest_chunks.py` | python3: merge saved chunks into one manifest |
| `scripts/bridge.sh` | Finds Blender; runs `sync-from-genesys` / `diff` / `validate` / `test`; exits on the RESULT line |
| `scripts/blender_bridge.py` | The Blender CLI the wrapper runs |
| `scripts/apply_genesys_delta.js` | `run_script` body template: preview or apply one batch, idempotently |
| `scripts/test_euler_roundtrip.mjs`, `scripts/test_bridge_blender.py` | Self-test against three.js (`bridge.sh test`) |
