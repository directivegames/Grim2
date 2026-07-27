---
name: screen-fade
description: Use when implementing full-screen black fades, cut transitions, or element opacity transitions in a Genesys project. Covers CSS-only screen fade overlays on world.gameContainer, a composable fade-to-black-then-action sequence, and per-element fade utilities.
---

Copy [assets/ScreenFade.ts](assets/ScreenFade.ts) into your project. No engine dependency beyond `world.gameContainer`.

## Fade to black, run an action, fade back in

```ts
import { fadeToBlackThen } from './ScreenFade.js';

await fadeToBlackThen(world, async () => {
  // runs while the screen is black: swap scenes, teleport player, load assets
}, 260, 80); // fadeInMs = 260, holdMs = 80
```

The screen fades out, your action runs, then the screen fades back in. The action always runs even if the world has no `gameContainer` — the fades are skipped silently.

## Manual overlay control

```ts
import { fadeInScreen, fadeOutScreen } from './ScreenFade.js';

const container = (world as unknown as { gameContainer?: HTMLElement }).gameContainer;
if (container) {
  await fadeInScreen(container, 300);   // fade to black over 300ms
  // ... do work ...
  await fadeOutScreen(container, 400);  // fade back over 400ms
}
```

## Per-element fades

```ts
import { fadeInElement, fadeOutElement } from './ScreenFade.js';

fadeInElement(myPanel, 450);           // fire-and-forget, no await needed
await fadeOutElement(myPanel, 500);    // awaitable
```

These animate the element's CSS `opacity`. The element must have `position: absolute` or `fixed` and a visible layout for the transition to be visible.

## Stacking overlays

Each call to `createScreenFade` or `fadeInScreen` re-uses the same overlay element (identified by `data-screen-fade`). Calling it twice does not stack two black layers. To create a separate overlay at a different z-index:

```ts
import { createScreenFade, fadeInScreen } from './ScreenFade.js';

const el = createScreenFade(container, 20000); // custom z-index
```

## Constraints

- All fades are CSS `transition: opacity`. Zero render pipeline cost.
- `fadeToBlackThen` always fades back out after the action, even if the action throws. Wrap your action in try/catch if you need to handle errors before the fade-out.
- `world.gameContainer` is accessed via a cast. If your engine version exposes it under a different property name, update `getGameContainer` in the asset file.
- `fadeOutScreen` removes the overlay element from the DOM after the transition completes. A subsequent `fadeInScreen` creates a fresh element.
