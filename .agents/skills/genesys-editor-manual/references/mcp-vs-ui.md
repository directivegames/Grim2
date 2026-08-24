# MCP vs UI

Prefer MCP when Status is Available and MCP is ready; otherwise give the Manual UI path. Do not invent tools for UI only rows.

MCP node era: use `query_node` / `action_node`. MCP schemas name node UUIDs `componentId` / `componentIds` / `parentComponentId` — that is the live param shape.

`action_node` operations are only: `add`, `delete`, `setProperties`, `select`. Transforms, reparent, duplicate, editor hide/lock, and reset-to-defaults are UI (or editable properties via `setProperties` when exposed) — do not invent `action_node` ops beyond that list.

| Task | MCP | Status | Manual UI |
| --- | --- | --- | --- |
| Inspect scene / nodes | `query_node`, `query_editor` | Available | Outliner (node tree); Inspector |
| Add node | `action_node.add` (`className`, optional `parentComponentId`) | Available | Outliner + (`NodeAddPicker`: Node / Prefab tabs) |
| Delete node | `action_node.delete` (`componentIds` / `componentId`) | Available | Outliner Remove (Del) |
| Select node | `action_node.select` | Available | Click in viewport / Outliner |
| Property set | `action_node.setProperties` (`componentId`, `properties`) | Available | Inspector property rows |
| Frame selection | `action_editor.frameSelection` | Available | Focus (F); Outliner RMB Focus |
| Transform / reparent / duplicate | — | UI only (or `setProperties` for editable transform paths) | Gizmo (W/ E/ R); DnD reparent; Duplicate (`Ctrl/Cmd+D`) |
| Property reset / copy / paste | — | UI only | Row reset; label Copy Value / Paste Value |
| Node copy / paste | — | UI only | Outliner Copy / Paste — recreate via MCP `action_node.add` if needed |
| Scene open / save / set active | `action_scene` | Available | Menu Save Scene (`Ctrl/Cmd+S`); Asset Browser open scene |
| Scene create / duplicate | `action_scene.create` / `duplicate` | Available | Menu New Scene; Asset Browser New Asset → Scene |
| Prefab create / open / place | — (`action_asset` has no prefab ops) | Unavailable / UI only | Asset Browser New → Prefab; double-click `.prefab.json`; drag to place |
| Undo / redo | `action_editor.undo` / `redo` | Available | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` |
| Editor hide / lock | — | UI only | Outliner eye / lock; H / L (editor-only) |
| Drop to surface | — | UI only | Hotkey End |
| Asset find refs | `query_asset.getReferences` | Available | Asset context Find References |
| Assets folder/material/move/rename/delete/import | `action_asset` / `query_asset` | Available | Asset Browser |
| Merge meshes → Model GLB | `action_asset.mergeMeshes` (`mergeGeometry` optional) | Available | Outliner Merge Meshes to Model… (optional Merge Into Single Mesh) |
| Local empty asset pack | `action_asset(installAssetPack)` | Available | Tools → New Asset Pack… |
| Browse / export packs | — | UI only | Tools → Browse / Export Asset Pack |
| Build / register classes | `action_build(buildProject)` | Available | Menu Build Project (`Ctrl/Cmd+B`) |
| Lightmap | `action_build(buildLightmap)` | Available | Title bar Build Lightmap |
| Play / exit | `enterPlayMode` / `exitPlayMode` | Available | Play ▾ / F5 / F6; Exit (Esc or title-bar Exit) |
| Play window/mobile/multiplayer prefs | — | UI only | Play ▾ options; Network menu |
| Screenshot | `action_editor.captureScreenshot` | Available | Assistant/viewport affordances |
| NavMesh | `query_navmesh` / `action_navmesh` | Available | Tools → Generate NavMesh |
| Viewport overlays / transform mode / snap | — | UI only | Viewport View / Snap / QWER |
| Animation / VFX / Skeleton editors | — | UI only | Asset Browser create + dialogs |
| Foundry / Scenario | — | UI only | Title bar Foundry |
| Project open/create/close | — | UI only | App picker / `genesys-sdk new` |
| Getting Started / Environment Setup | — | UI only | [app-setup-and-recovery.md](app-setup-and-recovery.md) |
| Configure / restart external MCP | — | UI only | Genesys AI Settings → MCP |
| Project Recovery / Fix with AI entry | — | UI only | Recovery dialog on failed open |
| Play Local Project | — | UI only | Dashboard *(dev SDK)* |
| Diagnostics | `query_diagnostics` | Available | Title bar Errors; console |

Compact-hidden (still callable via `run_script` / `batch_execute` / `search_tools`): `action_asset`, `query_asset`, `query_diagnostics`, `query_navmesh`, `action_navmesh`.

installAssetPack: scaffolds an empty `packs/<name>/` only — not catalog / cloud packs (use Browse Asset Packs).

<!-- PREFAB_TODO: Prefab editor/MCP UX removed; engine migrates legacy `.prefab.json` in memory on load. -->

Editor-only hide/lock: never describe as runtime `bHidden` / gameplay visibility.

UI vs MCP naming: the Node Outliner may still show legacy labels (e.g. “Actor”) in a few places; MCP and engine types use `*Node` (`MeshNode`, `InteractionNode`, …). Prefab instance actions (Edit Prefab, Apply, Resync, Unlink) live in the Inspector `PrefabActions` toolbar and in the Outliner/viewport Prefab submenu.
