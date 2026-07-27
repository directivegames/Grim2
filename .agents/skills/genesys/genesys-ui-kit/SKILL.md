---
name: genesys-ui-kit
description: Build screen-space UI in a Genesys project using the engine's BaseUIComponent widgets (Button, ProgressBar, Crosshair, Compass, Minimap, InventoryBar / Grid, AmmoCounter, WeaponCard, NumberDisplay, ControlsPanel, ReloadIndicator, StatCard, ItemCard, PlayerCard, Badge, Avatar, Card, Toggle, NavItem, ChatMessage, Achievement, and more). Use whenever the user asks for HUD elements, menus, buttons, bars, inventories, crosshairs, minimaps, controls help, counters, or any in-game UI — unless they explicitly request a custom look or a widget that has no engine match.
---

# Genesys UI Kit

The engine ships a curated set of `BaseUIComponent` widgets derived from the
Game UI Kit. Prefer these widgets over hand-rolling HTML / CSS. Drop down
to raw HTML only when the user explicitly asks for a custom look or no
existing widget matches.

## Decision flow

1. Read `./references/catalog.md`. Match the user's request against
   the widget summaries and `useCases`.
2. If exactly one widget matches → use it.
3. If several match → pick the closest, or ask the user which one.
4. If no single widget matches → compose existing widgets before writing
   anything custom. Most "missing" UI is just a layout of widgets that
   already exist. Example: a confirmation dialog is a `Card` (frame) with a
   `Message` or `CenterMessage` (body text) and one or two `Button`s
   (actions) — not a new `Dialog` widget.
5. If composition still doesn't fit → prefer to restyle an existing widget
   via its options (`variant`, `theme`, `customClasses`, `customStyles`)
   before authoring a new one.
6. Only fall back to a custom `BaseUIComponent` subclass or raw HTML when
   the user explicitly opts in or no combination of widgets can express
   what they want.

## Composition rule (mandatory)

**Compound widgets MUST use `mountChild` with existing widget classes. Never
re-implement a shipped widget inside another widget.**

- If a panel needs a button → use `mountChild(ENGINE.Button, …, slot)`.
- If a card needs a badge → use `mountChild(ENGINE.Badge, …, slot)`.
- If a dialog needs two buttons → mount two `ENGINE.Button` children.

`mountChild` initializes the child, moves its root into the provided slot
element, and tracks it so `destroy()` cleans everything up automatically.
Children created this way are always passed `position: 'none'` (handled
internally — do not set it yourself).

The engine ships two examples to follow:
- `ControlsPanel` mounts `Keystroke` children for each key binding.
- `ItemCard` and `PlayerCard` mount `Badge` / `Avatar` children.

Violating this rule produces duplicated CSS, divergent behavior when widget
internals change, and widgets that the catalog cannot enumerate correctly.

## How to use a widget

```ts
import * as ENGINE from '@gnsx/genesys.js';

const button = new ENGINE.Button(world.uiManager, {
  label: 'Start',
  variant: 'primary',
  size: 'large',
  onClick: () => world.start(),
});

await button.initialize();
// button.setLoading(true) / .setDisabled(true) / .setLabel('...') etc.
```

Every widget:
- accepts an options object typed as `<Class>Options`,
- needs `await component.initialize()` before it is visible,
- exposes `show()`, `hide()`, `toggle()`, `destroy()`, and component-specific
  setters,
- can be positioned via the shared `position` option
  (`top-left`, `top-center`, `top-right`, `bottom-left`, `bottom-center`,
  `bottom-right`, `center`).

## Presets — named variants

Ten widgets expose a `static readonly presets` object containing named option
combinations from the Game UI Kit. Spread a preset into the constructor (or
into `show()` for Achievement) to apply a named style combination without
looking up individual option values. Your own options always win over the spread.

```ts
import * as ENGINE from '@gnsx/genesys.js';

const btn = new ENGINE.Button(ui, {
  ...ENGINE.Button.presets.primaryLarge,
  label: 'Play',
  onClick: () => startGame(),
});

const badge = new ENGINE.Badge(ui, {
  ...ENGINE.Badge.presets.blueLarge,
  label: 'New',
});

// Compose two dimension presets for Avatar
const avatar = new ENGINE.Avatar(ui, {
  ...ENGINE.Avatar.presets.xl,
  ...ENGINE.Avatar.presets.online,
  initials: 'AX',
});

// Achievement.show() with rarity preset
achievement.show({
  ...ENGINE.Achievement.presets.legendary,
  title: 'First Blood',
  description: 'Landed the first kill',
});
```

All presets are also accessible via the `ENGINE.UIPresets` barrel so you can
browse them by widget name in your IDE:

```ts
ENGINE.UIPresets.Button.primaryLarge   // { variant: 'primary', size: 'large' }
ENGINE.UIPresets.Badge.blueLarge       // { color: 'blue', size: 'large' }
ENGINE.UIPresets.ProgressBar.health    // { theme: 'health' }
```

**Widgets with presets and their dimensions:**

| Widget | Preset names | Dimensions |
|--------|-------------|------------|
| `Button` | `primary`, `primaryLarge`, `dangerSmall`, … | variant × size (28 total) |
| `Badge` | `blue`, `blueLarge`, `redSmall`, … | color × size (24 total) |
| `Avatar` | `xs` … `xl`, `online`, `offline`, `away`, `busy` | size + status (9 total) |
| `ProgressBar` | `health`, `healthLarge`, `manaSmall`, `boss`, … | theme × size (14 total) |
| `Toggle` | `on`, `off`, `disabledOn`, `disabledOff` | state (4 total) |
| `StatBar` | `shield`, `mana`, `stamina`, `energy` | theme (4 total) |
| `Card` | `default`, `glass`, `elevated` | variant (3 total) |
| `Crosshair` | `dot`, `scope`, `x`, `bracket`, `circle`, `sniper` | style (6 total) |
| `Keystroke` | `small`, `medium`, `large` | size (3 total) |
| `Achievement` | `common`, `uncommon`, `rare`, `epic`, `legendary` | rarity (5 total, for `show()`) |
| `ItemCard` | `common`, `uncommon`, `rare`, `epic`, `legendary` | rarity (5 total) |

See `./references/customization.md` for the full list of per-widget options.

## Constraints

- Never append UI to `document.body` — the engine renders into
  `world.gameContainer`. The widgets handle this automatically; if you
  must add custom DOM, use `world.gameContainer`.
- Don't recreate widgets that already exist (e.g. a "health bar" is
  `ProgressBar` with `theme: 'health'`, not a new component).
- Asset paths inside templates use `@engine/...` / `@project/...` prefixes
  and must be resolved with `ENGINE.resolveAssetPathsInText` when injected
  into raw HTML.
- The catalog in `./references/catalog.md` is auto-generated from
  the engine source. Do not edit it by hand.

## Deprecated widgets

The catalog has a Deprecated section at the bottom listing widgets
that have been superseded. The rules are simple:

- Never pick a deprecated widget for new work. The catalog lists the
  replacement class in the `Replaced By` column — use it instead.
- Existing projects may still construct deprecated widgets. Don't
  rewrite working code unless the user asks you to migrate; if they do,
  swap the class and adjust options to match the replacement's API.
- Deprecated classes are also marked with TSDoc `@deprecated` in the
  engine source, so editors and TypeScript will flag usage at the call
  site.

## When the user wants a custom look

- Prefer overriding via the widget's options (`variant`, `theme`, `style`,
  `customClasses`, `customStyles`) before swapping templates.
- See ./references/customization.md for the per-widget knobs.
- Only as a last resort, author a new `BaseUIComponent` subclass — keep
  it inside the project (`src/ui/`), don't modify the engine package.

## References

- ./references/catalog.md — generated widget index.
- ./references/customization.md — styling and theming knobs.
