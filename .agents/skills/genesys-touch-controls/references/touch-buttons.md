# Touch buttons

The engine ships sticks but no action buttons. A touch button is an engine `Button`
(`genesys-ui` owns its look) plus pointer events for hold state; `holdButton` is in `SKILL.md`.
`Button.onClick` listens for `click`, which fires on release, so it suits only tap actions
(pause, menu). Anything held — jump with variable height, auto-fire, throttle, sprint — uses
`pointerdown` / `pointerup` / `pointercancel`.

## Sizes and placement

| Button | Size | Place (from the corner) |
|---|---|---|
| Primary (jump in a platformer, fire in a shooter) | 88 px | right 24 px, bottom 170 px (above a right stick) or bottom 24 px when there is no right stick |
| Secondary (dash, reload, ability) | 64 px | 104 px left of the primary, same baseline |
| Pause | 64 px | top 16 px, right 16 px |
| Throttle up / down (flight) | 64 px each | stacked, right 24 px, bottom 24 / 100 px |

Keep 16–24 px from the edges and out of the center third. The UI container (`#ui-container`,
`z-index` 1000) sits above the stick zones, so a button inside the dynamic right-stick zone gets the
touch rather than spawning a stick (verify in Play).

## Classic pawn (`DefaultCharacterPawn`)

The buttons call the same pawn methods the controller calls for Space and LMB.

Source: .engine/src/entities/DefaultPlayerController.ts (jump and fire paths), .engine/src/entities/PawnActions.ts (`isCombatPawn`), .engine/src/entities/MovementPawn.ts (`jump`, `stopJump`) (composed — typechecked against 18.1.0-alpha.317)
```ts
/** Main verbs + pause for a classic (DefaultCharacterPawn) hero. Call once after the HUD is built. */
export async function buildTouchControls(world: ENGINE.World, controller: ENGINE.PlayerController, onPause: () => void): Promise<ENGINE.Button[]> {
  const pawn = (): ENGINE.Pawn | null => controller.getPawn();
  const jump = await holdButton(world, 'Jump', 88, { right: '24px', bottom: '170px' },
    () => { const p = pawn(); if (p instanceof ENGINE.MovementPawn) p.jump(); },
    () => { const p = pawn(); if (p instanceof ENGINE.MovementPawn) p.stopJump(); });
  const fire = await holdButton(world, 'Fire', 88, { right: '128px', bottom: '96px' },
    () => { const p = pawn(); if (ENGINE.isCombatPawn(p)) p.fire(); },
    () => { const p = pawn(); if (ENGINE.isCombatPawn(p)) p.endFire(); });
  const pause = await holdButton(world, 'II', 64, { right: '16px', top: '16px' }, onPause);
  return [jump, fire, pause]; // hide() these with the sticks on title, pause and result screens
}
```

Resolve the pawn on every press (`controller.getPawn()`), since Retry spawns a new one. Calling
`pawn.jump()` directly is what `DefaultPlayerController` does offline; on a predicted online client
the controller routes jump through `movementNode.setJumpEdges()` instead, so an online classic game
needs a controller subclass that sets those edges (verify in Play with two clients). `stopJump()`
only changes height on a node that implements it (`PlatformerMovementNode` in `genesys-movement`).

## GSS pawn

The sim reads input only from its producer, so buttons set flags on a `GSSPlayerController`
subclass and the producer reports them as currently-down tags. Prediction and edge detection then
work exactly as for keys.

Source: .engine/src/gameplay-sim/entities/GSSPlayerController.ts (`produceInputCmd`), .engine/src/gameplay-sim/GSSTagSet.ts (`tagSetAdd`) (composed — typechecked against 18.1.0-alpha.317)
```ts
/** GSS: touch buttons set held flags; the producer reports them as currently-down tags. */
@ENGINE.GameClass()
export class TouchGSSController extends ENGINE.GSSPlayerController {
  public touchJump = false; // holdButton(..., () => c.touchJump = true, () => c.touchJump = false)
  public touchDash = false;
  public override produceInputCmd(cmd: ENGINE.GSSInputCmd, dt: number): void {
    super.produceInputCmd(cmd, dt);
    if (this.touchJump) ENGINE.tagSetAdd(cmd.inputTagsDown, ENGINE.GSSTags.InputJump);
    if (this.touchDash) ENGINE.tagSetAdd(cmd.inputTagsDown, ENGINE.GSSTags.InputDash);
  }
}
```

A custom GSS verb (sprint, fire) is a registered tag added the same way (`genesys-movement`
gss-abilities-effects); GSS fire wiring is `genesys-combat`.

## Pause and screens

The pause button calls the GameMode's pause transition (`genesys-game-boot`); that transition hides
the sticks (`world.inputManager.hideVirtualJoystick()`) and every touch button (`button.hide()`),
and Resume shows them again — only when they were shown at start (touch device or `FORCE_TOUCH`).
Title Start and result Retry are ordinary `Button`s with `onClick`; a tap fires `click`.
