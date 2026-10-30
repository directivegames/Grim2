# Screen state pattern

This is the shape of a game's flow. It is not a template to paste whole. Rename freely, but keep the structure: one enum, one transition method, one launch method, and screens mounted before the first transition.

The engine demo `.engine/demos/examples/side-scroller-advanced/game-mode.ts` shows the same idea with `Menu | Playing | Complete`. Its `ui/` folder builds screens with raw DOM on the document. Build yours in the game's UI direction under `world.gameContainer`: a custom HUD layer, restyled engine widgets, or both (`genesys-ui`).

## Modules

Split flow from content:

| File | Owns |
|---|---|
| `game-mode.ts` | Factories, the state enum, `transitionToState`, `launchRun`, end conditions |
| `ui/screens.ts` | Mounting and showing the title, HUD, pause, and result screens (custom HUD layer or widgets). No game rules. |
| `const.ts` | Every tuning number (health, speeds, spawn rates, run length), grouped by system, one-line comment each (SKILL → *Tuning lives in `src/const.ts`*) |
| gameplay files | Pawn, enemies, combat, and spawners. They expose `reset()` and `setActive(on)`. |

## GameMode

Sources: `.engine/src/game/GameMode.ts` (`beginPlay`, `waitForLocalPlayerController`); `.engine/src/nodes/SceneNode.ts` (`setTickEnabled`); `.engine/src/systems/InputManager.ts` (`isPointerLocked`)
```ts
export enum RunState { Title, Playing, Paused, Result }

@ENGINE.GameClass()
export class ArenaGameMode extends ENGINE.GameMode {
  private state = RunState.Title;
  private screens: GameScreens | null = null;
  private wasLocked = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    if (!world) return true;
    this.screens = new GameScreens(world, {
      onStart: () => this.launchRun(),
      onResume: () => this.transitionToState(RunState.Playing),
      onRetry: () => this.launchRun(),
    });
    void this.screens.mountAll().then(() => this.transitionToState(RunState.Title));
    return true;
  }

  public launchRun(): void {
    this.resetRun();                       // health, score, timer, spawners, live projectiles
    this.transitionToState(RunState.Playing);
  }

  public transitionToState(next: RunState): void {
    this.state = next;
    const active = next === RunState.Playing;
    for (const node of this.gameplayNodes()) node.setTickEnabled(active);
    this.getPlayerPawn()?.setControlEnabled(active);   // your pawn's own flag
    this.screens?.show(next);
  }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    // Pointer-locked games: Escape releases the lock before any keydown arrives.
    const locked = this.getWorld()?.inputManager.isPointerLocked() ?? false;
    if (this.state === RunState.Playing && this.wasLocked && !locked) this.transitionToState(RunState.Paused);
    this.wasLocked = locked;
  }
}
```

`gameplayNodes()`, `getPlayerPawn()`, `setControlEnabled()`, and `resetRun()` are yours. Keep them small and explicit. The GameMode ticks during pause (it owns the pause), so gameplay must not live in its tick.

The engine spawns the player at startup through `handleNewPlayer` → `playerCanRestart` → `restartPlayer`; keep that pawn on the title and gate control instead of destroying or unpossessing it.

## Pause input

An unlocked game such as top-down, puzzle, or a UI-heavy game catches Escape in the player controller and asks the GameMode to toggle the pause.

Source: `.engine/src/systems/InputManager.ts` (`handleKeyDown`); controller key handling as in `genesys-engine` `references/input-handling.md`
```ts
public override handleKeyDown(e: KeyboardEvent): boolean {
  // Returning true keeps Escape in the game (InputManager preventDefaults it); P is the key the smoke test presses.
  if (e.code === 'Escape' || e.code === 'KeyP') { this.onPauseRequested.invoke(); return true; }
  return super.handleKeyDown(e);
}
```

A pause key is ignored outside `Playing` and `Paused`.

Triggers in detail: Escape and `P` both toggle `Playing` ↔ `Paused`; show both in the controls text. When the controller's `handleKeyDown` returns true for Escape, `InputManager` calls `preventDefault`, and the editor keeps Escape in the game. Escape leaves Play only when the game did not consume it and pointer lock is off. F8 always leaves Play. The smoke test presses `P`. In a pointer-locked game, the browser spends Escape on releasing the lock, so also pause when `world.inputManager.isPointerLocked()` goes from true to false during `Playing`.

## Screens module

Mount every screen once, await each `initialize()`, place it with `setPosition`, then hide it. `show(state)` is the only visibility switch. Widget options and anchors come from `genesys-ui`.

Source: `node_modules/@gnsx/genesys.js/dist/src/ui/components/` (`Card`, `Button`, `ProgressBar`, `NumberDisplay`; `BaseUIComponent.setPosition`, `show`, `hide`)
```ts
public async mountAll(): Promise<void> {
  const ui = this.world.uiManager;
  this.title = new ENGINE.Card(ui, { title: GAME_TITLE, subtitle: TAGLINE, body: CONTROLS_TEXT });
  await this.title.initialize();
  this.title.setPosition(ANCHOR.center);
  this.start = new ENGINE.Button(ui, { label: 'Start', variant: 'primary', onClick: this.cb.onStart });
  await this.start.initialize();
  this.start.setPosition(ANCHOR.bottomCenter);
  // …HUD, pause card + Resume, result card + Retry, same pattern
  this.hideAll();
}

public show(state: RunState): void {
  this.hideAll();
  if (state === RunState.Title) { this.title?.show(); this.start?.show(); this.titleArt?.show(); }
  if (state === RunState.Playing) { this.hud.forEach(w => w.show()); }
  if (state === RunState.Paused)  { this.pause?.show(); this.resume?.show(); }
  if (state === RunState.Result)  { this.result?.show(); this.retry?.show(); }
}
```

The result card shows the outcome, the score, and the best score; the best score is saved across sessions with the guarded `loadSave` / `writeSave` (SKILL → *Persistence*). Update text through setters (`setTitle`, `setBody`, `setLabel`), never through HTML (`genesys-ui` Safe UI).

## Title art

When an image exists under `assets/`, show it behind the title card (`genesys-ui`, "Title art"). Without one, the title is still complete. Mount the shell first and add the art later.

## Reset checklist for `launchRun`

- Player health or lives, position at the spawn point, velocity, and status effects. With `CharacterStatsNode`, call `revive()`. The player's stats subclass overrides `handleDeath` so the pawn is never destroyed (`genesys-combat`).
- Score, timer, wave or level index, and combo.
- Spawners back to wave 1. Live enemies, projectiles, pickups, and effects destroyed or returned to their pools.
- The HUD refreshed to the reset values.
- Music switched to the gameplay track if the title used a different one.
