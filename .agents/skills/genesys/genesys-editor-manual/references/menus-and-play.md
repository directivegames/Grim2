# Menus and Play

Exact labels from the Genesys desktop title bar.

For Getting Started, Environment Setup, Genesys AI / MCP settings, Project Recovery, and Play Local Project, see [app-setup-and-recovery.md](app-setup-and-recovery.md).

## Title bar Menu (hamburger — tooltip Menu)

### Editor (project open)

| Item | Notes |
| --- | --- |
| **Exit Play Mode** | While playing; `Ctrl/Cmd+P` |
| **New Scene** | New-scene / Save Scene flow |
| **Save Scene** | `Ctrl/Cmd+S` |
| **Save Scene As** | Name/path prompt |
| **Build Project** | `Ctrl/Cmd+B` — rebuild `.dist/game.js`, register `@GameClass()` |
| **Play Game Default Scene** | F5 |
| **Play Current Scene** | F6 |
| **Play in New Window** | Launch mode |
| **Play in Mobile Preview** | Launch mode |
| **Project Settings** | Renderer, asset compiler, defaults |
| **App Settings** | See submenu below |
| **Editor Settings** → Panel Background Opacity | UI panel opacity (+ reset) |
| **Upload Project** | Upload flow |
| **Tools** → New Asset Pack… | Local empty pack scaffold |
| **Tools** → Export Asset Pack… | Export dialog |
| **Tools** → Browse Asset Packs | Catalog / cloud packs; **Manage Registries** inside dialog |
| **Tools** → Generate NavMesh | NavMesh dialog |
| **Tools** → Remove Imported Mesh Combinations | Cleanup |
| **Tools** → Clear Thumbnails | Clear thumbs + IDB screenshots |
| **Tools** → Performance Monitor / Profiler / View Perf Snapshot… | Perf UI |
| **Show in Explorer** | `Ctrl/Cmd+E` — OS folder |
| **Open in Code Editor** | Opens `{project}.code-workspace` |
| **View** → Reload (`Ctrl/Cmd+R`) / Toggle Full Screen (F11) / Reset Layout | |
| **Help** → Toggle Dev Console (F12) / Open App Logs Folder / GPU Diagnostics… / Changelog / Check for Updates / About | |
| **Quit** | `Ctrl/Cmd+Q` |

### Dashboard / home (no editor project)

Menu shows **View** / **Help** / **Quit**, plus the same **App Settings** and **Editor Settings** entries — so **Getting Started Wizard** and **Genesys AI Settings** work without a project open.

### App Settings submenu

| Item | Notes |
| --- | --- |
| **Application Settings** | Scenario API credentials, analytics consent |
| **Getting Started Wizard** | Reopen first-run setup |
| **Genesys AI Settings** | Providers, MCP configure / restart, Assist Action model |
| **AI Assistant** | Toggle *(dev builds)* — reset when changed |
| **Genesys MCP** | Enable MCP HTTP server — reset when changed |
| **Ask before project update** | Toggle — reset when changed |

## Title bar buttons

| Control | Notes |
| --- | --- |
| Save | Same as Save Scene |
| Errors (alert) | Build / play error overlay (**Fix with AI** when available) |
| Agent Nova / AI Assistant | Toggle assistant (`1`) *(when Assistant enabled)* |
| **Build Lightmap** | Bake dialog (desktop + open scene) |
| **Foundry** | Scenario / generative assets (UI only) |
| Profiler / Upload | Also under More actions on narrow layouts |
| Play + chevron | Start play; open **Play mode options** |
| Network | Multiplayer clients 1–4; server/client lag simulation |
| Exit Play / Play Dev Console | While playing |

## Play mode options (Play ▾)

| Item | Notes |
| --- | --- |
| Play in Editor / New Window / Mobile Preview | Launch mode |
| Game Default Scene / Current Scene | F5 / F6 |
| **Play Mode Settings** | Size, DPR, orientation, touch emulation, device frame |

## NavMesh dialog (Tools → Generate NavMesh)

Generate & Save; Import NavMesh; Clear; agent/cell settings. MCP: `action_navmesh` / `query_navmesh`.
