# Screens and HUD plan

The short rules are in [SKILL.md → Decide](../SKILL.md#decide). This file holds the element inventory, the HUD hierarchy, and the screens each game type needs.

## Element inventory first

Before building, walk the loop in order (title → start → spawn → main action → pickup → take damage → death → retry → win or result) and list every element the player sees: meters, counters, prompts, reticle states, toasts, damage numbers, banners. Write the list under the `GAME.md` design. That list is the authority: build every element on it, and cut any element with no mechanic behind it.

## HUD hierarchy

Rank what the player needs: **survival** (health, lives, fuel) > **objective** (score, wave, lap, timer, keys) > **moment** (hit marker, pickup pop, banner, under 1 s) > **flavour** (combo text, kill feed). Choose the two or three values the player checks most and put them in the corners. Survival gets `top-left`; objective gets `top-right` or `top-center`; moments play near the centre and leave; flavour is optional. A fourth permanent number needs a reason.

## Which screens

A new game mounts title, HUD, pause, and result before any title art exists. A focused edit adds a screen only when the edit touches that loop.

| Game type | Title | HUD (anchor) | Pause | End screen | Extra |
|---|---|---|---|---|---|
| Score-attack (arcade shooter, runner) | Card + Start | Health or lives `top-left`, score `top-right` | Card + Resume | Result Card: score, best, Retry | — |
| Level-based (platformer, adventure) | Card + Start | Lives `top-left`, collectibles `top-right` | Card + Resume + Restart level | Level-complete Card + Next; fail Card + Retry | `CenterMessage` level name on start, `duration: 1500` |
| Endless / survival / waves | Card + Start | Health `top-left`, score `top-right`, wave or time `top-center` | Card + Resume | Result Card: time or wave reached, best, Retry | `CenterMessage` per wave |
| Sandbox / no-fail | Card + Start | Objective or collect counter `top-right`, or none | Card + Resume + `ControlsPanel` | None. Milestones use `Achievement` toasts | — |
| Racing (laps / timer) | Card + Start | Lap `top-left`, race time `top-center`, place `top-right` | Card + Resume + Restart | Result Card: finish time, best lap, Retry | 3-2-1 countdown with `CenterMessage` |
| Puzzle | Card + Start | Level `top-left`, moves or time `top-right` | Card + Resume + Restart level | Solved Card + Next; Retry only if timed | — |

The table names engine widgets. A custom HUD layer builds the same screens and anchors in its own style.

- **Settings.** A game with sound ships Music and Effects volume controls on pause (and a Settings button on the title): a range per bus wired to `getBus('Music')` / `getBus('SFX')`, saved across sessions. No slider widget exists; the recipe is in [settings-and-style](settings-and-style.md).
- **Loading.** The title is the loader. Add a loading Card + `ProgressBar` only when the first frame waits more than about 1 s on assets.
- **Flow.** Start and Retry call the same launch method. Pause is a `GameMode` state, not `World.pause` (a private console command). Menus need a free cursor (`PlayerController` `noPointerLock`). All three are built in `genesys-game-boot`.
- **Aim.** `Crosshair` only with locked aim. When the cursor aims (`noPointerLock` true), the cursor is the reticle (`genesys-camera`).

## Title composition

Pick it on purpose: **centred card** (puzzle, arcade, party, no title art), **left rail** (adventure, RPG, shooter with art whose subject sits right), **bottom bar** (racer, sports, platformer with a wide hero shot), **corner** (horror, cozy, atmospheric: the scene is the picture). Exact anchors: [settings-and-style → Title composition](settings-and-style.md#title-composition); title art: [placement](placement.md#title-art-behind-the-shell).
