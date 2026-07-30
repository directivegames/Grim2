# Compact-Hidden Tools Reference

> **Generated** — do not edit by hand. Run `pnpm --filter @gnsx/genesys.sdk generate:mcp-docs`.

These tools are **not** first-class MCP tools in compact mode (the default). They are fully accessible through `run_script` (`genesys.*` API) or `batch_execute` (`tool:` field). Do **not** call `describe_tool` or `search_tools` for these tools before dispatching a known operation — go straight to the call.

| Tool | Kind | Operations |
| --- | --- | --- |
| `action_asset` | `action` | `createFolder`, `createMaterial`, `delete`, `import`, `installAssetPack`, `move`, `rename` |
| `action_navmesh` | `action` | `clear`, `export`, `generate`, `import`, `setSettings`, `toggleDebug` |
| `query_asset` | `query` | `find`, `getDetails`, `getAssetPackInfo`, `getReferences` |
| `query_diagnostics` | `query` | `getBuildErrors`, `getConsole` |
| `query_navmesh` | `query` | `getInfo`, `getSettings` |

### `action_asset`

**Action Asset** · kind: `action`

Asset actions via the live editor when possible. Requires `action`. Ops: createFolder, createMaterial, move, rename, delete (destructive), import, installAssetPack (empty packs/<name>/ scaffold only — not catalog packs). Bridged mutations need a ready editor; move/rename rewrite references.

**Operations:** `createFolder` *(undoable)*, `createMaterial` *(undoable)*, `delete` *(destructive, undoable)*, `import`, `installAssetPack`, `move`, `rename`

**Dispatch via `run_script`:**

```js
genesys.actionAsset({ action: 'createFolder', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "action_asset", args: { action: "createFolder", ... } }
```

### `action_navmesh`

**Action NavMesh** · kind: `action`

Generate, export, import, clear, configure, or toggle debug visualisation for the scene NavMesh. Requires `action`. Operations: generate, export, import, clear (destructive), setSettings, toggleDebug. Hidden in compact surface — call via run_script / batch_execute / search_tools.

**Operations:** `clear` *(destructive)*, `export`, `generate`, `import`, `setSettings` *(undoable)*, `toggleDebug`

**Dispatch via `run_script`:**

```js
genesys.actionNavmesh({ action: 'clear', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "action_navmesh", args: { action: "clear", ... } }
```

### `query_asset`

**Query Asset** · kind: `query`

Preferred MCP tool for listing and inspecting project assets and asset-pack assets. Requires `operation`. It does not index engine @engine/... assets; discover those from known engine paths or filesystem/manifests. Operations: find, getDetails, getAssetPackInfo, getReferences (project-wide reverse references via the editor Find Asset References analyser). Use find with assetType scene for scene files; results use project-relative forward-slash paths.

**Operations:** `find`, `getDetails`, `getAssetPackInfo`, `getReferences`

**Dispatch via `run_script`:**

```js
genesys.queryAsset({ operation: 'find', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "query_asset", args: { operation: "find", ... } }
```

### `query_diagnostics`

**Query Diagnostics** · kind: `query`

Read project and editor diagnostics. Requires `operation`. Operations: getBuildErrors, getConsole.

**Operations:** `getBuildErrors`, `getConsole`

**Dispatch via `run_script`:**

```js
genesys.queryDiagnostics({ operation: 'getBuildErrors', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "query_diagnostics", args: { operation: "getBuildErrors", ... } }
```

### `query_navmesh`

**Query NavMesh** · kind: `query`

Read NavMesh availability, baked mesh presence, debug overlay state, and generation settings from the live editor. Requires `operation`. Operations: getInfo, getSettings. Hidden in compact surface — call via run_script / batch_execute / search_tools.

**Operations:** `getInfo`, `getSettings`

**Dispatch via `run_script`:**

```js
genesys.queryNavmesh({ operation: 'getInfo', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "query_navmesh", args: { operation: "getInfo", ... } }
```
