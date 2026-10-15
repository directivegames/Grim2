# Menus and Play

Exact labels from the Genesys desktop title bar.

For Getting Started, Environment Setup, Genesys AI / MCP settings, Project Recovery, and Play Local Project, see [app-setup-and-recovery.md](app-setup-and-recovery.md).

## Title bar Menu (hamburger — tooltip Menu)

### Editor (project open)

| Item | Notes |
| --- | --- |
| Exit Play Mode | While playing; `Esc` (games that handle Escape keep it) / `F8` (always exits) |
| New Scene | New-scene / Save Scene flow |
| Save Scene | `Ctrl/Cmd+S` |
| Save Scene As | Name/path prompt |
| Build Project | `Ctrl/Cmd+B` — rebuild `.dist/game.js`, register `@GameClass()` |
| Play Game Default Scene | F5 |
| Play Current Scene | F6 |
| Play in New Window | Launch mode |
| Play in Mobile Preview | Launch mode |
| Project Settings | Renderer, asset compiler, defaults |
| App Settings | See submenu below |
| Editor Settings → Panel Background Opacity | UI panel opacity (+ reset) |
| Upload Project | Upload flow |
| Tools → New Asset Pack… | Local empty pack scaffold |
| Tools → Export Asset Pack… | Export dialog |
| Tools → Browse Asset Packs | Catalog / cloud packs; Manage Registries inside dialog |
| Tools → Generate NavMesh | NavMesh dialog |
| Tools → Remove Imported Mesh Combinations | Cleanup |
| Tools → Clear Thumbnails | Clear thumbs + IDB screenshots |
| Tools → Performance Monitor / Profiler | The monitor is a compact HUD. Profiler provides rolling Insights reports and detailed Trace recording. Artifacts go to `{project}/.editor/profiles` (hidden in the asset browser). |
| Show in Explorer | `Ctrl/Cmd+E` — OS folder |
| Open in Code Editor | Opens `{project}.code-workspace` |
| View → Reload (`Ctrl/Cmd+R`) / Toggle Full Screen (F11) / Reset Layout | |
| Help → Hot Keys (F1) / Toggle Dev Console (F12) / Open App Logs Folder / GPU Diagnostics… / Changelog / Check for Updates / About | |
| Quit | `Ctrl/Cmd+Q` |

### Dashboard / home (no editor project)

Menu shows View / Help / Quit, plus the same App Settings and Editor Settings entries — so Getting Started Wizard and Genesys AI Settings work without a project open.

### App Settings submenu

| Item | Notes |
| --- | --- |
| Application Settings | Scenario API credentials, analytics consent |
| Getting Started Wizard | Reopen first-run setup |
| Genesys AI Settings | Providers, MCP configure / restart, Assist Action model |
| AI Assistant | Toggle *(dev builds)* — reset when changed |
| Genesys MCP | Enable MCP HTTP server — reset when changed |
| Ask before project update | Toggle — reset when changed |

## Title bar buttons

| Control | Notes |
| --- | --- |
| Save | Same as Save Scene |
| Undo / Redo | `Ctrl/Cmd+Z` / `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y`; hidden in Play Mode |
| Undo History | Clock icon next to Redo; dropdown of the active document’s steps (newest first). Click a row to jump; **Opened {document}** undoes everything. Hover a row for undo/redo step count. Hidden in Play Mode |
| Errors (alert) | Build / play error overlay (Fix with AI when available) |
| Agent Nova / AI Assistant | Toggle assistant (`1`) *(when Assistant enabled)* |
| Build Lightmap | Bake dialog (desktop + open scene) |
| Foundry | Scenario / generative assets. Skybox generation is `action_asset_generation`; the rest of Foundry is UI only |
| Profiler / Upload | Also under More actions on narrow layouts |
| Play + chevron | Start play; open Play mode options |
| Network | Multiplayer clients 1–4; server/client lag simulation |
| Exit Play / Play Dev Console | While playing; Exit is `Esc` when the game does not use it, or `F8` always; Dev Console is F12 |

## Play mode options (Play ▾)

| Item | Notes |
| --- | --- |
| Play in Editor / New Window / Mobile Preview | Launch mode |
| Game Default Scene / Current Scene | F5 / F6 |
| Play Mode Settings | Size, DPR, orientation, touch emulation, device frame |

## Profiler

**Insights** is a Play preference. The Edit switch does not collect frames in the editor; it decides whether the next Play session starts collecting a bounded 120-frame window. The Play switch changes the running session and saves the same preference. **Generate Report** saves world, memory, timing, and optimization guidance to `.editor/profiles`. Edit mode can **Open Report Viewer** at any time. Play only confirms the saved path, so the viewer cannot perturb game timings or steal input.

**Trace** is always visible. In Edit, the Trace switch arms recording for the next Play. A hint warns that trace files can grow very large and are expensive for an AI agent to parse. In desktop Play it offers **Start Trace**, which streams a trace file to `.editor/profiles` and shows elapsed time, bytes, event count, and **Stop Recording** while recording. The Trace Viewer opens when recording stops. **Enable live trace** under Advanced opens it when recording starts and tails the file instead. **Open Trace** loads the newest trace or the one just stopped. The frame strip draws continuous frame-time/FPS budgets, sized so their labels stay visible, and shows exact frame timings on hover. Drag the frame strip or ruler to select a range. The collapsible **Frame Stats** grid summarizes that selection (or the frames in view): count, average, minimum, maximum, standard deviation, average FPS, and how many frames stay on the 60 FPS and 30 FPS targets, allowing a little pacing noise. Drag the divider to widen the scope panel. **Settings**, before the trace filename, remembers two display choices: **Show Frame Rows** adds frame markers to the scope table (they always stay on the flame graph), and **Highlight Repetitions** fades unrelated work only after a double-click selects every matching span. A single click highlights that one span and leaves the rest of the graph visible. Drag the flame graph horizontally and vertically to reach deep lanes while the wheel continues to zoom time. Selecting one span shows its frame and self cost. **Callers** is an expandable tree from the selected function up through every chain that called it, and **Callees** is a tree of everything it calls; both merge every occurrence in the range, open along the hot (heaviest) chain, and highlight the clicked span's own chain. Double-click a tree row to select that function. Scope columns are sortable and their heat maps highlight relative cost. `F` zooms to the clicked span, otherwise back to the selected range, otherwise out to the whole timeline. The **Controls** menu lists the viewer interactions. **Advanced** also sets the stop limits: duration defaults to 900 seconds, size to 2048 MB, and frames and minimum span duration to 0. Zero means that axis is unlimited. Each field has a hover hint and its own revert button. Unsupported controls are omitted rather than disabled.

While a streamed trace records, the Profiler panel shows elapsed time, file size, and **Stop Recording**. If writing fails, the panel reports the error and whether a partial file was kept.

Insights and Trace answer frame cost. JavaScript heap and VRAM captures are a separate workflow in [memory-profiling](../../memory-profiling/SKILL.md). Those files go to `{project}/.genesys/captures`, not `.editor/profiles`. Compare two heap captures with `compare-heap-captures.mjs` and two GPU captures with `compare-gpu-captures.mjs`.

## NavMesh dialog (Tools → Generate NavMesh)

Generate & Save; Import NavMesh; Clear; agent/cell settings. MCP: `action_navmesh` / `query_navmesh`.
