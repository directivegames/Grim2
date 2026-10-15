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
| Prefab create / place / isolate | Compact-hidden `action_prefab` (`create`, `instantiate`, `open`, `close`, `save`) via `run_script` / `batch_execute` | Available | Asset Browser New → Prefab; double-click `.prefab.json`; drag from Asset Browser or Place bar Prefab picker to place; pin a prefab onto the Place bar; Outliner Save Branch as Prefab |
| Prefab Apply / Resync / Unlink | `action_prefab.apply` / `resync` / `unlink` on a placed instance root | Available | Inspector PrefabActions; Outliner/viewport Prefab submenu |
| Prefab createFromNode | `action_prefab.createFromNode` | Available | Outliner Save Branch as Prefab |
| Prefab editable children | `action_prefab.setEditableChildren` | Available | Prefab submenu Editable Children |
| Undo / redo | `action_editor.undo` / `redo` | Available | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y`; title-bar Undo / Redo / **Undo History** (jump is UI only) |
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
| Diagnose performance | Compact-hidden `query_profiler` / `action_profiler`: `setInsights` then `generateReport` (returns `path`, `issues`, timing, and a compact memory summary), `listArtifacts` for saved files, or start/stop/arm a streamed Trace with `maxDurationMs` / `maxBytes` and read its manifest. `setGpuDetail` saves Passes, Stages, or Draws for the next Play. Trace bodies are never returned. Heap and VRAM captures stay in the memory-profiling skill | Available | Tools → Profiler; Insights in Edit/Play; Trace controls only in desktop Play |
| Play window/mobile/multiplayer prefs | — | UI only | Play ▾ options; Network menu |
| Screenshot | `action_editor.captureScreenshot` only when the user asks for a picture. `target: "auto"` returns the running game during Play (`surface: "all"` for extra multiplayer windows) and the editor viewport otherwise. Do not use it to verify the scene — use `query_node` and `query_editor` | Available | Assistant/viewport affordances |
| NavMesh | `query_navmesh` / `action_navmesh` | Available | Tools → Generate NavMesh |
| Viewport overlays / transform mode / snap | — | UI only | Viewport View / Snap / QWER |
| Poly Builder (place, mesh edit) | Compact-hidden `query_polybuilder` / `action_polybuilder` via `run_script` / `batch_execute`. See the `genesys-polybuilder` skill | Available | Viewport **Poly Builder** toggle; pointer tools stay the human UI. See [viewport-and-assets.md](viewport-and-assets.md) |
| Animation / VFX / Skeleton editors | — | UI only | Asset Browser create + dialogs |
| Foundry / Scenario | `action_asset_generation` (skybox, image, texture, 3D model, audio; upscale, remove background, PBR convert, cancel, import). `apply` (`applyAs` for images) only when the user asked to place it | Available | Title bar Foundry. Prompt enhance stays in the Foundry dialog. Import is the only way to save a Scenario asset into the project |
| Project open/create/close | — | UI only | App picker / `genesys-sdk new` |
| Getting Started / Environment Setup | — | UI only | [app-setup-and-recovery.md](app-setup-and-recovery.md) |
| Configure / restart external MCP | — | UI only | Genesys AI Settings → MCP |
| Clarifying question | `request_user_input` when a wrong assumption would change the work. Otherwise state the assumption and continue | Available | Assistant question card (options, Other, Skip). Stop cancels it |
| Project Recovery / Fix with AI entry | — | UI only | Recovery dialog on failed open |
| Play Local Project | — | UI only | Dashboard *(dev SDK)* |
| Diagnostics | `query_diagnostics` | Available | Title bar Errors; console |

Compact-hidden (still callable via `run_script` / `batch_execute` / `search_tools`): `action_asset`, `action_prefab`, `query_asset`, `query_diagnostics`, `query_navmesh`, `action_navmesh`, `query_polybuilder`, `action_polybuilder`, `query_profiler`, `action_profiler`.

installAssetPack: scaffolds an empty `packs/<name>/` only — not catalog / cloud packs (use Browse Asset Packs).

Editor-only hide/lock: never describe as runtime `bHidden` / gameplay visibility.

UI vs MCP naming: the Node Outliner may still show legacy labels (e.g. “Actor”) in a few places; MCP and engine types use `*Node` (`MeshNode`, `InteractionNode`, …). Prefab instance actions (Edit Prefab, Apply, Resync, Unlink) live in the Inspector `PrefabActions` toolbar and in the Outliner/viewport Prefab submenu. Transform / reparent / duplicate stay UI-only.
