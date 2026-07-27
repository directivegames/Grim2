# floating-damage-numbers

Extracted from Grim2's hit number system (`src/ui/HitNumberUI.ts`).

## Why object pooling for DOM elements

Creating and removing a `div` per hit is cheap in isolation but expensive at scale — a large zombie crowd can produce 30–60 hits per second during AoE attacks. DOM allocation triggers layout and GC pressure that compounds with game tick work. The pool pre-creates all elements at construction and recycles them via a free-list. Only the text content and background URL are updated per hit.

## Why the pool has an overflow recycle path

When all pool slots are in use (a burst of simultaneous hits), `_acquire` takes the oldest active element rather than returning null. This prevents hits from silently dropping during dense combat, at the cost of cutting short the animation on the oldest number. Increase `poolSize` to reduce the frequency of recycling.

## Why tick() exists alongside onfinish

The Web Animations API fires `onfinish` asynchronously and may fire late or not at all in certain edge cases (tab background, low-power mode, browser quirks). `tick()` provides a fallback sweep that checks elapsed time and releases any element that has clearly overstayed its duration. Without it, a pool of 15 elements can be exhausted by a single large burst that leaves elements "in use" past their animation lifetime.

## What was removed from the original

The original `HitNumberUI.ts` used:
- `@project/assets/UI/HitNumbersBG.webp` — a Grim-specific background sprite
- `injectBreeSerifFont()` and `sunsetNumberTextCss()` from `uiTypography.ts` — Grim's custom font and yellow glow styling
- A static singleton (`static instance`) pattern

The portable version makes the background URL and text CSS configurable constructor options, provides plain defaults, and removes the singleton. Projects that want Grim's exact look can pass their own font injection and CSS.

## Source

Extracted from `src/ui/HitNumberUI.ts` in Grim2. Renamed `HitNumberUI` to `FloatingDamageNumbers`, replaced static singleton with a plain class, and replaced Grim-specific typography imports with configurable options and plain defaults. No animation or pooling logic was changed.
