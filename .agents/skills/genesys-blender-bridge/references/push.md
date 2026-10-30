# Blender → Genesys

Pushes use `scripts/apply_genesys_delta.js` bodies through Genesys MCP. Do not
patch the serialized scene file (SKILL.md). What to push, and what not to, is
also there.

## 1. Diff

```bash
bash .agents/skills/genesys-blender-bridge/scripts/bridge.sh diff .scratch/blender-bridge/default.blend \
  --output .scratch/blender-bridge/changes.bridge-delta.json [--target-level <collection>]
```

Save the `.blend` first (the diff reads the saved file). Review:

- changed transforms;
- proposed additions;
- unsupported objects (including reparented mirrored nodes — the bridge does
  not reparent live Genesys nodes);
- `missingBaselineIds` (informational, not deletion requests);
- `repairedDuplicates` (Blender copies of a mirrored model that became
  additions).

The diff compares a child against its Blender parent-relative baseline. Moving
a SceneNode empty therefore proposes one SceneNode transform instead of
redundant updates for every unchanged descendant. `desiredLocal` is already
in the delta, sorted by `outlineOrder`. Schema: [manifest.md](manifest.md).

## 2. Batch (disk → run_script bodies)

```bash
python3 .agents/skills/genesys-blender-bridge/scripts/make_bridge_scripts.py apply \
  --delta .scratch/blender-bridge/changes.bridge-delta.json \
  [--deletions .scratch/blender-bridge/approved-deletions.json] [--max-units 80] [--max-chars 90000]
```

It writes `.scratch/blender-bridge/run/apply-NN.preview.js`,
`apply-NN.apply.js` and `apply-index.json` (batch, units, counts, body
sizes), with DELTA, APPLY and DELETIONS injected. Rules it follows:

- ≤ 80 mutation units per batch (transform change 1, addition 3 — add,
  setProperties, name — deletion 1; each about 0.6 s, under the client's
  300 s abort) and ≤ 90,000 characters per body (`run_script` code limit
  100,000);
- a changed parent and all its changed descendants share one batch (a parent
  moved by an earlier batch would make its children look changed in Sandbox);
- every transform change comes before any addition (an addition's
  `desiredLocal` assumes its parent already moved); deletions go last;
- `unsupported` and `missingBaselineIds` ride in batch 01 only.

## 3. Preview

`query_editor(getState)`: `editorReady`, play inactive, `activeScenePath` equals
the delta's `sourceScene`.

Submit every `apply-NN.preview.js` through `run_script(readOnly)`. The script
performs identity, class, parent, editable-property, and conflict checks and
returns counts plus short samples (arrays are capped at 20 so the response
never truncates): `updates`, `additions`, `alreadyApplied`, `deletionCount`,
`conflictCount`, `unsupportedCount`, `missingBaselineIdCount`. Show the summed
counts and the conflicts to the creator and ask for approval once for the set.

Force-overwriting a conflict is per record, never global by default — do not
edit the script to skip conflicts unless the user names those IDs.

## 4. Apply

Submit `apply-NN.apply.js` batches in order, each in its own
`run_script(apply, groupUndo: true)` call (never batched with play-mode or
build calls). Scope approval to `action_node.add`, `action_node.setProperties`,
`action_node.delete`, and `action_scene.save`.

Each batch aborts on any conflict before its first mutation, writes each
change's `desiredLocal`, adds approved `ENGINE.ModelMeshNode` placements,
deletes only the embedded `DELETIONS` list, verifies with `getDetails`, and
saves. It does not re-query the live parent after ancestor writes. A transform
that misses its target throws "Transform verification failed"; stop and
re-extract instead of retrying from the old `.blend`.

**Idempotent re-apply.** Running a batch again after a timeout or error is
safe and is the recovery step:

- a change whose node already sits at `desiredWorld` is counted in
  `alreadyApplied` and not written;
- an addition is skipped when a `ModelMeshNode` with the same `modelUrl`
  already sits under the same parent at the same world transform;
- a deletion whose node is gone is counted in `alreadyApplied`.

`setProperties` in this script is `position`, `rotation`, `scale`, `modelUrl`,
and `name` only. Never call the Genesys HTTP endpoint from shell or Blender.
After the last batch, re-query a few changed nodes with
`query_node(operation="getDetails")`: a value can read back right after a write and still not persist (`genesys-mcp-orchestrator`).

## 5. Refresh baseline

Only after a successful apply: extract a fresh manifest and run
`sync-from-genesys` into a **new** output `.blend`. Continue editing that file so
created objects get real Genesys IDs and a fresh `GENESYS_BRIDGE_BASELINE`.

Do not run another `diff` from the old `.blend` — it will propose the same
additions again (the apply bodies skip exact repeats, but any addition moved
since would be added twice). Ask the user to close Blender or write a new
output copy before that refresh, so an older in-memory file cannot overwrite
the metadata.

## Additions

A Blender mesh is eligible only when it is inside the bridge scene collection,
has `genesys_asset_path` (`@project/...` or `@engine/...`), and is a linked
duplicate of the matching canonical library source (shared mesh datablock — a
custom property alone is not enough).

Resolve the Genesys parent only from the object's current Blender parent when
that parent is a mirrored exact `ENGINE.SceneNode`. Ignore inherited `groupId`.
Null `parentId` (unparented, or parented to anything that is not that
SceneNode) is a Genesys scene root — SKILL.md.

A normal Blender duplicate (Shift+D / Alt+D) inherits `genesys_node_id`. The
original is the object whose name still equals its `genesys_blender_name`
(the name it got at sync, `.001` suffix included); every other copy that
carries `genesys_asset_path` becomes an addition. When no object keeps its
synced name (both renamed), or a copy is not a model, the diff stops as
ambiguous and names the objects.

The apply script adds `ENGINE.ModelMeshNode`, then `setProperties` for
`modelUrl` and transform, then a separate `name` (`<model>_NN`, unique among
up to 500 `find` results) so a rejected name path cannot abort the batch.

## Deletions

Embed only IDs the user explicitly named, each as `{ id, name, className }`,
in the `--deletions` JSON file. The script refuses a target whose live
name/class do not match, whose class is unsupported, or that has children, and
skips one already gone. Prefab roots/children may be protected by MCP and must
not be bypassed.
