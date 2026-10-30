---
name: genesys-ui
description: "All game UI, designed per game: the UI direction (fonts, shape language, signature element), a custom DOM/SVG HUD layer or styled engine widgets, placement, title/HUD/pause/result/settings screens, world-space UI, Safe UI. Use for any HUD, menu, button, bar, score, timer, minimap, inventory, dialog, settings, volume slider, nameplate, health bar, damage number, font, UI style. Not for the screen state machine (use `genesys-game-boot`) or touch sticks and buttons (use `genesys-touch-controls`)."
metadata:
  tokens: 3255
---

# Genesys UI

This skill owns game UI: the UI direction, the custom HUD layer, the widget catalog, placement, the screens a game needs, settings, world-space UI, fonts, and Safe UI. The most important rule: **every game's UI is designed for that game.** Two games with different art directions never share a HUD look; the default widget look (rounded translucent cards, system fonts) is a starting kit, not a finished design.

Build with a **custom HUD layer** (DOM and inline SVG under `world.gameContainer`, styled from the UI direction: [custom-hud](references/custom-hud.md)), **engine widgets restyled** (`new ENGINE.<Class>(world.uiManager, options)` → `await initialize()` → `setPosition`; never `.create()`, and the `position` option does not move them), or both.

## Use another skill when
- Showing and hiding screens, Start/Retry launching a run, pause state, pawn control on menus, persisting best score and settings → `genesys-game-boot`
- A hit flash, screen shake or "+1" pop as feel → `genesys-game-feel` (the floating damage number itself is here)
- The click and confirm sounds, music under the title, bus volumes → `genesys-audio`
- Title art, menu backdrop, icons, fonts as asset rows → `genesys-assets`; images under `assets/ui/` breaking after a build (KTX2) → `genesys-asset-compiler`
- Player names, chat, scoreboards from the network → `genesys-multiplayer` (`references/ui-security.md`, `references/player-list-safe.md`)
- On-screen sticks and touch buttons → `genesys-touch-controls`; pointer lock, cursor-as-reticle → `genesys-camera`
- Driving the HUD in the smoke test, Play captures → `genesys-verification`

## Decide

1. **Element inventory.** Walk the loop (title → start → main action → damage → death → retry → result) and list every element the player sees under the `GAME.md` design. Build every element on it; cut any with no mechanic behind it.
2. **Hierarchy.** Survival (health, lives) `top-left`; objective (score, wave, lap, timer) `top-right` or `top-center`; moments near the centre for under 1 s; flavour optional. A fourth permanent number needs a reason.
3. **Screens.** A new game mounts title, HUD, pause and result before any title art exists; a focused edit adds a screen only when it touches that loop. A game with sound ships Music and Effects volumes on pause. Start and Retry call one launch method; pause is a `GameMode` state (`genesys-game-boot`). `Crosshair` only with locked aim. Per game type: [screens](references/screens.md).
4. **UI direction**, written in `GAME.md` Design before the first screen, from the Art direction and Palette: **fonts** (display + body; a Google Fonts `<link>` or a `.woff2` under `assets/ui/fonts/`, with a system fallback stack), **shape language** (one family for every panel and button: rounded, square, skewed, cut-corner, ornate, hand-drawn), **colours** (accent, plate, ink from the palette), and one **signature element** only this game has. Every screen uses it. Examples: [custom-hud](references/custom-hud.md); font stacks: [settings-and-style](references/settings-and-style.md).
5. **Custom layer or widgets.** The custom layer is the usual choice for HUD, title, result and banners. Restyled engine widgets suit settings, inventory, minimap and controls help, where their behaviour saves work ([customization](references/customization.md)). Both can share one set of CSS variables.
6. **Title composition**, on purpose: centred card, left rail, bottom bar or corner ([screens](references/screens.md#title-composition)).

### Which widget (when you use widgets)

Full catalog: [catalog](references/catalog.md). Defaults:

| Job | Widget | Notes |
|---|---|---|
| Start, Resume, Retry, Next, confirm | `Button` | `...ENGINE.Button.presets.primaryLarge` |
| Title, pause, result, dialog | `Card` | `variant: 'glass'`; a dialog is Card + one or two Buttons |
| Health, boss HP, loading | `ProgressBar` | `presets.health` / `boss`, fixed `width` |
| Shield, mana, stamina | `StatBar` | Not a second health bar |
| Score, coins, wave, lap, timer | `NumberDisplay` | `prefix`, `suffix`, `setValue(v, animate)` |
| Ammo | `AmmoCounter` / `WeaponCard` | `setAmmo(cur, max)` |
| Wave start, countdown, "Finish!" | `CenterMessage` | `show({ title, subtitle, duration })` |
| Unlock or milestone toast | `Achievement` | Place it with `setPosition` |
| Controls help, mute | `ControlsPanel`, `Toggle` | `Toggle` has no label; pair it with text |
| Radar, hotbar, backpack | `Minimap`, `InventoryBar`, `InventoryGrid` | Self-placed roots ([placement](references/placement.md)) |
| Nameplate, overhead bar, interact prompt | `UI3DNode` hosting a widget | [world-space](references/world-space.md) |
| Damage number | `TextNode`, tweened then destroyed | [world-space](references/world-space.md) |

Pick the closest widget. Compose two widgets before writing a subclass. A health bar is `ProgressBar` with `theme: 'health'`, not a new component.

## Build

### Construct and place

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`initialize`, `setPosition`), `.engine/src/ui/components/Button.ts` (`click` listener); pattern from a shipped game shell — typechecked against 18.1.0-alpha.317
```ts
const ui = world.uiManager;                       // widgets are not SceneNodes: `new`, never `.create()`
const title = new ENGINE.Card(ui, { title: 'Game Name', subtitle: 'One-line hook', body: 'WASD move · Space jump · P pause', variant: 'glass' });
await title.initialize();
title.setPosition({ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'max-content' });
const start = new ENGINE.Button(ui, { ...ENGINE.Button.presets.primaryLarge, label: 'Start',
  onClick: () => this.launchRun() });
await start.initialize();
start.setPosition({ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)' });
```

The engine `Button` drops focus after a mouse or touch click, so Space and Enter in play do not click Start or Retry again; a raw `<button>` needs its own `blur()`. All seven anchors, self-placed widgets and title art: [placement](references/placement.md).

### Rules that hold every time

- Every widget mounts into `#ui-container` inside `world.gameContainer` through `world.uiManager`. The custom HUD layer also mounts under `world.gameContainer`, never `document.body`.
- `setPosition` runs after `await initialize()`, always with `position: 'absolute'`; a `Card` also gets `width: 'max-content'`.
- `show()` / `hide()` / `toggle()` / `destroy()` exist on every widget. `hide()` sets `display: none`, so a hidden screen takes no clicks; a widget faded to `opacity: 0` still does.
- One widget per anchor. A value change (9 → 100) changes text or fill inside the widget; it never resizes it or pushes a neighbour. Numbers get a fixed width and `tabular-nums`.
- During play the centre of the view is the player and the threat; HUD stays on the edges. Title, pause and result cards sit at `center` only while play is stopped.
- A label reads on bright and dark scene parts through its own plate (`variant: 'glass'` or `default`), never a full-screen dim overlay.
- Presets, then options, then `customClasses` + project CSS, then a subclass in `src/ui/` ([customization](references/customization.md)). `customStyles` cannot place a widget; `mountChild` is protected (subclasses only).
- Never set an ignored option ([catalog](references/catalog.md) → *Ignored options*; today most `ProgressBar` styling fields). On a headless server `initialize()` returns early.

### World-space UI

`UI3DNode` (a SceneNode, so `.create()`) pins a screen widget to a 3D point and moves it every frame: nameplates (`Badge`, `Message`), overhead bars (`ProgressBar`), interact prompts (`Keystroke`, `Message`). Add it as a child at head height. It never destroys its widget: call `widget.destroy()` before the owner dies. `TextNode` draws canvas text in the world (damage numbers); `BillboardNode` draws an image sprite. Options, the overhead-bar and nameplate code, damage numbers and costs: [world-space](references/world-space.md).

### Safe UI

Dynamic strings (player names, chat, scores, RPC or `joinParams` data) go through text setters (`setLabel`, `setTitle`, `setSubtitle`, `setBody`, `setMessage`, `setText`), `element.textContent`, or `TextNode.updateText`. `*Html`, `icon`, `imageHtml`, `setHTML` and `innerHTML` take developer-authored markup only (`ENGINE.Icons.*`, the title-art holder). Build custom HUD SVG with `createElementNS`, never markup strings. Never put player or network strings in `customStyles`. Full patterns: [safe-ui](references/safe-ui.md).

### Sound on UI

If the game has sound, its buttons make sound too; a silent menu is a defect. Every button plays a confirm one-shot from its `onClick`, and menu buttons play a quiet hover tick from `getElement()?.on('pointerenter', …)` (volume 0.2). Clips and the throttle helper come from `genesys-audio`; the snippet is in [settings-and-style](references/settings-and-style.md).

## Limitations
- Title art or a UI image set from code is broken only in a built game (the bake turns it into KTX2): [placement](references/placement.md#limitations).

## Traps
- Card is a full-width bar across the top, Start stuck under it → the Card was never placed: its built-in default `position` only adds a class. Pass `position` to the constructor, or call `setPosition` after `initialize()` with `width: 'max-content'`.
- Minimap, AmmoCounter, Compass or ControlsPanel off-screen at a right anchor → pass the root selector: `setPosition(anchor, '.ui-minimap')`. More placement traps (toasts, overflow, overlap): [placement](references/placement.md#traps).
- `Property 'create' does not exist on type 'typeof Card'` → widgets are not SceneNodes. Use `new ENGINE.Card(world.uiManager, options)`.
- Space or Enter in play restarts the run or reopens a menu → a raw `<button>` or other focusable control kept focus after a click (the engine `Button` releases it) → `blur()` in its click handler.
- `ItemCard` used as a menu or title → it is an inventory tile. Use `Card` + `Button`.
- Player name rendered through `innerHTML` / `setIconHtml` → XSS. Use a text setter.
- The HUD looks like every other game → no UI direction. Write it in `GAME.md` and restyle every screen to it. World-space traps (bars that pile up or reappear): [world-space](references/world-space.md#traps).

## Done
- Every element on the inventory list exists in Play, and nothing on screen lacks a mechanic.
- An unverified HUD is not done. The smoke test (`genesys-verification`) drives each meter to 0, 50 and 100 and each counter from 9 to 1000, and the overflow check returns nothing at each step.
- `GAME.md` has a **UI direction**. Captures of the title and the HUD show its fonts, shape language and signature element, not the default widget look.
- The title shows the chosen composition, with Start clear of the title art's focal point. After Start, survival sits `top-left`, the objective `top-right` or `top-center`, and the centre is clear.
- Pause shows its card, Resume, and the Music and Effects volumes; moving a volume changes the bus (`getBus('Music').getVolume()`) and survives a reload. The HUD takes no clicks behind the pause card.
- Result shows the run's numbers and Retry; Space after clicking Retry does not restart. Start, Resume and Retry play a sound.
- World-space bars follow their owner, hide behind the camera, and are gone once the owner dies.
- `grep -n "innerHTML\|Html(" src/ui/` shows only the title-art holder and `ENGINE.Icons` markup.
- Custom HUD elements carry `data-hud` (root) and `data-hud-item` (each placed piece) so the smoke checks cover them ([custom-hud](references/custom-hud.md)).
- Capture and query evidence follows `genesys-verification`.

## References
- [screens](references/screens.md) — element inventory, HUD hierarchy, screens per game type, title compositions
- [custom-hud](references/custom-hud.md) — the custom layer: structure, fonts, skin variables, example directions, SVG, motion, smoke-check markers
- [catalog](references/catalog.md) — every widget, its options type and asset paths
- [placement](references/placement.md) — anchors, self-placed widgets, title art, overflow check, placement limitations and traps
- [world-space](references/world-space.md) — `UI3DNode`, `TextNode`, `BillboardNode`; nameplates, bars, prompts, damage numbers
- [settings-and-style](references/settings-and-style.md) — volume controls, UI sounds, style brief, font stacks
- [customization](references/customization.md) — presets, per-widget options, design tokens, subclassing
- [safe-ui](references/safe-ui.md) — text vs trusted markup, `customStyles` allowlist, checklist
