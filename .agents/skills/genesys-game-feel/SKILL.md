---
name: genesys-game-feel
description: "Make a working game feel good: input response, impact layering, shake, hit flash, hitstop, juice, pacing, difficulty, near-misses, fast retry. Use when it feels flat, floaty, unresponsive, boring, unfair, too hard, or for polish, impact, juice, screen shake, satisfying hits or pickups. Not for new movement mechanics (use `genesys-movement`), camera rigs or FOV kick (use `genesys-camera`), or particle and sound APIs (use `genesys-vfx`, `genesys-audio`)."
metadata:
  tokens: 2632
---

# Game feel

"It runs" and "it feels like a game" are separate checks. This skill turns the first into the second with numbers, not adjectives. It tunes existing systems and never adds a parallel controller, camera rig, or effect system. It owns three small runtime tools the engine lacks: screen shake, hit flash, and hitstop (Build).

## Use another skill when
- The verb does not exist yet → build it first (`genesys-movement`, `genesys-combat`).
- Movement numbers (acceleration, deceleration, jump) → `genesys-movement` owns the fields. This skill picks the targets.
- Coyote time, jump buffer, variable jump, fast fall, knockback → `genesys-movement` owns the recipes (both stacks).
- Camera layout, spring arm, lookahead offset, FOV kick on boost or aim → `genesys-camera`.
- Where tuning constants live (`src/const.ts`) and how retry resets the run → `genesys-game-boot`.
- Damage numbers, cooldown meters, disabled-button states → `genesys-ui`.
- Particle API → `genesys-vfx`. Sound API → `genesys-audio`. Widget API → `genesys-ui`.

## Loop test first

Before tuning a single number, the game must have all five parts. Fix any missing part first.

1. **Verb.** The player does something every few seconds.
2. **Pressure.** Something can make them fail or lose time.
3. **Goal.** Something to reach, survive, collect, or beat.
4. **Feedback.** The player knows instantly whether they succeeded or failed.
5. **Fail and retry.** A run ends and restarts in one action (`genesys-game-boot`).

## Defaults

Start from these, and change a number only with a reason.

| Area | Default |
|---|---|
| **Input response** | Act in the handler that receives the input, on that frame. Animation follows the action and never gates it. When the player presses an action that is blocked (on cooldown, out of ammo, locked), respond on that same frame: a click sound plus a flash on the cooldown meter or a one-word toast. |
| **Movement** | Deceleration ≥ acceleration feel: stops are crisp, not slides. Reach top speed in 0.1–0.25 s on foot. Turn in under 0.15 s for arcade games. |
| **Jump** | Coyote time ~100 ms, jump buffer ~100 ms, variable height (release early = lower), fall 1.5–2× faster than rise. The engine gives coyote time on classic `CharacterMovementNode` only; the rest are `genesys-movement` recipes. |
| **Hitstop** | 40–60 ms on a melee hit or a kill. 80–120 ms on a boss hit or the player's death. Over 100 ms on ordinary hits reads as lag. Local only. |
| **Camera shake** | Only with a cause, never ambient. 0.1–0.2 s, decaying (trauma²). Trauma 0.3 hit taken, 0.6 explosion, 1.0 player death. Never on every shot of rapid fire. |
| **Hit flash** | The struck model scales 1.0 → 1.15 → 1.0 over 120 ms, or flashes white for 120 ms on its own material clone. On a code model, swap in its shared flash material instead (`genesys-code-modeling`). |
| **Camera lookahead** | Lead the view toward travel: 10–20 % of the screen in the move direction, eased over 0.3–0.5 s (`genesys-camera` sets the offset). Side-scrollers and racers most. |
| **FOV kick** | +8–12° on boost or sprint, eased in 0.2 s and out 0.4 s (`genesys-camera`). |
| **Knockback** | Small, in the hit direction (`genesys-movement` recipe). Enemies yes; the player only when it reads as fair. |
| **Invulnerability** | 0.5–1.0 s after the player is hit, shown by blinking. |
| **Projectiles** | Visible for their whole flight, faster than the player can dodge only when telegraphed. Muzzle on fire, impact on hit. |
| **Pickups** | Magnet within 2 m, a pop on collect, a rising pitch for combos. |
| **Score** | Numbers tick up rather than jump. A "+N" pops at the event and fades within ~0.6 s. |
| **Pacing** | First meaningful action within 3 s of Start. Something new (enemy type, speed, layout) every 30–45 s. A target run of 2–5 min for arcade games. |
| **Difficulty** | Ramp one variable at a time (count, speed, aggression). Rest beats between waves. The player's first death should come from a threat they saw. |
| **Near-misses** | Reward the close call: a dodge within 0.5 m of a projectile, a hazard cleared by a hair, a 1-HP survival gets a small sound, a "+N close!" pop, or a score bonus. |
| **Tuning** | Every feel number is a named constant in `src/const.ts` with a one-line comment, never a literal in logic (`genesys-game-boot`). Tune live: change one constant, rebuild, play 30 s, keep or revert. |
| **Death** | A 0.5–1.5 s beat (slow fade, explosion, sound) before the result screen. The result shows what ended the run and the score. |
| **Retry** | One click or key back into play. No reload, no long intro. |
| **UI response** | Every button press plays a sound. Hover state visible. A disabled action (cooldown, empty) shows why. |

## Layer every moment

A moment the player must notice gets **at least two channels**, fired from one gameplay call site at the same time. Cap it too: **small events get one layer; only the biggest get three.** When every moment is loud, none stands out: if every coin shakes the screen, the boss kill can't land. Rank the game's moments and spend shake, hitstop and FOV only on the top two or three.

| Moment | Channels |
|---|---|
| Main action (fire, swing, jump) | Sound + visual (muzzle, trail, dust) |
| Hit landed | Impact VFX + sound + hit flash (+ hitstop or shake for big hits) |
| Player hurt | Sound + HUD health change + screen-edge flash or camera kick + invulnerability blink |
| Kill or destroy | Death VFX + sound + score pop |
| Pickup | Sound + pop VFX + HUD tick |
| Run end | Music change or sting + slow beat + result card |

The effects come from `genesys-vfx` and the sounds from `genesys-audio`. Camera reactions use `CameraShakeNode` (*Build*) on the existing rig; FOV kick is `genesys-camera`.

## Build

The three tools the engine lacks, with full code in [feel-tools](references/feel-tools.md):

- **Screen shake** — a `CameraShakeNode` added once at Play start; gameplay calls `addTrauma(0.3 | 0.6 | 1.0)`. It writes decaying trauma² noise to the active camera's **local** position and rotation, which every engine rig leaves alone (rigs move the camera's parent), so it rides on top of any rig and restores the rest pose when trauma reaches 0.
- **Hit flash and scale pop** — flash only a material this instance owns: `ModelMeshNode` shares the GLB's materials, so create the model with `useDynamicMaterials: true` and set its emissive white for ~120 ms. Scale pop (1 → 1.15 → 1 through `world.tweenManager`) needs no material and is the default for crowds of 10+, since per-instance materials break batching (`genesys-profiler`). Pop the visual child, never a physics root (it rescales the collider), and restore the pose in `onComplete`.
- **Hitstop** — `World.pause` and `slomo` are private console commands. Freeze only attacker and victim: `setTickEnabled(false)` on each root, its `BasePawnMovementNode` and `AnimationStateMachineNode` (the mixer advances only in `tickPostPhysics`), then re-enable after 40–60 ms with `world.timerSystem.setTimeout`. Projectiles, particles, other enemies and music keep running, which reads as impact, not lag. On a GSS pawn the sim keeps stepping; online it is visual and local only (`genesys-multiplayer`).

## Limitations

- **Shake fights the camera or leaves it offset.** Rig code writes the camera's own transform each frame (custom rigs, and `OrbitCameraNode`, which sets the camera's world pose and `lookAt` every tick) → move the rig's parent node instead, so the shake owns the camera's local pose.

## Traps

- **Input lag.** The action waits for an animation clip or the next state check. Act in the input handler.
- **Floaty stop.** Deceleration is too low. Raise it (`genesys-movement`).
- **Silent action.** Any main action, hit, button, or death with no sound reads as broken.
- **Effect with no cause, or cause with no effect.** Shake with no hit, or a hit with no reaction.
- **Over-juiced.** Every small event shakes, flashes and stops time, so nothing stands out. Cut back to one layer for small events.
- **Every enemy flashes at once.** The flash wrote a shared material → `useDynamicMaterials: true` on that model, or use scale pop.
- **Hitstop feels like lag.** Over 100 ms on ordinary hits, or the whole world froze → 40–60 ms, attacker and victim only.
- **Silent refusal.** Pressing fire on cooldown does nothing visible → instant click sound plus meter flash.
- **Unfair death.** Killed by something off-screen or untelegraphed. Fix the camera framing (`genesys-camera`) or add a warning.
- **Wall of difficulty.** The first 30 s are as hard as minute three. Ramp it.
- **Dead air.** No music, or more than 5 s with nothing to do at the start.
- **Slow retry.** More than one action, or more than ~1.5 s, from result to play.

## Done

Play one full run (`genesys-verification`):
- The verb fires on the frame of the input.
- Every row of "Layer every moment" that the game has shows two or more channels, and only the top two or three moments use shake or hitstop.
- A big hit shakes the camera for under 0.2 s and the camera returns exactly to its rest pose; a hit enemy pops or flashes alone, not its neighbours; hitstop holds attacker and victim ~50 ms while projectiles keep flying.
- Music plays from the title onward.
- Difficulty visibly rises within the first minute.
- Death reads and lands on the result screen; Retry is instant.

Then stop tuning and report the numbers you chose in `GAME.md` Design → Pacing; the same numbers live in `src/const.ts`.

## References
- [feel-tools](references/feel-tools.md) — `CameraShakeNode`, `hitFlash` / `scalePop`, `hitstop`: full code and the engine facts behind each
