# slomo-manager

Extracted from Grim2's kill-streak and hit-stop systems (`src/actors/KillStreakTracker.ts` and `src/utils/slomo-time.ts`).

## Why a priority stack instead of a single value

Multiple systems can request slow motion at the same time — a kill streak may be active when a heavy hit lands and triggers a hit-stop. Without prioritisation, whichever system restores slomo last wins, which causes one system to prematurely cancel another.

The priority stack model means:
- A lower-priority request is silently rejected if a higher-priority one is active.
- When the higher-priority source ends, the stack restores exactly the value that was active before, rather than defaulting to normal speed.
- Any number of priorities can be layered without any system needing to know about the others.

## Why getUnscaledDeltaTime

When `world.slomo` is 0.1, engine tick `deltaTime` is also multiplied by 0.1. A 4-second kill-streak duration would then take 40 real seconds. Most timed game effects should expire in wall-clock time regardless of slomo — the kill-streak duration, the hit-stop duration, the cooldown timer, the combo reset delay. `getUnscaledDeltaTime` undoes the slomo scaling so these timers count real seconds.

## Source

`SlomoManager` extracted from `src/actors/KillStreakTracker.ts` in Grim2. The kill-streak triggering logic (which calls directly into `IsometricPlayerPawn`) was not extracted — it is Grim-specific. Only the manager class and the slomo-time utilities were included.
