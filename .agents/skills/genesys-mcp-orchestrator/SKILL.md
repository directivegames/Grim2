---
name: genesys-mcp-orchestrator
description: Live Genesys editor MCP orchestration (availability gate, readiness probe and recovery, run_script/batch_execute dispatch, result reliability, framing and viewport/play capture with metrics). Not for UI how-tos or pure TypeScript edits.
metadata:
  tokens: 3978
---

# Genesys MCP Orchestrator

Naming: Genesys in skills/docs/code = Sandbox Studio in the product UI (same app / MCP).

Use this skill for live Genesys editor/project work through MCP. For editor UI how-tos (menus, hotkeys), or when MCP is Off, read [genesys-editor-manual](../genesys-editor-manual/SKILL.md). Task recipes live in [references/workflows.md](references/workflows.md) — open only when needed.

## Availability Gate

The default surface is compact. Missing descriptors for hidden tools (`action_asset`, `action_prefab`, `query_asset`, `query_diagnostics`, navmesh tools, `query_profiler`, `action_profiler`, `query_play`) is expected. Frame cost: [genesys-profiler](../genesys-profiler/SKILL.md). JavaScript heap and VRAM: [memory-profiling](../memory-profiling/SKILL.md).

| State | Signal | Action |
|-------|--------|--------|
| Connected | Genesys entry tools (especially `run_script` / `batch_execute`) in the tool list | Use MCP |
| Probe-capable | `CallMcpTool` available and Genesys MCP descriptors/server metadata present | Use MCP via `CallMcpTool` |
| Off | User disabled MCP, or neither signal above | Do not use MCP |
| Forbidden | Shell/`curl`/HTTP against `mcp.json` | Never |

Ready when: Sandbox Studio is running with Genesys MCP enabled, the matching environment channel is connected in the IDE (server id from Configure / connection details), a project is open, and `query_editor(getState)` reports `editorReady: true`.

Not readiness on their own: disk MCP config, `project_none`, `unauthorized`, `app_offline`, `app_restarting`, or `editorReady: false`.

When Off or probe fails: report `blockingReasons` when available; use code/filesystem tools; do not read `*.genesys-scene` or glob/grep node display names / `@scene/…` unless the user asks or MCP is genuinely unavailable; do not retry MCP via shell. If the error is `app_offline`, tell the user to launch Sandbox Studio. If `app_restarting`, retry once after a short wait.

## Readiness and Dispatch

Before the first mutation: `query_editor(operation="getState")` or `genesys.queryEditor({ operation: "getState" })` inside `run_script`. `getState` is editor-only — not a scene/node operation. Use `getBusyState` only after a long build/play transition (`getState` already includes busy state).

| Path | Use when |
|------|----------|
| Direct `query_*` / `action_*` | One known operation |
| `run_script` | Find/read/mutate/save, or runtime-discovered/computed targets |
| `batch_execute` | Known fixed `operations: [...]` list, no JavaScript |

`batch_execute` has no `code` field. Script API methods are camelCase (`queryEditor`, `queryNode`, `actionNode`, …); snake_case names are MCP tool names only.

## Scenario

When the Scenario MCP server is connected, generate with it. Use `action_asset_generation` `start` only when that server is not available. Credit-spending calls ask for approval in the Assistant panel and the card shows the estimated credits; a `dry_run` cost estimate does not. When a Scenario tool result contains an asset id, the Genesys editor shows the Scenario viewer on that result. Do not call `asset_display` only to preview it in the editor. Other clients show the asset by calling `asset_display` with that id. To bring a Scenario asset into the project, always use `action_asset_generation` with `action: "import"`, `scenarioAssetIds`, and a short English `name` for the file. Omit `saveFolder` unless the user named a folder. Call `apply` only when the user asked to put the asset in the scene. Never download Scenario files by hand.

After a Scenario MCP generation succeeds, import it by default unless the user asked to keep it only in Scenario. `import` is not a generation: it spends no credits and is allowed even when the user said not to use the asset generation tool. The recipe is in [references/workflows.md](references/workflows.md).

Bulk find→mutate: first MCP call should be one `run_script(apply, groupUndo=true)` that probes, finds, mutates, saves, and returns a compact summary — do not pre-query nodes through the model or grep `*.genesys-scene` while ready.

Every tool call is a model turn that re-reads the conversation, so merge steps whose inputs you already know into one script: survey, post-apply finds, look and material edits, audit. Return counts next to lists so an empty result shows as `0`, not as a silent miss. Keep each script under about 45 s: the MCP client gives up at 60 s while the script keeps running. A world build inside a script returns `operation_still_running` after 50 s. Screenshots lose their image inside a script, so call `captureScreenshot` directly.

Prefer `query_node` / `action_node` for world/prefab scene-node trees.

## Attached node context

- `@scene/Name` or `@scene/Name [nodeUuid=…]` is a live scene node, not a `.genesys-scene` file and not `query_project(findFiles)`.
- Prefer the `nodeUuid` marker (or selection ids) as `componentIds` for `query_node(getDetails)` / `action_node`.
- When MCP is ready: never glob, grep, or `findFiles` for node display names.

## Script API vs engine

- `genesys` in `run_script` = MCP tool proxies only (`queryNode`, `actionNode`, …).
- No `genesys.getWorld()`, `getRootNodes()`, or other engine runtime APIs. Fetch `genesysmcp://api/typescript` if unsure — do not invent methods.

## Tree shape

- `find` / `getTree` return a flat `nodes[]` with `parentId` + `childIds` (direct children only).
- `query` is a plain string (case-insensitive substring on name, className, id, or prefabPath). It filters matching nodes only — it does not expand a nested subtree.
- Wrong: `query: { name: ['A', 'B'] }` or any object/array. Right: `query: 'A'` or one `getTree` + `names.includes(n.name)` in script.
- Subtree size: walk `childIds` in one `run_script(readOnly)`, or use `childIds.length` when depth is known shallow. Do not chain exploratory `getDetails` after a successful `find` that already has `childIds`.
- Do not call both `find` and `getTree` for the same discovery question.
- `getTree` returns at most `limit` nodes (default 200, max 500); `find` defaults to 50. Both report `matchedNodes` and `truncated`. When `truncated` is true, a script filtering `nodes[]` misses nodes: narrow `query` (a class name such as `"DamageObjectActor"` matches) instead.
- `getDetails` returns `components[]`; `transform.position` is a string such as `"(21.2, 14, 51.1)"`, not `properties.position`.

## Clarifying Questions

When `request_user_input` is listed, call it instead of asking a clarifying question in chat, then wait. Use it only when a wrong assumption would change the work. Otherwise state the assumption and continue. One question is enough; do not exceed three. Recommended option first, with "(Recommended)" on its label. Do not add Other.

## Play-test loop

Play is slow and costly. Diagnose first, then confirm once.

1. Diagnose in edit mode with queries (`query_node`, `query_editor`). Do not enter Play to test a hypothesis that a query can answer. For a spawn problem, call `query_node(operation="checkSpawnPoints")` first.
2. `enterPlayMode` already saves the scene and rebuilds the project. Never run `action_build` before it. Use `action_build` only to register new game classes in the editor.
3. Enter Play once, take all the captures you need, then exit once. Do not cycle enter/exit per capture.
4. Captures: start with `includeImage: false`. When you need the image, set `maxEdge` to 800 or less. Captures land in `.editor/captures/<day>/` by default (not project assets), so debug captures need no flag. Pass `saveLocation: 'none'` to skip the file write entirely. Pass `saveLocation: 'assets'` only when the user asks to keep the image in the game's assets.
5. `query_node` cannot see the Play world: it returns `play_mode_active`. During Play, read state with `query_play` (compact-hidden: `genesys.queryPlay` in `run_script`, or `batch_execute`): `getPlayerPawns`, `getNodeTransform` (`{ nodeId | name }`), `raycast` (`{ origin, direction, maxDistance }`).
6. Run `pnpm build` and `pnpm lint` once at the end, not after every iteration.

Spawn and PlayerStart placement: [existing-scene.md](../genesys-world-building/references/existing-scene.md#playerstart-recipe). Full recipe: [workflows.md](references/workflows.md#play-test-loop).

## Approval and Build

| Path | Approval |
|------|----------|
| Direct tools (`action_build`, `action_node`, `action_scene`, …) | Auto-mint per call in `auto` mode |
| `batch_execute(apply)` | Auto-derive scopes from `operations` when omitted |
| `run_script(apply)` | Pass `approval.operations` or rely on auto-derivation from `genesys.*` calls |

Use `genesys_request_approval` / `approvalId` only for prompt-mode pre-approval or token reuse. Pass `groupUndo: true` for multi-step apply. Node mutations auto-save on successful apply — only call `action_scene(save)` when you changed the scene outside those paths or need an explicit flush before build/export.

`readOnly` scripts cannot call any `action_*` tool. Use direct `dryRun: true` or `run_script(mode="dryRun")` for previews.

Build boundary: `action_build(action="buildProject")` is a direct tool after TypeScript edits that add or rename game classes. Do not call it before `enterPlayMode`: Play rebuilds on enter. Do not batch it with node/scene/prefab/asset mutations. Details: [workflows.md](references/workflows.md#register-a-code-class).

## Reading MCP Results

Do not trust wrapper `isError` or `status: "success"`. Parse the JSON body.

Treat as failed when: `ok === false`, `error.code` present, `status === "blocked"`, content starts with `MCP error`, or `batch_execute` has `ok === false` / entries in `errors[]`.

On failure: read `error.code` / `message` / `recovery`; if `recoverable`, fix and retry once; apply "Did you mean …" suggestions exactly. Never report success after `ok: false`.

Readiness errors carry `error.recovery: { action, hint, retryAfterMs? }` (also on `query_editor(getState)` as `recovery` when not ready):

| Code | Do |
|------|----|
| `editor_loading` | Wait `retryAfterMs`, retry (chunk/asset load) |
| `editor_not_ready` / `editor_busy` | Retry after `retryAfterMs`; if it persists, report blockers |
| `operation_still_running` | A world build is still running: poll `query_editor(getBusyState)` until `isBusy` is false, then read `lastWorldBuild` (`ok`, `focusNodeId` = the new terrain); never re-issue the action |
| `scene_not_open` | `action_scene(open)` a scene, then retry |
| `play_mode_active` | `action_editor(exitPlayMode)`, or capture with `target: "play"`. For `query_node` during Play, use `query_play` instead |
| `editor_hidden` | Ask the user to restore the Sandbox Studio window. `getState.viewportVisible: false` predicts it: check before a capture |
| `editor_disconnected` | Ask the user to reload the editor window; stop |
| `play_capture_unavailable` | Capture in edit mode with `cameraNodeId` |

When MCP is not ready, recover or stop and report. Never edit runtime game code (for example `beginPlay` scenery) to stand in for a scene edit — that patches the wrong target.

User-facing replies: state the outcome (counts, names, blockers). Do not quote `script_threw`, Zod text, or “query shape was wrong” unless the user asked for debugging. On `expected string, received object` for `query`: pass a string or use `getTree` + in-script filter; one silent retry max.

## Critical Call Shapes

- Prefer `query_node` / `action_node` for world/prefab scene-node trees.
- Routers require `operation` (queries) or `action` (actions).
- `describe_tool` takes `name`, not `toolName`.
- Nested wrapper args: put `mode` / `approval` / `groupUndo` / `code` inside tool `arguments`.
- `query_asset(find)` indexes project/pack assets only — not `@engine/...`. Use `getDetails` to existence-check an `@engine/...` path.

### `query_node` find / getTree

- `query` is a string substring only — never `{ name: [...] }`, arrays, or other objects (Zod fails with `expected string, received object`, often as `script_threw` if uncaught).
- One exact name / substring: `operation: 'find'` with `query: 'CircleBox_12'`.
- Several exact names or subtree counts: one `getTree(limit)` (≤500), filter in script, walk `childIds` — do not invent a structured `query` object.
- Pick one discovery op per question (`find` or `getTree`); never both for the same count.
- Read-only inspect/count: skip `getState`; it is required only before the first mutation (or when MCP availability is unknown).

## Discovery

Verification rule: **state is verified by query; look is verified by capture.** What exists, where it is, what is selected and whether an edit landed → `query_node` / `query_editor`. How a world looks (sky, lighting, water, terrain, camera) → frame, capture, read `metrics`, and look at the image.

Capture: `action_editor(action="captureScreenshot", focusNodeIds=[…], views=["hero","overview"], maxEdge=1280)` returns one record per view with `metrics` (exposure, clipping, colourfulness, detail, `flatFrame`, per-node `nodeCoverage`, `warnings[].code`). Read metrics first; set `includeImage: false` when only checking framing. `camera` / `cameraNodeId` render from another pose without moving the editor camera; `target: "play"` (or `auto` during play) captures the running game; `surface: "all"` (or `"client-2"`) captures extra multiplayer windows, one after another, without metrics. Frame first with `action_editor(action="frameNodes", nodeIds=[…], view="iso")`; a node with no mesh (trigger) is framed around its position; a PlayerStart is framed around its capsule. Recipe: [workflows.md](references/workflows.md#screenshot).

Before saying a capability is unavailable, do not stop at Cursor tool-name search (catalog names and truncated descriptions miss router ops). Check:

1. Known compact routers and their ops (`action_editor`, `action_node`, `action_scene`, `action_build`, `query_editor`, `query_node`, `action_asset_generation`, `query_asset_generation`, …) — call directly (`run_script`, `batch_execute`, …).
   Dispatch: generar arte, skybox o cielo → `action_asset_generation`. Recipe: [workflows.md](references/workflows.md#generate-a-skybox).
2. Genesys `search_tools(query=…)` (names, descriptions, and ops) or [workflows.md](references/workflows.md).
3. Known hidden tool → `run_script` (`genesys.*`) or `batch_execute` (`tool:`); see [compact-hidden-tools.md](references/compact-hidden-tools.md). Do not `describe_tool` first.
4. Use `search_tools` / `describe_tool` only for exploration, unknown tools, or after a schema/validation failure — never both for the same tool in one task.
5. Prefer `query_node` / `action_node` for scene trees.

Skip `select` / `focus` / `frameSelection` unless the user asks or the next step needs selection. For captures use `frameNodes` (no selection needed).

## MCP Vs Code

- MCP: live scene/editor state, nodes, prefabs, per-instance properties, transforms, builds, diagnostics, environment and look presets (`action_scene(applyEnvironmentPreset)`, `action_scene(applyLookPreset)`, outdoor worlds from a recipe (`action_scene(applyWorld)`, `auditWorld`); see [genesys-world-building](../genesys-world-building/SKILL.md)).
- Code: TypeScript, reusable behaviour, class defaults, runtime construction.
- Both: code first to register capability, then MCP to place/configure.

## Resources (on demand)

- [workflows.md](references/workflows.md) — task recipes (transform, primitives, screenshots, …)
- [compact-hidden-tools.md](references/compact-hidden-tools.md) — hidden tool ops
- `genesysmcp://guide/overview` · `safety` · `token-efficiency` · `batching`
- `genesysmcp://api/typescript` — fetch once before non-trivial `run_script`
- `genesysmcp://editor/state` · `scene/summary` · `project/manifest`
