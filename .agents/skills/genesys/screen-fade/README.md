# screen-fade

Extracted from Grim2's screen transition utilities (`src/utils/screen-transition.ts`).

## Why CSS-only fades

A CSS `opacity` transition has zero render pipeline cost. No render targets, no post-process passes, no shader changes — the browser compositor handles it. This makes it suitable for frequent use (every mission start/end, every menu transition) without any performance concern.

## Why a single overlay element

`createScreenFade` uses a `data-screen-fade` attribute to find and re-use an existing overlay rather than appending a new one. This prevents multiple callers from stacking opaque black layers if they race or call in quick succession.

## What was not extracted

Two functions from the original file were not included in the portable asset:

- `fadeOutIntroBlackCover` — fades out a specific element placed by Grim's intro actor using a Grim-specific data attribute.
- `removeAllBlockingOverlays` — clears both the screen fade and Grim's intro cover.

Both are Grim-specific. If you need similar "remove all blocking overlays on reset" behaviour, query by your own attribute names.

## Source

Extracted from `src/utils/screen-transition.ts` in Grim2. Removed the two Grim-specific functions and changed `'data-grim-screen-fade'` to `'data-screen-fade'`. No other logic was changed.
