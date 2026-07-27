# spatial-hash — Rationale

## Why not iterate all actors

Iterating every actor every frame to find those within a radius is O(n). At 200 enemies with 10 hit-detection queries per frame (melee, boomerang blades, AoE), that is 2000 full-list scans per frame. The spatial hash reduces each query to checking 9–25 cells containing a small fraction of actors, independent of total count.

## Why integer cell keys

String keys (`"${cellX},${cellZ}"`) allocate a new string on every lookup and comparison. Integer keys are value-compared by the JS engine without allocation. At high enemy counts and high query frequency this makes a measurable difference — Grim's profiler showed string key hashing consuming ~3% of frame time before the switch to integer keys.

## Why a scratch result array

`getNearbyZombies` in Grim returns a reused array (`_scratchResults`) rather than constructing a new array per call. This eliminates one heap allocation per query. The tradeoff is that callers must iterate immediately and not hold the reference — a constraint that is easy to enforce and almost never causes bugs in practice.

The generic `SpatialHash` in this skill uses the same pattern with a `readonly T[]` return type to signal that the caller should not mutate or store the result.

## Why update on a timer rather than in setWorldPosition

Tracking every position change would require hooking into the engine's transform system. Periodic updates decouple the spatial hash from the transform pipeline and keep the registration logic in the actor itself, making it easy to adjust per-actor update rates.

## When to use this vs physics overlap queries

Physics overlap queries (engine sweep tests) are accurate but expensive. Use them for infrequent, precise checks (damage volumes, trigger zones). Use the spatial hash for frequent, approximate checks (AI separation, hit detection, aggro) where a per-frame radius test is acceptable. The spatial hash is 10–100× cheaper for these use cases.
