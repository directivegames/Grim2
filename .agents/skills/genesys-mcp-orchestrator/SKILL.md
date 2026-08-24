---
name: genesys-mcp-orchestrator
description: Live Genesys editor MCP orchestration (availability gate, readiness probe, run_script/batch_execute dispatch, result reliability, viewport screenshot). Not for UI how-tos or pure TypeScript edits.
---

# Genesys MCP Orchestrator

Naming: Genesys in skills/docs/code = Sandbox Studio in the product UI (same app / MCP).

Use this skill for live Genesys editor/project work through MCP. For editor UI how-tos (menus, hotkeys), or when MCP is Off, read [genesys-editor-manual](../genesys-editor-manual/SKILL.md). Task recipes live in [references/workflows.md](references/workflows.md) — open only when needed.

## Availability Gate

The default surface is compact. Missing descriptors for hidden tools (`action_asset`, `query_asset`, `query_diagnostics`, navmesh tools) is expected.

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

Bulk find→mutate: first MCP call should be one `run_script(apply, groupUndo=true)` that probes, finds, mutates, saves, and returns a compact summary — do not pre-query nodes through the model or grep `*.genesys-scene` while ready.

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
- `query` is a plain string (case-insensitive substring on name, className, or id). It filters matching nodes only — it does not expand a nested subtree.
- Wrong: `query: { name: ['A', 'B'] }` or any object/array. Right: `query: 'A'` or one `getTree` + `names.includes(n.name)` in script.
- Subtree size: walk `childIds` in one `run_script(readOnly)`, or use `childIds.length` when depth is known shallow. Do not chain exploratory `getDetails` after a successful `find` that already has `childIds`.
- Do not call both `find` and `getTree` for the same discovery question.

## Approval and Build

| Path | Approval |
|------|----------|
| Direct tools (`action_build`, `action_node`, `action_scene`, …) | Auto-mint per call in `auto` mode |
| `batch_execute(apply)` | Auto-derive scopes from `operations` when omitted |
| `run_script(apply)` | Pass `approval.operations` or rely on auto-derivation from `genesys.*` calls |

Use `genesys_request_approval` / `approvalId` only for prompt-mode pre-approval or token reuse. Pass `groupUndo: true` for multi-step apply. Node mutations auto-save on successful apply — only call `action_scene(save)` when you changed the scene outside those paths or need an explicit flush before build/export.

`readOnly` scripts cannot call any `action_*` tool. Use direct `dryRun: true` or `run_script(mode="dryRun")` for previews.

Build boundary: `action_build(action="buildProject")` is a direct tool after TypeScript edits. Do not batch it with node/scene/prefab/asset mutations. Details: [workflows.md](references/workflows.md#register-a-code-class).

## Reading MCP Results

Do not trust wrapper `isError` or `status: "success"`. Parse the JSON body.

Treat as failed when: `ok === false`, `error.code` present, `status === "blocked"`, content starts with `MCP error`, or `batch_execute` has `ok === false` / entries in `errors[]`.

On failure: read `error.code` / `message`; if `recoverable`, fix and retry once; apply "Did you mean …" suggestions exactly; on `editor_not_ready` / `editor_busy` report blockers and stop. Never report success after `ok: false`.

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

Viewport capture: `action_editor(action="captureScreenshot", includeImage=true)` — live editor viewport, not OS/desktop. Recipe: [workflows.md](references/workflows.md#screenshot).

Before saying a capability is unavailable, do not stop at Cursor tool-name search (catalog names and truncated descriptions miss router ops). Check:

1. Known compact routers and their ops (`action_editor`, `action_node`, `action_scene`, `action_build`, `query_editor`, `query_node`, …) — call directly (`run_script`, `batch_execute`, …).
2. Genesys `search_tools(query=…)` (names, descriptions, and ops) or [workflows.md](references/workflows.md).
3. Known hidden tool → `run_script` (`genesys.*`) or `batch_execute` (`tool:`); see [compact-hidden-tools.md](references/compact-hidden-tools.md). Do not `describe_tool` first.
4. Use `search_tools` / `describe_tool` only for exploration, unknown tools, or after a schema/validation failure — never both for the same tool in one task.
5. Prefer `query_node` / `action_node` for scene trees.

Skip `select` / `focus` / `frameSelection` unless the user asks or the next step needs selection.

## MCP Vs Code

- MCP: live scene/editor state, nodes, prefabs, per-instance properties, transforms, builds, diagnostics.
- Code: TypeScript, reusable behaviour, class defaults, runtime construction.
- Both: code first to register capability, then MCP to place/configure.

## Resources (on demand)

- [workflows.md](references/workflows.md) — task recipes (transform, primitives, screenshots, …)
- [compact-hidden-tools.md](references/compact-hidden-tools.md) — hidden tool ops
- `genesysmcp://guide/overview` · `safety` · `token-efficiency` · `batching`
- `genesysmcp://api/typescript` — fetch once before non-trivial `run_script`
- `genesysmcp://editor/state` · `scene/summary` · `project/manifest`
