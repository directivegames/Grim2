# Viewport and Assets

## Viewport toolbars

Each view has a compact toolbar above its picture (not an overlay). The **left side** holds the transform tools, World / Local and snapping. The **right side** holds **Camera**, **View Mode**, **Show**, **Performance** and **Layout** (split viewports, dev builds). Labels hide in a narrow view. The orientation gizmo sits in the top-right of each view; click an axis to switch to that view. The **Place** bar floats inside the top-left view (click **Place** to collapse it), with **Poly Builder** at its foot; Poly Builder's tools open beside it. Opening a toolbar menu closes the one already open.

| Tool | Hotkey | Notes |
| --- | --- | --- |
| World / Local | X | Transform space |
| Select | Q | Esc clears selection / leaves asset or prefab focus — it does not switch tools |
| Move / Rotate / Scale | W / E / R | Gizmos; MCP: editable transform paths via `action_node.setProperties` when exposed by `getEditableProperties` |

## Camera, View Mode, Show and Performance menus (viewport)

**Camera** (icon shows the current view): Perspective · Orthographic Top / Bottom / Front / Back / Left / Right · FOV (this view) · Focus Zoom / Far plane · Reset Camera (O).

**View Mode**: Lit · Wireframe (any renderer) · debug views under Complexity / Lighting / Geometry / Buffers (WebGPU renderer only).

**Show**: This View (Grid / Skybox / Object Icons) · Show Orientation Gizmo (all views) · Effects (VFX) · Physics (Show Collisions in Editor / Game) · NavMesh (Show NavMesh + colour) · Selection Outline options.

**Performance**: Realtime (the view redraws every frame; with one view this is the editor render mode, otherwise per view) · Screen Percentage (per view in split WebGPU layouts) · Editor Pixel Ratio · Show FPS. The icon turns blue when the view only redraws on demand.

## Editor Pixel Ratio (viewport performance)

Viewport toolbar → **Performance** → **Editor Pixel Ratio**. This is the editor viewport Screen Percentage: 100% is Native (the display pixel ratio, clamped to 1–2). The slider runs 25–100 in steps of 5. The canvas uses that percentage of Native, and never goes below ×0.25. The menu shows `percentage% · ×ratio`. Reset returns to Native (100%).

Lower it when the editor viewport is the bottleneck (heavy scenes, shadows, post-processing, high-DPI displays). A lower value shrinks the drawing buffer, so the viewport costs less GPU time and looks softer. Turning off **Realtime** in the same menu stops redrawing while the scene is idle; use both when the editor feels heavy.

This setting is the editor canvas only. Play in New Window and Mobile Preview have their own **Pixel Ratio** under Play ▾ → Play Mode Settings. Override off uses this display, or the device preset in Mobile Preview. The running game uses the engine `r.ScreenPercentage` cvar.

## Snap

Viewport toolbar → Move / Rotate / Scale snap, each with an on/off toggle and its increment. Click the increment for presets, a **Custom** field, **Disable All Snapping** and **Reset Snap Defaults**. Scroll over a value to step through the presets. In a narrow viewport the three controls fold into the magnet button.

## Place bar

Click **Place** to collapse or expand the bar. The **⋯** Place Bar Options menu beside **Place**: Add to Place Bar, Icons Only / Show Labels, Presets (built-in / user / team), Restore Default Place Bar.

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

Viewport blockout. A **Poly Mesh** group parents one node per piece. Toggle **Poly Builder** at the foot of the Place bar, or drive the same pieces with MCP `query_polybuilder` / `action_polybuilder` (compact-hidden; see the `genesys-polybuilder` skill). While the toolbar is open, each piece draws a wireframe. With no tool armed, scene pick, the transform gizmo, and the viewport context menu work on those nodes. Brush and Mesh Edit take the left button until you click the armed tool again.

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
| New Asset | **+** (dock tab strip, or toolbar when undocked) → Prefab / Material / Resource… / Scene / Folder |
| Folders / Assets views | Toolbar switch. Folders browses the folder tree; Assets lists every asset by category with counts (Include Engine Assets optional) |
| Grid / List / Thumb size | Toolbar (wide panels) or the panel ⋯ options menu; Ctrl+Scroll resizes |
| Filter / Search | Toolbar Filter button (type picker + quick chips) and search box (an icon on narrow panels) |
| Folder tree | Toolbar panel button shows/hides it (a drawer on narrow panels). Chevron Shift-click expands or collapses the whole branch (same as Outliner) |
| Navigate | Back / Forward / Breadcrumbs (a folder picker on narrow panels); Alt+Up for the parent folder |
| Second Asset Browser | ⋯ options → Open Second Asset Browser (own folder, search and view; selection is shared) |
| Favorites | Add to Favorites on a folder. Favorites is the top folder in the tree, next to @project and @engine |
| Empty-area context | New Asset/Resource/Folder · Delete Folder · Import Files… · Show in Finder/Explorer · Refresh · Refresh Thumbnails |
| Open | Double-click (scene/prefab/material/resource/…) |
| Prefab | Open Prefab (`.prefab.json`; MCP `action_prefab.open`) |
| Model | Open In Model Viewer · Extract Material… · Create Animation Config · Create Skeleton Profile |
| Scene | Set as Game/Server Default Scene · Refresh Thumbnail |
| Common | Find References · Show in Finder/Explorer · Open in Code Editor · Rename (F2) · Duplicate · Delete · Import Copy to Project… (engine assets) · Add to Current/New Chat · Show in Folder (Assets view and search results) |

## Specialised dialogs (UI only unless mcp-vs-ui says otherwise)

| Dialog | Open from |
| --- | --- |
| New Material / Prefab / Resource / Folder / Class | Asset Browser create |
| Animation Config | Model → Create Animation Config / New Animation |
| VFX | New VFX / Inspector VFX Editor |
| Skeleton Profile | Model → Create Skeleton Profile |
| Extract Model Material | Model context |
| Model Viewer | Model context — GLTF tree chevron Shift-click expands or collapses the whole branch |
| Foundry | Title bar Foundry — the editor's manual generator. Agent-driven generation is `genesys-generated-assets` (Scenario MCP) |
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

Renderer (→ Project Settings) · Camera mode · FOV · Fly speed · Wireframe/Skybox/Grid · Node selection count (`No nodes selected` when none; hover lists names when several nodes are selected) · Background tasks · Panel toggles (Assistant 1, Outliner 2, Inspector 3, Assets 4, Viewport 5) · Notifications bell (toast history)
