---
name: genesys-mcp-orchestrator
description: Use Genesys MCP for live editor scene/selection/asset/diagnostic queries and editor actions when Connected or Probe-capable (CallMcpTool + Genesys descriptors). Do not call MCP via shell.
---

# Genesys MCP Orchestrator

Use this skill when a task needs live Genesys editor/project context through MCP rather than static file edits alone.

## MCP Availability Gate (Read First)

Do **not** require first-class `query_*` tool names in the top-level tool list. Classify MCP availability in three states:

| State | Signal | What to do |
|-------|--------|------------|
| **Connected** | Genesys MCP tools (e.g. `query_scene`, `query_editor`, `batch_execute`) appear directly in the chat tool list | Use this skill; call tools directly |
| **Probe-capable** | `CallMcpTool` is available **and** Genesys MCP tool descriptors exist under `mcps/*genesys*/tools/` (or equivalent server metadata shows the Genesys MCP server) | Use this skill; invoke Genesys tools via `CallMcpTool` after reading the tool schema |
| **Off** | User says MCP is disabled / not enabled; or neither Connected nor Probe-capable signals are present | Stop — do not use MCP |
| **Forbidden** | You would use `curl`, HTTP, `Invoke-WebRequest`, or shell against `mcp.json` URL | Never do this |

Descriptor presence means **probe-capable**, not **ready**. A successful `query_editor(getState)` probe is required before treating MCP as usable for mutations.

Signals that do **not** mean MCP is available on their own:

- Only `.cursor/mcp.json` on disk
- The user mentioned MCP without a connected/probe-capable session
- A skill references MCP but the session lacks tools or `CallMcpTool` + descriptors

When MCP is **off** (or probe fails):

1. Tell the user live editor access requires enabling the `genesys` MCP server in Cursor and running the Genesys editor with this project open; include `blockingReasons` from a failed probe when available.
2. Use normal code and filesystem tools; do not read or edit `*.genesys-scene` unless the user explicitly asks or filesystem fallback is appropriate after MCP is genuinely unavailable.
3. Do not retry MCP or simulate it from the terminal.

When MCP is **connected** or **probe-capable**, skip broad discovery preamble — but **before the first scene/editor mutation** in a task, run the mandatory readiness probe below.

## Prerequisites

- Genesys editor running with this project open.
- `genesys` MCP server enabled and connected in Cursor.
- Genesys MCP reachable in **this** chat session — either first-class tools in the tool list, or `CallMcpTool` plus Genesys MCP descriptors under `mcps/*genesys*/tools/`.

## Three Core Flows

### 1. Availability

1. Classify session state using the gate table above (Connected, Probe-capable, or Off).
2. **Mandatory readiness probe before mutations** — call `query_editor(operation="getState")` via the available MCP path (direct tool or `CallMcpTool`). Read the tool schema first when using `CallMcpTool`.
3. If `editorReady` is true, MCP is usable for mutations. If false or the call fails, read `blockingReasons`, report them, and treat MCP as blocked for that task unless the user resolves the blocker.

### 2. Read-Only Inspection

1. Call the relevant `query_*` tool directly.
2. `query_editor(getBusyState)` — play mode, builds, scene load.
3. `batch_execute(mode="readOnly")` — scene, selection, actors, assets, diagnostics in one pass.
4. Resources: `genesysmcp://editor/state`, `genesysmcp://scene/summary`, `genesysmcp://project/manifest`.

Prefer `query_asset(find)` for assets, prefabs, and scenes before filesystem glob. Paths use forward slashes (`assets/foo.genesys-scene`); `assetPath` may use `@project/...`. Treat `assets/foo` and `.\assets\foo` as the same asset.

### 3. Safe Mutation

1. **Readiness probe** — `query_editor(operation="getState")` before the first mutation in a task (required even when Connected; skip only for read-only inspection).
2. Consult this skill for approval scopes and destructive labels.
3. **Prefer MCP actions** for scene/outliner operations when the probe passes — `action_actor`, `action_component`, `action_scene`, or `batch_execute` for rename, create, delete, reparent, `setTransform`, and component changes. Do **not** edit `*.genesys-scene` files directly as the first choice when MCP is usable.
4. `query_editor(getBusyState)` — no edits during play mode, reload, or long builds.
5. Use `batch_execute(dryRun)` when operations are destructive, broad, path/ID-resolution heavy, or otherwise ambiguous; inspect `plannedChanges` before applying.
6. `batch_execute(apply, ...)` — in `auto` mode the server mints the approval token automatically, so apply works with no `approval`/`approvalId` and no `genesys_request_approval` call.
   - Optional `approval={summary, operations?}` gives a clearer `prompt`-mode dialog and audit trail; pass `approvalId` only to reuse a pre-minted token.
   - Direct actions behave the same: `action_actor({...})` applies without approval in `auto` mode.
7. `action_scene(save)` when the scene changed.
8. Re-query and report `undoGroupId` / `undoGroupIds`.

Do not batch `action_build` apply with actor/scene/prefab apply.

## Efficiency Default

Prefer the shortest mutation path: `query_editor(getState)` → mutate → `action_scene(save)` when scene changed → minimal re-query.

**Skip by default** — do not call `action_actor(select)`, `action_editor(frameSelection)`, or `action_actor(focus)` unless explicitly needed. They are viewport convenience only; they do not create, save, or modify scene content and add token cost (especially `select` with many `actorIds`).

**Call them only when:**

- The user asks to select, focus, or frame something in the viewport.
- The immediate next MCP step depends on active editor selection (e.g. `...From: "selection.actorIds"`).
- `action_editor(captureScreenshot)` needs a composed viewport — frame first if required, then capture.

After create/edit workflows, stop at save + brief verification. Do not append automatic `select` → `frameSelection` tail steps.

## Current Scope (Phase 3)

| Tool | Operations |
|------|------------|
| `query_asset` | `find`, `getDetails`, `getAssetPackInfo` |
| `action_actor` | `select`, `focus`, `rename`, `create`, `duplicate`, `delete` *(destructive)*, `setTransform`, `reparent` |
| `action_component` | `add`, `setProperties`, `setEnabled` |
| `action_scene` | `open`, `save`, `setActive` |
| `action_editor` | `frameSelection`, `enterPlayMode`, `exitPlayMode`, `captureScreenshot` |
| `action_asset` | `createFolder`, `move`, `rename`, `delete` *(destructive)*, `import`, `installAssetPack` |
| `action_prefab` | `createFromActor`, `instantiate`, `apply`, `unpack` |
| `action_build` | `compile`, `buildProject`, `validatePrefabs`, `buildLightmap` |

**Planned later** — `query_diagnostics` validation/job providers (`validateProject`, `validateScene`, `validatePrefab`, `getLastJob`).

**Approval** — In `auto` mode the server auto-mints the token, so apply calls succeed without any `approval`/`approvalId`. Pass an optional `approval={summary}` for a clearer `prompt`-mode dialog and audit trail; `genesys_request_approval`/`approvalId` remain for pre-approval or token reuse. In `prompt` mode every apply triggers the Genesys editor UI.

**Undo** — `undoGroupId` on results; batch `undoGroupIds` on apply batches. Build, asset filesystem, prefab apply/unpack, and screenshots have no undo.

**Diagnostics** — `getBuildErrors` / `getConsole` are authoritative when connected. Unavailable diagnostics = unknown state, not success.

## Workflow Recipes

**Inspect scene** — `query_editor(getBusyState)` → `batch_execute(readOnly)` with `query_scene` + `query_actor`.

**Discover assets** — `query_asset(find)` → `getDetails`; avoid filesystem until MCP is unavailable.

**Edit actors/scene/prefabs** — `query_editor(getState)` (mandatory probe) → `getBusyState` → optional `dryRun` for destructive/ambiguous plans → `action_actor` / `action_component` / `batch_execute(apply)` (prefer MCP over `*.genesys-scene` edits) → `action_scene(save)` → re-query. Do not append `select` / `frameSelection` unless the user asked or the next step needs selection. In `auto` mode no approval is needed; add an optional `approval={summary}` for a clearer prompt-mode dialog, and use `genesys_request_approval`/`approvalId` only for pre-approval or token reuse.

**Spawn basic mesh primitives** — `query_scene(findActors)` → `query_actor(getTransform)` → `action_actor(action="create", primitiveType="sphere", position=[...])` → `action_scene(save)` → re-query. Use `primitiveType` for `cube`, `sphere`, `cone`, `cylinder`, `torus`, and `capsule`. Blockout/multi-primitive creates: batch, save, stop — no automatic viewport framing. Optional (user-requested only): `select` → `frameSelection`. Read `genesysmcp://catalog/geometry-types` only for advanced geometry beyond that set.

**After TypeScript edits** — normal file tools → `action_build(validatePrefabs)` if prefabs changed → `compile` or `buildProject` (both run the full `.dist` pipeline for now) → `getBusyState` → `query_diagnostics(getBuildErrors)` when authoritative.

| Build action | Use for |
|--------------|---------|
| `compile` | Full `.dist` pipeline (registers game classes) |
| `buildProject` | Same as `compile` today |
| `validatePrefabs` | Prefab JSON check (no editor IPC) |

Do not run `compile` then `buildProject` unless debugging a failure. MCP `buildProject` ≠ game `pnpm build-project`.

**Screenshot** — `action_editor(captureScreenshot)` returns storage keys, not inline image bytes.

## When To Use MCP Vs Code Editing

- MCP: live editor state, scenes, prefabs, builds, diagnostics.
- Normal tools: TypeScript and source files.
- Do not present MCP as available unless Connected or Probe-capable per the gate table, and the readiness probe succeeds for mutations.
- Only fall back to direct `*.genesys-scene` editing when MCP is off or the readiness probe reports blocked/unavailable.

## Batch Patterns

- `...From` dependency keys (e.g. `actorIdsFrom: "selection.actorIds"`).
- An explicit approval must cover every scope in an apply batch; `auto` mode derives scopes from the batch operations automatically.
- `failFast: false` for partial outcomes.

## Useful Resources

- `genesysmcp://guide/overview`, `genesysmcp://guide/safety`, `genesysmcp://guide/batching`
- `genesysmcp://editor/state`, `genesysmcp://project/manifest`, `genesysmcp://scene/summary`
- `genesysmcp://catalog/geometry-types` for mesh geometry labels and default parameters

## Safety Expectations

- Prefer token-efficient workflows: mutate, save, verify — skip `select` / `frameSelection` / `focus` unless the user requests viewport help or a follow-up step requires selection.
- Use dry-run before apply for destructive, broad, or ambiguous mutations; direct apply is acceptable for low-risk, fully specified actions in `auto` mode.
- For destructive deletes, prefer an explicit `approval={summary}` naming what is removed so `prompt`-mode dialogs and audit logs are clear.
- No actor/prefab mutations during play mode or reload.
- `enterPlayMode` may save/build first; check `getBusyState` before overlapping `action_build`.

## External IDE Testing

Enable the `genesys` MCP server in Cursor while the Genesys editor is open. Maintainers: see `packages/sdk/docs/mcp-external-client-smoke.md` in the Genesys SDK monorepo.
