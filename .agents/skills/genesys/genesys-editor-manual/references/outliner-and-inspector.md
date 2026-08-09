# Outliner and Inspector

## Outliner panel

Dock Left/Right via Outliner Options. Hidden during prefab isolation.

| Control | Path | Notes |
| --- | --- | --- |
| Search | Toolbar | Filter by name/id |
| Add Folder | + folder | Create folder |
| Add Actor | + → Actor Class Picker | Spawn class |
| Editor hide | Eye; tooltip Hide/Show object in editor; **H** | Editor-only |
| Editor lock | Lock; Lock/Unlock selection (**L**) | Editor-only |
| Folder hide/lock all | Folder eye/lock | Recursive |
| Edit Prefab | Prefab pencil on row | Isolation |
| Scene Settings | Click scene root | Inspector → scene settings |

### Actor context menu

Add to Current/New Chat · **Show/Hide** (H) · **Lock Selection** / **Unlock Selection** (L) · **Focus** (F) · **Rename** (F2) · **Copy** (`Ctrl/Cmd+C`) · **Paste** (`Ctrl/Cmd+V`) · **Duplicate** (`Ctrl/Cmd+D`) · **Move to Folder** (Root / folders / Create New Folder) · **Merge Meshes to Model…** · **Prefab** → Edit Prefab / Apply to Prefab / Resync with Prefab / Show in Asset Browser / Unlink Prefab · **Save as Prefab...** · **Remove** (Del)

### Folder context menu

**Show/Hide All** (H) · **Lock All** / **Unlock All** (L) · **Rename** (F2) · **Merge Meshes to Model…** · **Delete Folder (Delete content)** (Del) · **Delete Folder (Keep content)** (Shift+Del)

### Outliner-focused extras

**F** Focus · **Shift+F** scroll to selected · `Ctrl/Cmd+C`/`V`/`D` · F2 rename

## Inspector panel

Titles vary: Inspector · Inspector (Scene Settings) · Inspector (Prefab Asset) · Inspector (Material) · …

| Feature | Path | Notes |
| --- | --- | --- |
| Edit properties | Property rows | MCP `action_component.setProperties` |
| Reset property | Row reset — **Reset to default value** | May show **(override)** on prefab instances |
| Copy / Paste property value | Label context: **Copy Value** (Shift+RMB) · **Paste Value** (Shift+LMB) | In-memory clipboard — **UI only**; type-checked paste; undoable |
| Expand All / Collapse All | Inspector Options | |
| Asset Details | Collapsible section | Starts collapsed on shorter viewports |
| Back to Previous Selection | Back button (Esc) | Leave asset/scene-settings focus |
| Add Component | Component tree **+** / context **Add** | MCP `action_component.add` |
| Component Focus | Context **Focus** (F) | |
| Duplicate component | Context **Duplicate** (`Ctrl/Cmd+D`) | MCP `action_component.duplicate` |
| Rename component | Context **Rename** (F2) | |
| Make Root | Context **Make Root** | Promote to root component |
| Merge Meshes to Model… | Context menu | MCP `action_asset.mergeMeshes` — exports nested meshes to `.glb`; originals kept |
| Remove component | Context **Remove** (Del) | MCP `action_component.remove` |
| Reparent components | Drag in component tree | |
| VFX Editor | Property when VFX path set | Opens VFX dialog — UI only |

### Prefab Inspector chrome

| Action | Path | MCP |
| --- | --- | --- |
| Edit Prefab / Close Prefab | Prefab buttons | `open` / `close` |
| Apply to Prefab | Button | `apply` |
| Resync Prefab / Resync with Prefab… | Button / More Prefab Actions | `resync` |
| Unlink from Prefab… | More Prefab Actions | `unpack` |
| Show in Asset Browser | Prefab chrome | — |
| Save Prefab | Prefab asset mode | `save` |

Prefab isolation: viewport **Prefab Editor** banner · Exit Prefab Mode (Esc) · Outliner hidden · status **Prefab Asset Mode**.
