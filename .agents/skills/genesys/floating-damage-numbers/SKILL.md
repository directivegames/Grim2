---
name: floating-damage-numbers
description: Use when displaying floating hit numbers or damage indicators that pop up at a 3D world position and float toward screen space in a Genesys project. Covers an object-pooled HTML overlay with elastic punch animation and world-to-screen projection using the active camera.
---

Copy [assets/FloatingDamageNumbers.ts](assets/FloatingDamageNumbers.ts) into your project.

## Create an instance

```ts
import { FloatingDamageNumbers } from './FloatingDamageNumbers.js';

// In your HUD beginPlay or pawn beginPlay:
const container = (world as unknown as { gameContainer?: HTMLElement }).gameContainer ?? null;
this._damageNumbers = new FloatingDamageNumbers(world, container, {
  backgroundImageUrl: null, // or '@project/assets/ui/hit-bg.webp' for a sprite backdrop
  poolSize: 15,
});
```

## Show a hit number

```ts
this._damageNumbers.showDamage(damage, hitWorldPosition);
```

Call from your damage handler, passing the world-space position of the hit.

## Tick each frame

```ts
// In your pawn or HUD tick:
this._damageNumbers.tick();
```

`tick` handles overflow cleanup for cases where the Web Animations API `onfinish` callback fires late. Without it, elements from a large burst of simultaneous hits may remain invisible in the pool indefinitely.

## Destroy on teardown

```ts
this._damageNumbers.destroy();
```

Call when the mission ends or the world is torn down. Removes all DOM elements and clears the pool.

## Customise appearance

### Text style

Pass a `textCss` string to override the number style:

```ts
new FloatingDamageNumbers(world, container, {
  textCss: `
    position: absolute;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%);
    font-family: 'Impact', sans-serif;
    font-size: 22px;
    color: #ff4444;
    -webkit-text-stroke: 1px #000;
  `,
});
```

The default is white bold text with a black outline readable on any background.

### Background sprite

Pass a background image URL to render a sprite behind each number:

```ts
new FloatingDamageNumbers(world, container, {
  backgroundImageUrl: '@project/assets/ui/damage-bg.webp',
});
```

URLs containing `@` are resolved via `ENGINE.resolveAssetPathsInText` at construction. Plain URLs and data URIs are used directly.

## Constraints

- Projection uses `world.getActiveCamera()`. If no camera is active, numbers are not shown.
- Pool size is fixed at construction. When all elements are in use the oldest active number is recycled immediately.
- The class is not a singleton. Create one instance per context (e.g. one for enemy hits, one for critical hits with different styling).
- Background image resolution is async. Numbers shown immediately after construction may appear without the background on the first few frames while resolution completes.
