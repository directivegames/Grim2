---
name: genesys-game-boot
description: "GameMode, main(), pawn and controller factories, the title/play/pause/result/retry state machine, build order, the build sequence with bundle proof, saves and src/const.ts tuning. Use when Play doesn't run new code, buildProject fails, editor_busy, the old game still plays, screens, pause or retry misbehave, or for high score, save, settings persistence, tuning constants. Not for widgets (use `genesys-ui`) or the networked match flow (use `genesys-multiplayer`)."
metadata:
  tokens: 3348
---

# Game boot

A game is one boot path the editor runs, not a pile of files. This skill owns four things:
- **what** Play loads;
- **when** each screen shows and the player has control;
- the **proof** that Play loads your code (the canonical build sequence);
- **where** tuning and saved data live.

## Use another skill when
- Building or placing a widget, a settings screen, or volume controls → `genesys-ui`.
- Networked GameMode, joins, server authority → `genesys-multiplayer`. Online, every world (clients too) creates a GameMode, so `beginPlay` and the screen mount run on each client; run state is decided on the server and each client shows screens from the replicated state.
- Pawn movement and camera → `genesys-movement`, `genesys-camera`.
- Module contracts, stubs and work packages for a larger game (`TECH.md`) → `genesys-tech-design`.
- What counts as "played", the smoke harness and Play captures → `genesys-verification`.

## Play loads the bundle

Sandbox Studio runs **`.dist/game.js`** when it exists, not `src/`. `pnpm build` typechecks only and does not refresh `.dist/game.js`.

### Canonical build sequence

Run it after changing `src/game.ts`, `main()`, the GameMode, or any `@ENGINE.GameClass()` used at runtime. Other skills link here and never restate it.

1. If a builder in `tools/models/` changed, run the GLB export first (`genesys-code-modeling`). Then `pnpm lint` (it auto-fixes) and `pnpm build`. All run in the project root.
2. `node .agents/skills/genesys-assets/scripts/asset-check.mjs --prebuild`. Every `@project/...` literal in `src/` must exist on disk, because a missing one fails `buildProject`.
3. MCP `action_build(action="buildProject")` **as its own call**, to register a new or renamed `@ENGINE.GameClass()` such as the GameMode (Play also saves and rebuilds on enter). Keep it out of the message or batch that holds `enterPlayMode` or scene mutations: a call made while the editor is busy waits up to 30 s for it, then fails with `editor_busy`. Wait for it to return.
4. **Bundle proof:** `grep -c "<YourGameMode>" .dist/game.js` is non-zero, and the template's `MyGameMode` is gone unless you kept it on purpose.
5. `query_editor(operation="getRegisteredClasses", filter="<YourGameMode>")` lists it.
6. `query_diagnostics(operation="getBuildErrors")` is empty.

Until step 4 passes, the game is not **Built**. Do not start paid generation, and do not write "playable". Enter Play in a later call, after the build returns.

### When buildProject fails

Fix the first error from `query_diagnostics(getBuildErrors)` and rerun from step 1. A missing `@project/assets/...` file: make the asset or drop the literal (step 2 names it). `editor_busy`: wait for `query_editor(getBusyState)` to clear, retry **once**, never in a loop. Bundle grep 0 or the old game plays: `defaultGameModeClass` names your class and its file is imported. Registered classes empty: add `@ENGINE.GameClass()`. A renamed class errors on the old name: rebuild (never edit `auto-imports.ts`) and fix leftover `GAME.<OldName>` nodes through MCP. Full table: [build-failures](references/build-failures.md).

## Entry point

`main()` hands the engine your GameMode. The empty template's `game.ts` has this shape. Keep it, and swap the class.

Source: empty template `src/game.ts`; `.engine/src/game/GameMode.ts` (`GameModeOptions`)
```ts
import * as ENGINE from '@gnsx/genesys.js';
import { ArenaGameMode } from './game-mode.js';

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  return new ENGINE.BaseGameLoop(container, { ...options, defaultGameModeClass: ArenaGameMode });
}
```

The scene's `gameModeClass` is usually null, so `defaultGameModeClass` wins; if the scene sets one, match it. Spawn the player through the factories, overridden on the GameMode or passed as `pawnFactory` / `playerControllerFactory` in `GameModeOptions`.

Source: `.engine/src/game/GameMode.ts` (`getPawnFactory`, `getPlayerControllerFactory`)
```ts
public override getPawnFactory(): () => Promise<ENGINE.Pawn> {
  return async () => PlayerPawn.create();
}
public override getPlayerControllerFactory(): () => Promise<ENGINE.PlayerController> {
  return async () => PlayerInputController.create();
}
```

The hero model lives on that pawn class (`genesys-assets` → *Wire it*), never on a static scene node at `PlayerStart`.

## Screen state machine

Own the flow in the GameMode with one enum and one `transitionToState`. The full pattern with code is in [screen-state](references/screen-state.md).

| State | Screens | Player and sim |
|---|---|---|
| `Title` | Title card + Start (and title art when it exists) | Pawn spawned and framed by its camera. Input ignored. Opposition idle or absent. |
| `Playing` | HUD | Control on. Gameplay nodes ticking. |
| `Paused` | Pause card + Resume (+ Restart) | Gameplay nodes stop ticking. Cursor visible. |
| `Result` | Result card (outcome, score, best) + Retry | Control off. |

Add a state only when needed (`LevelComplete` between puzzle levels, a race `Countdown`).

Rules:
- **Mount every screen in `beginPlay`, then `transitionToState(Title)`.** Show and hide happen only inside `transitionToState`. Art that is missing never delays a screen.
- **One launch path.** Start and Retry both call `launchRun()`, which resets player state, score, timer, spawners and live projectiles, then `transitionToState(Playing)`. Retry never reloads the page.
- **Keep the pawn on the title.** The engine spawns the player at startup (`handleNewPlayer` → `restartPlayer`); let it, so the camera frames the hero, and gate *control*. Destroying or unpossessing it drops Play onto the editor camera.
- **Pause.** `World.pause` and `slomo` are private console commands. Pause by `setTickEnabled(false)` on the gameplay nodes you own (pawn, enemies, spawners, projectiles) and ignoring gameplay input; physics bodies keep simulating, so a physics-heavy game also freezes them (`genesys-physics`).
- **Pause triggers.** Escape and `P` toggle `Playing` ↔ `Paused` (show both in the controls text; the smoke test presses `P`). Return true from `handleKeyDown` for Escape so the editor keeps it in the game; F8 always leaves Play. In a pointer-locked game the browser spends Escape on the lock, so also pause when `world.inputManager.isPointerLocked()` goes from true to false during `Playing` ([screen-state](references/screen-state.md#pause-input)).
- **End conditions** call `transitionToState(Result)` from one place, after a short beat (0.5–1.5 s) so the death or finish moment reads.
- **Smoke node.** Start the async `consumeSmokeFlag()` at the top of `beginPlay` (null for the creator's own Play); once it and the screens resolve, add the `SmokeTestNode`. Never in the gameplay-node list: it must tick while paused. Mount code: `genesys-verification` (`references/smoke-test.md`).

## Tuning lives in `src/const.ts`

Every tunable number lives in `src/const.ts`, grouped by system, with a one-line comment giving its unit and meaning: speeds, health, damage, spawn rates, wave growth, timers, camera distances, volumes, colours. Logic files import them and hold no tuning literals, so the creator changes the feel in one file. Structural constants (asset paths, enum values) stay where they are used.

Composed — typechecked against 18.1.0-alpha.317
```ts
// ============================================================================
// Player
// ============================================================================
export const PLAYER = {
  maxHealth: 100,          // hit points at spawn and after Retry
  walkSpeed: 5,            // m/s
  jumpHeight: 1.2,         // m at the apex
} as const;
```

## Persistence

Keep the best score and the settings (music, volumes, invert-Y) across sessions in `localStorage`: one versioned key per game, every access in try/catch, every field validated with defaults, because storage is blocked in some private windows and an old or hand-edited save must never crash the title. Load once in `beginPlay` before the title shows; write on Result and on each settings change. The module (`loadSave` / `writeSave`): [persistence](references/persistence.md). The settings screen is `genesys-ui`.

During a smoke run, resolve the smoke gate before loading, then pass `` `${SAVE_KEY}.smoke` `` while `isSmokeActive()` is true, so the test never overwrites the creator's best score.

## Build order (whole build)

Integrate before polishing, so Play never lies. Art runs **beside** this order: the first asset batch (`genesys-assets` → *Batches*) starts with step 1, since code models, synth audio and Scenario jobs need no editor or build. Wire each part as its step reaches the thing it dresses.

1. **Walking skeleton, before any feature work:** `main()`, the GameMode, the factories, all four screens, `src/const.ts`, one compiling stub module per system (`reset()`, `setActive(on)`, empty tick; with a `TECH.md`, its contracts and stubs, `genesys-tech-design`), blockouts for the pawn, an enemy and the goal, and the smoke node.
2. **Prove the skeleton.** Run the canonical build sequence and bundle proof. One smoke run shows Title → Start → Playing → `P` pause → forced Result → Retry → Playing (S01, S02, S12–S15), all with blockouts.
3. **Verb.** Movement, camera, and the main action on the spawned pawn.
4. **Loop.** Pressure, damage or failure, score or goal, the end state, and best score saved.

   **First playable.** When the loop runs end to end, build it and run one smoke run. Write it in `GAME.md` **Now**. Tell the creator in one line what they can play. Then continue with step 5. Do not polish anything before this point.
5. **Space.** The play space through MCP (`genesys-level-authoring`), plus lighting.
6. **Feedback.** VFX, sound, music, and camera reactions (`genesys-game-feel`). Nothing spawned carries a light, and the title warms up every gameplay-only model and effect (`genesys-profiler` → *Never pay per spawn*).
7. **Presentation.** Every Assets row `wired`: the hero on the pawn class, enemies on their class or prefab, props in the scene, the title framing the live scene, HUD icons, music and sounds; `asset-check.mjs` passes (`genesys-assets`).
8. **Play it.** Run the full smoke run, the Play captures, and the fresh critic (`genesys-verification`). Fix, then rebuild.

Steps 3–7 can run in parallel across disjoint files (`genesys-subagents`), and asset folders from step 1 onward. The parent owns `game.ts`, the GameMode, every editor edit, and every build.

## Wire assets to the boot path

| Asset | Attaches to |
|---|---|
| Title art | The title screen already mounted |
| Hero model | The pawn class the factory spawns |
| Enemy models | The enemy class or prefab the spawner creates |
| Play space | Scene nodes placed by MCP and re-queried |
| Music | Started on `Title`, kept or switched on `Playing` (`genesys-audio`) |

## Limitations

- Pause freezes nothing, or freezes the UI → only the GameMode tick returns early → `setTickEnabled` on every gameplay node.

## Traps

- Play shows the old game after a code change → `main()` still uses the old GameMode (Play rebuilds on enter; a failed build stops Play with "Play mode did not start" instead of running the old bundle) → check `main()`, then `query_diagnostics(getBuildErrors)` and the bundle proof (canonical build sequence).
- `buildProject` fails on a missing `@project/` file → code ahead of the art → `asset-check.mjs --prebuild` before every build.
- `editor_busy` right after `buildProject` → `enterPlayMode` was sent with it and the build outlasted the 30 s wait → a separate call after the build returns.
- The title shows an empty grid → the pawn was destroyed or unpossessed → keep it and gate control.
- Retry leaves old enemies, projectiles or score → `launchRun` does not reset everything Start resets ([screen-state](references/screen-state.md) reset checklist).
- A screen shown with no widget mounted, or a click lands before an async mount → await every `initialize()` in `beginPlay`; toggle only in `transitionToState`.
- Escape does nothing in a pointer-locked game → add the lock-release trigger.
- Features built before the skeleton runs, so the first full Play exposes broken flow late → walking skeleton first.
- Best score resets, or a corrupt save crashes the title → the guarded, versioned `loadSave`.
- The creator cannot find a speed or spawn rate → a tuning literal in a logic file → move it to `src/const.ts`.

## Done
- The canonical build sequence passes: bundle proof, the class registered, and build errors empty.
- In Play: Title → Start → Playing → `P` → Paused (gameplay frozen) → Resume → fail or finish → Result → Retry → Playing, with everything reset. Escape also pauses. `genesys-verification` scripts this check (S01, S02, S12–S15).
- The title frames the hero pawn, not the editor camera.
- The best score survives a second Play session. Every tunable is in `src/const.ts`.

## References
- [screen-state](references/screen-state.md): the full state-machine pattern with code: mount, transition, pause input, launchRun reset checklist.
- [build-failures](references/build-failures.md): the buildProject failure table.
- [persistence](references/persistence.md): the guarded, versioned save module.
