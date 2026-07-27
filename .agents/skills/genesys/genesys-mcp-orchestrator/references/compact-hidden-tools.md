# Compact-Hidden Tools Reference

> **Generated** — do not edit by hand. Run `pnpm --filter @gnsx/genesys.sdk generate:mcp-docs`.

These tools are **not** first-class MCP tools in compact mode (the default). They are fully accessible through `run_script` (`genesys.*` API) or `batch_execute` (`tool:` field). Do **not** call `describe_tool` or `search_tools` for these tools before dispatching a known operation — go straight to the call.

| Tool | Kind | Operations |
| --- | --- | --- |
| `action_asset` | `action` | `createFolder`, `createMaterial`, `delete`, `import`, `installAssetPack`, `move`, `rename` |
| `action_component` | `action` | `add`, `duplicate`, `remove`, `resetToDefaults`, `setEnabled`, `setProperties` |
| `action_navmesh` | `action` | `clear`, `export`, `generate`, `import`, `setSettings`, `toggleDebug` |
| `action_prefab` | `action` | `apply`, `close`, `createFromActor`, `instantiate`, `open`, `resync`, `save`, `unpack` |
| `query_asset` | `query` | `find`, `getDetails`, `getAssetPackInfo`, `getReferences` |
| `query_diagnostics` | `query` | `getBuildErrors`, `getConsole` |
| `query_navmesh` | `query` | `getInfo`, `getSettings` |

### `action_asset`

**Action Asset** · kind: `action`

Perform project asset actions through the live editor when possible. Requires `action`. Operations: createFolder, createMaterial, move, rename, delete (destructive), import, installAssetPack (scaffolds an empty in-project pack under packs/<name>/; does not install catalog packs). Bridged mutations require an open ready editor and rewrite references for move/rename.

**Operations:** `createFolder` *(undoable)*, `createMaterial` *(undoable)*, `delete` *(destructive, undoable)*, `import`, `installAssetPack`, `move`, `rename`

**Dispatch via `run_script`:**

```js
genesys.actionAsset({ action: 'createFolder', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "action_asset", args: { action: "createFolder", ... } }
```

### `action_component`

**Action Component** · kind: `action`

Perform component actions. Requires `action` and `actorId`. Operations: add, setProperties, setEnabled, remove (destructive), duplicate, resetToDefaults (resets editable Inspector properties to defaults).

**Operations:** `add` *(undoable)*, `duplicate` *(undoable)*, `remove` *(destructive, undoable)*, `resetToDefaults` *(undoable)*, `setEnabled` *(undoable)*, `setProperties` *(undoable)*

**Dispatch via `run_script`:**

```js
genesys.actionComponent({ action: 'add', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "action_component", args: { action: "add", ... } }
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

### `action_prefab`

**Action Prefab** · kind: `action`

Create prefab assets from scene actors, instantiate prefabs, apply/unpack instances, or manage prefab isolation. Requires `action`. Operations: createFromActor, instantiate, apply, unpack, open, close, save, resync.

**Operations:** `apply`, `close`, `createFromActor`, `instantiate` *(undoable)*, `open`, `resync`, `save`, `unpack`

**Dispatch via `run_script`:**

```js
genesys.actionPrefab({ action: 'apply', ... })
```

**Dispatch via `batch_execute`:**

```text
{ tool: "action_prefab", args: { action: "apply", ... } }
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
