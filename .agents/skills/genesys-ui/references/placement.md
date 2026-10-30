# Where a widget actually sits

## How the DOM is built

- `world.uiManager` creates `#ui-container` inside `world.gameContainer`: `position: absolute; top: 0; left: 0; width: 100%; height: 100%; pointer-events: none; z-index: 1000` (`createUIContainer` in `.engine/src/ui/UIManager.ts`).
- Each widget's `initialize()` calls `uiManager.createLayout`, which appends a `.ui-layout` wrapper div to `#ui-container` and sets `pointer-events: auto` on it. The widget template root (`.ui-card`, `.ui-button`, ...) sits inside that wrapper.
- Wrappers that are not taken out of flow stack from the top of the view. A `.ui-card` is `display: flex` with no width (`assets/ui/styles/card.css`), so in flow it stretches edge to edge. That is the full-width bar with the button stuck under it.

## The `position` option anchors only when you pass it

A `position` passed to the constructor (`new ENGINE.Card(world.uiManager, { position: 'top-right', ... })`) pins the template root to that anchor at `initialize()`: 16 px from the top and side edges, 24 px from the bottom, centred anchors by auto margins (so the root's own `transform` animations still work). A widget's built-in default `position` only adds a class, so a widget you do not place stays in flow. A widget whose stylesheet already sets offsets (`Crosshair`, `ChatPanel`, `CenterMessage`, `Tooltip`, `ReloadIndicator`) keeps its own placement. Any `setPosition` call removes the anchor first, so the two never fight. `'none'` is for widgets composed inside another widget (`mountChild` passes it).

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`applyPositioning`, `POSITION_ANCHOR_STYLES`).

## `setPosition` for any other placement

Use it for offsets the anchors do not cover (a second widget under the first, a custom margin). `BaseUIComponent.setPosition(styles, selector?)` writes each entry with `style.setProperty` on the `.ui-layout` wrapper, or on the child matching `selector`. It must run after `await initialize()`; before that it warns and does nothing. The `customStyles` allowlist does not apply to it, so `position`, `transform`, and offsets work here.

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`setPosition`, `applyPositioning`).

Always pass `position: 'absolute'`. On a `Card`, also pass `width: 'max-content'` so the panel does not become a bar.

| Anchor | `setPosition` argument | Default use |
|---|---|---|
| `top-left` | `{ position: 'absolute', top: '16px', left: '16px' }` | Health, lives, lap |
| `top-center` | `{ position: 'absolute', top: '16px', left: '50%', transform: 'translateX(-50%)' }` | Timer, wave, objective |
| `top-right` | `{ position: 'absolute', top: '16px', right: '16px' }` | Score, coins, place |
| `bottom-left` | `{ position: 'absolute', bottom: '24px', left: '16px' }` | Chat, hints |
| `bottom-center` | `{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)' }` | Start, Resume, Retry, hotbar |
| `bottom-right` | `{ position: 'absolute', bottom: '24px', right: '16px' }` | Ammo, weapon card, abilities |
| `center` | `{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 'max-content' }` | Title, pause, result cards (play stopped only) |

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`setPosition`) — typechecked against 18.1.0-alpha.317
```ts
await start.initialize();
start.setPosition({ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)' });
```

A second widget on the same edge gets its own offset: score at `top: '16px'`, best score at `top: '88px'`. Do not put two widgets on one anchor.

## Self-placed widgets

Some templates already position their own root. Do not wrap them in an anchor blindly.

| Widget | Root rule (stylesheet) | What to do |
|---|---|---|
| `CenterMessage` | `position: fixed; inset: 0`, centred flex, `pointer-events: none`, `z-index: 9999`, fades via `data-visible` | Nothing. `show({ title, subtitle, color, duration })`; `duration` 0 stays until `hide()` |
| `Crosshair` | `position: absolute; top: 50%; left: 50%; translate(-50%,-50%)` | Nothing |
| `ReloadIndicator` | Full-size absolute overlay | Nothing |
| `Tooltip` | `position: fixed`, follows `target` | `show(text, target)` |
| `ChatPanel` | `position: absolute; left: 16px; bottom: 16px` | Nothing, or `setPosition(anchor, '.ui-chat-panel')` |
| `InventoryGrid` | `position: fixed`, `z-index: 2000` | `setPosition(centerAnchor, '.ui-inventory-grid')` |
| `Minimap` | `position: absolute`, no offsets | `setPosition(topRightAnchor, '.ui-minimap')` |
| `AmmoCounter` | `position: absolute`, no offsets | `setPosition(bottomRightAnchor, '.ui-ammo-counter')` |
| `InventoryBar` | `position: absolute`, no offsets | `setPosition(bottomCenterAnchor, '.ui-inventory-bar')` |
| `Compass` | `.compass-container` absolute, no offsets | `setPosition(topCenterAnchor, '.compass-container')` |
| `ControlsPanel` | `position: absolute`, no offsets | `controls.setCustomPosition(anchor)` (targets `.ui-controls-panel`) |
| `Achievement` | Anchored top-right by default (16 px); slides in from the right (`translateX(120%)` → 0) when `show()` sets `data-visible` | Nothing, or `setPosition` it under the top-right widget (below) |

Why the selector: the wrapper of an absolute child has zero width. Anchoring the wrapper at `right: 16px` puts the child's left edge there, so it hangs off-screen. Targeting the child's root class places the visible box.

Source: `node_modules/@gnsx/genesys.js/assets/ui/styles/*.css`, `.engine/src/ui/components/ControlsPanel.ts` (`setCustomPosition`).

Source: `node_modules/@gnsx/genesys.js/assets/ui/styles/achievement.css`, `.engine/src/ui/components/Achievement.ts` (`show`) — typechecked against 18.1.0-alpha.317
```ts
const toast = new ENGINE.Achievement(world.uiManager, {});
await toast.initialize();
toast.setPosition({ position: 'absolute', top: '88px', right: '16px' });   // under the top-right score
toast.show({ ...ENGINE.Achievement.presets.rare, title: 'First Clear', description: 'Finished level 1' });
```

## Title compositions

Pick one on purpose from the genre and the title art (table and exact anchors: [settings-and-style](settings-and-style.md) → *Title composition*): centred card, left rail, bottom bar, or corner. Pause and result cards stay at `center`.

## Title art behind the shell

The shell is finished without an image. Title art is an asset row owned by `genesys-assets` (the live scene behind the title card by default, an image only when the creator asks; Scenario only when the project's art routes name it). It lands under `assets/ui/` and is ready before the code that references it is built: a missing literal path fails `buildProject`.

Mount it under `world.gameContainer` in its own holder at `z-index: 999`, just below `#ui-container` (1000), so the Card and Start draw on top. Resolve the path with `ENGINE.resolveAssetPathsInText`; `customStyles` rejects `url(` and `background-image`, and `Card.setBody` writes text, so neither carries an image. The holder is the one sanctioned `innerHTML` in UI code; mark it with `data-title-art` so the Safe UI grep can skip it.

Source: `.engine/src/storage/projectContext.ts` (`resolveAssetPathsInText`); pattern from a shipped game shell — typechecked against 18.1.0-alpha.317
```ts
const html = await ENGINE.resolveAssetPathsInText(
  '<img src="@project/assets/ui/title-art.png" alt="" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none;">');
const holder = document.createElement('div');
holder.dataset.titleArt = '1';               // the Done grep exempts this sanctioned holder
holder.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:999;background:#05070d;';
holder.innerHTML = html; // developer-authored markup only
world.gameContainer?.appendChild(holder);
```

Over title art, use the composition's anchors so the Card sits off the art's focal point, and lift Start to `bottom: '14%'` so it clears the lettering. Hide the holder (`style.display = 'none'`) on every state except the title, in the same transition that hides the title Card. Write the asset path as a literal; never build it from variables.

**Keep UI images raw.** With the asset compiler on, a PNG or JPG becomes KTX2 at build, and an `<img>` cannot show KTX2. The build keeps an image raw when a UI `.html` or `.css` file names it by its `@project/...` path; one set from code (`img.src`, `imageUrl`, UI data) is baked, so the title is blank only in shared and built games. Keep title art, icons and UI images under `assets/ui/` and make sure `textureCompression.exclude` lists `"assets/ui/"` in `.genesys-project` (`genesys-asset-compiler`).

## Readability bar

- HUD margins: 16 px from the top and sides, 24 px from the bottom.
- During play nothing sits in the central third of the view except `Crosshair` and transient `CenterMessage`s.
- Fixed-width meters: give `ProgressBar` a `width` (e.g. 260). `NumberDisplay` animates the value inside its card.
- One panel at a time in the centre. Pause and result never stack on the title.

### Overflow check

Labels must fit their plates at every value. This helper is for a quick manual check from `run_script`; the smoke test's `textOverflow` is the check that counts. The smoke test (`genesys-verification`) sets each meter to 0, 50 and 100 and each counter from 9 to 1000, then runs this check; an empty list passes.

Source: composed against `.engine/src/ui/UIManager.ts` (`#ui-container`) — typechecked against 18.1.0-alpha.317
```ts
// Leaf elements in the widgets and the custom HUD whose text is wider than their box. Run with HUD values at 0, 50 and 100 (and 9 → 1000).
export function uiOverflows(world: ENGINE.World): string[] {
  const root = world.gameContainer;
  const bad: string[] = [];
  root?.querySelectorAll<HTMLElement>('#ui-container *, [data-hud] *').forEach((el) => {
    if (el.childElementCount === 0 && el.offsetParent !== null && el.scrollWidth > el.clientWidth + 1) {
      bad.push(`${el.className || el.tagName}: "${el.textContent ?? ''}" ${el.scrollWidth}>${el.clientWidth}`);
    }
  });
  return bad;
}
```

## Limitations

- Title art or a UI image is broken only in a shared or built game → it is set from code, so the asset compiler turned it into KTX2, which `<img>` cannot show. Keep it under `assets/ui/` and exclude that folder (`genesys-asset-compiler`).

## Traps

- Card is a full-width bar across the top, Start stuck under it → the Card was never placed, so it sits in flow → pass `position` to its constructor, or call `setPosition` after `initialize()` with `width: 'max-content'`.
- Minimap, AmmoCounter, Compass, or ControlsPanel lands off-screen at a right anchor → their root is already `position: absolute`. Pass the root selector: `setPosition(anchor, '.ui-minimap')` (*Self-placed widgets*).
- `Achievement` toast covers the score → both sit at the top-right anchor → `setPosition` the toast under the score (`top: '88px'`).
- `setPosition` logs "not initialized" and nothing moves → it ran before `await initialize()`.
- `customStyles: { position: ... }` does nothing and warns → `position`, offsets, `z-index`, `transform`, `filter`, `background-image`, and `url(` are blocked. Use `setPosition` for placement.
- An `<img>` string shows as text in a Card → `setBody` writes `textContent`. Title art is a resolved `<img>` in its own holder (*Title art behind the shell*).
- Two widgets on `top-right` overlap → one per anchor; stack with an offset `top` (e.g. `72px`) or move one.
- HUD digits jitter the layout → the number box is sized by its content. Give it a fixed width and `font-variant-numeric: tabular-nums`, or use `NumberDisplay` / `ProgressBar` with a fixed width.
- A label is cut off or spills out of its plate at 1000 or "Wave 10" → text overflow (*Overflow check*); widen the widget or shorten the label.
