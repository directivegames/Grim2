# Viewport and Assets

## Viewport transform toolbar

| Tool | Hotkey | Notes |
| --- | --- | --- |
| World / Local | **X** | Transform space |
| Select | **Q** / Esc | |
| Move / Rotate / Scale | **W** / **E** / **R** | Gizmos; MCP: editable transform paths via `action_node.setProperties` when exposed by `getEditableProperties` |

## View menu (viewport)

Perspective / Top / Bottom / Front / Back / Left / Right · Show Wireframe / Skybox / Grid / VFX / Object Icons · On-Demand Rendering · Show Collisions (Editor / Game) · Show NavMesh (+ colour) · FOV / Focus Zoom / Far plane · Selection Outline options · **Reset Camera**

## Snap

Snap button → translate/rotate/scale snap toggles + values · **Reset to defaults**

## Place Actors toolbar

Toggle Place Actors · Empty Actor · Cube/Sphere/Cone/Cylinder · Point/Spot/Rect Area/Ambient/Directional/Hemisphere lights

(UI label “Place Actors” / “Empty Actor” may persist; spawned types are `*Node` classes such as `MeshNode`, `PointLightNode`.)

## Viewport context menu (stationary right-click)

Add to Chat · **Duplicate** (`Ctrl/Cmd+D`) · **Show/Hide** (H) · **Lock Selection** / **Unlock Selection** (L) · **Focus** (F) · **Remove** (Del)

## Camera / placement

| Action | How |
| --- | --- |
| Fly camera | Right-drag; WASD while flying (speed in status bar) |
| Drop to Surface | **End** |
| Focus / frame | **F** (Outliner/Viewport **Focus**; MCP `action_editor.frameSelection`) |
| Place from assets | Drag Asset Browser → viewport. Loading drops show a **Placing…** indicator |

Contextual: instanced paint/erase · CSG **Export Geometry** · camera preview pin/close

## Asset Browser (Assets panel)

| Feature | Path |
| --- | --- |
| New Asset | Prefab / Material / Resource… / Scene / Folder |
| Filter / Search / Thumb size | Toolbar / More options |
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
| Model Viewer | Model context |
| Foundry / Scenario | Title bar Foundry |
| Find Asset References | Find References |
| Save Branch as Prefab | Outliner |
| Merge Meshes to Model | Outliner — writes Model GLB under `@project/assets/models`; optional **Merge Into Single Mesh** |
| Project Settings | Menu; status-bar renderer click |
| Play Mode Settings | Play ▾ |
| Build Lightmap | Title bar |
| Browse Asset Packs | Tools — install from Genesys cloud / local registries; footer **Manage Registries** (API base URL) |
| New / Export Asset Pack | Tools |
| Upload / About / Changelog / GPU Diagnostics / Perf Snapshot | Menu / Help / Tools |

## Status bar (glance)

Renderer (→ Project Settings) · Camera mode · FOV · Fly speed · Wireframe/Skybox/Grid · Selection / Prefab Asset Mode · New Agent Chat (Space) · Background tasks · **Notifications** bell (toast history)
