# Blender → Genesys

Pushes use `scripts/apply_genesys_delta.js` through Genesys MCP. Do not patch the
serialized scene file (SKILL.md). What to push, and what not to, is also there.

## 1. Diff

```bash
blender --background path/to/edited.blend \
  --python .agents/skills/genesys-blender-bridge/scripts/blender_bridge.py -- \
  diff --output path/to/changes.bridge-delta.json
```

Save the `.blend` first. Review:

- changed transforms;
- proposed additions;
- unsupported objects (including reparented mirrored nodes — the bridge does
  not reparent live Genesys nodes);
- `missingBaselineIds` (informational, not deletion requests).

The diff compares a child against its Blender parent-relative baseline. Moving
a SceneNode empty therefore proposes one SceneNode transform instead of
redundant updates for every unchanged descendant. `desiredLocal` is already
in the delta, sorted by `outlineOrder`. Schema: [manifest.md](manifest.md).

## 2. Preview

`query_editor(getState)`: `editorReady`, play inactive, `activeScenePath` equals
the delta's `sourceScene`.

Embed the parsed delta in `scripts/apply_genesys_delta.js`, keep `APPLY=false`,
and submit it through `run_script(readOnly)`. The script performs identity,
class, parent, editable-property, and conflict checks. Show its summary
(updates, additions, deletions, conflicts, unsupported, scene path, whether
a save would occur) and ask for approval.

Force-overwriting a conflict is per record, never global by default — do not
edit the script to skip conflicts unless the user names those IDs.

## 3. Apply

Same payload with `APPLY=true` in one `run_script(apply, groupUndo=true)`.
Scope approval to `action_node.add`, `action_node.setProperties`,
`action_node.delete`, and `action_scene.save`.

The script aborts on any conflict before the first mutation, writes each
change's `desiredLocal`, adds approved `ENGINE.ModelMeshNode` placements, deletes
only the embedded `DELETIONS` list, verifies with `getDetails` on those IDs,
and saves. It does not re-query the live parent after ancestor writes. If
transform verification fails, stop; do not retry from the old `.blend`.

`setProperties` in this script is `position`, `rotation`, `scale`, `modelUrl`,
and `name` only. Never call the Genesys HTTP endpoint from shell or Blender.

## 4. Refresh baseline

Only after a successful apply: extract a fresh manifest and run
`sync-from-genesys` into a **new** output `.blend`. Continue editing that file so
created objects get real Genesys IDs and a fresh `GENESYS_BRIDGE_BASELINE`.

Do not run another `diff` from the old `.blend` — it will propose the same
additions again and duplicate them in Sandbox. Ask the user to close Blender
or write a new output copy before that refresh, so an older in-memory file
cannot overwrite the metadata.

## Additions

A Blender mesh is eligible only when it is inside the bridge scene collection,
has `genesys_asset_path` (`@project/...` or `@engine/...`), and is a linked
duplicate of the matching canonical library source (shared mesh datablock — a
custom property alone is not enough).

Resolve the Genesys parent only from the object's current Blender parent when
that parent is a mirrored exact `ENGINE.SceneNode`. Ignore inherited `groupId`.
Null `parentId` (unparented, or parented to anything that is not that
SceneNode) is a Genesys scene root — SKILL.md.

A normal Blender duplicate may inherit `genesys_node_id`. The diff may
classify extras as additions only when exactly one object still has the
baseline name and every extra object is a mesh carrying `genesys_asset_path`;
otherwise stop as ambiguous.

The apply script adds `ENGINE.ModelMeshNode`, then `setProperties` for
`modelUrl` and transform, then a separate `name` so a rejected name path cannot
abort the batch.

## Deletions

Embed only IDs the user explicitly named, each as `{ id, name, className }`
in `DELETIONS` inside the apply script. The script refuses a target that is
gone, whose live name/class do not match, whose class is unsupported, or that
has children. Prefab roots/children may be protected by MCP and must not be
bypassed.
