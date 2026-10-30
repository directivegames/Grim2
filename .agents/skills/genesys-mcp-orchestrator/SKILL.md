---
name: genesys-mcp-orchestrator
description: "Drive the live editor through Genesys MCP: availability gate, channel probe, version gate, readiness, run_script/batch_execute limits, approvals, save-and-re-query, build/play/console/exit, material and colour values on scene nodes, and the MCP-off playbook. Use before any MCP call, or when MCP is down, an edit did not persist, or a colour reverts. Not for editor UI how-tos (use `genesys-editor-manual`)."
metadata:
  tokens: 3237
---

# Genesys MCP Orchestrator

Genesys in skills and code is Sandbox Studio in the product UI (same app, same MCP). This skill owns live editor work: transforms, hierarchy, materials, placed nodes, lights and prefab instances change through MCP; reusable behaviour goes in TypeScript. Never patch an editor node from `beginPlay`.

## Use another skill when
- UI how-to, where a button is, or MCP is Off and the user wants it done by hand → `genesys-editor-manual`
- Node classes, pawns, reusable behaviour → `genesys-engine`
- GameMode boot, `buildProject` order, `.dist/game.js` bundle proof → `genesys-game-boot`
- What evidence a change needs, smoke test, in-Play captures → `genesys-verification`
- Where a mesh, texture, skybox or sound comes from → `genesys-assets`
- Prefab decisions → `genesys-prefabs`; Poly Builder → `genesys-polybuilder`; Insights and traces → `genesys-profiler`; JavaScript heap and VRAM → `memory-profiling`; sky, terrain, water and outdoor worlds (`action_scene` `applyWorld`, `auditWorld`, `applyEnvironmentPreset`, `applyLookPreset`) → `genesys-world-building`; subagents → `genesys-subagents`
- Fog, sky, lights, emissive glow → `genesys-lighting`; node-material classes → `webgpu-tsl-node-material-assets`

## Availability gate

The default surface is compact: `run_script`, `batch_execute`, `search_tools`, `describe_tool`, `genesys_request_approval` and the core `query_*` / `action_*` routers (project, editor, node, scene, build). Every other tool is compact-hidden, so a missing descriptor is expected: call it through `run_script` (`genesys.*`) or `batch_execute` (`tool:`). List: [compact-hidden-tools.md](references/compact-hidden-tools.md).

| State | Signal | Action |
|-------|--------|--------|
| Connected | Genesys entry tools (especially `run_script` / `batch_execute`) in the tool list | Use MCP |
| Probe-capable | `CallMcpTool` available and Genesys MCP descriptors/server metadata present | Use MCP via `CallMcpTool` |
| Off | User disabled MCP, or every channel failed the probe below | Do not use MCP |
| Forbidden | Shell/`curl`/HTTP against `mcp.json` or the MCP endpoint | Never |

Ready when: Sandbox Studio runs with Genesys MCP enabled, the matching channel is connected in the IDE (server id from Configure / connection details; never invent it), a project is open, and `query_editor(getState)` reports `editorReady: true`. Disk config or descriptor presence alone is not ready.

### Channel probe

Sandbox Studio runs one MCP server per environment: `sandbox-studio-genesys`, `-dev`, `-staging` (Cursor prefixes `user-`). Once per task:

1. Probe the default channel with `query_editor(getState)`.
2. If it errors, times out, or is not connected, probe every other configured Genesys channel the same way.
3. Use the first channel that reports `editorReady: true`. MCP is Off only after every channel failed.

### MCP Off

Never stall the build, and never move a scene edit into `beginPlay`. Keep doing TypeScript, models, layouts and docs; queue editor work in `GAME.md` → Now tagged `[MCP]`; report what is built, what is queued, and the one action that unblocks it. Re-probe at the start of each user turn. Full playbook and connection errors: [mcp-off.md](references/mcp-off.md).

## Readiness and dispatch

Before the first mutation: `query_editor(operation="getState")` (`genesys.queryEditor` inside `run_script`). It already includes busy state; use `getBusyState` only after a long build/play transition. Read-only inspect/count can skip it when Connected.

| Path | Use when |
|------|----------|
| Direct `query_*` / `action_*` | One known operation |
| `run_script` | Find/read/mutate/save, or runtime-discovered/computed targets |
| `batch_execute` | Known fixed `operations: [...]` list, no JavaScript (no `code` field) |

Script API methods are camelCase (`queryNode`, `actionNode`); snake_case names are MCP tool names. `genesys` in `run_script` is tool proxies only: there is no `genesys.getWorld()` or other engine API (fetch `genesysmcp://api/typescript` if unsure).

Bulk find→mutate is one `run_script(apply, groupUndo=true)` that probes, finds, mutates, saves, and returns a compact summary with counts (so an empty result shows as `0`). Do not pre-query nodes through the model.

- `action_node.add` ignores `properties`: follow it with `setProperties` on `affectedComponentIds[0]`.
- A mutation costs ~0.6 s and the client can give up on a call at 60 s: keep each apply under ~150 mutations, resumable by slot name, and each script under ~45 s. Hundreds of nodes go through a layout file (`genesys-level-authoring`).
- Limits, approvals, discovery order, version gate: [dispatch.md](references/dispatch.md). Task recipes: [workflows.md](references/workflows.md).

## Finding nodes

- `@scene/Name [nodeUuid=…]` is a live node: pass the uuid as `componentIds`. While ready, never glob, grep or `findFiles` for node names or read `*.genesys-scene`.
- `query` is a plain string, never an object or array. `find` / `getTree` return a flat `nodes[]` with `parentId` + direct `childIds`; when `truncated` is true, narrow `query`.
- One discovery op per question: never both `find` and `getTree`. Shapes and count recipes: [workflows.md → Find](references/workflows.md#find--inspect--select-nodes).

## Save, then re-query

Pass `groupUndo: true` for multi-step apply. After every mutation batch call `action_scene(action="save")`, then re-query what you changed (`query_node(getDetails)`). Do not rely on auto-save: `action_prefab.instantiate` does not save, and colour and material edits can read back fine live and still be missing from the saved scene. While a prefab document is open, flush with `action_prefab.save` / `close`, never `action_scene.save`. An explicit `approval.operations` list must include `action_scene.save`, or omit `operations` and let it derive.

## Build, play, console, exit

`action_build(buildProject)` registers new or renamed `@ENGINE.GameClass()` classes; Play saves and rebuilds on enter, so don't call it before `enterPlayMode`. The full build order is owned by `genesys-game-boot`.

1. `buildProject` (only after adding or renaming a game class) is its own direct call: never in `batch_execute`, a `readOnly` script, or the same message as `enterPlayMode` or scene mutations (they wait on it for up to 30 s, then fail with `editor_busy`). Wait for its result.
2. After a prefab save/apply/resync, bulk layout, scene load/save or large `batch_execute`, a `Scene world reset` keeps the editor busy for a few seconds. Calls wait for it (up to 30 s); for a longer one poll `getBusyState` until `isBusy` is false ([recipe](references/workflows.md#wait-for-busy-to-clear)), then build.
3. Check `query_editor(getPlayModeState)` before `enterPlayMode` and `exitPlayMode`. `isActive` / `isStarting` before you entered → the creator is playing: don't take over or exit. `exitPlayMode` when not playing is an error.
4. Play, wait, read the console, exit in one `run_script(apply)`: [recipe](references/workflows.md#build-play-console-exit). `getConsole` returns errors and warnings, not `console.log`. Do not mutate nodes during Play; read it with `query_play`.
5. Diagnose with edit-mode queries first, then enter Play once to confirm: [Play-test loop](references/workflows.md#play-test-loop).

## Reading MCP results

Do not trust wrapper `isError` or `status: "success"`; parse the JSON body. Failed when: `ok === false`, `error.code` present, `status === "blocked"`, content starts with `MCP error`, or `batch_execute` has entries in `errors[]`. Read `error.code` / `message` / `recovery`; if `recoverable`, fix and retry once. Apply "Did you mean …" suggestions exactly. Never report success after `ok: false`.

| Code | Do |
|---|---|
| `editor_loading` / `editor_not_ready` / `editor_busy` | Retry after `recovery.retryAfterMs`; if it persists, report blockers |
| `operation_still_running` | Poll `getBusyState` until not busy, read `lastWorldBuild`. Never re-issue |
| `scene_not_open` | `action_scene(open)`, retry |
| `play_mode_active` | `exitPlayMode`, capture with `target: "play"`, or use `query_play` |
| `editor_hidden` / `editor_disconnected` | Ask the user to restore the Sandbox Studio window / reload the editor window; stop |
| `play_capture_unavailable` | Capture in edit mode with `cameraNodeId` |
| `app_offline` / `app_restarting` / `unauthorized` | [mcp-off.md → Connection errors](references/mcp-off.md#connection-errors) |

Empty `classes: []` with `ok: true` from `getRegisteredClasses` means not loaded yet: rebuild and query again. Unavailable diagnostics mean unknown, not success. Tell the user outcomes (counts, names, blockers), not `script_threw` or Zod text.

## Critical call shapes

- Routers require `operation` (queries) or `action` (actions). `query_diagnostics` takes `operation: "getBuildErrors" | "getConsole"`, never `query`.
- Selection: `query_editor(operation="getSelection")`. `describe_tool` takes `name`, not `toolName`; add `operation` (`{ name: "action_editor", operation: "captureScreenshot" }`) for that operation's parameters, since tool schemas keep only one-line field hints.
- Put `mode` / `approval` / `groupUndo` / `code` inside the tool `arguments`.
- `query_asset(find)` indexes project/pack assets only; existence-check `@engine/...` paths with `getDetails`.
- `action_node` operations are only `add`, `delete`, `setProperties`, `select`. Transforms use property paths from `getEditableProperties`.
- Confirm a `className` with `query_editor(getRegisteredClasses, filter=…)`. Prefer `*Node` names (`ENGINE.MeshNode`, `GAME.MyNode`).
- A tool you can't find may be compact-hidden or 18.1+ only: check [dispatch.md → Discovery](references/dispatch.md#discovery) before calling it unavailable.

## Capture vs query

Scene facts (what exists, where, selected, whether an edit landed) are verified with `query_node` / `query_editor`. A look (sky, lighting, terrain, camera, HUD) is verified with `action_editor(frameNodes)` then `captureScreenshot` called directly (images are stripped inside scripts); read `metrics` first. Options: [workflows.md → Screenshot](references/workflows.md#screenshot).

## Material and colour values

Set `MeshNode.material` (or `ModelMeshNode.modelMaterial` / `modelMaterials`) to a `.material.json` path: reuse an existing file, or `action_asset(createMaterial)` and edit the new file's fields. Then `setProperties` → save → re-query. Recipe: [workflows.md → Node property edit](references/workflows.md#node-property-edit).

## Traps

- `setProperties` blocks a material with "takes a material asset path" → the value was an object (`{ color: … }`, a material's JSON) → set a `.material.json` path; `action_asset(createMaterial)` makes one (*Material and colour values*).
- Deleting a scene's sky, sun or other environment node to "replace" it → the creator's tuning is lost and the scene can go dark. Change its properties; delete only when asked.
- Scene edit "made" in `beginPlay` after MCP failed → the editor scene never changed and the next edit fights runtime code → probe every channel, report, queue the edit.

## Done
- `editorReady: true` on the channel used before the first mutation; every result body had `ok !== false` and no `errors[]`.
- Scene or prefab flushed after the last batch; re-queried nodes show the new values.
- After TypeScript changes: `buildProject` ran alone and the class appears in `getRegisteredClasses`.
- Play entered only when no session was running, and exited by the agent that entered it.
- MCP Off: the report lists what was built and the queued `[MCP]` steps.

## References
- [workflows.md](references/workflows.md) — task recipes (find, bulk edit, add, materials, play-test, build/play, screenshot, prefabs, Poly Builder, profiling); open the matching section only
- [dispatch.md](references/dispatch.md) — cost and hard limits, approvals, discovery order, 18.1+ version gate; open before a large script or when a tool seems missing
- [mcp-off.md](references/mcp-off.md) — MCP-off playbook and connection errors; open when every channel failed
- [compact-hidden-tools.md](references/compact-hidden-tools.md) — every compact-hidden tool and its ops (generated)
- [editor-asset-generation.md](references/editor-asset-generation.md) — the editor's `action_asset_generation`; only when the user asks for the in-editor generator
- MCP resources: `genesysmcp://guide/overview` · `safety` · `token-efficiency` · `batching`; `genesysmcp://api/typescript` (fetch once before a non-trivial `run_script`); `genesysmcp://editor/state` · `scene/summary` · `project/manifest`
