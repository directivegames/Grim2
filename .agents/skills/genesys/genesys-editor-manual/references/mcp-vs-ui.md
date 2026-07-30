# MCP vs UI

Prefer MCP when Status is Available and MCP is ready; otherwise give the Manual UI path. Do not invent tools for **UI only** rows.

| Task | MCP | Status | Manual UI |
| --- | --- | --- | --- |
| Inspect scene / actors | `query_scene`, `query_actor`, `query_editor` | Available | Outliner; Inspector |
| Actor CRUD / transform / reparent | `action_actor` | Available | Outliner context; viewport gizmo |
| Select / Focus / frame | `action_actor.select` / `focus`; `action_editor.frameSelection` | Available | Click; **Focus** (F); Outliner Shift+F scrolls to selection |
| Component add / set / enable | `action_component` (compact-hidden) | Available | Inspector **+** Add Component; property rows |
| Component remove / duplicate / reset | `action_component.remove` / `duplicate` / `resetToDefaults` | Available | Component context **Remove** / **Duplicate**; property row reset |
| Property copy / paste | — | UI only | Property label **Copy Value** (Shift+RMB) / **Paste Value** (Shift+LMB) |
| Actor copy / paste | — | UI only | Outliner **Copy** / **Paste** (`Ctrl/Cmd+C`/`V`) — recreate via MCP actor create if needed |
| Scene open / save / set active | `action_scene` | Available | Menu **Save Scene** (`Ctrl/Cmd+S`); Asset Browser open scene |
| Scene create / duplicate | `action_scene.create` / `duplicate` | Available | Menu **New Scene**; Asset Browser New Asset → Scene |
| Prefab create / open / place | `action_asset` / Prefab open via Asset Browser | Available | Asset Browser **New → Prefab**; double-click `.prefab.json`; drag to place |
| Undo / redo | `action_editor.undo` / `redo` | Available | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Y` |
| Editor hide / lock | `setEditorVisible` / `setEditorLocked` | Available | Outliner eye / lock; **H** / **L** (editor-only) |
| Drop to surface | — | UI only | Hotkey **End** |
| Asset find refs | `query_asset.getReferences` | Available | Asset context **Find References** |
| Assets folder/material/move/rename/delete/import | `action_asset` / `query_asset` | Available | Asset Browser |
| Local empty asset pack | `action_asset(installAssetPack)` | Available | Tools → **New Asset Pack…** |
| Browse / export packs | — | UI only | Tools → Browse / Export Asset Pack |
| Build / register classes | `action_build(buildProject)` | Available | Menu **Build Project** (`Ctrl/Cmd+B`) |
| Lightmap | `action_build(buildLightmap)` | Available | Title bar **Build Lightmap** |
| Play / exit | `enterPlayMode` / `exitPlayMode` | Available | Play ▾ / F5 / F6; Exit (`Ctrl/Cmd+P`) |
| Play window/mobile/multiplayer prefs | — | UI only | Play ▾ options; Network menu |
| Screenshot | `captureScreenshot` | Available | Assistant/viewport affordances |
| NavMesh | `query_navmesh` / `action_navmesh` | Available | Tools → **Generate NavMesh** |
| Viewport overlays / transform mode / snap | — | UI only | Viewport View / Snap / QWER |
| Animation / VFX / Skeleton editors | — | UI only | Asset Browser create + dialogs |
| Foundry / Scenario | — | UI only | Title bar **Foundry** |
| Project open/create/close | — | UI only | App picker / `genesys-sdk new` |
| Diagnostics | `query_diagnostics` | Available | Title bar Errors; console |

**Compact-hidden** (still callable via `run_script` / `batch_execute` / `search_tools`): `action_component`, `action_asset`, `query_asset`, `query_diagnostics`, `query_navmesh`, `action_navmesh`.

<!-- PREFAB_TODO: Prefab editor/MCP UX removed; engine migrates legacy `.prefab.json` in memory on load. -->

**Editor-only hide/lock:** never describe as runtime `bHidden` / gameplay visibility.
