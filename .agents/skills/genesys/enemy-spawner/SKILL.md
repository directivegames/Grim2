---
name: enemy-spawner
description: 'Configurable enemy wave spawner system for Genesys.js games. Supports wave-based spawning, kill thresholds, respawn queues and pooling. Triggers on: spawner, enemy waves, zombie horde, spawn system, horde manager.'
user-invocable: false
---

# Enemy Spawner System

A wave-based enemy spawning system built on top of `ZombieHordeManager`. Place the actor in your scene and it will automatically hook into placed enemies, count kills, and begin dynamic spawning once the threshold is reached.

---

## Current State (What Is Actually Implemented)

### Two Real Editor Properties

Only **two** properties are currently exposed in the scene editor via `@ENGINE.property()`:

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `killsToActivate` | number | 10 | Kills needed before first wave spawns |
| `waveInterval` | number | 8 | Seconds between waves |

Everything else is a **hardcoded constant** at the top of `ZombieHordeManager.ts`:

| Constant | Value | What it controls |
|----------|-------|-----------------|
| `MAX_ACTIVE_ZOMBIES` | 35 | Hard cap on simultaneous enemies |
| `RESUME_SPAWN_THRESHOLD` | 25 | Resume spawning when active count drops here |
| `KILLS_TO_ACTIVATE_HORDE` | 10 | Default kill threshold (mirrors `killsToActivate`) |
| `MAX_TOTAL_KILLS` | 500 | Stop spawning after this many total kills |
| `WAVE_SIZE` | 10 | Enemies per wave |
| `RESPAWN_DELAY_SEC` | 5 | Seconds before a dead enemy re-enters the spawn queue |
| `SPAWN_MIN_DISTANCE` | 12 | Minimum spawn ring radius from player (units) |
| `SPAWN_MAX_DISTANCE` | 15 | Maximum spawn ring radius from player (units) |
| `SPAWN_HEIGHT` | 0.9 | Zombie capsule center Y — puts feet on ground |

To change any of these, edit the constants directly in `src/actors/ZombieHordeManager.ts`.

---

## How to Use

### Basic Setup

1. Place `ZombieHordeManager` in the scene
2. Optionally tweak `killsToActivate` and `waveInterval` in the editor
3. The spawner auto-hooks all placed `NewZombieActor` instances on `doBeginPlay`
4. Once `killsToActivate` kills are registered, the first wave spawns

### Placed Enemy Hook

On startup the manager scans `world.getActors()` for any `NewZombieActor` where `isPooled === false`. These are the manually placed enemies. It assigns their `onDied` callback to count toward the activation threshold. Spawned (pooled) enemies count toward the total kill limit but trigger respawn queue logic instead.

---

## Pooling Contract

Any enemy class used with this spawner must follow this interface:

```typescript
class MyEnemy extends ENGINE.Actor {
  // Required by spawner
  public isPooled: boolean = false;
  public onDied: (() => void) | null = null;

  /**
   * Called after the 300ms smoke VFX reveal delay.
   * Must: unhide the enemy, set position, reset all state,
   * restore health, re-enable NPC, set aggro to true.
   */
  public softReset(position: THREE.Vector3): void {
    this.setHiddenInGame(false);
    this.rootComponent.position.copy(position);
    // reset health, aggro, animation, NPC component...
  }

  // Must call this.onDied?.() from within handleDeath
  public override handleDeath(): void {
    // ... death effects ...
    this.onDied?.();
    if (this.isPooled) {
      this.recycle(); // hide + park off-screen
    } else {
      this.destroy();
    }
  }

  private recycle(): void {
    this.setHiddenInGame(true);
    this.rootComponent.position.set(0, -1000, 0);
    this._deathSequenceStarted = false;
  }
}
```

**Key rules:**
- `handleDeath` must call `this.onDied?.()` — this is how the manager counts kills
- `softReset` must set `_hasAggro = true` and `DistanceToPlayer = 15` on the blackboard (NOT 0 — setting 0 causes `attackZoneLatched` to immediately trigger, making the enemy stand still)
- `recycle()` parks the enemy at `(0, -1000, 0)` so the physics body doesn't simulate off-screen
- Skip all `tickPrePhysics` logic when `isHiddenInGame()` returns true for performance

---

## Spawning Flow

```
Scene loads
    ↓
hookPlacedZombies() — finds all placed enemies, assigns onDied callbacks
    ↓
Player kills N enemies (killsToActivate threshold met)
    ↓
activateHorde() — first wave spawns immediately
    ↓
Every waveInterval seconds → spawnWave()
    ↓
At MAX_ACTIVE_ZOMBIES → _spawningPaused = true (waves skip)
    ↓
Enemy dies → added to _respawnQueue with RESPAWN_DELAY_SEC delay
    ↓
Active count drops to RESUME_SPAWN_THRESHOLD → _spawningPaused = false
    ↓
processRespawnQueue() respawns queued enemies each tick
    ↓
Total kills reach MAX_TOTAL_KILLS → spawning stops permanently
```

---

## Spawn Position Logic

`getSpawnPosition()` places enemies in a ring around the player:

1. Pick random angle and distance (`SPAWN_MIN_DISTANCE` to `SPAWN_MAX_DISTANCE`)
2. Use `playerPos.y` for the navmesh query (not a hardcoded height — avoids false misses)
3. Snap candidate to navmesh via `getClosestPointOnNavigationMesh()`
4. Reject if snap moved the point more than 5 units (likely inside geometry)
5. After a valid snap, override Y to `SPAWN_HEIGHT` (capsule center height)
6. Try up to 5 times before giving up and skipping the spawn

If the navmesh is not ready, raw position is used as fallback.

---

## Spawn VFX

`ZombieRiseVFXActor.spawnAt()` is called at each spawn point. This plays a dark smoke/particle effect. The enemy is hidden for 300ms while the VFX runs, then revealed and `softReset()` is called.

The VFX class is hardcoded — to use a different effect, change the import and call in `spawnSingleZombie()`.

---

## Scale Matching

Placed enemies may have non-uniform scale set in the scene editor. Spawned enemies default to scale `(1, 1, 1)`. To match, the spawner explicitly sets the scale after creation:

```typescript
zombie.rootComponent.scale.set(1.224317, 1.157981, 1.410963);
```

When adding a new enemy type, check the placed version's scale in the scene file and apply the same values here.

---

## Death Object Collision

`DeadGraveActor` uses a custom collision profile (`DeadGraveNoPawnBlock`) that ignores the `Pawn` channel. This lets enemies walk through graves without being blocked. The profile is registered on first `initialize()` call.

If other death objects (e.g., bones, debris) are added, apply the same profile pattern so they don't block NPC movement.

---

## Troubleshooting

### Enemies not spawning
- Has `killsToActivate` been reached? Check console for `[ZombieHordeManager] Kill!` logs
- Navmesh not ready — check for `No valid spawn position found` in console
- Player pawn is null — `getFirstPlayerPawn()` returns null until player spawns in scene

### Enemies spawning in one cluster
- Navmesh height mismatch — the spawn query uses `playerPos.y` now, but verify the navmesh is built on the correct geometry
- `SPAWN_MIN_DISTANCE` / `SPAWN_MAX_DISTANCE` too tight or navmesh doesn't cover the area

### Enemies running on the spot
- `DistanceToPlayer` set to 0 in `softReset` — must be set to ~15 (spawn distance)
- `followActor()` called in `softReset` — conflicts with `applyDirectSteerChase()`, do not call it
- NPC component not re-enabled — check `npc.enabled = true` in `softReset`

### Enemies floating above ground
- `SPAWN_HEIGHT` should be half the capsule height (~0.9 for a 1.75-tall capsule)
- Confirm navmesh Y snap is working by checking if enemies land at the same height as placed ones

### Performance issues
- Lower `MAX_ACTIVE_ZOMBIES` (25-30 recommended for smooth performance)
- Ensure enemies skip all `tickPrePhysics` logic when `isHiddenInGame()` is true
- Death effects (GoreExplosionActor etc.) use `MAX_ACTIVE` caps — verify these are set

---

## Planned Features (Not Yet Implemented)

These features are designed but not in the codebase yet:

### Pressure Modes
Control spawn intensity over time:
- **constant** — fixed interval and wave size throughout
- **low** — longer intervals, smaller waves
- **high** — short intervals, large waves
- **escalating** — starts slow, ramps up as kill count increases

### Time-Based Activation
`spawnDelayMinutes` — delay first wave until N minutes of gameplay have passed. Useful for tutorial phases or time-gated content.

### Boss/Elite Triggers
```typescript
// Track kills by enemy type
private _killCountsByType = new Map<string, number>();

// When kill count of a specific type hits threshold, spawn a boss
if (enemyType === this.triggerEnemyClass && count >= this.triggerKillCount) {
  this.spawnBoss();
}
```
Properties needed: `triggerEnemyClass`, `triggerKillCount`, `bossClassName`, `bossSpawnMessage`.

To implement any of these: add `@ENGINE.property()` fields to `ZombieHordeManager`, then wire up the logic in `tickPrePhysics` and `spawnWave`.

---

## Code References

- `src/actors/ZombieHordeManager.ts` — Main spawner logic (all constants at top)
- `src/actors/NewZombieActor.ts` — Reference pooled enemy implementation
- `src/actors/DeadGraveActor.ts` — Death object with pawn-ignoring collision profile
- `src/actors/ZombieRiseVFXActor.ts` — Spawn smoke VFX
- `src/actors/KillStreakTracker.ts` — Kill streak/slowmo system (separate from spawner)

## Related Skills

- @genesys-engine — Core engine architecture and actor system
