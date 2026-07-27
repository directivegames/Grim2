# combo-attack — Rationale

## Why a state machine

A flat boolean `isAttacking` breaks immediately once you add hold-to-chain and click-buffering. The four-phase machine (`idle → windup → swing → recovery`) makes these cases explicit:

- Windup is a distinct state so the player sees the anticipation frame before commitment.
- Recovery creates a small gap between combo hits so each beat reads individually.
- Buffered input (`_queuedMelee`) is only consumed at the idle→windup transition, so fast clicking never skips ahead by more than one hit.

## Why callbacks not subclassing

The state machine fires callbacks rather than using virtual methods. This keeps the timing logic in one file and lets you compose it inside any actor class without deep inheritance chains. The weapon mesh, slash trails, audio, and screen shake all live in your actor; the combo only manages time and state.

## Why arc math in orbit space

The orbital coordinate system (angle maps to a circle around the player) decouples "where is the weapon relative to the player" from "which direction is the player facing." The aim angle from the mouse is converted once at swing start, freezing the arc. This means the player can move the mouse mid-swing without the arc shifting — which would feel wrong.

## Tuning notes

`ATTACK_DURATIONS` controls how long each swing takes. Shorter durations feel snappier but make it harder to see the arc. `WIND_UP_DURATION` is intentionally short (0.04 s) — it exists to separate the moment of input from the moment damage is possible, making the game feel responsive rather than laggy. `RECOVERY_DURATION` (0.05 s) is long enough to block a new swing but short enough to feel instant.

The `heavySwingProgress` easing function was tuned for 0.2 s swings. For longer swings (RPG-style), switch to `Math.pow(t, 0.5)` for a faster start.

## Combining with ability-key-binding

The combo normally lives inside a larger actor that also manages other abilities (projectile, special moves). The `ability-key-binding` skill documents how to implement the `IInputHandler` and wire `onMouseDown` into the combo alongside other input handlers.
