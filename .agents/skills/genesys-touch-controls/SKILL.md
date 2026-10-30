---
name: genesys-touch-controls
description: "Phone and tablet play: the engine's virtual joysticks, hold-to-act touch buttons (jump, fire, dash, throttle), a tappable pause, the twin-stick aim stick, per-genre touch layouts, stick sensitivity, and testing touch on desktop. Default on every whole build. Use when the user says mobile, phone, tablet, iPad, touch, on-screen controls, virtual joystick, thumbstick, or 'can I play this on my phone'. Not for mouse aim or look sensitivity (use `genesys-camera`) or widget styling (use `genesys-ui`)."
metadata:
  tokens: 3229
---

# Touch controls

This skill owns when the engine's two virtual sticks exist, which stick does what for each kind of game, which actions become on-screen buttons, and how those buttons hold. The rule: **configure the engine sticks through `virtualJoystickOptions` and build buttons from the engine `Button` with pointer events; do not add a touch library or a hand-built stick.**

## Use another skill when
- The button widget's look, theme, Safe UI → `genesys-ui`
- Desktop look, cursor, pointer lock, mouse sensitivity → `genesys-camera`
- The stick moves the pawn the wrong way, or movement speed → `genesys-movement`
- Where `main()` and game-loop options live, showing/hiding per screen, bundle proof → `genesys-game-boot`
- Phone frame rate → `genesys-profiler`

## Default: touch on every whole build

Links get opened on phones. On a whole build, wire touch for the main verbs plus a tappable pause whenever a layout row below fits; otherwise write one line in `GAME.md` saying why touch is skipped (e.g. "keyboard-only typing game"). A focused fix touches touch only when it is the subject.

- Create the buttons always; show them only on a touch device (`ENGINE.isMobileBrowser()`, or a `FORCE_TOUCH` const for desktop testing).
- Touch adds to keyboard, mouse and gamepad; it never replaces them.
- `touch-action: none` on every button; mount under `world.uiManager` (it lives in `world.gameContainer`), never `document.body`.
- Hide sticks and buttons on title, pause and result screens; show them on Start and Resume (`genesys-game-boot`).
- Layout polish and real-phone testing are the creator's call; ask only if they raise it.

## What the engine ships

Two sticks, `left` and `right`, created by `InputManager` inside the game container (lazy-loads `nipplejs`). Options are `VirtualJoystickOptions` on `BaseGameLoopOptions.virtualJoystickOptions`. There is no action-button option; a button is an engine `Button` widget, and `Button` fires `onClick` on release (`click`), so hold actions need pointer events (Build).

| Setting | Values | Default |
|---|---|---|
| `enabled` | `'auto'` / `true` / `false` | `'auto'`: mobile user agent or `'ontouchstart' in window`, or `?debugTouchInput=1` on the page URL (Mobile Preview adds it) |
| `mode` | `'static'` (fixed), `'dynamic'` (spawns at the touch, gone on release), `'semi'` (recycled within `catchDistance`) | `'static'` |
| `size`, `opacity`, `color` | px, 0–1, CSS color | 120, 0.7, `'white'` |
| `fadeTime`, `threshold`, `catchDistance` | ms, 0–1, px | 250, 0.1, 200 |
| `left` / `right` | per-stick overrides (same fields plus `zone`, `position`), or `false` to remove | bottom-left / bottom-right, 20 px from the edges |

Default mapping: `DefaultPlayerController` and `GSSPlayerController` read the left stick as move and the right stick as look.

**Testing on desktop.** Play in Mobile Preview: it emulates a phone and adds `?debugTouchInput=1` to the Play URL, so `'auto'` sticks appear. Touch buttons follow your own show check, so verify them there too. In plain desktop Play, use a `FORCE_TOUCH` const in `src/const.ts` that sets `enabled: true` and shows the buttons, and set it back to `false` before shipping. `VITE_DEBUG_TOUCH_INPUT` in a project `.env` never reaches the engine.

## Decide

| Game type | Left stick | Right stick | On-screen buttons |
|---|---|---|---|
| Third-person action / adventure | Move, `static` | Look, `dynamic` over the right half | Jump 88 px, attack/fire 88 px, dash 64 px, bottom-right above the look zone |
| First-person shooter | Move, `static` | Look, `semi` over the right half | Fire 88 px (hold), jump 64 px, reload 64 px |
| Platformer / side-scroller | Move, `static` | `false` | Jump 88 px (hold, for variable height), one action 64 px |
| Top-down / twin-stick shooter | Move, `static` | **Aim + fire**, `static` (override, [virtual-joysticks](references/virtual-joysticks.md)) | Ability or bomb 64 px |
| Top-down with auto-aim or tap targets | Move, `static` | `false` | Primary action 88 px |
| Racing / driving | Steer + throttle, `static` | `false` | Brake/handbrake (pawn `jump()`), boost |
| Arcade flight | Pitch + bank, `static` | `false` | Throttle up / down (hold), `genesys-movement` bindings |
| Endless runner, auto-move | `false` | `false` | Jump and slide, or left/right halves as buttons |
| RTS / map pan (`TopDownMovementNode`) | Pan, `static` | `false` | Context actions |
| Puzzle, card, board, point-and-tap | `enabled: false` | — | Tap targets ≥ 44 px; no extra widgets |

Every layout gets a pause button: 64 px, top-right, 16 px from the edges. Layout numbers: buttons at least 64 px (primary 88 px), 16–24 px from the screen edge, never over the center third where the player pawn is. Sticks stay in their corners; a stick that covers the player pawn is a defect. Phone aim is the right stick; set `noPointerLock: true` when the stick is the only look control (`genesys-camera`).

## Build

Sticks in `main()`:

Source: .engine/src/systems/InputManager.ts (`VirtualJoystickOptions`), .engine/src/game/GameLoop.ts (`BaseGameLoopOptions`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  return new ENGINE.BaseGameLoop(container, {
    ...options,
    defaultGameModeClass: MyGameMode,
    virtualJoystickOptions: {
      enabled: FORCE_TOUCH ? true : 'auto', // desktop editor Play: flip FORCE_TOUCH in src/const.ts
      right: { mode: 'dynamic', fadeTime: 250, zone: { top: 0, right: 0, bottom: 0, left: '50%' } },
    },
  });
}
```

Platformer: `virtualJoystickOptions: { right: false }`. No movement at all: `{ enabled: false }`.

**Hold button.** Engine `Button` placed with `setPosition`, plus pointer events on its element: press on `pointerdown`, release on `pointerup`, `pointercancel` or lost capture, so a finger that slides off still releases.

Source: .engine/src/ui/components/Button.ts, BaseUIComponent.ts (`initialize`, `setPosition`, `getElement`), .engine/src/utils/Utils.ts (`isMobileBrowser`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export const FORCE_TOUCH = false; // src/const.ts: true to test touch UI on desktop

/** Engine Button with hold state: press on pointerdown, release on pointerup/cancel. Hidden unless touch. */
export async function holdButton(
  world: ENGINE.World, label: string, sizePx: number, place: Record<string, string>,
  onPress: () => void, onRelease: () => void = () => {},
): Promise<ENGINE.Button> {
  const button = new ENGINE.Button(world.uiManager, { ...ENGINE.Button.presets.secondaryLarge, label });
  await button.initialize();
  button.setPosition({ position: 'absolute', ...place });
  button.setPosition({ width: `${sizePx}px`, height: `${sizePx}px`, 'border-radius': '50%' }, '.ui-button');
  const el = button.getElement()?.element;
  if (el) {
    el.style.touchAction = 'none'; // no scroll, zoom or synthetic mouse events
    let held = false;
    const release = (): void => { if (held) { held = false; onRelease(); } };
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      el.setPointerCapture(e.pointerId); // finger may slide off and still release here
      if (!held) { held = true; onPress(); }
    });
    el.addEventListener('pointerup', release);
    el.addEventListener('pointercancel', release);
    el.addEventListener('lostpointercapture', release);
  }
  if (!(FORCE_TOUCH || ENGINE.isMobileBrowser())) button.hide();
  return button;
}
```

Wiring for both stacks ([touch-buttons](references/touch-buttons.md)):
- Classic (`DefaultCharacterPawn`): Jump → `pawn.jump()` / `pawn.stopJump()`; Fire → `pawn.fire()` / `pawn.endFire()` behind `ENGINE.isCombatPawn(pawn)`; the same calls the controller makes for Space and LMB.
- GSS: a `GSSPlayerController` subclass keeps `touchJump` / `touchDash` flags that the buttons set, and adds the tags in `produceInputCmd`. GSS has no fire path; its fire wiring is in `genesys-combat`.
- Pause → the GameMode's pause function (`genesys-game-boot`), which also hides sticks and buttons.

Sensitivity is static per controller class; GSS pawns read the GSS settings:

Source: .engine/src/entities/DefaultPlayerController.ts, .engine/src/gameplay-sim/entities/GSSPlayerController.ts (`inputSettings`)
```ts
ENGINE.DefaultPlayerController.inputSettings.joystickMovementSensitivity = 0.03; // default; full speed at ~33 px of stick travel
ENGINE.DefaultPlayerController.inputSettings.joystickLookSensitivity = 0.6;      // default
ENGINE.GSSPlayerController.inputSettings.joystickMovementSensitivity = 0.03;     // GSS pawns read these two
ENGINE.GSSPlayerController.inputSettings.joystickLookSensitivity = 0.6;
```

Runtime: `world.inputManager.showVirtualJoystick()` / `hideVirtualJoystick()` / `isVirtualJoystickVisible()` / `isVirtualJoystickEnabled()`.

Twin-stick aim or any non-look right stick: override `handleVirtualJoystick(index, data)` on your `DefaultPlayerController` / `GSSPlayerController` subclass, handle `VirtualJoystickIndex.Right` yourself, and call `super` for the left stick ([virtual-joysticks](references/virtual-joysticks.md) has the aim-and-fire controller). A direct `PlayerController` subclass implements `handleVirtualJoystick` from `IInputHandler`.

## Limitations

- Touch jump fires on lift-off, fire never auto-repeats, variable jump is always full height → `Button.onClick` is a release `click` → `holdButton` with pointer events.
- Jump has no touch control in a platformer → add a hold button; the engine ships none.

## Traps

- Sticks never appear on a phone → `enabled: false`, or no game container → leave `'auto'` and pass options through the game loop.
- Sticks appear on a touch-screen laptop → `'auto'` treats any touch-capable browser as mobile → acceptable; set `enabled: false` only for touch-free games.
- `VITE_DEBUG_TOUCH_INPUT=true` in `.env` shows nothing in editor Play → a project `.env` never reaches the engine → Play in Mobile Preview, or `FORCE_TOUCH` + `enabled: true`.
- Finger slides off a held button and the action never stops → only `pointerup` was handled → also `pointercancel` and `lostpointercapture`, with pointer capture.
- Holding a button scrolls, zooms or selects the page → no `touch-action: none` on the element.
- Buttons sit outside the game view or above the pause card → appended to `document.body` → `new ENGINE.Button(world.uiManager, …)` and `hide()` with the sticks.
- Right stick spins a top-down or side view → default handler maps it to look yaw → `right: false`, or override `handleVirtualJoystick` for aim.
- Stick pushed right moves the pawn screen-left → camera or mesh orientation → fix per `genesys-movement`, never by inverting the stick.
- Tuning `DefaultPlayerController.inputSettings` changes nothing on a GSS pawn → GSS reads `GSSPlayerController.inputSettings`.
- Sticks or buttons stay over the title or pause card → hide them in the screen state machine.
- No way to pause on a phone → Escape and P do not exist there → a 64 px pause button on every layout.
- A dead right stick left on screen → set `right: false` instead of leaving it unbound.

## Done
- `GAME.md` names the touch layout row used, or one line saying why touch is skipped.
- With `FORCE_TOUCH` (or a phone-sized emulated session), the move stick walks the pawn the same directions as W/A/S/D; the look or aim stick turns the same way as the mouse, both axes.
- Every main verb is reachable by touch; hold buttons act on touch start and stop on lift (jump height varies with hold time where the design has variable jump).
- Pause is tappable and the result screen's Retry works by tap.
- No stick or button covers the player pawn or HUD readouts; all hide on non-play screens.
- Desktop mouse, keyboard and gamepad still work; `FORCE_TOUCH` is `false` in the shipped build.
- Evidence per `genesys-verification`.

## References
- [touch-buttons](references/touch-buttons.md) — wiring hold buttons to classic and GSS pawns, pause, sizes and placement per layout
- [virtual-joysticks](references/virtual-joysticks.md) — every stick option, zones, modes, recipes, the twin-stick aim-and-fire override, CSS hook
