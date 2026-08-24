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
| `Ctrl/Cmd+Z` | Undo |
| `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` | Redo |
| F11 | Toggle Full Screen (desktop View menu) |
| F12 | Toggle Dev Console (desktop) |

**Show in Explorer** and **Quit** display `Ctrl/Cmd+E` / `Ctrl/Cmd+Q` in the title-bar menu, but those keys are **not** bound in the editor. Use the menu items. macOS **Quit** still follows the app **Cmd+Q**.

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
| G | Toggle Grid (View menu Show Grid) |
| O | Reset Camera to the origin (View menu Reset Camera). Distinct from F, which frames the selection |
| C | Toggle Show Collisions in Editor (no-op when physics debug is unavailable) |
| Y | Toggle Show Object Icons |

Ignored in Play Mode and while typing in a field. Unmodified keys only (`Ctrl/Cmd+C` copy and `Ctrl/Cmd+Y` redo are unchanged).

## Selection and nodes

| Hotkey | Action |
| --- | --- |
| `Ctrl/Cmd+C` | Copy selected nodes (skipped if a text range is highlighted) |
| `Ctrl/Cmd+V` | Paste nodes as children of the selection (works with viewport focus; empty selection / Scene root pastes at the world root) |
| `Ctrl/Cmd+Shift+V` | Paste as Sibling — insert after the selected node under the same parent (empty selection / Scene root pastes at the world root) |
| `Ctrl/Cmd+D` | Duplicate selection |
| Del / Backspace | Remove selection (Backspace matches Delete on macOS) |
| H | Toggle editor visibility (editor-only, not runtime) |
| L | Toggle editor lock (editor-only) |
| `/` | Edit selected prefab instance |
| Esc | Close Quick Action Overlay (overlay handles nested popups first); else close Prefab Editor when a return scene exists; else Back from asset / Scene Settings; else clear selection. Does **not** switch to the Select tool |

## Trees (Outliner, Asset Browser folders, Model Viewer GLTF)

| Hotkey | Action |
| --- | --- |
| Arrow Up / Arrow Down | Move focus and selection |
| Arrow Right / Arrow Left | Expand, or collapse / move to parent |
| F2 | Rename (Outliner focused row; Asset Browser selected project file — not folders) |
| Shift+click chevron | Expand or collapse the whole branch |

There is no chevron tooltip. Shift+F does **not** scroll the Outliner.

## AI Assistant

| Hotkey | Action |
| --- | --- |
| `1` | Toggle Agent Chat panel (when Assistant UI is enabled; ignored in Play Mode) |
| Space | Quick Action Overlay when Assistant can start a chat; otherwise **AI Settings** (Connection tab if no usable provider). Ignored in Play Mode |

## Contextual (not global)

| Hotkey | Where | Action |
| --- | --- | --- |
| Shift+RMB / Shift+LMB | Inspector property label | Copy Value / Paste Value (in-memory clipboard) |
| Ctrl+scroll | Asset Browser grid | Change thumbnail size |
| Shift+hold | Instanced-geometry brush | Temporarily eraser |
| Insert / Del / Esc | Spline point edit | Insert at hover / delete selected point / cancel drag or deselect |
