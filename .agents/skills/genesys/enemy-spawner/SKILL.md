---
name: enemy-spawner
description: 'Configurable enemy wave spawner system for Genesys.js games. Supports pressure modes, enemy type selection, and full spawn control. Triggers on: spawner, enemy waves, zombie horde, spawn system.'
user-invocable: false
---

# Enemy Spawner System

A flexible wave-based enemy spawning system for Genesys.js games. Place a `ZombieHordeManager` actor in your scene to enable dynamic enemy spawning with full control over spawn behavior, enemy types, and difficulty pressure.

## Core Concepts

- **Wave-based spawning**: Enemies spawn in groups (waves) at timed intervals
- **Activation threshold**: Spawning can be delayed until the player kills a set number of initial enemies
- **Pressure modes**: Control spawn intensity (constant, low, high, or escalating)
- **Enemy types**: Configure which enemy class to spawn (e.g., `NewZombieActor`)
- **Caps and limits**: Set maximum simultaneous enemies and total kill limits

## How to Use

### Basic Setup

1. Place `ZombieHordeManager` in your scene
2. Configure properties in the editor
3. The spawner automatically hooks into existing placed enemies

### Editor Properties

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `killsToActivate` | number | 10 | Kills needed before first wave spawns |
| `maxActiveEnemies` | number | 35 | Hard cap on simultaneous enemies |
| `resumeThreshold` | number | 25 | Resume spawning when count drops to this |
| `totalKillLimit` | number | 500 | Stop spawning entirely after this many kills |
| `waveSize` | number | 10 | Enemies per wave |
| `waveInterval` | number | 8 | Seconds between waves |
| `spawnMinDistance` | number | 12 | Minimum spawn distance from player |
| `spawnMaxDistance` | number | 15 | Maximum spawn distance from player |
| `pressureMode` | enum | "escalating" | Spawn intensity pattern |
| `enemyClassName` | string | "NewZombieActor" | Enemy class to spawn |
| `spawnDelayMinutes` | number | 0 | Minutes of gameplay before first wave spawns |
| `triggerEnemyClass` | string | "" | Enemy type that triggers boss spawn when killed |
| `triggerKillCount` | number | 50 | Kills of trigger enemy type needed to spawn boss |
| `bossClassName` | string | "" | Boss/elite enemy class to spawn on trigger |
| `bossSpawnMessage` | string | "" | UI message shown when boss spawns |

### Pressure Modes

- **constant**: Fixed wave size and interval throughout
- **low**: Slower spawns, smaller waves (relaxed combat)
- **high**: Fast spawns, large waves (intense from start)
- **escalating**: Starts low, ramps up intensity over time/kills

### Enemy Types

The spawner can spawn any actor class that:
1. Extends `ENGINE.Actor`
2. Has `isPooled` property settable to `true`
3. Has `onDied` callback property
4. Implements `softReset(position)` method for respawning
5. Has matching collision profile in the game

To use a different enemy:
1. Create your enemy actor class (e.g., `FastZombieActor`)
2. Set `enemyClassName` to `"GAME.FastZombieActor"`
3. Ensure the class follows the pooling contract above

## Architecture

### Spawning Flow

```
Player kills placed enemies (killsToActivate threshold)
         ↓
   First wave spawns
         ↓
   waveInterval seconds pass
         ↓
   Next wave spawns (if under maxActiveEnemies)
         ↓
   At maxActiveEnemies → pause spawning
         ↓
   10 kills drop count to resumeThreshold → resume
```

### Key Methods

- `spawnWave()`: Triggers a wave of enemies
- `spawnSingleZombie()`: Spawns one enemy with VFX
- `getSpawnPosition()`: Finds valid navmesh position near player
- `onPoolZombieDied()`: Handles death, adds to respawn queue

### Pooled Enemy Lifecycle

1. **Create**: Enemy instantiated at spawn position, hidden
2. **VFX**: Smoke effect plays at spawn location
3. **Reveal**: After 300ms, enemy unhidden and `softReset()` called
4. **Chase**: Enemy immediately targets player via steering
5. **Death**: Death effects play, enemy recycled to pool
6. **Respawn**: After delay, enemy reused for next spawn

## Troubleshooting

### Enemies not spawning
- Check `killsToActivate` — have enough initial enemies been killed?
- Verify navmesh is generated and ready
- Check console for "No valid spawn position found"

### Enemies spawning in one spot
- Navmesh may not cover intended spawn area
- Player Y-height vs navmesh height mismatch
- Check `spawnMinDistance` / `spawnMaxDistance` aren't too tight

### Enemies running on spot
- Check enemy's `softReset()` properly enables NPC component
- Verify `DistanceToPlayer` blackboard value isn't 0
- Ensure steering system isn't fighting with `followActor()`

### Performance issues
- Reduce `maxActiveEnemies` (try 25-30)
- Lower `waveSize` for fewer simultaneous spawns
- Enable enemy LOD in the enemy actor class

## Advanced Features

### Time-Based Spawning

Set `spawnDelayMinutes` to delay the first wave by a specific amount of gameplay time:

- **0**: Spawning starts immediately (or after `killsToActivate` kills)
- **10**: First wave spawns after 10 minutes of gameplay
- Useful for tutorial sections, exploration phases, or story pacing

The timer counts actual gameplay time (not paused during menus). When combined with `killsToActivate`, both conditions must be met: time elapsed AND enough kills.

### Boss/Elite Spawn Triggers

Spawn special enemies when players reach milestones:

```
kill 50 NewZombieActor → spawn BossZombieActor
```

Configure with:
- `triggerEnemyClass`: Which enemy type to track (e.g., "NewZombieActor")
- `triggerKillCount`: How many must be killed (e.g., 50)
- `bossClassName`: Boss class to spawn (e.g., "BossZombieActor")
- `bossSpawnMessage`: Optional UI message (e.g., "A powerful enemy approaches!")

**Implementation approach**:
```typescript
private _killCountsByType = new Map<string, number>();

onEnemyDied(enemyType: string): void {
  const count = (this._killCountsByType.get(enemyType) ?? 0) + 1;
  this._killCountsByType.set(enemyType, count);
  
  if (enemyType === this.triggerEnemyClass && 
      count >= this.triggerKillCount &&
      !this._bossSpawned) {
    this.spawnBoss();
    this._bossSpawned = true;
  }
}
```

Use cases:
- Spawn a boss every 100 zombies killed
- Unlock new enemy types after killing X of basic types
- Create escalation events at kill milestones

## Future Enhancements

Potential additions for more complex spawn behavior:

1. **Multiple enemy types per spawner**: Spawn table with weighted random selection
2. **Spawn zones**: Restrict spawning to specific scene areas
3. **Event triggers**: Spawn waves on game events (player enters area, etc.)
4. **Boss waves**: Multiple boss spawn points with different triggers
5. **Difficulty scaling**: Automatic adjustment based on player performance
6. **Spawn patterns**: Spawn enemies in formations or from specific directions

## Code References

- `src/actors/ZombieHordeManager.ts` — Main spawner logic
- `src/actors/NewZombieActor.ts` — Example pooled enemy implementation
- `src/actors/DeadGraveActor.ts` — Death effect with custom collision
- `src/actors/ZombieRiseVFXActor.ts` — Spawn smoke effect

## Related Skills

- @genesys-engine — Core engine architecture and actor system
