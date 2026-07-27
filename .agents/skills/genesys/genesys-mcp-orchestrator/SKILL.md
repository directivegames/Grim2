---
name: genesys-mcp-orchestrator
description: Use Genesys MCP for live editor scene/selection/asset/diagnostic queries and editor actions when Connected or Probe-capable (CallMcpTool + Genesys descriptors). Do not call MCP via shell.
---

# Genesys MCP Orchestrator

Use this skill when a task needs live Genesys editor/project context through MCP rather than static file edits alone.

When the user asks **how to do something in the editor UI** (where is the button, which menu or hotkey), or MCP is Off, read [genesys-editor-manual](../genesys-editor-manual/SKILL.md) instead of inventing UI steps.

## Quick Reference (Approval and Build)

| Path | Approval behavior |
|------|-------------------|
| **Direct tools** (`action_build`, `action_actor`, `action_scene`, …) | Auto-mint per call in `auto` mode — no `approval.operations` needed |
| **`batch_execute(apply)`** | Auto-derive scopes from the `operations` array when `approval.operations` is omitted |
| **`run_script(apply)`** | List every mutating scope in `approval.operations`, or rely on server auto-derivation from `genesys.*` calls in `code` |

**Class registration / rebuild:** call `action_build(action="buildProject")` as a **direct tool** after TypeScript edits. Do **not** route builds through `run_script` unless you are already inside a multi-step script — and never batch `action_build` with scene/asset mutations in the same script.

**Example — bulk scene edit approval scopes:**

```json
{
  "mode": "apply",
  "groupUndo": true,
  "approval": {
    "summary": "Double scale of all Sphere actors",
    "operations": ["action_actor.setTransform", "action_scene.save"]
  }
}
```

## MCP Availability Gate (Read First)

The default Genesys MCP surface is **compact** — common tools such as `run_script`,
`batch_execute`, `query_scene`, `query_actor`, `query_project`, `query_editor`,
`action_actor`, `action_scene`, `action_editor`, and `action_build` may appear directly. Less common
tools can still be reached through `run_script`, `batch_execute`, `search_tools`, and
`describe_tool`. In compact mode, hidden tools typically do **not** have per-tool
descriptor files under `mcps/*genesys*/tools/` because they are not returned by the
top-level `tools/list` — their absence is expected, not a sign MCP is broken.

Do **not** require first-class `query_*` tool names in the top-level tool list. Classify MCP availability in three states:

| State | Signal | What to do |
|-------|--------|------------|
| **Connected** | Genesys MCP entry tools (especially `run_script` or `batch_execute`) appear directly in the chat tool list | Use this skill; prefer `run_script` for multi-step work |
| **Probe-capable** | `CallMcpTool` is available **and** Genesys MCP descriptors exist under `mcps/*genesys*/tools/` (or equivalent server metadata shows the Genesys MCP server) | Use this skill; invoke compact tools via `CallMcpTool`; prefer `run_script` for multi-step work |
| **Off** | User says MCP is disabled / not enabled; or neither Connected nor Probe-capable signals are present | Stop — do not use MCP |
| **Forbidden** | You would use `curl`, HTTP, `Invoke-WebRequest`, or shell against `mcp.json` URL | Never do this |

Descriptor presence means **probe-capable**, not **ready**. A successful readiness probe (preferably inside `run_script` with `genesys.queryEditor({ operation: "getState" })`) is required before treating MCP as usable for mutations.

Signals that do **not** mean MCP is available on their own:

- Only `.cursor/mcp.json` on disk
- The user mentioned MCP without a connected/probe-capable session
- A skill references MCP but the session lacks tools or `CallMcpTool` + descriptors
- Missing descriptors for hidden tools such as `action_asset`, `action_component`, `action_prefab`, `query_asset`, or `query_diagnostics` (these are hidden by design in compact mode)

When MCP is **off** (or probe fails):

1. Tell the user live editor access requires enabling the `genesys` MCP server in Cursor and running the Genesys editor with this project open; include `blockingReasons` from a failed probe when available.
2. Use normal code and filesystem tools; do not read or edit `*.genesys-scene` unless the user explicitly asks or filesystem fallback is appropriate after MCP is genuinely unavailable.
3. Do not retry MCP or simulate it from the terminal.

When MCP is **connected** or **probe-capable**, skip broad discovery preamble — but **before the first scene/editor mutation** in a task, run the mandatory readiness probe below.

## Prerequisites

- Genesys editor running with **this** project open (bearer must match; wrong project → `project_mismatch`).
- Genesys MCP enabled (listener uses a stable app URL; `.cursor/mcp.json` alone is not readiness).
- `genesys` MCP server enabled and connected in Cursor.
- Genesys MCP reachable in **this** chat session — either first-class tools in the tool list, or `CallMcpTool` plus Genesys MCP descriptors under `mcps/*genesys*/tools/`.

Signals that do **not** mean MCP is ready:

- Only `.cursor/mcp.json` on disk
- Genesys running with a **different** project open
- HTTP reachable but `project_none` / `editorReady: false`

## Three Core Flows

### 1. Availability

1. Classify session state using the gate table above (Connected, Probe-capable, or Off).
2. **Mandatory readiness probe before mutations** — call `genesys.queryEditor({ operation: "getState" })` inside the planned `run_script`, or call `query_editor(operation="getState")` directly for a one-off direct action.
   - Do not call `query_scene(operation="getState")`; `getState` is an editor operation, not a scene operation.
3. If `editorReady` is true, MCP is usable for mutations. If false or the call fails, read `blockingReasons`, report them, and treat MCP as blocked for that task unless the user resolves the blocker.

### 2. Read-Only Inspection

1. `run_script(mode="readOnly", code=...)` — call `genesys.queryScene(...)`, `genesys.queryActor(...)`, etc. in code; return only the compact summary the model needs.
2. `batch_execute(mode="readOnly", operations=[...])` — combine known tool calls when no JavaScript is needed.
3. Direct `query_*` calls — only for one-off reads.
4. Resources: `genesysmcp://editor/state`, `genesysmcp://scene/summary`, `genesysmcp://project/manifest`.

Prefer `query_asset(find)` for assets, prefabs, and scenes before filesystem glob. Paths use forward slashes (`assets/foo.genesys-scene`); `assetPath` may use `@project/...`. Treat `assets/foo` and `.\assets\foo` as the same asset.

### 3. Safe Mutation

1. **Readiness probe** — `query_editor(operation="getState")` before the first mutation in a task (required even when Connected; skip only for read-only inspection).
2. Consult this skill for approval scopes and destructive labels.
3. **Prefer MCP actions** for scene/outliner operations when the probe passes — `run_script(mode="apply")`, direct `action_actor`/`action_scene`, or `batch_execute(operations=[...])` for rename, create, delete, reparent, `setTransform`, and component changes. Do **not** edit `*.genesys-scene` files directly as the first choice when MCP is usable.
4. `query_editor(getBusyState)` — no edits during play mode, reload, or long builds.
5. Use `run_script(mode="dryRun")` or `batch_execute(mode="dryRun", operations=[...])` when operations are destructive, broad, path/ID-resolution heavy, or otherwise ambiguous; inspect `plannedChanges` before applying.
6. Approval for apply mutations — behavior depends on the dispatch path:
   - **Direct tools** (`action_build`, `action_actor`, `action_scene`, …): in `auto` mode the server auto-mints a scoped token per call; no `approval`/`approvalId` required.
   - **`batch_execute(apply)`**: auto-derives scopes from the `operations` array when `approval.operations` is omitted.
   - **`run_script(apply)`**: pass `approval.operations` listing every mutating scope the script will call (e.g. `["action_actor.setTransform", "action_scene.save"]`), or rely on server auto-derivation from `genesys.*` calls in `code`. Optional `approval.summary` improves the `prompt`-mode dialog.
   - Pass `approvalId` only to reuse a pre-minted token; use `genesys_request_approval` only for explicit pre-approval.
7. `action_scene(save)` when the scene changed.
8. Re-query and report `undoGroupId` / `undoGroupIds`.

Do not batch `action_build` apply with actor/scene/prefab apply.

## Bulk Scene Edit Fast Path (Mandatory)

For "find matching actors, then change them" tasks, use this path before any direct `query_scene`, `query_actor`, `batch_execute`, grep, or filesystem search:

```text
run_script(mode="apply", groupUndo=true, approval={ summary: "...", operations: ["action_actor.setTransform", "action_scene.save"] }, code=...)
  → genesys.queryEditor({ operation: 'getState' })
  → genesys.queryScene({ operation: 'findActors', query: '<user term>' })
  → genesys.queryActor({ operation: 'getTransform' | 'getBounds' | 'getDetails', actorIds: [...] })
  → genesys.actionActor(...)
  → genesys.actionScene({ action: 'save' })
  → return { matched, changed, saved }
```

Examples: "half all spheres", "double all spheres", "move all lights up", "rename every Temp actor", "delete all Debug_* actors" (dry-run first if destructive). The first MCP call after reading this skill should be the `run_script` call; do **not** pre-query the matching actors through the model, do **not** use `batch_execute` with a `code` field, and do **not** grep the project for live scene actors while MCP is ready. `batch_execute` is only for an `operations: [...]` array of tool calls; JavaScript belongs in `run_script`.

### Do / Do Not (bulk scene edits)

| Do | Do not |
|----|--------|
| `genesys.queryScene({ operation: 'findActors', query: 'Sphere' })` | `queryScene({ operation: 'searchActors' })` — no such operation; use `findActors` |
| Top-level `query` string (case-insensitive name substring) | `filter: { nameContains: 'Sphere' }`, `namePattern`, or `caseInsensitive` objects |
| `genesys.queryActor({ operation: 'getTransform', actorIds: ids })` | `queryActor({ operation: 'getTransform', actorId: 'one' })` — `query_actor` takes `actorIds: [...]`, even for one actor |
| One `run_script(mode="apply")` that probes, finds, reads, mutates, saves | Per-actor `query_actor` / `action_actor` direct calls through the model before the script |
| Trust `findActors` coverage and the readiness probe | `grep` / `read` of `*.genesys-scene` after the probe reports `editorReady: true` |

If a call fails with `invalid_arguments` and a "Did you mean ..." suggestion, apply the suggestion **exactly** (e.g. `searchActors` → `findActors`) and retry **once** with the corrected shape — do not switch to a filesystem fallback while MCP is ready.

## Reading MCP Results (Reliability)

Every Genesys MCP tool result is JSON in a text content block. **Do not trust `isError` or `status: "success"` from generic MCP client wrappers** — some wrappers normalise our structured errors (and the SDK's `-32602` schema rejections) into `status: "success"` with the error text inside `content`. The only reliable failure signal is the **JSON body itself**.

**Treat a call as failed when any of these hold** (parse the content text as JSON first):

- `ok === false`
- `error.code` is present (e.g. `invalid_arguments`, `editor_not_ready`, `editor_busy`, `approval_required`, `tool_not_found`)
- `status === "blocked"`
- The content text starts with `MCP error` (SDK-level schema rejection that never reached our handler)
- `batch_execute` results have `ok === false` or any entry in `errors[]`

**On failure:**

1. Read `error.code` and `error.message`.
2. If `recoverable: true`, fix the input and retry **once**. Do not retry the same input unchanged.
3. If `invalid_arguments` includes a "Did you mean ..." suggestion, apply the suggestion **exactly** (e.g. `searchActors` → `findActors`).
4. If `editor_not_ready` / `editor_busy`, report `blockingReasons` to the user and stop mutating.
5. **Never report success to the user when the last MCP call returned `ok: false`** — say the call failed and quote `error.code`.

## Direct-Call Cheat Sheet

Exact minimal arguments for the direct tools. The `operation` (query tools) or `action` (action tools) field is **required**; the other name is accepted as an alias but omitting both is an error. Enum values mirror the server schema exactly.

| Tool | Required | Common optional |
|------|---------|-----------------|
| `query_scene` | `operation` ∈ {`getActive`, `getOpenScenes`, `getSummary`, `getGraph`, `getSelection`, `findActors`, `getActorSummaries`} | `findActors`: `query` (case-insensitive name substring, top-level string — **not** a filter object), `limit`. `getGraph`: `sceneName`, `maxNodes`. `getActorSummaries`: `actorIds`. |
| `query_actor` | `operation` ∈ {`getState`, `getDetails`, `getTransform`, `getBounds`, `getComponents`, `getChildren`, `getReferences`, `getEditableProperties`}, `actorIds: [...]` | `getDetails`: `include`, `exclude`. |
| `query_editor` | `operation` ∈ {`getState`, `getSelection`, `getViewport`, `getPlayModeState`, `getBusyState`, `getRegisteredClasses`, `getNodeMaterialClasses`} | `getRegisteredClasses`: actor/component filter. `getNodeMaterialClasses`: node material asset filter. |
| `query_project` | `operation` ∈ {`getManifest`, `getStructure`, `getBuildErrors`, `getPackageInfo`, `getScripts`, `getTemplates`, `getAssetPacks`, `findFiles`} | `getStructure`: `maxDepth`. `findFiles`: `query`, `limit`. |
| `query_asset` | `operation` ∈ {`find`, `getDetails`, `getAssetPackInfo`, `getReferences`} | `find`: `query`, `assetType`, `extension`, `pack`, `limit`, `cursor`. `getDetails`/`getReferences`: `assetPath`. |
| `action_actor` | `action` ∈ {`select`, `focus`, `rename`, `create`, `createMany`, `duplicate`, `delete`, `setTransform`, `reparent`, `setEditorVisible`, `setEditorLocked`} | `setTransform`: `actorId`, `position`/`rotation`/`scale` (3-tuples). `create`: exactly one of `className`/`primitiveType`/`assetPath`. `select`/`focus`/`duplicate`/`delete`/`reparent`/`setEditorVisible`/`setEditorLocked`: `actorIds`. `setEditorVisible`/`setEditorLocked`: **editor viewport only** (not runtime). |
| `action_component` | `action` ∈ {`add`, `setProperties`, `setEnabled`, `remove`, `duplicate`, `resetToDefaults`}, `actorId` | `add`: `className`. `setProperties`: `componentId`, `properties`. `setEnabled`: `componentId`, `enabled`. `remove`/`duplicate`/`resetToDefaults`: `componentId`. |
| `action_scene` | `action` ∈ {`open`, `save`, `setActive`, `create`, `duplicate`} | `open`/`setActive`/`duplicate`: `scenePath`. `create`: optional name / default flags. |
| `action_editor` | `action` ∈ {`frameSelection`, `enterPlayMode`, `exitPlayMode`, `captureScreenshot`, `undo`, `redo`} | `captureScreenshot`: `includeImage`, `filename`, `width`+`height` (together or neither). |
| `action_asset` | `action` ∈ {`createFolder`, `createMaterial`, `move`, `rename`, `delete`, `import`, `installAssetPack`} | Bridged through the editor (except pack scaffolding). `createMaterial`: `materialClassName`, `name`, `parentPath`. `createFolder`: `parentPath`, `folderName`. per-operation: `assetPath`, `sourcePath`, `destinationPath`, `newName`, `packName`, `packId`. `installAssetPack` scaffolds an empty pack only. |
| `action_prefab` | `action` ∈ {`createFromActor`, `instantiate`, `apply`, `unpack`, `open`, `close`, `save`, `resync`} | `createFromActor`: `actorId`, `parentPath`, `preferredName`. `instantiate`: `prefabPath`, `position`/`rotation`/`scale`. `open`/`save`: `prefabPath`. `resync`: `actorId`. |
| `action_build` | `action` ∈ {`buildProject`, `validatePrefabs`, `buildLightmap`} | `buildLightmap`: `scenePath`. |
| `query_navmesh` / `action_navmesh` | Hidden in compact — use `run_script` / `batch_execute` / `search_tools` | `query_navmesh`: `getInfo`, `getSettings`. `action_navmesh`: `generate`, `export`, `import`, `clear`, `setSettings`, `toggleDebug`. |

## Efficiency Default

**Read-modify-write default:** For any task that needs to find actors then mutate them (e.g. "double all spheres", "move all lights up", "rename every Temp actor"), use **one** `run_script(mode="apply", groupUndo=true, approval={ summary, operations: [...] })` that probes, finds, reads, mutates, and saves. Do **not** issue per-actor `query_actor` round-trips through the model before the script. See the **Transform all matching actors** recipe below.

Prefer the shortest mutation path: `query_editor(getState)` → mutate → `action_scene(save)` when scene changed → minimal re-query. For multi-step or bulk work, default to a single `run_script` instead of sequential direct tool calls.

**Script-first (preferred for multi-step work)** — fetch the typed API once, then do probe → discover → mutate → save inside one script so intermediate results stay in the sandbox and only the `return` value reaches the model:

```text
genesysmcp://api/typescript (once)           → fetch typed GenesysApi surface
→ run_script(mode="readOnly", code=...)       → query, filter, aggregate in-script; only logs/return reach the model
→ run_script(mode="apply", groupUndo=true, approval.operations=[...], code=...)  → mutations with auto-minted approval; readiness probe inside script
→ minimal re-query to verify
```

**Batch-execute (fine for single or small batches):**

```text
batch_execute(mode=apply, groupUndo=true): [action_actor, action_scene.save]
```

**Skip by default** — do not call `action_actor(select)`, `action_editor(frameSelection)`, or `action_actor(focus)` unless explicitly needed. They are viewport convenience only; they do not create, save, or modify scene content and add token cost (especially `select` with many `actorIds`).

**Call them only when:**

- The user asks to select, focus, or frame something in the viewport.
- The immediate next MCP step depends on active editor selection (e.g. `...From: "selection.actorIds"`).
- `action_editor(captureScreenshot)` needs a composed viewport — frame first if required, then capture.

After create/edit workflows, stop at save + brief verification. Do not append automatic `select` → `frameSelection` tail steps.

## Discovery Discipline

Skills are the primary discovery layer. Discovery tools (`search_tools`, `describe_tool`) exist for unknown or rare tools — not as a default preamble for every task.

**Rules (follow in order):**

1. **If this skill has a recipe for the task** — go straight to the call. Do not call `search_tools` or `describe_tool` first.
2. **If the tool is first-class in compact mode** (`run_script`, `search_tools`, `describe_tool`, `batch_execute`, `genesys_request_approval`, `query_scene`, `query_actor`, `query_project`, `query_editor`, `action_actor`, `action_scene`, `action_editor`, `action_build`) — call it directly. No schema lookup needed.
3. **If the tool is hidden in compact mode** (`action_component`, `action_asset`, `action_prefab`, `query_asset`, `query_diagnostics`) — call it through `run_script` (`genesys.*`) or `batch_execute` (`tool:` field) directly. Do **not** call `describe_tool` for a hidden tool before routing it through a known dispatch path. See [references/compact-hidden-tools.md](references/compact-hidden-tools.md) for operations and call shapes.
4. **Never call both `search_tools` and `describe_tool` for the same tool** in a single task — they overlap; pick one or skip both.
5. **Use `describe_tool` or `search_tools` only when:**
   - A call failed with a schema/validation error (schema may have changed; re-fetch the specific tool's schema with `describe_tool`).
   - The tool is genuinely rare or unknown (not in this skill, not in the hidden-tools reference).
   - You are exploring capabilities for the user (e.g. "what can MCP do with prefabs?").

**Hidden tools dispatch (compact mode):**

```text
// Correct — skip describe_tool, dispatch hidden tool through run_script
run_script(mode="apply"): genesys.actionComponent({ action: 'setProperties', ... })

// Correct — dispatch hidden tool through batch_execute
batch_execute(mode="apply"): [{ tool: "action_component", args: { action: "setProperties", ... } }]

// Wrong — describe_tool before a known hidden op (unnecessary round-trip)
describe_tool({ name: "action_component" })  ← skip this
```

## Token efficiency (cache-aware)

- Cache read scales with turn count × growing context. Every tool result stays in context and is re-sent on later turns. Minimise turns and payload size, not just final output length.
- Prefer one `run_script` for probe → discover → mutate → save when the task needs more than ~2 MCP steps. Intermediate results stay in the script environment; only `return` / `console.log` enters the model context.
- Read only tool schemas you will call. Do not pre-read `batch_execute`, geometry catalog, or extra `query_*` descriptors unless the plan needs them.
- `query_editor(getState)` already includes busy state — do not also call `getBusyState` unless you need a mid-task re-check after a long build or play-mode transition.
- Use direct `query_*` and `action_*` tools for single operations only. For any find/read/mutate/save flow, use `run_script` first.
- Do not grep or filesystem-search for live scene actors after a successful MCP readiness probe; query the editor through MCP instead.
- Never pull full dumps when a slice suffices:
  - Use `query_actor(getTransform)` or `getDetails` with include/exclude for position/bounding box — not `getEditableProperties` unless you are editing those properties.
  - Never return full BufferGeometry JSON, full editable-property lists, or large `findActors` lists to the model when you only need one id or one scalar (e.g. ground top Y).
- `createMany` does not support `primitiveType`. For many mesh primitives, use one `run_script` loop of `action_actor(create, primitiveType=…)` + `action_scene(save)`, not chained per-actor tool calls from the model.
- Return minimal summaries after bulk work: `{ created, saved, counts }` — not per-actor full results.
- Do not read `genesysmcp://catalog/geometry-types` for basic `primitiveType` work (`cube`, `sphere`, `cone`, `cylinder`, `torus`, `capsule`).

## Current Scope (Phase 3)

| Tool | Operations |
|------|------------|
| `query_asset` | `find`, `getDetails`, `getAssetPackInfo` |
| `action_actor` | `select`, `focus`, `rename`, `create`, `createMany`, `duplicate`, `delete` *(destructive)*, `setTransform`, `reparent`, `setEditorVisible`, `setEditorLocked` *(editor viewport only)* |
| `action_component` | `add`, `setProperties`, `setEnabled`, `remove` *(destructive)*, `duplicate`, `resetToDefaults` |
| `action_scene` | `open`, `save`, `setActive`, `create`, `duplicate` |
| `action_editor` | `frameSelection`, `enterPlayMode`, `exitPlayMode`, `captureScreenshot`, `undo`, `redo` |
| `action_asset` | `createFolder`, `createMaterial`, `move`, `rename`, `delete` *(destructive)*, `import`, `installAssetPack` |
| `action_prefab` | `createFromActor`, `instantiate`, `apply`, `unpack`, `open`, `close`, `save`, `resync` |
| `action_build` | `buildProject`, `validatePrefabs`, `buildLightmap` |
| `query_navmesh` / `action_navmesh` | Hidden in compact — `getInfo`/`getSettings`; `generate`/`export`/`import`/`clear`/`setSettings`/`toggleDebug` |

**Approval** — In `auto` mode: direct tools auto-mint a scoped token per call; `batch_execute` auto-derives scopes from its `operations` array; `run_script` auto-derives scopes from `genesys.*` calls in `code` when `approval.operations` is omitted. Pass an optional `approval={summary, operations}` for a clearer `prompt`-mode dialog; `genesys_request_approval`/`approvalId` remain for pre-approval or token reuse. In `prompt` mode every apply triggers the Genesys editor UI.

**Undo** — `undoGroupId` on results; batch `undoGroupIds` on apply batches. Build, pack scaffolding, move/rename relocate, import, prefab apply/unpack, and screenshots have no undo. `createFolder`, `createMaterial`, and `delete` can return editor undo ids when recorded.

**Diagnostics** — `getBuildErrors` / `getConsole` are authoritative when connected. Unavailable diagnostics = unknown state, not success.

## Workflow Recipes

**Inspect scene** — `query_editor(getBusyState)` → `batch_execute(readOnly)` with `query_scene` + `query_actor`.

**run_script: inspect scene, return only a slice** — fetch the full graph but filter in-script so only the compact summary reaches the model (full node dumps stay in the sandbox):

```js
const { nodes } = await genesys.queryScene({ operation: 'getGraph' });
const lights = nodes.filter(n => n.name.toLowerCase().includes('light'));
console.log(`Found ${lights.length} light actors`);
return lights.slice(0, 5).map(n => ({ id: n.id, name: n.name, parentId: n.parentId }));
```

```text
run_script(mode="readOnly", code=<above>)
→ only the logged count + 5-item array reach the model (full graph stays in sandbox)
```

**Discover assets** — `query_asset(find)` → `getDetails`; avoid filesystem until MCP is unavailable.

**Register a new code class in the running editor** — after adding or updating a `@ENGINE.GameClass()`:

```text
edit TypeScript class
→ pnpm lint
→ action_build(action="buildProject")
→ query_editor(operation="getRegisteredClasses", filter="YourClass")
→ action_actor(action="create", className="GAME.YourClass", position=[...])
→ action_scene(action="save")
```

- `action_build` is a direct MCP tool. Do not probe or call it through `run_script` unless you are already doing a multi-step scripted workflow.
- `run_script(mode="readOnly")` cannot call apply actions such as `actionBuild`.
- A `query_editor(getRegisteredClasses)` result with `ok: true` and `classes: []` means no matching classes are loaded yet. Rebuild with `action_build(buildProject)` and query again.

**Edit actors/scene/prefabs** — `query_editor(getState)` (mandatory probe) → `getBusyState` → optional `dryRun` for destructive/ambiguous plans → `action_actor` / `action_component` / `batch_execute(apply)` (prefer MCP over `*.genesys-scene` edits) → `action_scene(save)` → re-query. Do not append `select` / `frameSelection` unless the user asked or the next step needs selection. In `auto` mode no approval is needed; add an optional `approval={summary}` for a clearer prompt-mode dialog, and use `genesys_request_approval`/`approvalId` only for pre-approval or token reuse.

**Transform all matching actors** (e.g. "half the size of all spheres", "double the size of all spheres") — do the find + read + write in one `run_script`; do not issue per-actor `query_actor` calls through the model first. `query_actor` transform values are formatted strings like `"(0.4, 0.4, 0.4)"`, so parse them in-script. Replace the `factor` with `0.5` to halve, `2` to double, etc.:

```js
const factor = 0.5; // halve; use 2 to double
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const { actors } = await genesys.queryScene({ operation: 'findActors', query: 'Sphere' });
if (actors.length === 0) return { scaled: 0, saved: false };
const parseVec = (s) => String(s).replace(/[()]/g, '').split(',').map((n) => Number(n.trim()));
const { actors: details } = await genesys.queryActor({ actorIds: actors.map((a) => a.id), operation: 'getTransform' });
for (const d of details) {
  const [x, y, z] = parseVec(d.transform.scale);
  await genesys.actionActor({ action: 'setTransform', actorId: d.id, scale: [x * factor, y * factor, z * factor] });
}
await genesys.actionScene({ action: 'save' });
return { scaled: details.length, factor, saved: true };
```

`findActors` already returns the full match set — do not re-run it with a different term (e.g. a mesh/geometry name) just to "double-check" coverage; trust the first result and only widen the query for criteria the user named that it did not cover.

**Spawn basic mesh primitives**

- **Single shape** — `query_editor(getState)` → `query_scene(findActors, query='ground', limit=5)` → `query_actor(getTransform)` on ground → `action_actor(create, primitiveType, position)` → `action_scene(save)`.
- **Many shapes (10+)** — one `run_script(apply)` that finds ground, computes placement in-script, loops `actionActor({ action: 'create', primitiveType, … })`, then `actionScene({ action: 'save' })`; return `{ created, saved, counts }` only.

```js
const state = await genesys.queryEditor({ operation: 'getState' });
if (!state.editorReady) throw new Error('Editor not ready: ' + state.blockingReasons.join('; '));
const { actors } = await genesys.queryScene({ operation: 'findActors', query: 'ground', limit: 5 });
const groundId = actors[0]?.id;
if (!groundId) throw new Error('No ground actor found');
const { transforms } = await genesys.queryActor({ actorIds: [groundId], operation: 'getTransform' });
const groundY = transforms[0]?.position?.[1] ?? 0;
const primitiveTypes = ['cube', 'sphere', 'cone', 'cylinder', 'torus', 'capsule'];
let created = 0;
for (let i = 0; i < 100; i++) {
  await genesys.actionActor({
    action: 'create',
    primitiveType: primitiveTypes[i % primitiveTypes.length],
    position: [(i % 10) * 2, groundY + 1, Math.floor(i / 10) * 2],
    name: `Primitive ${i + 1}`,
  });
  created++;
}
await genesys.actionScene({ action: 'save' });
return { created, saved: true, counts: { actors: created } };
```

- Use `primitiveType` for `cube`, `sphere`, `cone`, `cylinder`, `torus`, and `capsule`. Do not read `genesysmcp://catalog/geometry-types` for basic primitive work. Blockout/multi-primitive creates: one script, save, stop — no automatic viewport framing. Optional (user-requested only): `select` → `frameSelection`.

**Place engine demo models** — for built-in/demo GLBs such as rocks, trees, ships, or characters:

```text
query_editor(getState)
→ query_scene(findActors, query='ground', limit=5)
→ query_actor(getBounds, actorIds=[groundId]) to compute the ground top Y
→ filesystem/manifest discovery under node_modules/@gnsx/genesys.js/assets/models/demo
→ run_script(mode="apply", groupUndo=true, approval={ operations: ["action_actor.create", "action_scene.save"] }, code=...)
  → genesys.actionActor({ action: 'create', assetPath: '@engine/assets/models/demo/...glb', position, name })
  → genesys.actionScene({ action: 'save' })
→ return { created, saved: true }
```

- Do not use `query_asset(find, query='demo')` for these assets; it only indexes project assets and asset packs, not engine `@engine/...` assets.
- On Windows, prefer exact known paths or a simple `cmd /c dir` style listing when shell globbing behaves differently.
- Keep placement in one apply script so readiness, ground lookup, actor creation, and save share one undo group and one approval.

**Bulk spawn many actors** — for dozens or hundreds of similar objects (model URL, material, shadow flags, transforms), prefer one `action_actor(action="createMany", payload={...})` call instead of per-actor create/add/setProperties chains. Use `createMany` for model/material/component templates only; for primitive bulk use `run_script` + `primitiveType` create loop instead.

```text
query_editor(getState)
→ query_editor(getBusyState)
→ action_actor(action="createMany", dryRun=true, payload={ version: 1, templates: {...}, actors: [...] })
→ action_actor(action="createMany", payload={...})
→ action_scene(action="save")
```

- Put shared component defaults in `templates`; each `actors[]` entry only needs `key`, `template`, transform, and sparse overrides.
- Use `actors[].components` as an override object keyed by template component key when one instance needs different properties.
- Result returns `createdActors`, `createdComponents`, and `counts` for follow-up work without extra queries.

**Scene-visible component property edit** (materials, colours, component settings) — use this for per-scene/per-instance edits to editor-authored actors instead of `BeginPlay` hacks or runtime patch code:

```text
query_editor(getState)
→ query_editor(getBusyState)
→ query_scene(getSelection) or query_scene(findActors, query="…")
→ action_component(action="setProperties", actorId=…, properties={ material: "@project/assets/materials/Foo.material.json" })
   — omit componentId to target the actor root component; on MeshComponent the property is `material`, not `materialPath`
→ action_scene(action="save")
→ re-query affected actor/component when needed
```

After `action_actor(action="create")`, the apply result includes `rootComponentId` so you can set root properties without a component lookup. For batched create + property flows, use `componentIdFrom: "createOp.affectedComponentIds.0"` only when targeting a non-root component; for root properties omit `componentId` entirely.

MCP-first properties include per-instance `material` (MeshComponent material asset ref), visible colour/tint fields, mesh/model refs, light intensity/colour, camera settings, component `enabled` state (via `setEnabled`), and transforms (via `action_actor(setTransform)`). Do not write TypeScript solely to change these on a specific actor already in the scene; do use TypeScript when defining reusable class defaults, construction for runtime-spawned objects, or behaviour that should apply to every instance.

**Node material asset (custom TSL class)** — after adding/updating a `@ENGINE.GameClass({ isNodeMaterialAsset: true, ... })` material class:

```text
[Code] edit material class in src/
→ action_build(action="buildProject")   (direct tool — do not batch with scene edits)
→ query_editor(operation="getNodeMaterialClasses", filter="YourMaterial")
→ run_script(mode="apply", groupUndo=true, approval={ operations: ["action_asset.createMaterial", "action_component.setProperties", "action_scene.save"] }, code=...)
  → genesys.queryEditor({ operation: "getState" })
  → genesys.queryScene({ operation: "findActors", query: "Ground", limit: 1 })
  → genesys.actionAsset({ action: "createMaterial", materialClassName: "GAME.YourMaterialClass", name: "M_YourMaterial", parentPath: "assets/materials" })
  → genesys.actionComponent({ action: "setProperties", actorId: ground.id, properties: { material: "@project/assets/materials/M_YourMaterial.material.json" } })
  → genesys.actionScene({ action: "save" })
  → return { materialAssetPath: "@project/assets/materials/M_YourMaterial.material.json", saved: true }
```

- Use `getNodeMaterialClasses`, not `getRegisteredClasses`, to verify node material registration (`getRegisteredClasses` lists actor/component classes only).
- Do not combine `action_build` with create/assign in one script; run build first as a direct tool call.
- Do not pull `getEditableProperties` to verify assignment — re-query only the `material` field if needed.
- See [webgpu-tsl-node-material-assets/SKILL.md](../webgpu-tsl-node-material-assets/SKILL.md) for the full class pattern.

**After TypeScript edits** — normal file tools → `action_build(validatePrefabs)` if prefabs changed → `action_build(buildProject)` (full `.dist` pipeline; registers game classes) → `getBusyState` → `query_diagnostics(getBuildErrors)` when authoritative.

| Build action | Use for |
|--------------|---------|
| `buildProject` | Full `.dist` pipeline (registers game classes) |
| `validatePrefabs` | Prefab JSON check (no editor IPC) |
| `buildLightmap` | Headless lightmap bake (`scenePath` required) |

There is no separate `compile` MCP action. MCP `buildProject` ≠ game `pnpm build-project`.

**Screenshot** — `action_editor` is a **first-class compact tool**, so call `captureScreenshot` directly; do not call `describe_tool` or `search_tools` first.

**One-call inline image (preferred):**

```text
action_editor({ action: "captureScreenshot", includeImage: true })
```

`includeImage` **defaults to `true`** for `captureScreenshot`. The response contains two MCP content blocks: a JSON metadata block (`{ action, screenshot: { screenshotPath, dimensions, imageType, imageIncluded, ... } }`) and an inline `image` content block with base64 bytes.

**Displaying the screenshot in chat (Cursor):**

- An inline image block from a direct `action_editor(captureScreenshot)` call renders automatically.
- If only a path is available (e.g. from a `run_script` / `batch_execute` result), display the image using the Read tool on `screenshot.screenshotPath`. **Never emit a markdown image link to an absolute local disk path** — they are blocked for security, and Windows backslashes break the URL syntax.

**Token-sensitive path (metadata only, no inline bytes):**

```text
action_editor({ action: "captureScreenshot", includeImage: false })
→ saves under @project/assets/screenshots; use Read tool on screenshotPath to show image
```

**`run_script` / `batch_execute` paths return metadata only** — image bytes are stripped from those dispatch paths. Use the direct call when an inline image is wanted.

Optional dry-run to inspect the planned save path before capturing:

```text
action_editor({ action: "captureScreenshot", dryRun: true })
→ returns { status: "planned", screenshot: { screenshotPath, ... } } — no file written
```

## run_script API Discipline

- Inside `run_script`, the injected `genesys` API uses camelCase method names (`queryEditor`, `queryScene`, `queryProject`, `queryActor`, `queryAsset`, `queryDiagnostics`, `actionActor`, `actionComponent`, `actionScene`, `actionBuild`, `actionEditor`, `actionPrefab`, `actionAsset`).
- Snake_case names such as `query_project` and `action_actor` are direct MCP tool names, not methods on the `genesys` script object.
- Do not invent operations. Use documented operations from the tool schema or `genesysmcp://api/typescript` (for example, class registration checks belong to `queryEditor({ operation: "getRegisteredClasses", ... })`, not `queryProject(listGameClasses)`).
- Prefer direct `query_*`/`action_*` tools for one-off calls only. Use `run_script` when you need shared script state across multiple steps, especially find/read/mutate/save workflows.

## Common Footguns

- `query_scene(operation="findActors")` takes a top-level `query` string (case-insensitive name substring), **not** a `filter`/`namePattern`/`caseInsensitive` object. There is no `searchActors` operation.
- Every `query_*` and `action_*` router requires `operation` (query tools) or `action` (action tools); the other is accepted as an alias but omitting both is an error.
- `describe_tool` takes `name`, not `toolName`.
- `query_actor` requires `actorIds: [...]`, even for one actor. `actorId` is for action paths such as rename/setTransform, not query_actor. `getState` belongs to `query_editor`, not `query_scene`. When `actorIds` is supplied without an `operation`, the server defaults to `getDetails` — but always pass `operation` explicitly (e.g. `getTransform` for placement) to avoid pulling more than you need.
- After a successful readiness probe (`editorReady: true`), do not `grep`, glob, or `read` `*.genesys-scene` for live scene state — query the editor through MCP. Filesystem scene reads are only a fallback when MCP is off or the probe reports blocked/unavailable.
- `batch_execute` takes `operations: [{ id?, tool, args }]` only. `id` is optional (defaults to `op_<index>`); provide an explicit `id` when another operation references it via `...From`. It does **not** take `code`; use `run_script` for JavaScript.
- Use `query_scene({ operation: 'getSummary' })` or the `genesysmcp://scene/summary` resource for compact scene summaries — do not pull `getGraph` when a summary will do.
- In generic MCP wrappers, nest `mode`, `approval`, `groupUndo`, and `code` inside the `run_script` arguments object; top-level wrapper fields are ignored and default to read-only mode.
- `query_asset` searches project `assets/` and asset packs only; it does not index engine `@engine/...` assets.

## When To Use MCP Vs Code Editing

- MCP: live editor state, scenes, actors, prefabs, per-instance component properties, transforms, materials/colours assigned to scene objects, builds, and diagnostics.
- Normal tools: TypeScript/source files, reusable gameplay behaviour, class defaults, constructors for runtime-created objects, custom actor/component classes, input, networking, and UI logic.
- Mixed work: edit TypeScript for the reusable capability, build/register it, then use MCP to place or configure instances in the scene.
- Do not present MCP as available unless Connected or Probe-capable per the gate table, and the readiness probe succeeds for mutations.
- Only fall back to direct `*.genesys-scene` editing when MCP is off or the readiness probe reports blocked/unavailable.

## Batch Patterns

- `...From` dependency keys (e.g. `actorIdsFrom: "selection.actorIds"`). Put `...From` references in `args`, not in `foreach` items.
- **`foreach` expansion** — for a known list of targets (e.g. `setTransform` on N actors), put a `foreach` array on an operation to expand it into one child per item. Each child id is `${id}_${index}` and its args are the deep-merge of `args` and the item (**item wins**). Items must be plain objects and must not contain `...From` keys. Prefer `run_script` when the target list is discovered at runtime.
- **Limits:** up to **500 operations** per batch (`BATCH_MAX_OPERATIONS`), hard ceiling **750** (`BATCH_HARD_MAX_OPERATIONS`). `foreach` items expand before this check, so total expanded operations must stay within the hard limit.
- `dryRun` for planning; `apply` for execution. In `auto` mode approval is auto-minted; pass `approvalId` only to reuse a pre-minted token.
- An explicit approval must cover every action scope in the batch; `auto` mode derives scopes from the batch operations automatically.
- `failFast: false` to collect partial outcomes.
- Pass `groupUndo: true` for multi-step apply batches and scripts so partial failures are reversible with one undo.
- Default `run_script` wall-clock timeout is **5 minutes** (`300_000`ms, max `900_000`ms); pass `timeoutMs` only for unusually long bulk work.

## Useful Resources

- `genesysmcp://guide/overview` — getting started + code-execution workflow
- `genesysmcp://guide/safety` — approval, undo, destructive actions
- `genesysmcp://guide/batching` — modes and dependency references
- `genesysmcp://guide/token-efficiency` — `run_script` patterns and query shaping
- `genesysmcp://api/typescript` — **generated `GenesysApi` type declarations** for `run_script` (fetch once before writing non-trivial scripts)
- `genesysmcp://editor/state`, `genesysmcp://project/manifest`, `genesysmcp://scene/summary`
- `genesysmcp://catalog/geometry-types` — mesh geometry labels and default parameters

## Safety Expectations

- Prefer token-efficient workflows: mutate, save, verify — skip `select` / `frameSelection` / `focus` unless the user requests viewport help or a follow-up step requires selection.
- Use dry-run before apply for destructive, broad, or ambiguous mutations; direct apply is acceptable for low-risk, fully specified actions in `auto` mode.
- For destructive deletes, prefer an explicit `approval={summary}` naming what is removed so `prompt`-mode dialogs and audit logs are clear.
- No actor/prefab mutations during play mode or reload.
- `enterPlayMode` may save/build first; check `getBusyState` before overlapping `action_build`.

## External IDE Testing

Enable the `genesys` MCP server in Cursor while the Genesys editor is open. Maintainers: see `packages/sdk/docs/mcp-external-client-smoke.md` in the Genesys SDK monorepo.
