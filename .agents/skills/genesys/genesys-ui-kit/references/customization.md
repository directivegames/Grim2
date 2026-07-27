# Customizing UI Kit widgets

## Layout & spacing tokens

All shipped widgets share a consistent set of spacing, radius, and type values
derived from the Game UI Kit. Match these when building custom panels, composed
layouts, or new `BaseUIComponent` subclasses.

### Container padding (outer border → first content row)

| Context | Value | Notes |
|---|---|---|
| Standard panel | `17px` | Cards, item panels, player panels, overlay headers |
| Compact toast | `14px` | Notification / achievement-style toasts |
| Wide panel | `16px 24px` | Panels that span horizontally (controls lists, etc.) |
| Bubble / inline | `12px` | Chat bubbles, compact frames |
| Tight element | `8px 12px` | Tooltips, row items, small buttons |

### Internal gaps (between rows or sibling elements inside a container)

| Context | Value | Notes |
|---|---|---|
| Section-to-section | `12px` | Between a header, body section, and footer inside a panel |
| Element-to-element | `8px` | Icon + label, two metadata fields, sibling rows |
| Tight stack | `4px` | Label directly above its value, description below a title |

### Border radius

| Shape | Value | Notes |
|---|---|---|
| Panel / card | `16px` | Outer container of any floating or overlay panel |
| Medium element | `12px` | Buttons (md / lg), image insets, bubble containers |
| Small element | `8px` | Slot cells, tooltips, small buttons, nav rows |
| Pill / circle | `9999px` | Badges, avatars, any fully-rounded element |

### Color palette

Three neutral tiers used across every widget. Use these — do not invent
intermediate grays.

| Token | Value | Use |
|---|---|---|
| Primary text | `#e8eaed` | Headings, active values, names, button labels |
| Secondary text | `#a8adb8` | Labels, descriptions, metadata, captions |
| Muted text | `#6b7280` | Timestamps, separators, placeholders, disabled |

### Text roles

Every shipped widget uses one of six roles. Apply the exact properties below
when writing HTML templates or custom CSS — do not approximate.

#### Panel heading
Top-level title of a floating panel, overlay, or inventory window.
```css
font-size: 18px; font-weight: 600; line-height: 28px;
letter-spacing: -0.44px; color: #e8eaed;
```

#### Subheading / entity name
Section headings, player names, achievement titles, item names.
```css
font-size: 16px; font-weight: 600; line-height: 24px;
letter-spacing: -0.3125px; color: #e8eaed;
```

#### Body strong
Field labels, sender names, button labels (medium), emphasized metadata.
```css
font-size: 14px; font-weight: 600; line-height: 20px;
letter-spacing: -0.15px; color: #e8eaed;
```

#### Body
Descriptions, card body copy, chat text, helper text.
```css
font-size: 14px; font-weight: 400; line-height: 20px;
letter-spacing: -0.15px; color: #a8adb8;
```

#### Caption
Secondary descriptions, tooltip text, slot labels, achievement descriptions.
```css
font-size: 13px; font-weight: 400; line-height: 18px;
letter-spacing: -0.078px; color: #a8adb8;
```

#### Small label
Quantity chips, stat bar labels, badge text, hotkey chips.
```css
font-size: 12px; font-weight: 400; line-height: 16px;
color: #a8adb8;
```

#### Uppercase label *(variant)*
Weapon names, category tags, any ALL-CAPS short identifier.
```css
font-size: 12px; font-weight: 400; line-height: 16px;
letter-spacing: 0.6px; text-transform: uppercase; color: #a8adb8;
```

### Icon sizes

| Context | Size |
|---|---|
| Hero icon (centrepiece of a panel or toast) | `64 × 64 px` |
| Inline label icon (beside a stat or heading) | `20 × 20 px` |
| Button / row icon | `18 × 18 px` |

### Quick reference — dialog / panel checklist

When composing a new panel or dialog from scratch, start here:

```
outer container  padding: 17px               border-radius: 16px
  ├─ heading     panel heading role
  ├─ gap                                      12px  ← section separator
  ├─ body text   body role  (color #a8adb8)
  ├─ gap                                      8px   ← element separator
  └─ action row  Button widgets               gap: 8px between buttons
```

If margins feel too large, check you are not stacking both a container
`padding` and a child `margin` — prefer `gap` on the flex/grid parent and
remove manual margins from children.

---

Order of escalation when the user wants a non-default look:

1. **Presets first.** Ten widgets ship `static readonly presets` that map
   to Game UI Kit variant names. Spread a preset and add your own options:
   ```ts
   new ENGINE.Button(ui, { ...ENGINE.Button.presets.primaryLarge, label: 'Go' });
   new ENGINE.Badge(ui,  { ...ENGINE.Badge.presets.blueLarge,     label: 'New' });
   ```
   All presets are also accessible via `ENGINE.UIPresets.<Widget>.<name>`.
   See the presets table in `../SKILL.md` for the full list.
2. **Individual options.** When no preset is an exact match, set the options
   that differ individually — `variant`, `size`, `theme`, `style`, `color`,
   sizing fields, label text, etc.
3. **`customClasses` + `customStyles`.** Shared on every `BaseUIComponentOptions`:
   ```ts
   new ENGINE.ProgressBar(world.uiManager, {
     ...ENGINE.ProgressBar.presets.health,
     customClasses: ['my-game-health'],
     customStyles: { 'border-color': '#f87171' },
   });
   ```
   Pair `customClasses` with project-side CSS to do targeted overrides
   without forking the widget.
4. **Subclass.** Extend the engine widget in your project and override
   `getInitialData()` / `cacheElements()` / `onInitialize()`. Keep the
   subclass in `src/ui/` of the game project.
5. **New widget (last resort).** Only when no shipped widget can be
   shaped to fit. Build a new `BaseUIComponent` subclass following the
   same conventions (template + styles under `assets/ui/`, register on
   the class via `static metadata`).

## Per-widget knobs

### Control

- **`Button`** — `variant` (primary | secondary | accent | success | danger |
  ghost | outline), `size` (small | medium | large | extra-large), `icon`
  (HTML string for left icon slot), `disabled`, `loading`, `onClick`.
  Presets: `primary`, `primaryLarge`, `dangerSmall`, `accentXL`, … (28 total).
- **`Toggle`** — `on` (boolean), `disabled`, `onChange`.
  Presets: `on`, `off`, `disabledOn`, `disabledOff`.
- **`Input`** — `placeholder`, `value`, `disabled`, `onChange`, `onSubmit`.

### HUD

- **`ProgressBar`** — `theme` (health | mana | stamina | experience | boss |
  custom), `size` (small | medium | large), `fillColor`, `backgroundColor`,
  `textDisplay` (none | value | percentage | both | custom), `animate`,
  `animationDuration`, `label`.
  Presets: `health`, `healthLarge`, `manaSmall`, `boss`, … (14 total).
- **`StatBar`** — `theme` (shield | mana | stamina | energy), `value`,
  `maxValue`, `iconHtml`, `label`.
  Presets: `shield`, `mana`, `stamina`, `energy`.
- **`Crosshair`** — `style` (dot | scope | x | bracket | circle | sniper),
  `size` (px), `color`, `accentColor`.
  Presets: `dot`, `scope`, `x`, `bracket`, `circle`, `sniper`.
- **`Compass`** — `width`, `height`, `pixelsPerDegree`.
- **`Minimap`** — `size`, `worldRadius`, `playerColor`, `targetColor`,
  `backgroundColor`, `borderColor`.
- **`WeaponCard`** — `weaponName`, `currentAmmo`, `maxAmmo`, `iconHtml`
  (SVG/HTML for the 64×64 purple icon slot). Setters: `setWeapon(name, cur, max)`,
  `setAmmo(cur, max?)`, `setIconHtml(html)`.
- **`AmmoCounter`** — `lowAmmoThreshold`, `showLowAmmoWarning`.
- **`ReloadIndicator`** — `reloadDuration`, `text`, `color`.

### Data / Display

- **`Badge`** — `color` (blue | purple | pink | cyan | green | orange | red |
  yellow), `size` (small | medium | large), `label`, `dot` (leading dot).
  Presets: `blue`, `blueLarge`, `redSmall`, … (24 total).
- **`Avatar`** — `size` (xs | sm | md | lg | xl), `status` (none | online |
  offline | away | busy), `initials`, `imageUrl`, `ringColor`.
  Presets: `xs` … `xl`, `online`, `offline`, `away`, `busy` (9 total).
- **`Card`** — `variant` (default | glass | elevated), `title`, `subtitle`,
  `body`.
  Presets: `default`, `glass`, `elevated`.
- **`StatCard`** — `label`, `value` (string | number), `trend` (string,
  auto-colored: "↑+12%" → green, "-3%" → red), `subtitle`, `iconHtml`
  (SVG/HTML for the 20×20 icon beside the label).
  Setters: `setLabel()`, `setValue()`, `setTrend()`, `setSubtitle()`, `setIconHtml()`.
- **`ItemCard`** — `itemName`, `rarity` (common | uncommon | rare | epic |
  legendary), `imageHtml` (HTML/SVG for image area), `quantity` (0 = hidden),
  `price` (string | number, shown in yellow, empty = hidden). Rarity drives a
  composed `Badge` child — use `setRarity()` to swap it at runtime.
  Setters: `setItem(data)`, `setRarity()`, `setImageHtml()`, `setQuantity()`, `setPrice()`.
  Presets: `common`, `uncommon`, `rare`, `epic`, `legendary` (5 total).
- **`Keystroke`** — `size` (small | medium | large), `key` (label text).
  Presets: `small`, `medium`, `large`.
- **`NumberDisplay`** — `prefix`, `suffix`, `decimalPlaces`, `minValue`,
  `maxValue`, `animate`, `animationDuration`.
- **`InventoryBar`** / **`InventoryGrid`** — `slotCount` (bar) or
  `rows`/`columns` (grid), `slotSize`, `slotGap`, `itemRenderer`,
  `slotClearer`.
- **`ControlsPanel`** — `controls` (array of `{ key, description }`), `title`.

### Feedback

- **`Achievement`** — no constructor options; call `show(opts)` with `title`,
  `description`, `iconHtml`, `rarity` (common | uncommon | rare | epic |
  legendary), `duration` (ms).
  Presets are for `show()`: `Achievement.presets.legendary`, … (5 total).
- **`Tooltip`** — `content`, `placement` (top | bottom | left | right).
- **`Message`** / **`CenterMessage`** — `text`, `duration`, `style`.
- **`ChatMessage`** — `author`, `text`, `system` (boolean).
- **`NavItem`** — `label`, `icon`, `active`, `onClick`.
- **`NotificationBadge`** — `count`, `mode` (count | dot).

## When to ask the user

- If the request implies a look that none of the variants cover ("neon
  green hex-shaped button"), surface the closest preset or variant + the
  `customClasses` approach before committing to a custom widget.
- If the request is for an entirely new widget category (e.g. radial
  menu, dialog box), confirm with the user that no existing widget
  works before authoring a new one.
