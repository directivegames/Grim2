# Difficulty scaling

## applyMissionRisk

Call this after the mission is selected, before `doBeginPlay` finishes. It configures the horde for the active difficulty tier.

```ts
hordeManager.applyMissionRisk(
  healthMult,             // multiplier on enemy max HP (1.0 = normal)
  damageMult,             // multiplier on enemy attack damage (1.0 = normal)
  eliteSpawnWeightBonus,  // added to every elite type's spawn weight (0 = no change)
  riskLevel,              // RiskLevel 1–5 — gates elite type eligibility (minRiskLevel)
  {
    spawnCap?: number,          // override max active enemies for this mission
    aggressiveSpawn?: boolean,  // true → wave interval 4s (8s on iOS)
    waveIntervalMult?: number,  // fractional multiplier on the base wave interval (default 1)
  }
);
```

`healthMult` and `damageMult` are applied to all currently active and placed enemies immediately, and to every future spawn. Call `applyMissionRisk` before enemies are alive to avoid a visible mid-session change in enemy toughness.

`spawnCap` is clamped to the platform ceiling automatically:
- Desktop: no hard ceiling beyond `MAX_ACTIVE_ZOMBIES = 65`
- Mobile: capped at 30
- iOS: capped at 14

`aggressiveSpawn` sets the wave interval to 4s on desktop/Android and 8s on iOS. `waveIntervalMult` is then applied on top of that base, so `aggressiveSpawn: true, waveIntervalMult: 0.5` gives 2s on desktop.

The minimum wave interval after all adjustments is 2s.

## clearMissionRisk

```ts
hordeManager.clearMissionRisk();
```

Resets all multipliers to 1.0 and restores default platform caps and wave intervals. Call on mission end before `resetForMissionStart` or `resetForMainMenu`.

## getStats

Useful for debugging and UI:

```ts
const stats = hordeManager.getStats();
// {
//   totalKills: number,
//   hordeActive: boolean,
//   activeZombies: number,
//   respawnQueue: number,
//   activeElites: Record<string, number>  // keyed by HordeEnemyType.id
// }
```

## Platform caps reference

These are the actual values in the codebase. Do not exceed them via `spawnCap`.

- Desktop — max active: 65, resume threshold: 50, wave size: 15, wave interval: 8s
- Android mobile — max active: 30, resume threshold: 22, wave size: 8, wave interval: 8s
- iOS (Safari) — max active: 14, resume threshold: 9, wave size: 4, wave interval: 12s, aggressive interval: 8s

The manager detects the device class via `isMobileDevice()` and `isIosDevice()` at `doBeginPlay`. Platform caps are applied before `applyMissionRisk` runs, so `spawnCap` in `applyMissionRisk` is a ceiling override within the platform limit, not an override of it.
