# TECH.md template

`TECH.md` sits at the project root next to `GAME.md`. It is for agents and technical creators. Its first three lines say in plain words what the game is built from, so a creator can skim it.

`tech-check.mjs` reads the tables by their headings and column names. Keep the headings (`## 3. Modules`, `## 8. Verification plan`, `## 9. Work packages`) and the column names below.

## Template

```markdown
# <Title> — Technical design

<Two or three plain sentences: the engine pieces the game stands on, how the code is split, and where tuning lives.>

Engine: @gnsx/genesys.js <version> · Players: <solo | online co-op | online versus> · Targets: <desktop | desktop + mobile>
Implements: GAME.md (GAME.md wins on *what*, this file on *how*)
Contracts: src/contracts.ts · Tuning: src/const.ts · Smoke: src/debug/

## 1. Boot and flow
Entry `src/game.ts` → `<Name>GameMode` (`src/game-mode.ts`). Pawn factory → `<Pawn>`; controller factory → `<Controller>`.

| State | Enter does | Exit does | Entered from |
|---|---|---|---|
| Title | … | … | boot, Result (Menu) |
| Playing | … | … | Title (Start), Result (Retry), Paused (Resume) |
| Paused | … | … | Playing (Esc / P) |
| Result | … | … | Playing (fail or finish, after a 0.5–1.5 s beat) |

`launchRun()` resets: <every piece of run state>. Pause freezes (`setTickEnabled(false)`): <node classes>.

## 2. Engine mapping
| System | Engine class(es) | Our class / file | Skill | Why / rejected alternative |
|---|---|---|---|---|
| Hero pawn | `DefaultCharacterPawn`, `DefaultPlayerController` | `PlayerPawn` (`src/player/player-pawn.ts`) | genesys-movement | fires and interacts with no input code; GSS rejected (solo) |
| … | | | | |

## 3. Modules
| ID | Module | Owns files | Depends on | Exposes | Skills | Tier | Parallel | Status | Done when |
|---|---|---|---|---|---|---|---|---|---|
| M1 | Boot & flow | src/game.ts, src/game-mode.ts, src/contracts.ts | — | GameFacade | genesys-game-boot | parent | serial — integrator | stub | S01–S03 pass |
| M2 | Hero | src/player/* | M1 | PlayerView | genesys-movement, genesys-camera, genesys-game-feel | strong | serial — feel | stub | S04 sustained move |
| … | | | | | | | | | |

## 4. Contracts
Index of `src/contracts.ts`: each interface or delegate, who implements it, who calls it. `const.ts` sections and their owning module.

## 5. Scene plan
| Item | Authored as | Names code depends on | Collision | Instanced | Placed by |
|---|---|---|---|---|---|
| Arena | layout JSON `levels/arena.layout.json` → prefab | ArenaBounds | static, walls only | grass, fences | parent (one instantiate) |

## 6. Data and persistence
Save key, schema version, fields, defaults (`genesys-game-boot` → persistence).

## 7. Performance budget
Draw calls (instancing for repeated dressing), alive caps per enemy type, no lights on spawned nodes, shared materials, the warm-up list, weight budgets (`genesys-assets`), the phone pass.

## 8. Verification plan
| Step | Module | Asserts (sustained outcome) | Capture |
|---|---|---|---|
| S01 | M1 | Title shows; pawn spawned and framed | title |
| S02 | M1 | Start → Playing; HUD visible | — |
| S03 | M1 | Forced fail → Result within 2 s; Retry → Playing with state reset | result |
| … | | | |

## 9. Work packages
| WP | Module | Tags | Tier | Brief | Status |
|---|---|---|---|---|---|
| WP01 | M1 | [Code] | parent | — (walking skeleton) | done |
| WP04 | M5 | [Code] | mid | design/tasks/WP04-hud.md | ready |

## 10. Technical decisions
- <date> — <decision, contract change, or rejected alternative, one line>
```

## Rules per section

- **Header.** The plain summary is mandatory. It is what a creator reads.
- **§1** lists every state the GameMode has, not only the four defaults. `launchRun` and the pause list are what Retry and Pause bugs come from, so name every piece.
- **§2** has one row per system the game needs. A class name in backticks must exist in the engine (`tech-check` warns when it cannot find it). Custom code names the engine class it replaces and why.
- **§3** Owns files are comma-separated paths or globs (`src/ui/*`, `src/ui/**`). No file belongs to two modules. Tier is `parent`, `strong`, `mid` or `small`. Status is `planned → stub → in progress → done`. A row is `done` only after the parent ran its done condition.
- **§4** names the implementer and the callers of every contract item, so a worker knows who depends on it.
- **§5** prefers files over MCP: layout JSON, prefabs, Blender folders. Only the parent applies them to the editor.
- **§8** step ids are the strings used in `src/debug/` smoke steps (`tech-check` warns when an id is missing there).
- **§9** Brief is a path under `design/tasks/` (or `—` for parent work). Status is `draft → ready → in progress → review → done`. `ready` means every design question in the brief is answered.
- **§10** is append-only. A contract change always gets a line.
- Keep `GAME.md` and `TECH.md` from repeating each other. The Assets table stays in `GAME.md` (`asset-check` reads it); §5 points at Assets rows by role name.
- A resumed session reads `GAME.md`, then `TECH.md`, then the brief for the work in progress.
