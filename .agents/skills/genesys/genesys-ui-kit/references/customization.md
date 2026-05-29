# Customizing UI Kit widgets

Order of escalation when the user wants a non-default look:

1. **Options first.** Every widget exposes its own knobs — `variant`, `size`,
   `theme`, `style`, `color`, sizing fields, label text, etc. Try these
   before anything else.
2. **`customClasses` + `customStyles`.** Shared on every `BaseUIComponentOptions`:
   ```ts
   new ENGINE.ProgressBar(world.uiManager, {
     theme: 'health',
     customClasses: ['my-game-health'],
     customStyles: { 'border-color': '#f87171' },
   });
   ```
   Pair `customClasses` with project-side CSS to do targeted overrides
   without forking the widget.
3. **Subclass.** Extend the engine widget in your project and override
   `getInitialData()` / `cacheElements()` / `onInitialize()`. Keep the
   subclass in `src/ui/` of the game project.
4. **New widget (last resort).** Only when no shipped widget can be
   shaped to fit. Build a new `BaseUIComponent` subclass following the
   same conventions (template + styles under `assets/ui/`, register on
   the class via `static metadata`).

## Common per-widget knobs

- `Button` — `variant` (primary | secondary | success | danger | ghost),
  `size` (small | medium | large | extra-large), `loading`,
  `loadingStyle` (spinner | dots), `disabled`, `onClick`.
- `ProgressBar` — `theme` (health | mana | stamina | experience | custom),
  `style` (flat | gradient | rounded | glow), `direction`, `fillDirection`,
  `textDisplay`, `fillColor`, `backgroundColor`, `borderColor`,
  `borderWidth`, `borderRadius`, `animate`, `animationDuration`.
- `Crosshair` — `size`, `color`, `style` (dot | cross | circle).
- `Compass` — `width`, `height`, `pixelsPerDegree`.
- `Minimap` — `size`, `worldRadius`, `playerColor`, `targetColor`,
  `backgroundColor`, `borderColor`.
- `AmmoCounter` — `lowAmmoThreshold`, `showLowAmmoWarning`.
- `NumberDisplay` — `prefix`, `suffix`, `decimalPlaces`, `minValue`,
  `maxValue`, `animate`, `animationDuration`.
- `ReloadIndicator` — `reloadDuration`, `text`, `color`.
- `InventoryBar` / `InventoryGrid` — `slotCount` (bar) or `rows`/`columns`
  (grid), `slotSize`, `slotGap`, `itemRenderer`, `slotClearer`.
- `ControlsPanel` — `controls` (array of `{ key, description }`), `title`.

## When to ask the user

- If the request implies a look that none of the variants cover ("neon
  green hex-shaped button"), surface the closest variant + the
  `customClasses` approach before committing to a custom widget.
- If the request is for an entirely new widget category (e.g. radial
  menu, dialog box), confirm with the user that no existing widget
  works before authoring a new one.
