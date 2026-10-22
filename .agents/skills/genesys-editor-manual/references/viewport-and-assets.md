# Viewport and Assets

## Viewport transform toolbar

| Tool | Hotkey | Notes |
| --- | --- | --- |
| World / Local | X | Transform space |
| Select | Q | Esc clears selection / leaves asset or prefab focus — it does not switch tools |
| Move / Rotate / Scale | W / E / R | Gizmos; MCP: editable transform paths via `action_node.setProperties` when exposed by `getEditableProperties` |

## View menu (viewport)

Perspective / Top / Bottom / Front / Back / Left / Right · Show Wireframe / Skybox / Grid / VFX / Object Icons · On-Demand Rendering · Editor Pixel Ratio · Show Collisions (Editor / Game) · Show NavMesh (+ colour) · FOV / Focus Zoom / Far plane · Selection Outline options · Reset Camera

## Editor Pixel Ratio (viewport performance)

Viewport toolbar → **View** → **Editor Pixel Ratio**. This is the editor viewport Screen Percentage: 100% is Native (the display pixel ratio, clamped to 1–2). The slider runs 25–100 in steps of 5. The canvas uses that percentage of Native, and never goes below ×0.25. The menu shows `percentage% · ×ratio`. Reset returns to Native (100%).

Lower it when the editor viewport is the bottleneck (heavy scenes, shadows, post-processing, high-DPI displays). A lower value shrinks the drawing buffer, so the viewport costs less GPU time and looks softer. **On-Demand Rendering** in the same menu stops redrawing while the scene is idle; use both when the editor feels heavy.

This setting is the editor canvas only. Play in New Window and Mobile Preview have their own **Pixel Ratio** under Play ▾ → Play Mode Settings. Override off uses this display, or the device preset in Mobile Preview. The running game uses the engine `r.ScreenPercentage` cvar.

## Snap

Snap button → translate/rotate/scale snap toggles + values · Reset to defaults

## Place bar

Toggle Place (**+** on the viewport left edge). **⋯** beside **+**: Add to Place Bar, Icons Only / Show Labels, Presets (built-in / user / team), Restore Default Place Bar.

Default items: Ground / Cube / Sphere / Cone / Cylinder · Lights flyout (Point / Spot / Rect Area / Ambient / Directional / Hemisphere) · Empty (a `PrimitiveNode` root).

| Action | How |
| --- | --- |
| Place with preview | Drag a Place item onto the viewport |
| Place at look-at | Click a spawn item (Cube, Empty, pinned Prefab, …) |
| Pin an asset | Drag a Prefab, Model, VFX, or JS Class from the Asset Browser onto the Place bar |
| Add a node class | Add to Place Bar (⋯, empty bar, or right-click the bar chrome) → Nodes (e.g. Player Start). Empty is already on the bar |
| Rearrange | Drag a Place item along the bar. Right-click → Move Up / Move Down. Arrow keys while a Place item is focused |
| Hide an item | Right-click → Hide from Place Bar |
| Insert a separator | Right-click a Place item → Insert Separator Below |

Scene and Prefab documents keep separate Place bar layouts. Spawned types are `*Node` classes (e.g. `MeshNode`, `PointLightNode`).

## Viewport context menu (stationary right-click)

Add to Chat · Prefab submenu on placed instances (and children) · Show/Hide (H) · Lock Selection / Unlock Selection (L) · Focus (F) · Duplicate (`Ctrl/Cmd+D`) · Remove (Del)

Viewport stays a short subset: no Add, Rename, Copy, Paste, or Save Branch as Prefab. View commands sit above Duplicate; Remove stays last. Instance Prefab submenu matches the Outliner (Edit, Apply, Resync, Editable Children, Show in Asset Browser, Unlink).

## Camera / placement

| Action | How |
| --- | --- |
| Fly camera | Right-drag; WASD while flying (speed in status bar) |
| Drop to Surface | End |
| Focus / frame | F (Outliner/Viewport Focus; MCP `action_editor.frameSelection`) |
| Place from assets | Drag Asset Browser → viewport, or drag onto the Place bar to pin. Loading drops show a Placing… indicator |

Contextual: instanced paint/erase · CSG Export Geometry · camera preview pin/close

## Poly Builder

Viewport blockout. A **Poly Mesh** group parents one node per piece. Toggle **Poly Builder** on the viewport toolbar, or drive the same pieces with MCP `query_polybuilder` / `action_polybuilder` (compact-hidden; see the `genesys-polybuilder` skill). While the toolbar is open, each piece draws a wireframe. With no tool armed, scene pick, the transform gizmo, and the viewport context menu work on those nodes. Brush and Mesh Edit take the left button until you click the armed tool again.

Hotkeys: [hotkeys.md](hotkeys.md) (Poly Builder mode). Brush, Mesh Edit, and Export are toolbar clicks.

| Tool | How | What to do |
| --- | --- | --- |
| Brush | Toolbar | Choose a shape, then click and drag. Polygon marks the first point; with 3 or more points, click that mark or double-click to close, then set the height. A cube is a mesh, same as the other shapes. Stairs and ramps climb from the first click towards the second, so the second click is the high end |
| Mesh Edit | Toolbar | Vertex / Edge / Face on any piece, including a cube. Move, Rotate, and Scale move the selection, not the node. Select a face and move the gizmo to pull it. Toolbar **Extrude** applies a mesh op |
| Snap | Viewport Snap | Brush placement uses the viewport translate snap. Mesh Edit uses the viewport Move, Rotate, and Scale snaps |
| Export | Toolbar | Writes `poly_mesh.glb` of the group next to the current scene, one object per piece |
| Exit | **Esc** | Cancels an in-progress brush drag first; otherwise leaves Poly Builder |
| Delete | **Del** / **Backspace** | The usual scene delete. It removes the selected piece node |

## Asset Browser (Assets panel)

| Feature | Path |
| --- | --- |
| New Asset | Prefab / Material / Resource… / Scene / Folder |
| Filter / Search / Thumb size | Toolbar / More options |
| Folder tree | Sidebar chevron — Shift-click expands or collapses the whole branch (same as Outliner) |
| Navigate | Back / Forward / Breadcrumbs |
| Favorites | Add to Favorites on a folder. Favorites is the top folder in the tree, next to @project and @engine |
| Empty-area context | New Asset/Resource/Folder · Delete Folder · Import Files… · Show in Finder/Explorer · Refresh · Refresh thumbnails |
| Open | Double-click (scene/prefab/material/resource/…) |
| Prefab | Open Prefab (`.prefab.json`; MCP `action_prefab.open`) |
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
| Foundry / Scenario | Title bar Foundry. Skybox generation is `action_asset_generation`. Bring an existing Scenario asset in with `import`; `apply` (`applyAs` for images) only when the user asked to place it. Other Foundry controls stay in the dialog |
| Find Asset References | Find References |
| Save Branch as Prefab | Outliner (MCP `action_prefab.createFromNode`) |
| Merge Meshes to Model | Outliner — writes Model GLB under `@project/assets/models`; optional Merge Into Single Mesh |
| Project Settings | Menu; status-bar renderer click |
| Play Mode Settings | Play ▾ |
| Build Lightmap | Title bar |
| Browse Asset Packs | Tools — install from Genesys cloud / local registries; footer Manage Registries (API base URL) |
| New / Export Asset Pack | Tools |
| Upload / About / Changelog / GPU Diagnostics / Perf Snapshot | Menu / Help / Tools |

## Status bar (glance)

Renderer (→ Project Settings) · Camera mode · FOV · Fly speed · Wireframe/Skybox/Grid · Node selection count (`No nodes selected` when none; hover lists names when several nodes are selected) · New Agent Chat (Space) · Background tasks · Notifications bell (toast history)
