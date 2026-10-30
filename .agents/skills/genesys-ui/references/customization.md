# Customizing widgets

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

## Order of escalation

When the creator wants a non-default look, go down this list and stop at the first step that works.

1. **Presets.** Eleven widgets ship `static readonly presets` (named Game UI Kit variants). Spread one and add your own options; your options win.
2. **Individual options.** `variant`, `size`, `theme`, `style`, `color`, sizing fields, label text.
3. **`customClasses` + `customStyles`.** Shared on every `BaseUIComponentOptions`. Both apply to the widget's `.ui-layout` wrapper. Pair `customClasses` with project CSS for targeted overrides without forking the widget.
4. **Subclass.** Extend the engine widget in `src/ui/` and override `getInitialData()` / `cacheElements()` / `onInitialize()` / `onBeforeCacheElements()`.
5. **New widget (last resort).** Only when no shipped widget can be shaped to fit. Build a `BaseUIComponent` subclass with the same conventions: template + styles under `assets/ui/`, `getAssetPaths()`, `getDefaultOptions()`, `getInitialData()`, and a `static metadata: UIComponentMetadata`. Never modify the engine package.

A look no variant covers ("neon green hex button"): use the closest preset plus a `customClasses` rule. A new widget category (radial menu, dialog): compose first. A confirmation dialog is a `Card` (frame) + `Message` or body text + one or two `Button`s, not a new `Dialog` widget.

## Presets

Source: `.engine/src/ui/UIPresets.ts`, each widget's `static readonly presets` — typechecked against 18.1.0-alpha.317
```ts
const play = new ENGINE.Button(ui, { ...ENGINE.Button.presets.primaryLarge, label: 'Play', onClick: () => startRun() });
const badge = new ENGINE.Badge(ui, { ...ENGINE.Badge.presets.blueLarge, label: 'New' });
const avatar = new ENGINE.Avatar(ui, { ...ENGINE.Avatar.presets.xl, ...ENGINE.Avatar.presets.online, initials: 'AX' });
achievement.show({ ...ENGINE.Achievement.presets.legendary, title: 'First Clear', description: 'Finished level 1' });
ENGINE.UIPresets.ProgressBar.health; // { theme: 'health' } — the same presets, browsable by widget name
```

| Widget | Preset names | Dimensions |
|---|---|---|
| `Button` | `primary` … `outline`; `<variant>Small`, `<variant>Large`, `<variant>XL` (e.g. `primaryLarge`, `dangerSmall`, `accentXL`) | variant × size (28) |
| `Badge` | `blue`, `blueLarge`, `redSmall`, … | color × size (24) |
| `Avatar` | `xs` … `xl`, `online`, `offline`, `away`, `busy` | size + status (9) |
| `ProgressBar` | `health`, `mana`, `stamina`, `experience`, `boss`, `healthSmall` … `experienceSmall`, `healthLarge` … `bossLarge` | theme × size (14) |
| `Toggle` | `on`, `off`, `disabledOn`, `disabledOff` | state (4) |
| `StatBar` | `shield`, `mana`, `stamina`, `energy` | theme (4) |
| `Card` | `default`, `glass`, `elevated` | variant (3) |
| `Crosshair` | `dot`, `scope`, `x`, `bracket`, `circle`, `sniper` | style (6) |
| `Keystroke` | `small`, `medium`, `large` | size (3) |
| `Achievement` | `common`, `uncommon`, `rare`, `epic`, `legendary` | rarity (5, for `show()`) |
| `ItemCard` | `common`, `uncommon`, `rare`, `epic`, `legendary` | rarity (5) |

## `customStyles` allowlist

`customStyles` passes through `sanitizeCssCustomStyles` (`.engine/src/utils/sanitizeCssCustomStyles.ts`). Dropped entries log a warning.

- Allowed: colours, `background` / `background-color` / `-size` / `-position` / `-repeat`, borders and radius, outline, `width` / `height` / min / max, spacing, typography, flex helpers, `--*` custom properties.
- Blocked: `position`, `top` / `right` / `bottom` / `left`, `inset*`, `z-index`, `pointer-events`, `transform`, `translate`, `rotate`, `scale`, `offset*`, `clip-path`, `clip`, `mask*`, `filter`, `backdrop-filter`, `background-image`, `content`.
- Values: no `;`, `{`, `}`, `url(`, or `expression(`.

Placement goes through `setPosition` ([placement](placement.md)), which is not filtered.

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`applyCustomStyling`) — typechecked against 18.1.0-alpha.317
```ts
new ENGINE.ProgressBar(world.uiManager, {
  ...ENGINE.ProgressBar.presets.health,
  customClasses: ['my-game-health'],
  customStyles: { 'border-color': '#f87171' },
});
```

## Composition rule

Compound widgets mount existing widget classes with `mountChild` (protected on `BaseUIComponent`, so call it from a subclass). Never re-implement a shipped widget inside another one; that duplicates CSS, drifts as widget internals change, and hides the widget from the catalog.

- A panel needs a button → `this.mountChild(ENGINE.Button, { label: 'OK' }, slotEl)`.
- A card needs a badge → `this.mountChild(ENGINE.Badge, { ...ENGINE.Badge.presets.green, label: 'Ready' }, slotEl)`.

`mountChild` creates the child with `position: 'none'` (do not set it yourself), initializes it, moves its template root into `slot`, and tracks it so `destroy()` tears it down. Engine examples: `ControlsPanel` mounts `Keystroke` children; `ItemCard` and `PlayerCard` mount `Badge` / `Avatar` children.

## Per-widget knobs

All verified against `node_modules/@gnsx/genesys.js/dist/src/ui/components/<Class>.d.ts`. Every widget also takes `position`, `visible`, `customClasses`, `customStyles`.

### Control
- `Button` — `label`, `variant` (primary | secondary | accent | success | danger | ghost | outline), `size` (small | medium | large | extra-large), `icon` (trusted HTML for the left icon slot), `disabled`, `loading`, `onClick`. Setters: `setLabel`, `setVariant`, `setSize`, `setDisabled`, `setLoading`, `setOnClick`, `setIcon`.
- `Toggle` — `on`, `disabled`, `onChange(on)`. Setters: `setOn`, `setDisabled`, `isOn()`.
- `Input` — `label`, `placeholder`, `value`, `helper`, `type`, `error`, `disabled`, `leadingIconHtml`, `trailingIconHtml`, `onChange(value, event)`, `onBlur`. Setters: `setValue`, `getValue`, `setLabel`, `setHelper`, `setError`, `setDisabled`, `setPlaceholder`, `setType`, `setLeadingIconHtml`, `setTrailingIconHtml`.

### HUD
- `ProgressBar` — `currentValue`, `maxValue`, `minValue`, `width`, `height`, `theme` (health | mana | stamina | experience | boss | custom), `size` (small | medium | large), `fillColor`, `animate`, `animationDuration`, `textDisplay` (none | value | percentage | both | custom), `customText`, `label`. The other styling options are ignored ([catalog](catalog.md) → *Ignored options*). Setters: `setValue(v, animate?)`, `setMaxValue`, `getValue`, `getPercentage`, `setCustomText`, `setSize`, `setTheme`, `setFillColor`.
- `StatBar` — `theme` (shield | mana | stamina | energy), `value`, `maxValue`, `iconHtml`, `label`. Setters: `setValue`, `setMaxValue`, `setTheme`, `setIconHtml`, `setLabel`.
- `Crosshair` — `style` (dot | scope | x | bracket | circle | sniper), `size` (px), `color`, `accentColor`. Setters: `setStyle`, `setSize`, `setColor`, `setAccentColor`.
- `Compass` — `width`, `height`, `pixelsPerDegree`. Call `updateRotation(camera)` each tick.
- `Minimap` — `size`, `worldRadius`, `playerColor`, `targetColor`, `cardinalColor` (the glass surface comes from `minimap.css`; `backgroundColor` / `borderColor` were removed in engine 19). Methods: `setPlayerPosition(v3)`, `setTargets`, `addTarget`, `removeTarget`, `clearTargets`, `render`, `setSize`, `setWorldRadius`.
- `WeaponCard` — `weaponName`, `currentAmmo`, `maxAmmo`, `iconHtml` (64×64 icon slot). Setters: `setWeapon(name, cur, max)`, `setAmmo(cur, max?)`, `setIconHtml`.
- `AmmoCounter` — `weaponName`, `lowAmmoThreshold`, `showLowAmmoWarning`. Methods: `setAmmo(cur, max)`, `setWeaponName`, `isLowAmmo`, `isEmpty`.
- `ReloadIndicator` — `reloadDuration`, `text`, `color`. Methods: `startReload()`, `cancelReload()`, `isActive()`, `setDuration`, `setText`.
- `AbilityIcon` — `iconHtml`, `hotkey`, `cooldown` (s), `ready`. Setters: `setIconHtml`, `setHotkey`, `setCooldown`, `setReady`.
- `CenterMessage` — `show({ title, subtitle, color, duration })`; `duration` in ms, 0 stays until `hide()`.
- `Message` — `setMessage({ name, body, color, iconHtml })`.
- `ChatPanel` — `maxVisibleLines`, `placeholder`, `maxLength`, `openLabel`, `sendLabel`, `onSubmit(text)`, `onOpenChange(open)`. Methods: `addLine({ senderName, text, kind, isLocalSender })`, `clearLines`, `openComposer`, `closeComposer`, `isOpen`.

### Data / display
- `Badge` — `color` (blue | purple | pink | cyan | green | orange | red | yellow), `size` (small | medium | large), `label`, `dot`. Setters: `setLabel`, `setColor`, `setSize`, `setDot`.
- `Avatar` — `size` (xs | sm | md | lg | xl), `status` (none | online | offline | away | busy), `initials`, `imageUrl`, `ringColor`. Setters: `setSize`, `setStatus`, `setInitials`, `setImageUrl`, `setRingColor`.
- `Card` — `variant` (default | glass | elevated), `title`, `subtitle`, `body`. Setters `setTitle`, `setSubtitle`, `setBody` write text; `setVariant`.
- `StatCard` — `label`, `value`, `trend` (auto-coloured: "↑+12%" green, "-3%" red), `subtitle`, `iconHtml` (20×20). Setters: `setLabel`, `setValue`, `setTrend`, `setSubtitle`, `setIconHtml`.
- `ItemCard` — `itemName`, `rarity` (common … legendary; drives a composed `Badge`), `imageHtml`, `quantity` (0 hides), `price` (yellow; empty hides). Setters `setItem`, `setRarity`, `setImageHtml`, `setQuantity`, `setPrice`.
- `PlayerCard` — `setPlayer({ name, handle, initials, imageUrl, status, score, statusBadge })`.
- `Keystroke` — `key`, `size` (small | medium | large). Setters `setKey`, `setSize`.
- `NumberDisplay` — `label`, `iconHtml`, `prefix`, `suffix`, `initialValue`, `minValue`, `maxValue`, `decimalPlaces`, `animate`, `animationDuration`, `trend`. Methods: `setValue(v, animate?)`, `getValue`, `add`, `subtract`, `increment`, `decrement`, `reset`, `setPrefix`, `setSuffix`, `setRange`, `setLabel`, `setIconHtml`, `setTrend`.
- `InventoryBar` — `slotCount`, `slotSize`, `slotGap`, `itemRenderer`, `slotClearer`, `filledClass`, `emptyClass`, `itemContentSelector`. Methods: `setItems`, `addItem`, `removeItem`, `removeItemById`, `findItem`, `hasItem`, `isFull`, `setCooldown(slot, percent)`.
- `InventoryGrid` — `rows`, `columns`, `slotSize`, `slotGap`, `itemRenderer`, `slotClearer`, `enableDragDrop`, `dragHoverClass`, `onClose`. Methods as `InventoryBar` plus `moveItem`, `getItemsWithPositions`, `toggle`.
- `ControlsPanel` — `controls` (`{ key, description }[]`), `title`. Methods: `updateControls`, `setCustomPosition(styles)`.

### Feedback / navigation
- `Achievement` — no constructor options of note; call `show({ title, description, iconHtml, rarity, duration })`. Presets are for `show()`. It anchors top-right by itself; `setPosition` it after `initialize()` to move it ([placement](placement.md)).
- `Tooltip` — `text`, `placement` (top | bottom | left | right), `offset`, `target`. Methods: `show(text?, target?)`, `hide`, `setText`, `setPlacement`, `setTarget`.
- `ChatMessage` — `name`, `body`, `system`, `timestamp`, `color`, `initials`, `imageUrl`, `glass`. `setMessage(data)`, `setGlass`.
- `NavItem` — `label`, `iconHtml`, `active`, `badgeCount`, `onClick`. Methods: `setItem({ label, iconHtml?, active?, badgeCount?, onClick? })` (replaces all fields; unspecified ones fall back to defaults), `setActive`, `setBadgeCount` (0 hides the badge), `setOnClick`. There is no `setLabel`; change the label through `setItem`.
- `NotificationBadge` — `count`, `mode` (count | dot), `maxCount`. Setters: `setCount`, `setMode`, `setMaxCount`.

## Trusted icons

`ENGINE.Icons` holds developer-authored SVG strings for `*Html` / `icon` slots: `heart`, `shield`, `bolt`, `star`, `sparkles`, `hourglass`, `user`, `users`, `gear`, `bell`, `lock`, `key`, `message`, `mail`, `flame`, `droplet`, `trophy`, `crown`, `gem`, `award`, `home`, `map`, `package`, `battery`. `ENGINE.createIcon(path, fill?)` wraps your own SVG path.

Source: `.engine/src/ui/icons.ts`.
