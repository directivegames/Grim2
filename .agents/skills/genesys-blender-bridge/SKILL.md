---
name: genesys-blender-bridge
description: >-
  Mirrors a live Genesys/Sandbox Studio scene into Blender and pushes reviewed
  Blender edits (transforms, model additions, explicit deletions) back through
  Genesys MCP. Use when the user mentions Blender sync, Blender bridge,
  Genesys↔Blender, Sandbox→Blender, Blender→Sandbox, library grid at Z=-100,
  or editing a Genesys level in Blender without a custom exporter add-on.
metadata:
  tokens: 762
---

# Genesys Blender Bridge

Bidirectional, add-on-free sync between a live Sandbox Studio (Genesys) scene
and Blender. Canonical path: `.agents/skills/genesys-blender-bridge/`.
`.claude/skills` is a junction to `.agents/skills` — do not maintain a second
copy there.

## When to use

- User wants the open Genesys scene mirrored into Blender for layout edits.
- User moved / instanced / deleted objects in Blender and wants Sandbox updated.
- Default transport is Blender CLI. Optional live Blender MCP only after
  explicit install approval — [references/setup.md](references/setup.md).

## Non-negotiable boundaries

1. **Never** edit `*.genesys-scene` by hand. Live scene mutations go through
   Genesys MCP (`action_node` / `action_scene` / `run_script`).
2. **Actor ancestry rule** — mirror `ENGINE.MeshNode`,
   `ENGINE.ModelMeshNode`, their required exact `ENGINE.SceneNode` ancestors,
   and eligible `ENGINE.*LightNode` nodes. Every ancestor must be an exact
   SceneNode/MeshNode/ModelMeshNode; anything under an Actor (or any other
   class) is excluded, including nested lights/meshes.
3. Push only **location / rotation / scale** for mirrored nodes, plus reviewed
   model additions and **explicitly approved** deletions.
4. Do **not** push sibling/outliner order Blender→Genesys. Order travels
   Genesys→Blender only.
5. Do **not** infer deletions from absence in Blender. `missingBaselineIds` is
   informational until the user names IDs.
6. Unparented objects inside the Blender scene collection become **Genesys scene
   roots** on push. Do not ask; do not invent a `Models` parent.

## Workflow routing

| Direction | Steps |
| --- | --- |
| Genesys → Blender | [references/sync-from-genesys.md](references/sync-from-genesys.md) |
| Blender → Genesys | [references/push.md](references/push.md) |
| Manifest / delta schema | [references/manifest.md](references/manifest.md) |
| Architecture / identity | [references/architecture.md](references/architecture.md) |
| Blender transport setup | [references/setup.md](references/setup.md) |

Before any Genesys mutation, follow
[genesys-mcp-orchestrator](../genesys-mcp-orchestrator/SKILL.md): probe
`query_editor(getState)`, then `run_script` / `batch_execute`.

## Scripts

| Script | Role |
| --- | --- |
| `scripts/extract_genesys_scene.js` | Genesys `run_script` body — chunked live extraction |
| `scripts/merge_manifest_chunks.py` | Merge compressed chunks → one manifest |
| `scripts/blender_bridge.py` | Blender CLI: `sync-from-genesys` / `diff` / `validate` |
| `scripts/apply_genesys_delta.js` | Genesys `run_script` body — preview/apply delta |
