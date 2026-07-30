---
name: genesys-mcp-orchestrator
description: Live Genesys editor MCP orchestration (availability gate, readiness probe, run_script/batch_execute dispatch, result reliability). Not for UI how-tos or pure TypeScript edits.
---

# Genesys MCP Orchestrator

Use this skill for live Genesys editor/project work through MCP. For editor UI how-tos (menus, hotkeys), or when MCP is Off, read [genesys-editor-manual](../genesys-editor-manual/SKILL.md). Task recipes live in [references/workflows.md](references/workflows.md) — open only when needed.

## Availability Gate

The default surface is **compact**. Missing descriptors for hidden tools (`action_component`, `action_asset`, `action_prefab`, `query_asset`, `query_diagnostics`, navmesh tools) is expected.

| State | Signal | Action |
|-------|--------|--------|
| **Connected** | Genesys entry tools (especially `run_script` / `batch_execute`) in the tool list | Use MCP |
| **Probe-capable** | `CallMcpTool` available **and** Genesys MCP descriptors/server metadata present | Use MCP via `CallMcpTool` |
| **Off** | User disabled MCP, or neither signal above | Do not use MCP |
| **Forbidden** | Shell/`curl`/HTTP against `mcp.json` | Never |

**Ready when:** Sandbox Studio / Genesys is running with Genesys MCP enabled, the matching environment channel is connected in the IDE (`sandbox-studio-genesys` / `-staging` / `-dev` — still called Genesys MCP in prose), a project is open, and `query_editor(getState)` reports `editorReady: true`.

Not readiness on their own: disk MCP config, `project_none`, `unauthorized`, or `editorReady: false`.

When Off or probe fails: report `blockingReasons` when available; use code/filesystem tools; do not read `*.genesys-scene` unless the user asks or MCP is genuinely unavailable; do not retry MCP via shell.

## Readiness and Dispatch

**Before the first mutation:** `query_editor(operation="getState")` or `genesys.queryEditor({ operation: "getState" })` inside `run_script`. `getState` is editor-only — not `query_scene`. Use `getBusyState` only after a long build/play transition (`getState` already includes busy state).

| Path | Use when |
|------|----------|
| Direct `query_*` / `action_*` | One known operation |
| **`run_script`** | Find/read/mutate/save, or runtime-discovered/computed targets |
| **`batch_execute`** | Known fixed `operations: [...]` list, no JavaScript |

`batch_execute` has no `code` field. Script API methods are camelCase (`queryEditor`, `actionActor`, …); snake_case names are MCP tool names only.

**Bulk find→mutate:** first MCP call should be one `run_script(apply, groupUndo=true)` that probes, finds, mutates, saves, and returns a compact summary — do not pre-query actors through the model or grep `*.genesys-scene` while ready.

## Approval and Build

| Path | Approval |
|------|----------|
| Direct tools | Auto-mint per call in `auto` mode |
| `batch_execute(apply)` | Auto-derive scopes from `operations` when omitted |
| `run_script(apply)` | Pass `approval.operations` or rely on auto-derivation from `genesys.*` calls |

Use `genesys_request_approval` / `approvalId` only for prompt-mode pre-approval or token reuse. Pass `groupUndo: true` for multi-step apply. Actor/component mutations auto-save on successful apply — only call `action_scene(save)` when you changed the scene outside those paths or need an explicit flush before build/export.

`readOnly` scripts cannot call any `action_*` tool. Use direct `dryRun: true` or `run_script(mode="dryRun")` for previews.

**Build boundary:** `action_build(action="buildProject")` is a **direct** tool after TypeScript edits. Do not batch it with actor/scene/prefab/asset mutations. Details: [workflows.md](references/workflows.md#register-a-code-class).

## Reading MCP Results

Do **not** trust wrapper `isError` or `status: "success"`. Parse the JSON body.

Treat as failed when: `ok === false`, `error.code` present, `status === "blocked"`, content starts with `MCP error`, or `batch_execute` has `ok === false` / entries in `errors[]`.

On failure: read `error.code` / `message`; if `recoverable`, fix and retry **once**; apply "Did you mean …" suggestions exactly; on `editor_not_ready` / `editor_busy` report blockers and stop. **Never report success after `ok: false`.**

## Critical Call Shapes

- `findActors`: top-level `query` string — not `filter` / `namePattern` / `searchActors`.
- `query_actor`: always `actorIds: [...]` (even for one). `actorId` is for actions.
- Routers require `operation` (queries) or `action` (actions).
- `describe_tool` takes `name`, not `toolName`.
- Nested wrapper args: put `mode` / `approval` / `groupUndo` / `code` inside tool `arguments`.
- `query_asset` indexes project/pack assets only — not `@engine/...`.

## Discovery

1. Known compact tool → call directly.
2. Known hidden tool → `run_script` (`genesys.*`) or `batch_execute` (`tool:`); see [compact-hidden-tools.md](references/compact-hidden-tools.md). Do **not** `describe_tool` first.
3. Use `search_tools` / `describe_tool` only for exploration, unknown tools, or after a schema/validation failure — never both for the same tool in one task.

Skip `select` / `focus` / `frameSelection` unless the user asks or the next step needs selection.

## MCP Vs Code

- **MCP:** live scene/editor state, actors, prefabs, per-instance properties, transforms, builds, diagnostics.
- **Code:** TypeScript, reusable behaviour, class defaults, runtime construction.
- **Both:** code first to register capability, then MCP to place/configure.

## Resources (on demand)

- [workflows.md](references/workflows.md) — task recipes (transform, primitives, screenshots, …)
- [compact-hidden-tools.md](references/compact-hidden-tools.md) — hidden tool ops
- `genesysmcp://guide/overview` · `safety` · `token-efficiency` · `batching`
- `genesysmcp://api/typescript` — fetch once before non-trivial `run_script`
- `genesysmcp://editor/state` · `scene/summary` · `project/manifest`
