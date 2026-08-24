# Outliner and Inspector

The editor uses a Node Outliner (world-level `SceneNode` tree) and Node Inspector (properties for the selected node, or asset / scene-settings / prefab-document modes). Some UI strings may still say “Actor” or “Component”; MCP uses `query_node` / `action_node` with `componentId` params for node UUIDs.

## Outliner panel

Dock Left/Right via Outliner Options.

| Control | Path | Notes |
| --- | --- | --- |
| Search | Toolbar | Filter by name/id; Enter selects; type-to-search |
| Expand / collapse | Chevron | Shift-click expands or collapses the whole branch |
| Add node / prefab | + (`NodeAddPicker`) | Node class picker (tab reads "Node") or prefab place |
| Editor hide | Eye; tooltip Hide/Show object in editor; H | Editor-only |
| Editor lock | Lock; Lock/Unlock selection (L) | Editor-only |
| Scene Settings | Click scene Root | Inspector → scene settings |
| Prefab document | Click blank in the Outliner (empty selection) | Inspector → Prefab Name, Prefab Asset, Prefab Preview Scene |
| Prefab document root | Click prefab Root | Inspector → node properties (no Prefab Preview Scene section) |
| Prefab instance | Editor icon on the instance row | Opens Prefab Editor for that instance |

Folders, Move to Folder, and Add Folder are not in the Node Outliner. Organisation is the node hierarchy and DnD reparent.

### Node context menu

Header · Add to Current/New Chat · Prefab slot · Add · Show/Hide (H) · Lock Selection / Unlock Selection (L) · Focus (F) · Rename (F2) · Copy (`Ctrl/Cmd+C`) · Paste (`Ctrl/Cmd+V`) · Paste as Sibling (`Ctrl/Cmd+Shift+V`) · Duplicate (`Ctrl/Cmd+D`) · Remove (Del)

View commands (Show/Hide, Lock, Focus) are grouped separately from Rename / Copy / Paste / Duplicate. Remove stays last.

The Prefab slot is one row so shared commands stay in the same place:

- Placed instance (and children): Prefab submenu — Edit Prefab (`/`), and on instance roots also Apply to Prefab, Resync Prefab, Editable Children, Show in Asset Browser, Unlink from Prefab…
- Normal node: Save Branch as Prefab (not on placed prefab instance roots)

Prefab document Root: Show Prefab in Asset Browser · Add · Paste. Scene Root: Add · Paste. Apply / Resync / Unlink still prompt (Inspector toolbar or this submenu). Engine prefabs disable Apply and Unlink.

### Outliner-focused extras

F Focus · `Ctrl/Cmd+C`/`V`/`Shift+V`/`D` · F2 rename · Root Paste for world-level paste

## Inspector panel

Titles vary: Inspector · Inspector (Scene Settings) · Inspector (Material) · Inspector (Prefab Asset) · …

There is no separate component tree — properties for the selected node only (multi-select supported).

| Feature | Path | Notes |
| --- | --- | --- |
| Edit properties | Property rows | MCP `action_node.setProperties` (`componentId`, `properties`) |
| Reset property | Row reset — Reset to default value | UI only |
| Copy / Paste property value | Label context: Copy Value (Shift+RMB) · Paste Value (Shift+LMB) | In-memory clipboard — UI only |
| Expand All / Collapse All | Inspector Options | |
| Asset Details | Collapsible section | Starts collapsed |
| Back to Previous Selection | Back button (Esc) | Leave asset/scene-settings focus |
| Prefab instance actions | `PrefabActions` toolbar + outliner/viewport Prefab submenu | Inspector: Edit / Apply / Resync / Browse; More: Editable Children, Unlink. Outliner/viewport Prefab submenu: Edit (`/`); instance roots also Apply / Resync / Editable Children / Show in Asset Browser / Unlink |
| Merge Meshes to Model… | Outliner context | MCP `action_asset.mergeMeshes` — exports nested meshes to `.glb`; originals kept; optional Merge Into Single Mesh welds to one geometry |
| VFX Editor | Property when VFX path set | Opens VFX dialog — UI only |

Prefab isolation: Outliner Back closes Prefab Editor immediately. Esc clears selection first, then closes Prefab Editor when nothing is selected (restores the edited instance when you entered from one). Document root shows the prefab asset name, plus `(Instance Name)` when entered from a placed instance. Asset Browser single-click shows inspector details with Back; double-click opens or switches Prefab Editor. Entering Prefab Editor reveals that prefab in the Asset Browser.
