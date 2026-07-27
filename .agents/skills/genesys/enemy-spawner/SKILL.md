---
name: enemy-spawner
description: Wave-based enemy horde system for Genesys games with kill-threshold activation, pooled actor reuse across missions, weighted elite enemy variants, designer-placed spawn markers, and runtime difficulty scaling. Use when implementing enemy spawning, horde managers, spawn systems, or enemy waves.
---

The spawning system has four cooperating parts: the horde manager actor (`ZombieHordeManager` in Grim), scene-placed `EnemySpawnPointActor` markers, an elite enemy registry, and a pooling contract every enemy class must satisfy.

## Step 1: Place spawn markers in the scene

Place at least 4–8 `EnemySpawnPointActor` actors in the scene. Without markers nothing spawns and you will see a warning log. See [references/spawn-markers.md](references/spawn-markers.md) for placement rules and how the manager picks among them.

## Step 2: Place the horde manager in the scene

Two properties are editable in the scene editor:

- `killsToActivate` (default 10) — kills of placed enemies before the first wave fires
- `waveInterval` (default 8) — seconds between waves once the horde is active

All other tuning constants live at the top of the manager actor source file. Adjust them there.

## Step 3: Implement the pooling contract for every enemy class

Every actor used with this spawner must implement a specific pooling interface. See [references/pooling-contract.md](references/pooling-contract.md) for the full contract including `softReset`, `onDied`, `isPooled`, and the required `handleDeath` flow.

## Step 4: Register elite enemy types (optional)

The manager picks spawn type per slot via a weighted roll. Add entries to `createDefaultHordeEnemyTypes()` in the enemy registry to introduce new enemy variants without touching the manager. See [references/elite-registry.md](references/elite-registry.md).

## Mission lifecycle

Call these methods at the correct points — calling the wrong one wastes memory or leaks actors across sessions:

```ts
// Between missions (replay same run, next rank):
hordeManager.resetForMissionStart();
// Parks all live actors into the idle pool for reuse next mission.
// Does NOT clear the pool itself.

// Back to main menu (full session end):
hordeManager.resetForMainMenu();
// Clears everything — idle pool, respawn queue, active actors.
```

## Difficulty scaling

Call `applyMissionRisk()` after the mission is selected and before `doBeginPlay` completes:

```ts
hordeManager.applyMissionRisk(
  healthMult,           // e.g. 1.5 for 50% more HP
  damageMult,           // e.g. 1.2
  eliteSpawnWeightBonus, // added to every elite type's weight (more elites)
  riskLevel,            // 1–5, gates which elite types are eligible
  {
    spawnCap: 40,            // override max active (optional)
    aggressiveSpawn: true,   // wave interval → 4s (8s on iOS)
    waveIntervalMult: 0.8,   // fractional multiplier on top of base interval
  }
);
```

Call `hordeManager.clearMissionRisk()` on mission end to reset all multipliers. See [references/difficulty-scaling.md](references/difficulty-scaling.md) for full parameter detail.

## Platform spawn caps

The manager auto-detects the device class and applies tighter caps automatically. Do not set `MAX_ACTIVE_ZOMBIES` above these values in `applyMissionRisk` — the manager clamps to the platform ceiling:

- Desktop: 65 max active, resume at 50
- Mobile (Android): 30 max active, resume at 22
- iOS (Safari/WebKit): 14 max active, resume at 9, wave interval 12s

## Spawning flow

```
Scene loads
  → hookPlacedZombies() — editor-placed enemies get onDied callbacks
  → Player kills killsToActivate enemies
  → activateHorde() — first wave fires immediately
  → Every waveInterval seconds: spawnWave()
  → Each slot rolls normal vs elite (weighted)
  → Spawn position picked from closest enabled EnemySpawnPointActor markers
  → Actor hidden → GLTF readiness check → softReset(pos) → VFX
  → At max active cap: waves skip until active count drops to resume threshold
  → Enemy dies → queued for reuse after RESPAWN_DELAY_SEC (5s)
  → Same actor reused at new spawn position — no new allocations
  → Enemies >30 units from player: relocated to a spread marker every 2.5s
```

## Constraints

- `softReset` must set `_hasAggro = true` and `DistanceToPlayer` to approximately the spawn distance on the NPC blackboard. Setting it to 0 causes `attackZoneLatched` to trigger immediately and the enemy stands still.
- Do not call `followActor()` in `softReset` — it conflicts with direct-steer chase. Re-enable the NPC component only (`npc.enabled = true`).
- Skip all tick logic when `this.isHiddenInGame()` is true. Pooled actors remain in the world while hidden and will waste budget if they tick.
- The relocation system calls `softReset` on live active enemies. `softReset` must be safe to call on an already-active, non-hidden enemy.
- `revealActorWhenVisualReady` retries up to 8 times at 16ms intervals if the GLTF mesh is not ready. If `onFailed` fires, the actor is re-queued with a 2s delay. If your enemy has no `GLTFMeshComponent`, it passes the readiness check immediately.

## Troubleshooting

- Nothing spawning: check that `EnemySpawnPointActor` markers exist in the scene. `No valid spawn position found` in the console confirms the marker system is empty.
- Enemies standing still: `DistanceToPlayer` set to 0 in `softReset` — set it to ~15.
- Enemies floating: capsule center Y is used as the root position — set `softReset` Y to half the capsule height (~0.9 for a 1.75-tall capsule).
- Fewer enemies than expected on mobile: platform caps are intentional. Do not try to raise iOS caps.
- Pool not refilling between missions: confirm you are calling `resetForMissionStart()` not `resetForMainMenu()`.

## Grim source references

The code below reflects Grim's implementation. Adapt class names to your project:

- `src/actors/ZombieHordeManager.ts` — main spawner, all constants at top of file
- `src/horde/HordeEnemyRegistry.ts` — elite enemy type definitions
- `src/mission/enemy-spawn-points.ts` — marker registration and picking
- `src/actors/EnemySpawnPointActor.ts` — the scene marker actor
- `src/horde/horde-spawn-utils.ts` — GLTF readiness reveal helper
- `src/actors/NewZombieActor.ts` — reference pooled enemy implementation
