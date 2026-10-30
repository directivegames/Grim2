# Settings, UI sound, and the style brief

## Settings screen

Every game with sound ships volume controls: Music and Effects, each 0–100, on the pause screen, with a Settings button on the title that opens the same panel. Values apply live and survive a reload. Any music track, paid or synthesised, needs a volume control; shipping one without is a defect.

| Control | Build | Bus |
|---|---|---|
| Music volume | Range 0–100, step 5, default 100 | `getBus('Music')` |
| Effects volume | Range 0–100, step 5, default 100 | `getBus('SFX')` (also `Ambience` if the game has ambience) |
| Mute all (optional) | `Toggle` beside a text label | `getBus('Master')` 0 / 1 |
| Look sensitivity, invert Y (aim games) | Same row shape | `genesys-camera` owns the values |

- **Bus, not clip.** Clip levels come from the sound-set table in `genesys-audio`; the settings move the buses. Map the slider to gain as `(v / 100) ** 2` so the range feels even.
- **Persistence.** One guarded `localStorage` key per game, read at `beginPlay` and applied once the buses exist (`getBus` creates them on demand). The persistence rules are `genesys-game-boot`'s.
- **No slider widget exists.** Use a raw `<input type="range">` under `world.gameContainer` (below), or −/+ `Button`s with a `NumberDisplay` (touch-first or when the panel must match widget styling).
- The panel is a centred plate in the design tokens of [customization](customization.md): padding 17 px, radius 16 px, primary text `#e8eaed`. It sits at `z-index` 1001, above `#ui-container` (1000). The pause card's Settings button hides the pause card and shows the panel; a Back `Button` at `bottom-center` hides the panel and shows the pause card again. Leaving pause hides both.

Source: `.engine/src/utils/GlobalAudioManager.ts` (`getBus`), `.engine/src/utils/AudioBus.ts` (`setVolume`) — typechecked against 18.1.0-alpha.317
```ts
// One volume row: label, range input, value readout. Bus gain = (v/100)^2 so the slider feels even.
const KEY = 'my-game.settings.v1';            // guarded localStorage (persistence rules: genesys-game-boot)
type Volumes = Record<'Music' | 'SFX', number>;
export function loadVolumes(): Volumes {
  try { return { Music: 100, SFX: 100, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') }; }
  catch { return { Music: 100, SFX: 100 }; }
}
export function applyVolume(world: ENGINE.World, bus: 'Music' | 'SFX', v: number): void {
  world.globalAudioManager.getBus(bus)?.setVolume((v / 100) ** 2);
}
export function volumeRow(world: ENGINE.World, panel: HTMLElement, bus: 'Music' | 'SFX', vols: Volumes): void {
  const row = document.createElement('label');
  row.style.cssText = 'display:grid;grid-template-columns:72px 180px 40px;gap:8px;align-items:center;color:#e8eaed;font:600 14px/20px system-ui,sans-serif';
  const name = document.createElement('span'); name.textContent = bus === 'SFX' ? 'Effects' : 'Music';
  const range = document.createElement('input');
  range.type = 'range'; range.min = '0'; range.max = '100'; range.step = '5'; range.value = String(vols[bus]);
  const readout = document.createElement('span'); readout.textContent = `${vols[bus]}%`;
  range.addEventListener('input', () => {
    vols[bus] = Number(range.value);
    readout.textContent = `${vols[bus]}%`;
    applyVolume(world, bus, vols[bus]);
    try { localStorage.setItem(KEY, JSON.stringify(vols)); } catch { /* private mode: keep the live value */ }
  });
  range.addEventListener('change', () => range.blur());   // arrow keys and Space go back to the game
  row.append(name, range, readout);
  panel.append(row);
}
export function mountSettings(world: ENGINE.World): HTMLElement {
  const panel = document.createElement('div');
  panel.style.cssText = 'position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);z-index:1001;display:none;flex-direction:column;gap:12px;padding:17px;border-radius:16px;background:rgba(20,22,34,0.88);pointer-events:auto';
  const vols = loadVolumes();
  volumeRow(world, panel, 'Music', vols);
  volumeRow(world, panel, 'SFX', vols);
  applyVolume(world, 'Music', vols.Music); applyVolume(world, 'SFX', vols.SFX);
  world.gameContainer?.appendChild(panel);   // never document.body
  return panel;                               // show: panel.style.display = 'flex'; hide: 'none'
}
```

Widget-only alternative (−/+ steps of 10 and a mute `Toggle`; place each with `setPosition` around the pause card):

Source: `.engine/src/ui/components/NumberDisplay.ts`, `Button.ts`, `Toggle.ts` — typechecked against 18.1.0-alpha.317
```ts
const ui = world.uiManager;
let music = 100;
const readout = new ENGINE.NumberDisplay(ui, { label: 'Music', initialValue: music, suffix: '%', minValue: 0, maxValue: 100 });
await readout.initialize();
const step = (d: number) => { music = Math.max(0, Math.min(100, music + d)); readout.setValue(music, false); applyVolume(world, 'Music', music); };
const minus = new ENGINE.Button(ui, { ...ENGINE.Button.presets.secondarySmall, label: '−', onClick: () => step(-10) });
const plus = new ENGINE.Button(ui, { ...ENGINE.Button.presets.secondarySmall, label: '+', onClick: () => step(10) });
await minus.initialize(); await plus.initialize();
const mute = new ENGINE.Toggle(ui, { on: true, onChange: (on) => world.globalAudioManager.getBus('Master')?.setVolume(on ? 1 : 0) });
await mute.initialize();
```

`Toggle` is a bare switch with no label. Put a text label beside it (a `Message`, or text in the raw panel).

## UI sound

If the game has sound, its buttons make sound too; a silent menu is a defect. Every `Button` plays a confirm one-shot in `onClick` (volume 0.5); menu buttons also play a hover tick (volume 0.2) on `pointerenter`. Cancel and Back use the cancel clip. `playSfx` is the throttled helper from `genesys-audio`; it already drops repeats inside 60 ms.

Source: `.engine/src/ui/components/BaseUIComponent.ts` (`getElement`), `.engine/src/ui/UIElement.ts` (`on`), `.engine/src/ui/components/Button.ts` — typechecked against 18.1.0-alpha.317
```ts
const retry = new ENGINE.Button(world.uiManager, { ...ENGINE.Button.presets.primaryLarge, label: 'Retry',
  onClick: () => {
    playSfx(world, '@project/assets/audio/confirm.wav', undefined, 0.5);
  } });
await retry.initialize();
retry.getElement()?.on('pointerenter', () => playSfx(world, '@project/assets/audio/click.wav', undefined, 0.2));
```

## The style brief

One brief styles the whole game: `GAME.md` → Art direction (one sentence) + Palette (5–8 hexes). UI and lighting both read it; a second, separate look for the menus is a defect. Add these lines under the palette when the UI is built:

```text
UI accent   #ffb347  (buttons, fills, highlights — one palette colour)
UI plate    glass    (Card variant; or default/elevated)
Fonts       display "GameDisplay" (assets/ui/fonts/display.woff2) · body system stack "rounded"
Title       left rail (title art subject sits right)
```

- **Accent** goes to the primary `Button` and `ProgressBar` fills through `customClasses` + one project CSS rule ([customization](customization.md)); health stays red and danger stays red whatever the accent.
- **Grade and fog** (`genesys-lighting`) take their tints from the same palette.

### Fonts

The engine ships Inter (weights 100-900; Latin, Cyrillic, Greek and Vietnamese) and adds it to the page with the first UI, so every widget shows Inter by default, and `'Inter'` works in any stack with no file of your own. For a direction with its own look, pick a pair on purpose:

- **Google Fonts link.** Allowed for now (experimental). Add one `<link>` to `document.head` with a fixed `id` so it loads once, and keep a system fallback stack. The pattern is in [custom-hud](custom-hud.md).
- **Project font.** A `.woff2` under `assets/ui/fonts/` (supplied by the creator, or an open-licence font the creator approves downloading; it is an Assets row in `genesys-assets` with its licence). Load it with `@font-face` in a `<style>` under `world.gameContainer`, the URL resolved by `ENGINE.resolveAssetPathsInText`. Write each `@project/...` path as one literal so the build copies the file. The `document.fonts.check` line logs when it did not load; verify in Play once.
- **System stack** when there is no font file. Pick the stack for the style:

| Style | Display (titles, buttons) | Body |
|---|---|---|
| Clean / sci-fi / default | `system-ui, -apple-system, "Segoe UI", Roboto, sans-serif` at weight 700 | same, weight 400 |
| Rounded / cozy / kids / puzzle | `ui-rounded, "SF Pro Rounded", "Nunito", "Varela Round", system-ui, sans-serif` | same |
| Fantasy / storybook / horror | `"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, serif` | `system-ui, sans-serif` |
| Arcade / retro / terminal | `ui-monospace, "SF Mono", Menlo, Consolas, monospace` | same |
| Sports / racing / military | `Impact, "Haettenschweiler", "Arial Narrow Bold", sans-serif` | `"Arial Narrow", "Roboto Condensed", Arial, sans-serif` |

Source: `.engine/src/storage/projectContext.ts` (`resolveAssetPathsInText`), `.engine/src/ui/UILayout.ts` (`.ui-layout` wrapper) — typechecked against 18.1.0-alpha.317
```ts
// Once, before the first widget mounts. Each @project path stays one full literal so the build copies the file.
const css = await ENGINE.resolveAssetPathsInText(
  '@font-face{font-family:"GameDisplay";src:url("@project/assets/ui/fonts/display.woff2") format("woff2");font-display:swap}' +
  '@font-face{font-family:"GameBody";src:url("@project/assets/ui/fonts/body.woff2") format("woff2");font-display:swap}' +
  '#ui-container .ui-layout>*{font-family:"GameBody",system-ui,sans-serif}' +
  '#ui-container .ui-card-title,#ui-container .ui-center-message-title,#ui-container .ui-button{font-family:"GameDisplay",system-ui,sans-serif}');
const style = document.createElement('style');
style.textContent = css;
world.gameContainer?.appendChild(style);
await document.fonts.load('32px GameDisplay');
if (!document.fonts.check('32px GameDisplay')) console.warn('[ui] display font did not load; the system stack is showing');
```

The same rule with a system stack has no `@font-face` and no await: one `<style>` with the two `font-family` lines.

Numbers in a HUD use tabular figures so digits do not shift: `font-variant-numeric: tabular-nums` on the widget's `customClasses` rule.

## Title composition

| Composition | When | Card | Start |
|---|---|---|---|
| Centred card | Puzzle, arcade, party; no title art | `center` | `bottom-center` |
| Left rail | Adventure, RPG, shooter; title art whose subject sits right | `{ position: 'absolute', top: '50%', left: '48px', transform: 'translateY(-50%)', width: 'max-content' }` | `{ position: 'absolute', bottom: '14%', left: '48px' }` |
| Bottom bar | Racer, sports, platformer; a wide hero shot | `{ position: 'absolute', bottom: '24px', left: '50%', transform: 'translateX(-50%)', width: 'min(880px, 92vw)' }` | `{ position: 'absolute', bottom: '40px', right: '8%' }` |
| Corner | Horror, cozy, atmospheric; the scene or art is the picture | `{ position: 'absolute', bottom: '32px', left: '32px', width: 'max-content' }` | `{ position: 'absolute', bottom: '32px', right: '32px' }` |

Choose the composition from the genre and the title art, and write it in the style brief. Defaulting every title to the centred card is the failure mode. Pause and result stay centred whatever the title uses.
