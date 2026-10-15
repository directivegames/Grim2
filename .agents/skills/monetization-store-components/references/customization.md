# Customization

Install unchanged first. Then change only what the creator asked for, in this
order.

## 1. Config — `src/store/store-config.ts`

- `accent`: color for the primary buttons and the active tab underline, e.g. `'#9d4edd'`.
- `hotkey`: `'b'` by default; `null` disables the key.
- `showHudChip`: `false` hides the chip; open the store from an interactable or menu with `store.open()` or `store.toggle()`.
- `hudPosition`: `'top-right' | 'top-left' | 'bottom-right' | 'bottom-left'`.
- `showSessionInfo`: the footer line; `false` for a clean panel.
- `apiBaseUrl`: leave as is.

Per game: `installStore(world, { accent: '#fb923c', showHudChip: false })`.

## 2. Copy

Titles, subtitles and state messages are literal text in
`assets/ui/store/*.html`. Keep the `data-*` attributes.

## 3. Styles

Each component has a stylesheet in `assets/ui/store/`. The values follow the
kit: Inter, glass `rgba(42,45,68,.6)` with blur, radii 16/12/8, text
`#eef0f5` / `#a3a9ba`, price `#fbbf24`, accent `#4f7cff`. To restyle a kit
widget inside the store, use the widget's options in the component's
`mountChild` call (`variant`, `size`, `color`) or `customClasses` with your
CSS before touching the widget's markup.

Grid density: `.store-grid { grid-template-columns: repeat(auto-fill, minmax(190px, 1fr)) }`
in `store-panel.css`; the phone queries set their own columns (two in
portrait, `minmax(130px, 1fr)` in landscape), so change those inside the
queries for phones. Panel size: `.store-panel { width; height }`; on phones
the panel fills the view, set inside the phone query.

Phones: the phone layout applies when the game view is at most 600 px wide or
480 px tall. The rules sit in container queries on the backdrops,
`@container store (…)` in `store-panel.css` and `store-item-card.css`. The queries read
`(max-width: 552px) or (max-height: 432px)` because the backdrops have 24px
padding; `(max-height: 432px)` alone is landscape. Rules outside the queries
apply to both layouts; the phone queries override `.store-grid` columns and
`.store-panel` size, so change those inside the queries for phones. Put
phone-only changes inside the queries. Touch-only rules use
`@media (hover: none)` (tiles) and `@media (hover: none) and (pointer: coarse)`
(the HUD key hint).
`env(safe-area-inset-*)` is 0 unless the page's viewport meta has
`viewport-fit=cover`.

## 4. Opening from the world

```ts
const store = await installStore(world, { showHudChip: false });
// in an interactable's beginInteract():
store.toggle();
```

## 5. Replacing a component

The controller does not know the UI. Any component can be swapped as long as
it renders from `StoreState` and calls the controller's actions. Keep the
controller, the client and `install-store.ts`; give the replacement the same
options surface (`onAction`, `onClose`, …) so the wiring stays.

## 6. Updating the templates

Rerun the install script. It overwrites `src/store/` and `assets/ui/store/`
except `store-config.ts`; copy and style edits from steps 2 and 3 must be
reapplied, so keep them small or move them into `store-config.ts` values.

## Do not

- Add a confirmation dialog to purchases.
- Show a custom error for insufficient Silicon.
- Sell Silicon in the game (packs, Pay Station, `/api/payment/packages`), or
  open the top-up tab without a click.
- Put player names, chat or network strings into `imageHtml`, `icon` or `innerHTML`.
- Read or hard-code environment URLs.
