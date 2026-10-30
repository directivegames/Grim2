<!-- Generated from the editor's hotkey catalog. Do not edit by hand. -->

# Hotkeys

Keyboard shortcuts for the editor, viewport, Outliner, and Asset Browser.

`Ctrl/Cmd` means Control on Windows/Linux and Command on macOS. `Alt/Option` means Alt on Windows/Linux and Option on macOS. `Ctrl` in a row is the Control key on every platform (not Command).

## File and app

| Hotkey | Action |
| --- | --- |
| F1 | Open Hot Keys (Help menu) |
| `Ctrl/Cmd+S` | Save Scene |
| `Ctrl/Cmd+B` | Build Project |
| `Ctrl/Cmd+R` | Reload |
| `Ctrl/Cmd+K` | Open Command Palette |
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |
| F11 | Toggle Full Screen (desktop View menu) |
| F12 | Toggle Dev Console (desktop) |
| `Ctrl/Cmd+E` | Show Project in Explorer / Finder (desktop) |
| `Ctrl/Cmd+Q` | Quit (desktop) |

## Play

| Hotkey | Action |
| --- | --- |
| F5 | Play Game Default Scene (ignored while already playing) |
| F6 | Play Current Scene (ignored while already playing) |
| Esc / F8 | Exit Play Mode. Esc: if the game did not consume Escape and pointer lock is off. F8 always exits (the game does not receive F8). Title-bar **Exit Play Mode** also works. |

## Transform and camera

| Hotkey | Action |
| --- | --- |
| Q / W / E / R | Select / Move / Rotate / Scale |
| Space | Cycle transform tool: Move → Rotate → Scale (switches to Move from Select). Ignored in Play Mode |
| X | Toggle World / Local (Scale always uses local) |
| F | Focus / frame selection. Prefab Editor document root (or nothing selected): Reset Camera |
| End | Drop selection to surface |
| Right-drag | Fly camera. In an orthographic view, right-drag switches to Perspective first. While flying: **WASD** move, **Q/E** up/down, **Shift** boost, **wheel** fly speed |
| Shift+left-drag or `Alt/Option+left-drag` | Orbit / rotate around the focus. Orbiting an orthographic view switches to Perspective |
| `Alt/Option+right-drag` | Dolly (perspective) or zoom (orthographic) |
| Middle-drag | Pan |

Q/E while **not** flying are Select / Rotate. They only move the camera while RMB fly is active.

## View settings

| Hotkey | Action |
| --- | --- |
| G | Toggle Grid (Show menu, This View → Grid) |
| O | Reset Camera to the origin (Camera menu Reset Camera). Distinct from F, which frames the selection |
| C | Toggle Show Collisions in Editor (no-op when physics debug is unavailable) |
| Y | Toggle Show Object Icons |
| `Alt/Option+Shift+1` / `Alt/Option+Shift+2` / `Alt/Option+Shift+3` / `Alt/Option+Shift+4` | Viewport layout: Single / Two Side by Side / Two Stacked / 2 x 2 (when split viewports are enabled) |
| Shift+Space | Maximize or restore the active viewport pane (split viewports only) |

Ignored in Play Mode and while typing in a field. Unmodified keys only (`Ctrl/Cmd+C` copy and `Ctrl/Cmd+Y` redo are unchanged).

## Selection and nodes

| Hotkey | Action |
| --- | --- |
| `Ctrl/Cmd+C` | Copy selected nodes (skipped if a text range is highlighted) |
| `Ctrl/Cmd+X` | Cut selected nodes (copy, then delete; skipped if a text range is highlighted) |
| `Ctrl/Cmd+V` | Paste nodes as children of the selection (works with viewport focus; empty selection / Scene root pastes at the world root) |
| `Ctrl/Cmd+Shift+V` | Paste as Sibling — insert after the selected node under the same parent (empty selection / Scene root pastes at the world root) |
| `Ctrl/Cmd+D` | Duplicate selection |
| Del / Backspace | Remove selection (Backspace matches Delete on macOS) |
| H | Toggle editor visibility (editor-only, not runtime) |
| L | Toggle editor lock (editor-only) |
| `/` | Edit selected prefab instance |
| Esc | Close Prefab Editor when a return scene exists; else Back from asset / Scene Settings; else clear selection. Does **not** switch to the Select tool |

## Trees (Outliner, Asset Browser folders, Model Viewer GLTF)

| Hotkey | Action |
| --- | --- |
| Arrow Up / Arrow Down | Move focus and selection |
| Arrow Right / Arrow Left | Expand, or collapse / move to parent |
| `Ctrl/Cmd+Arrow Up` / `Ctrl/Cmd+Arrow Down` | Move the selected nodes up / down among their siblings (Outliner only; needs a contiguous block under one parent) |
| `Ctrl/Cmd+F` | Focus the Outliner filter (not type-to-filter; ignored while typing in a field or in Play Mode) |
| `Ctrl/Cmd+Shift+A` | Open the Add Node dialog for the current selection (Ctrl/Cmd+A stays select-all) |
| F2 | Rename (Outliner focused row; Asset Browser selected project file — not folders) |
| Shift+click chevron | Expand or collapse the whole branch |

There is no chevron tooltip. Shift+F does **not** scroll the Outliner.

## AI Assistant

| Hotkey | Action |
| --- | --- |
| `1` | Toggle Assistant panel (when Assistant UI is enabled; ignored in Play Mode) |
| `2` | Toggle Outliner panel (ignored in Play Mode) |
| `3` | Toggle Inspector panel (ignored in Play Mode) |
| `4` | Toggle Assets panel (ignored in Play Mode) |
| `5` | Show / hide the Viewport so panels take its space (ignored in Play Mode) |
| Enter | Send. While the agent is running, steer: the message is delivered at its next step |
| `Alt/Option+Enter` | While the agent is running, queue the message to send after this turn |
| Shift+Enter | New line |
| Esc | Stop the running agent (only when the box is empty and no picker is open) |
| Up | Edit the most recent queued message (only when the box is empty) |

## Contextual (not global)

| Hotkey | Where | Action |
| --- | --- | --- |
| Shift+RMB / Shift+LMB | Inspector property label | Copy Value / Paste Value (in-memory clipboard) |
| Ctrl+scroll | Asset Browser content | Change thumbnail size (grid) or row size (list) |
| Arrow keys / Home / End / Page Up / Page Down | Asset Browser content | Move the selection (Shift extends it) |
| Enter | Asset Browser content | Open the selected asset or folder |
| `Alt/Option+Arrow Up` | Asset Browser content | Go to the parent folder (Folders view) |
| Del or Backspace | Asset Browser content | Delete the selected project assets (asks to confirm) |
| `Ctrl/Cmd+click` / Shift+click | Asset Browser content | Toggle an item, or select a range |
| `Ctrl/Cmd+A` | Asset Browser content | Select all items in the current folder or category |
| Shift+hold | Instanced-geometry brush | Temporarily eraser |
| Insert / Del / Esc | Spline point edit | Insert at hover / delete selected point / cancel drag or deselect |
| Esc | Poly Builder mode | Cancel an in-progress brush drag, or exit the mode. Other tools are toolbar clicks, so camera and editor keys pass through |
| Enter / Shift+Enter | Add Node dialog | Add the highlighted entry / add it and keep the dialog open (Arrow keys and Page Up / Down move, Esc closes) |
| Tab / Shift+Tab | Add Node dialog | Next / previous category |
| `Ctrl/Cmd+D` | Add Node dialog | Star or unstar the highlighted entry in Favorites |
