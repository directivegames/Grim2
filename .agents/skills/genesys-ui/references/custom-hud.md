# Custom HUD layer

A bespoke DOM and SVG layer gives each game its own UI: its fonts, its shapes, its colours and one signature element. Engine widgets with the default kit look make every game look the same. This file shows how to build that layer so it stays safe, readable and testable.

The rules do not change with the look. Mount under `world.gameContainer`. Write dynamic strings through `textContent` only. Keep sizes readable and pieces apart. Use real `<button>`s at touch size. Show and hide pieces only from the screen state machine (`genesys-game-boot`).

## Custom layer, styled widgets, or a mix

Decide per surface. The usual whole build is a mix: the custom layer for the HUD, title, result and banners, and restyled engine widgets for settings and other behaviour-heavy panels.

| Surface | Default | Reason |
|---|---|---|
| HUD meters, counters, reticle, banners | Custom layer | They carry the art direction and the signature element |
| Title and result screens | Custom layer, composition from [settings-and-style](settings-and-style.md) | First and last impression of the game |
| Pause card | Custom layer, or a `Card` restyled with the skin variables | Either is fine; match the title |
| Settings and volume rows | Engine widgets or the raw range row in [settings-and-style](settings-and-style.md), restyled with the skin variables | Behaviour and persistence already exist |
| Inventory grid, minimap, chat, `Achievement` toast | Engine widgets, restyled | Complex behaviour; do not rebuild it |
| Nameplates, overhead bars, interact prompts | `UI3DNode` hosting a widget ([world-space](world-space.md)) | The engine projects them every frame |
| A focused fix on a game whose HUD is engine widgets | Styled engine widgets | Change only that surface |

Record the choice in `GAME.md` with the UI direction (below). A game with no UI direction line gets one before the first UI code.

## The HUD module

Put the layer in one module, `src/ui/hud.ts`, with one class. The GameMode owns one instance: it mounts it in `beginPlay`, calls `show(state)` from `transitionToState`, and destroys it in `endPlay`. A larger HUD splits into one file per piece (`hud-score.ts`, `hud-health.ts`) under the same class.

The pattern:
- Build the DOM once in `mount`. Never rebuild it per state or per frame.
- Write one `<style>` element. Prefix every selector with one unique root class, so no rule leaks into the editor or the engine widgets.
- Cache every element you update in a field.
- Write `textContent` only when the value changed. A per-frame write of the same text still costs a style pass.
- Toggle the `hidden` attribute per state. The `[hidden]{display:none!important}` rule keeps it stronger than any `display` in the skin.
- Remove the root and the `<style>` in `destroy`.

The root is `position:absolute; inset:0; z-index:1000; pointer-events:none`. The engine's `#ui-container` has the same z-index (`.engine/src/ui/UIManager.ts:35-50`). The HUD root is appended later, so it paints above the widgets. Title art sits at 999, below both ([placement](placement.md)). Each interactive piece sets `pointer-events:auto` on itself.

Source: Composed — typechecked against 18.1.0-alpha.317 (`World.gameContainer` `.engine/src/game/World.ts:410`, `World.isHeadless` `World.ts:458`)
```ts
import * as ENGINE from '@gnsx/genesys.js';
export enum RunState { Title, Playing, Paused, Result }
const R = 'hud-k7';   // unique root class; every selector starts with it
const CSS = `
.${R}{position:absolute;inset:0;z-index:1000;pointer-events:none;font-family:var(--hud-body);color:var(--hud-ink)}
.${R} [data-hud-item]{position:absolute}
.${R} [hidden]{display:none!important}
.${R} .${R}-plate{background:var(--hud-plate);border:var(--hud-line) solid var(--hud-outline);border-radius:var(--hud-radius);box-shadow:var(--hud-shadow);padding:8px 14px}
.${R} .${R}-score{top:16px;right:16px;width:7ch;text-align:right;font:700 28px/1 var(--hud-display);font-variant-numeric:tabular-nums}
.${R} .${R}-start{bottom:24px;left:50%;transform:translateX(-50%);pointer-events:auto;min-width:180px;min-height:52px;
  font:700 22px/1 var(--hud-display);color:var(--hud-ink);background:var(--hud-accent);
  border:var(--hud-line) solid var(--hud-outline);border-radius:var(--hud-radius);box-shadow:var(--hud-shadow);cursor:pointer}`;

export class GameHud {
  private root: HTMLDivElement | null = null;
  private style: HTMLStyleElement | null = null;
  private score: HTMLDivElement | null = null;
  private start: HTMLButtonElement | null = null;
  private lastScore = Number.NaN;
  public mount(world: ENGINE.World, onStart: () => void): void {
    const host = world.gameContainer;
    if (!host || world.isHeadless() || this.root) return;   // no DOM on a server; mount once
    this.style = document.createElement('style'); this.style.textContent = CSS;
    this.root = document.createElement('div');
    this.root.className = R; this.root.dataset.hud = '';     // smoke helpers find the layer by data-hud
    this.score = this.item('div', `${R}-plate ${R}-score`);
    this.start = this.item('button', `${R}-start`);
    this.start.type = 'button';
    this.start.textContent = 'Start';
    this.start.addEventListener('click', () => { this.start?.blur(); onStart(); });
    host.append(this.style, this.root);                      // world.gameContainer, never document.body
  }
  private item<K extends 'div' | 'button'>(tag: K, cls: string): HTMLElementTagNameMap[K] {
    const el = document.createElement(tag);
    el.className = cls;
    el.dataset.hudItem = '';                                 // one per separately placed piece
    this.root?.append(el);
    return el;
  }
}
```

Add the change-only update, the state switch and the teardown to the same class.

Source: Composed — typechecked against 18.1.0-alpha.317 (same file as above)
```ts
  public setScore(v: number): void {
    if (v === this.lastScore || !this.score) return;         // DOM write only when the value changes
    this.lastScore = v;
    this.score.textContent = String(v);
  }

  public show(state: RunState): void {
    if (this.score) this.score.hidden = state !== RunState.Playing;
    if (this.start) this.start.hidden = state !== RunState.Title;
  }

  public destroy(): void {
    this.root?.remove();
    this.style?.remove();
    this.root = this.style = this.score = this.start = null;
    this.lastScore = Number.NaN;
  }
```

The GameMode owns the instance. Push values from the events that change them (score, damage, pickup). If a value has no event, poll it in `tickPrePhysics` and let `setScore` drop the repeats. `SceneNode.endPlay` asks subclasses to call `super.endPlay()` first and continue only when it returns true (`.engine/src/nodes/SceneNode.ts:580-585`).

Source: `.engine/src/game/GameMode.ts` (`beginPlay`, `endPlay` at line 949) — typechecked against 18.1.0-alpha.317
```ts
import * as ENGINE from '@gnsx/genesys.js';
import { GameHud, RunState } from './ui/hud.js';

@ENGINE.GameClass()
export class ArenaGameMode extends ENGINE.GameMode {
  private readonly hud = new GameHud();
  private state = RunState.Title;
  private score = 0;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    const world = this.getWorld();
    if (world) this.hud.mount(world, () => this.launchRun());
    this.transitionToState(RunState.Title);
    return true;
  }

  public addScore(points: number): void {
    this.score += points;
    this.hud.setScore(this.score);          // event-driven: the HUD changes when the score does
  }

  public launchRun(): void {
    this.score = 0;
    this.hud.setScore(0);
    this.transitionToState(RunState.Playing);
  }

  public transitionToState(next: RunState): void {
    this.state = next;
    this.hud.show(next);                    // same switch that shows engine widgets (genesys-game-boot)
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) return false;
    this.hud.destroy();                     // Stop Play leaves no HUD behind in the editor view
    return true;
  }
}
```

In a mixed UI, `transitionToState` calls both `screens.show(state)` (widgets) and `hud.show(state)` (custom layer). Keep one switch for both.

### Readable and touch-sized

- HUD numbers: 22–32 px. Labels and body text: 14 px minimum. On phones, size with `clamp(20px, 2.6vw, 32px)`.
- Buttons: at least 48 × 48 px hit area, 52 px tall for the main action. Keep 12 px between buttons.
- Margins: 16 px from the top and sides, 24 px from the bottom. Keep the centre third clear during play ([placement](placement.md)).
- Text on a plate: ink against plate at a contrast of 4.5:1 or more. Text straight on the scene gets a 2–3 px outline (`paint-order: stroke` on SVG text, or `text-shadow` in all four directions).
- Counters: a fixed width in `ch` with `font-variant-numeric: tabular-nums`. A value change never moves a neighbour.

## Fonts

Each direction names a display font and a body font. Load them before the title shows. Always end each stack with a system fallback from the table in [settings-and-style](settings-and-style.md).

**Google Fonts (experimental, allowed for now).** Add one `<link>` to `document.head`. A `<link>` in the head is not UI, so the `document.body` rule does not apply. Give it a fixed `id` so a second mount adds nothing. Request `display=swap`, so the fallback shows until the font arrives. If the player is offline, or the network blocks Google, the fallback stack shows. Verify the font in a shared game. The player's browser contacts Google to fetch the font. Tell the creator once when you add it.

**Bundled file (the stable route).** Put a `.woff2` under `assets/ui/fonts/` with its licence as an Assets row (`genesys-assets`). Resolve the path with `ENGINE.resolveAssetPathsInText` (`.engine/src/storage/projectContext.ts:127`) and add it with the browser `FontFace` API. Write the `@project/...` path as one literal so the build copies the file. The `<style>` + `@font-face` form is in [settings-and-style](settings-and-style.md).

Source: `.engine/src/storage/projectContext.ts` (`resolveAssetPathsInText`); browser `FontFace` and `document.fonts` — typechecked against 18.1.0-alpha.317
```ts
import * as ENGINE from '@gnsx/genesys.js';

// Google Fonts: one <link> in document.head, deduped by id. display=swap shows the fallback until it loads.
export function loadWebFonts(familiesQuery: string): void {
  const id = 'game-webfonts';
  if (document.getElementById(id)) return;                 // a second mount or a Retry adds nothing
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = `https://fonts.googleapis.com/css2?${familiesQuery}&display=swap`;
  document.head.append(link);
}
loadWebFonts('family=Bungee&family=Nunito:wght@400;700');
// Stacks: web font first, system fallback last.
export const DISPLAY = '"Bungee", Impact, "Arial Black", system-ui, sans-serif';
export const BODY = '"Nunito", ui-rounded, system-ui, sans-serif';

// Check once after the first title shows; log the fallback instead of failing.
export async function reportFont(family: string): Promise<void> {
  await document.fonts.load(`32px "${family}"`);
  if (!document.fonts.check(`32px "${family}"`)) console.warn(`[hud] ${family} did not load; the fallback stack is showing`);
}

// Bundled file: keep the @project path one literal so the build copies it.
export async function loadBundledFont(): Promise<void> {
  const url = await ENGINE.resolveAssetPathsInText('@project/assets/ui/fonts/display.woff2');
  const face = new FontFace('GameDisplay', `url("${url}") format("woff2")`, { display: 'swap' });
  document.fonts.add(await face.load());
}
```

Write family names with `+` for spaces in the query (`family=Space+Grotesk:wght@500;700`). Leave the `<link>` in the head after `endPlay`; the id check stops duplicates. Give `TextNode` and other canvas text the loaded family name in `fontFamily`. Draw them after `reportFont` resolves. If you draw them earlier, they render in the fallback font.

## Skin: one block of variables

The art direction becomes CSS custom properties. Every rule in the HUD reads them, so changing one object re-skins the whole layer. Set the variables on `world.gameContainer`. The HUD root and the engine's `#ui-container` both sit inside it, so restyled widgets inherit the same skin.

Add the direction to `GAME.md` under the Palette, next to the style brief from [settings-and-style](settings-and-style.md):

```text
UI direction  chunky arcade
UI layer      custom HUD + title + result; engine widgets for settings and toasts
Fonts         display "Bungee" · body "Nunito" (Google Fonts) · fallback Impact / ui-rounded
Shape         radius 14px · skew -6deg · line 4px · hard shadow 0 5px 0 outline
Colours       plate #ff4f9a · accent #ffd23f · ink #ffffff · outline #1a1030 · danger #ff3b3b
Signature     score burst tilts and pops on every point
```

Source: Composed — typechecked against 18.1.0-alpha.317
```ts
// One block of variables re-skins the HUD. Values are developer-authored, never player or network strings.
export interface HudSkin {
  display: string; body: string;                      // font stacks, fallback last
  ink: string; outline: string; plate: string;        // text, outline, panel fill
  accent: string; danger: string;                     // palette roles from GAME.md
  radius: string; skew: string; line: string;         // shape language
  shadow: string;                                     // shadow style
}

export const ARCADE: HudSkin = {
  display: '"Bungee", Impact, "Arial Black", sans-serif', body: '"Nunito", ui-rounded, system-ui, sans-serif',
  ink: '#ffffff', outline: '#1a1030', plate: '#ff4f9a', accent: '#ffd23f', danger: '#ff3b3b',
  radius: '14px', skew: '-6deg', line: '4px', shadow: '0 5px 0 #1a1030',
};

export function applySkin(host: HTMLElement, s: HudSkin): void {
  const vars: Record<string, string> = {
    '--hud-display': s.display, '--hud-body': s.body, '--hud-ink': s.ink, '--hud-outline': s.outline,
    '--hud-plate': s.plate, '--hud-accent': s.accent, '--hud-danger': s.danger, '--hud-radius': s.radius,
    '--hud-skew': s.skew, '--hud-line': s.line, '--hud-shadow': s.shadow,
  };
  for (const [k, v] of Object.entries(vars)) host.style.setProperty(k, v);
}
// Call applySkin(world.gameContainer, ARCADE) before mount: the HUD and #ui-container widgets inherit it.
```

Restyle the engine widgets you keep with the same variables. Put these rules in the HUD's `<style>`. `#ui-container` in front of the class outranks the widget stylesheets, which use no `!important` (`node_modules/@gnsx/genesys.js/assets/ui/styles/button.css`, `card.css`). The engine button reads its colour from `--ui-btn-bg`, set per variant.

Source: `node_modules/@gnsx/genesys.js/assets/ui/styles/button.css` (`--ui-btn-bg`, `.variant-primary`), `card.css` (`.ui-card`, `.ui-card-title`)
```css
#ui-container .ui-card { background: var(--hud-plate); border: var(--hud-line) solid var(--hud-outline);
  border-radius: var(--hud-radius); box-shadow: var(--hud-shadow); font-family: var(--hud-body); color: var(--hud-ink); }
#ui-container .ui-card-title, #ui-container .ui-button { font-family: var(--hud-display); }
#ui-container .ui-button.variant-primary { --ui-btn-bg: var(--hud-accent); --ui-btn-bg-hover: var(--hud-accent);
  border-radius: var(--hud-radius); }
```

### Directions

These are principles to derive from, not a house style. Start from the genre and the `GAME.md` art direction and palette. Choose one row as a base, then change at least the colours and the signature to fit the game.

| Direction | Fonts (display · body) | Shape language | Colours and shadow | Signature element |
|---|---|---|---|---|
| Clean minimal sci-fi | Rajdhani 600 · Inter | Radius 2px, 1px hairlines, cut corners with `clip-path` | Dark translucent plate, one cold accent, glow shadow `0 0 12px` accent | Corner brackets on plates; a segmented energy bar |
| Chunky comic / arcade | Bungee · Nunito | Radius 14px, skew −6°, 4px outline | Saturated plate, white ink, hard offset shadow `0 5px 0` outline | A tilted score burst that pops on each point |
| Painterly fantasy parchment | Cinzel · Alegreya | Radius 6px, 2px double border, notched ribbon ends | Parchment plate, brown ink, gold accent, soft shadow `0 4px 14px` | A ribbon banner for wave and quest text; wax-seal hearts |
| Retro pixel | Press Start 2P · VT323 | Radius 0, stepped 4px borders, `image-rendering: pixelated` on icons | A 4–8 colour palette, hard shadow `4px 4px 0` | Blocky pips and a blinking "PRESS START" |
| Soft cozy | Fredoka · Nunito | Pills and 24px radius, 0–2px lines | Pastel plate, warm dark ink, soft shadow `0 6px 16px` at 18% | Leaf or heart icons that wobble gently on change |

Principles:
- One signature element per game. It appears on the title and in the HUD, and nowhere else is louder.
- Skew a plate's `::before` background, not the plate. Text stays upright and readable.
- Health and danger stay red in every direction. The accent never replaces them.
- Two fonts at most. The display font goes on titles, buttons and numbers; the body font goes on everything else.
- Check the widest value in each font. Press Start 2P and Bungee are wide, so "Wave 10" or "1000" needs a wider plate.

## Inline SVG pieces

Build hearts, pips, reticles and icons with `document.createElementNS`. Paths and shapes are static, developer-authored strings. After the build, change only attributes, classes or styles; never re-parse markup. This keeps the Safe UI grep (`innerHTML|Html(`) clean. For a stock icon, use `ENGINE.Icons.*` through a widget's `iconHtml` ([safe-ui](safe-ui.md)). Colour SVG through `style.fill` and `style.stroke`, which accept `var(--hud-*)`.

Source: Composed — typechecked against 18.1.0-alpha.317
```ts
const NS = 'http://www.w3.org/2000/svg';
const HEART = 'M12 21 3.5 12.5A5 5 0 0 1 12 6a5 5 0 0 1 8.5 6.5Z';   // static, developer-authored

// A row of heart pips. Only styles change afterwards; no markup is ever re-parsed.
export function makePips(row: HTMLElement, max: number): SVGSVGElement[] {
  const pips: SVGSVGElement[] = [];
  for (let i = 0; i < max; i++) {
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', HEART);
    path.style.fill = 'var(--hud-danger)';             // style, not the fill attribute: var() works here
    path.style.stroke = 'var(--hud-outline)';
    path.style.strokeWidth = '2';
    svg.append(path);
    row.append(svg);
    pips.push(svg);
  }
  return pips;
}

export function setPips(pips: SVGSVGElement[], value: number): void {
  pips.forEach((p, i) => { p.style.opacity = i < value ? '1' : '0.25'; });
}
```

A reticle is the same pattern: four `line` elements in a `viewBox="-16 -16 32 32"`, stroked with `var(--hud-ink)`, in a `data-hud-item` centred with `top:50%; left:50%; transform:translate(-50%,-50%)`. It is decoration, so it takes `pointer-events:none`. Show it only with locked aim (`genesys-camera` owns the aim mode).

## Motion

Animate with the Web Animations API (`element.animate`). Animate only `scale`, `translate`, `rotate` and `opacity`. These individual properties compose with an anchor's `transform`, so a centred piece keeps its place. Never read layout (`getBoundingClientRect`, `offsetWidth`) in a per-frame path. Animations run on the browser clock, so they finish during pause.

Respect reduced motion. If `prefers-reduced-motion: reduce` matches, skip the pop and swap slides and shakes for opacity fades. The moment keeps a UI channel either way.

Source: Composed — typechecked against 18.1.0-alpha.317 (browser Web Animations API)
```ts
// Web Animations API on transform-type properties and opacity only: no layout reads, no class-toggle reflow.
// The `scale` and `translate` properties compose with the anchor's `transform`, so a centred item keeps its place.
const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

export function pop(el: HTMLElement): void {                 // value-change pop, 220 ms
  if (reducedMotion()) return;
  el.animate([{ scale: '1' }, { scale: '1.3', offset: 0.35 }, { scale: '1' }],
    { duration: 220, easing: 'cubic-bezier(.2,.9,.3,1.4)' });
}

// Banner: slide in, hold, slide out in one 1.8 s animation, then hide. Text goes in through textContent.
export function banner(item: HTMLElement, label: HTMLElement, text: string): void {
  label.textContent = text;
  item.hidden = false;
  const frames: Keyframe[] = reducedMotion()
    ? [{ opacity: 0 }, { opacity: 1, offset: 0.1 }, { opacity: 1, offset: 0.9 }, { opacity: 0 }]
    : [{ translate: '0 -140%', opacity: 0 }, { translate: '0 0', opacity: 1, offset: 0.15 },
       { translate: '0 0', opacity: 1, offset: 0.85 }, { translate: '0 -140%', opacity: 0 }];
  item.getAnimations().forEach(a => a.cancel());              // a new banner replaces the old one
  item.animate(frames, { duration: 1800, easing: 'ease-out' }).finished
    .then(() => { item.hidden = true; }, () => { /* cancelled by the next banner */ });
}

// Damage shake, 240 ms. Reduced motion swaps it for a flash so the hit keeps its UI channel.
export function shake(plate: HTMLElement): void {
  const frames: Keyframe[] = reducedMotion()
    ? [{ opacity: 1 }, { opacity: 0.35 }, { opacity: 1 }]
    : [0, -6, 5, -4, 3, 0].map(x => ({ translate: `${x}px 0` }));
  plate.animate(frames, { duration: reducedMotion() ? 200 : 240, easing: 'linear' });
}
```

Call `pop` from `setScore` after the text changes, not every frame. A banner (wave, lap, "Finish!") sits at `top-center` or the upper third and lasts under 2 s. Camera shake and hitstop are `genesys-game-feel`; the HUD shake is the UI channel beside them.

## World-to-screen elements

Floating damage numbers, nameplates, overhead bars and markers follow [world-space](world-space.md). Do not project points by hand. To match the skin:
- A widget hosted by `UI3DNode` lives in `#ui-container`, so it inherits the variables set on `world.gameContainer`. Give it `customClasses` and one rule that reads `var(--hud-*)`.
- `TextNode` draws on a canvas, which cannot read CSS variables. Pass the hex and the font family from the same `HudSkin` object.

## Verification

The smoke helpers in `genesys-verification` (`templates/smoke-test.ts`) test the custom layer by these markers. Follow them exactly:

- The HUD root carries `data-hud`.
- Every separately placed piece carries `data-hud-item`: each panel, meter, counter, banner, reticle and button group.
- Every clickable control is a real `<button>`. `clickByText` searches `button, [role="button"]` inside `world.gameContainer` and calls `.click()`.
- A full-screen decorative layer (vignette, scanlines, frame) takes `pointer-events:none`. `clickByText` fails when another element covers a button's centre.
- A hidden piece uses the `hidden` attribute or `display:none`. `isVisible` then skips it, and it takes no clicks.

What the helpers check:
- `clickByText(world, 'Start')`: the button is visible, enabled, and the top element at its centre.
- `uiOverlaps(world)`: visible `[data-hud-item]` boxes and engine widget roots overlap by no more than 2 px. A piece nested inside another piece does not count.
- `textOverflow(world)`: no visible text inside `[data-hud]` or a widget is wider than its box. The smoke test drives counters from 9 to 1000 and meters to 0, 50 and 100.
- Captures in Play show the direction: the fonts loaded, the signature element visible, nothing clipped (`screen.clipped-text`) or covered (`screen.covered`).

Run the Safe UI grep from [safe-ui](safe-ui.md) on `src/ui/`. A custom HUD built as above adds no hits.

## Traps

- If the HUD sits outside the game view or stays after Stop, it was appended to `document.body`. Append the root to `world.gameContainer`. Remove it in the owner's `endPlay`.
- If a second HUD appears after Retry or a level load, `mount` ran again. Guard `mount` with the root field. Show and hide only in `transitionToState`.
- If a player name runs script or shows tags, it went through `innerHTML`. Assign it to `textContent`.
- If `clickByText` reports the button covered, a decorative layer takes pointer events. Set `pointer-events:none` on the layer.
- If Start does nothing in the smoke test, the control is a `<div>` with a click listener. Make it a `<button type="button">`.
- If Space restarts the run after a click, the button kept focus. Call `blur()` in the click handler.
- If a hidden piece still shows, a skin rule sets `display` on it. Keep the `[hidden]{display:none!important}` rule in the root style.
- If the score plate jumps as digits change, the plate is sized by its content. Give it a fixed `ch` width and `tabular-nums`.
- If `textOverflow` lists a counter at 1000, the plate is too narrow for the display font. Widen the plate, or shorten the label.
- If `uiOverlaps` lists two pieces, they share an anchor. Offset the second piece, or move it to a free edge.
- If the frame rate drops with the HUD on, the tick writes the DOM every frame. Write only when a value changes.
- If a centred banner jumps sideways during its slide, the animation sets `transform`. Animate `translate` instead.
- If every font looks like the browser default, the font did not load and the stack has no fallback. Add a system stack, and check with `reportFont`.
- If the Google font is missing only in a shared game, the network or the page blocks Google. Bundle a `.woff2` under `assets/ui/fonts/`.
- If a bundled font is missing only after a build, its path was built from parts. Write the `@project/assets/ui/fonts/...` path as one literal.
- If an engine `Card` keeps the default look beside the custom HUD, its rules lack the `#ui-container` prefix. Prefix them, or set the skin on `world.gameContainer`.
- If a damage number uses the wrong colour or font, `TextNode` cannot read CSS variables. Pass the values from the `HudSkin` object.
- If every game looks alike, nobody wrote a UI direction. Write the direction lines in `GAME.md` before the first UI code.
