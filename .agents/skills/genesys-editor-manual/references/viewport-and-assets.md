# Viewport and Assets

## Viewport transform toolbar

| Tool | Hotkey | Notes |
| --- | --- | --- |
| World / Local | X | Transform space |
| Select | Q | Esc clears selection / leaves asset or prefab focus — it does not switch tools |
| Move / Rotate / Scale | W / E / R | Gizmos; MCP: editable transform paths via `action_node.setProperties` when exposed by `getEditableProperties` |

## View menu (viewport)

Perspective / Top / Bottom / Front / Back / Left / Right · Show Wireframe / Skybox / Grid / VFX / Object Icons · On-Demand Rendering · Show Collisions (Editor / Game) · Show NavMesh (+ colour) · FOV / Focus Zoom / Far plane · Selection Outline options · Reset Camera

## Snap

Snap button → translate/rotate/scale snap toggles + values · Reset to defaults

## Place toolbar

Toggle Place (viewport left edge) · Primitives: Ground/Cube/Sphere/Cone/Cylinder · Lights: Point/Spot/Rect Area/Ambient/Directional/Hemisphere

Spawned types are `*Node` classes (e.g. `MeshNode`, `PointLightNode`).

## Viewport context menu (stationary right-click)

Add to Chat · Prefab submenu on placed instances (and children) · Show/Hide (H) · Lock Selection / Unlock Selection (L) · Focus (F) · Duplicate (`Ctrl/Cmd+D`) · Remove (Del)

Viewport stays a short subset: no Add, Rename, Copy, Paste, or Save Branch as Prefab. View commands sit above Duplicate; Remove stays last. Instance Prefab submenu matches the Outliner (Edit, Apply, Resync, Editable Children, Show in Asset Browser, Unlink).

## Camera / placement

| Action | How |
| --- | --- |
| Fly camera | Right-drag; WASD while flying (speed in status bar) |
| Drop to Surface | End |
| Focus / frame | F (Outliner/Viewport Focus; MCP `action_editor.frameSelection`) |
| Place from assets | Drag Asset Browser → viewport. Loading drops show a Placing… indicator |

Contextual: instanced paint/erase · CSG Export Geometry · camera preview pin/close

## Asset Browser (Assets panel)

| Feature | Path |
| --- | --- |
| New Asset | Prefab / Material / Resource… / Scene / Folder |
| Filter / Search / Thumb size | Toolbar / More options |
| Folder tree | Sidebar chevron — Shift-click expands or collapses the whole branch (same as Outliner) |
| Navigate | Back / Forward / Breadcrumbs |
| Empty-area context | New Asset/Resource/Folder · Delete Folder · Import Files… · Show in Finder/Explorer · Refresh · Refresh thumbnails |
| Open | Double-click (scene/prefab/material/resource/…) |
| Prefab | Open Prefab (`.prefab.json`) |
| Model | Open In Model Viewer · Extract Material… · Create Animation Config · Create Skeleton Profile |
| Scene | Set as Game/Server Default Scene · Refresh Thumbnail |
| Common | Find References · Show in Finder/Explorer · Open in Code Editor · Rename (F2) · Duplicate · Delete · Import Copy to Project… (engine assets) · Add to Current/New Chat |

## Specialised dialogs (UI only unless mcp-vs-ui says otherwise)

| Dialog | Open from |
| --- | --- |
| New Material / Prefab / Resource / Folder / Class | Asset Browser create |
| Animation Config | Model → Create Animation Config / New Animation |
| VFX | New VFX / Inspector VFX Editor |
| Skeleton Profile | Model → Create Skeleton Profile |
| Extract Model Material | Model context |
| Model Viewer | Model context — GLTF tree chevron Shift-click expands or collapses the whole branch |
| Foundry / Scenario | Title bar Foundry |
| Find Asset References | Find References |
| Save Branch as Prefab | Outliner |
| Merge Meshes to Model | Outliner — writes Model GLB under `@project/assets/models`; optional Merge Into Single Mesh |
| Project Settings | Menu; status-bar renderer click |
| Play Mode Settings | Play ▾ |
| Build Lightmap | Title bar |
| Browse Asset Packs | Tools — install from Genesys cloud / local registries; footer Manage Registries (API base URL) |
| New / Export Asset Pack | Tools |
| Upload / About / Changelog / GPU Diagnostics / Perf Snapshot | Menu / Help / Tools |

## Status bar (glance)

Renderer (→ Project Settings) · Camera mode · FOV · Fly speed · Wireframe/Skybox/Grid · Selection / Prefab Asset Mode · New Agent Chat (Space) · Background tasks · Notifications bell (toast history)
