---
name: slomo-manager
description: Use when implementing priority-stacked time dilation (slow motion) in a Genesys project. Covers a SlomoManager that prevents lower-priority sources from overriding active higher-priority slomo, and getUnscaledDeltaTime for timers that must count wall-clock seconds during slow motion.
---

Copy [assets/SlomoManager.ts](assets/SlomoManager.ts) into your project.

## Define priority constants

Add a constants object to your project. Higher number wins. Normal (no slomo) is 0.

```ts
export const SLOMO_PRIORITY = {
  normal:      0,
  comboEffect: 1,
  hitStop:     2,
  cutscene:    3,
} as const;
```

## Apply slow motion

```ts
import { slomoManager } from './SlomoManager.js';

// Returns true if slomo was applied (priority was high enough to override current state)
const applied = slomoManager.setSlomo(world, 0.1, SLOMO_PRIORITY.hitStop);
```

If a higher-priority source is already active, `setSlomo` does nothing and returns false.

## Restore

```ts
// Restore from an exact priority match (use when you know you are the current owner):
slomoManager.resetIfPriority(world, SLOMO_PRIORITY.hitStop);

// Remove a priority entry from the stack without needing to know current state:
slomoManager.removePriorityAndRestore(world, SLOMO_PRIORITY.comboEffect);

// Hard reset — call during mission end, game over, or world teardown:
slomoManager.forceReset(world);
```

## Wall-clock timers during slow motion

Engine tick `deltaTime` is scaled by `world.slomo`. Use `getUnscaledDeltaTime` for any timer that must expire in real seconds while slomo is active (effect windows, UI fades, sound durations):

```ts
import { getUnscaledDeltaTime } from './SlomoManager.js';

// In your tick:
this._elapsed += getUnscaledDeltaTime(world, deltaTime);
if (this._elapsed >= DURATION_SEC) {
  slomoManager.removePriorityAndRestore(world, SLOMO_PRIORITY.comboEffect);
}
```

## Hit-stop pattern

A common use is a brief hit-stop on a heavy attack land:

```ts
// On hit:
if (slomoManager.setSlomo(world, 0.04, SLOMO_PRIORITY.hitStop)) {
  this._hitStopElapsed = 0;
}

// In tick:
this._hitStopElapsed += getUnscaledDeltaTime(world, deltaTime);
if (this._hitStopElapsed >= HIT_STOP_DURATION) {
  slomoManager.resetIfPriority(world, SLOMO_PRIORITY.hitStop);
}
```

## Constraints

- `slomoManager` is a module-level singleton. One instance per project.
- Always call `forceReset(world)` during world teardown or mission reset. A leaked slomo state will carry over to the next session.
- `removePriorityAndRestore` is safe to call even when the priority is not currently active — it is a no-op in that case.
- `world.slomo` is accessed via a cast to `unknown`. If a future engine version exposes it differently, update the cast in the asset file.
