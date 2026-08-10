# Outliner and Inspector

The editor uses a **Node Outliner** (world-level `SceneNode` tree) and **Node Inspector** (properties for the selected node, or asset / scene-settings / prefab-document modes). Some UI strings may still say “Actor” or “Component”; MCP uses `query_node` / `action_node` with `componentId` params for node UUIDs.

## Outliner panel

Dock Left/Right via Outliner Options.

| Control | Path | Notes |
| --- | --- | --- |
| Search | Toolbar | Filter by name/id; Enter selects; type-to-search |
| Add node / prefab | **+** (`NodeAddPicker`) | Component class picker or prefab place |
| Editor hide | Eye; tooltip Hide/Show object in editor; **H** | Editor-only |
| Editor lock | Lock; Lock/Unlock selection (**L**) | Editor-only |
| Scene Settings | Click scene **Root** | Inspector → scene settings |

Folders, **Move to Folder**, and **Add Folder** are not in the Node Outliner (v14). Organisation is the component/node hierarchy and DnD reparent.

### Node context menu

Add to Current/New Chat · **Show/Hide** (H) · **Lock Selection** / **Unlock Selection** (L) · **Focus** (F) · **Rename** (F2) · **Copy** (`Ctrl/Cmd+C`) · **Paste** (`Ctrl/Cmd+V`) · **Duplicate** (`Ctrl/Cmd+D`) · **Merge Meshes to Model…** · **Save Branch as Prefab…** · **Remove** (Del)

Prefab instance workflow (**Edit Prefab**, **Apply to Prefab**, **Resync with Prefab**, **Show in Asset Browser**, **Unlink from Prefab**) is in the **Inspector** `PrefabActions` toolbar, not the outliner RMB menu.

### Outliner-focused extras

**F** Focus · `Ctrl/Cmd+C`/`V`/`D` · F2 rename · Root **Paste** for world-level paste

## Inspector panel

Titles vary: Inspector · Inspector (Scene Settings) · Inspector (Material) · Inspector (Prefab Asset) · …

There is no separate component tree — properties for the selected node only (multi-select supported).

| Feature | Path | Notes |
| --- | --- | --- |
| Edit properties | Property rows | MCP `action_node.setProperties` (`componentId`, `properties`) |
| Reset property | Row reset — **Reset to default value** | UI only |
| Copy / Paste property value | Label context: **Copy Value** (Shift+RMB) · **Paste Value** (Shift+LMB) | In-memory clipboard — **UI only** |
| Expand All / Collapse All | Inspector Options | |
| Asset Details | Collapsible section | Starts collapsed |
| Back to Previous Selection | Back button (Esc) | Leave asset/scene-settings focus |
| Prefab instance actions | `PrefabActions` toolbar | Edit / Apply / Resync / Browse / Unlink; **Editable Children** on placed prefab roots |
| Merge Meshes to Model… | Outliner context | MCP `action_asset.mergeMeshes` — exports nested meshes to `.glb`; originals kept; optional **Merge Into Single Mesh** welds to one geometry |
| VFX Editor | Property when VFX path set | Opens VFX dialog — UI only |

Prefab isolation: viewport **Prefab Editor** banner · **Close Prefab** (Esc when a previous scene exists) · Outliner hidden · status **Prefab Asset Mode**.
