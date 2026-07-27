# mission-lifecycle

Generic patterns for transitioning a Genesys game between mission states: cleaning up after a run ends, resetting the play space, and starting a fresh run. Covers the ordered cleanup sequence, physics-safe teleporting, player reset contract, transient actor cleanup, and the pause/input lock system.

This skill documents the patterns. For Grim-specific traps (KinematicVelocityBased teleport, `setHiddenInGame` override) see the `grim-mission-reset` skill.

---

## Core concepts

Two locks control what runs during a transition. They are independent and both must be managed:

`gameplayUnlocked` — a boolean that gate-keeps game logic (abilities, enemy AI, mission ticks). Set to `false` to freeze the game state without stopping physics.

`physics running` — controlled by `world.slomo`. Setting `slomo = 0` freezes all physics simulation. A mission fail screen uses this. Physics must be live (slomo > 0) for any teleport to commit.

---

## 1. Cleanup sequence (end of mission)

Run in this order. Each step depends on the previous:

```ts
// 1. Stop active special states (transformation, cutscenes, etc.)
MyTransformationActor.forceStop(world);

// 2. Close open UI panels
PauseMenuUI.close(world);
ResultsUI.close(world);

// 3. Lift physics freeze FIRST — teleport will not commit while slomo=0
clearMissionPause(world);       // lifts slomo=0 without unlocking gameplay
setGameplayUnlocked(false);     // keep input locked
flushGameplayInput(world);      // clear any held keys/buttons

// 4. Reset time and kill-streak state
slomoManager.forceReset(world);

// 5. Stop mission-specific systems before touching the live world
missionRunner.stop(world);

// 6. Stop music
backgroundMusic.stop();

// 7. Reset world content
resetLevelWorld(world, { restorePlacedEnemies: true, resetPlayer: true });
```

The critical constraint: `clearMissionPause` must come before any teleport. If `slomo = 0` when you queue a teleport, physics never steps and the player never moves.

---

## 2. resetLevelWorld — world content reset

```ts
export function resetLevelWorld(world: ENGINE.World, options: ResetOptions): void {
  // Destroy runtime-spawned actors (projectiles, VFX, runtime enemies)
  destroyTransientActors(world);

  // Clear spatial hash (enemy position index)
  enemySpatialHash.clear();

  // Reset pooled enemy manager
  for (const actor of world.getActors()) {
    if (actor instanceof EnemySpawnerActor) {
      actor.resetForMissionStart();
      break;
    }
  }

  // Restore scene-placed enemies to their editor positions
  if (options.restorePlacedEnemies) {
    for (const actor of world.getActors()) {
      if (actor instanceof PlacedEnemyActor) {
        actor.restoreToScenePlacement();
      }
    }
  }

  // Reset player
  if (options.resetPlayer) {
    const pawn = world.getFirstPlayerPawn();
    pawn?.prepareForMissionStart();
  }
}
```

---

## 3. Player reset contract (prepareForMissionStart)

Every playable pawn should implement a `prepareForMissionStart()` method that guarantees:

```ts
public prepareForMissionStart(): void {
  // 1. Make visible (death may have hidden the pawn)
  this.setHiddenInGame(false);

  // 2. Restore full health
  this.getComponent(ENGINE.CharacterStatsComponent)?.resetHealth();

  // 3. Cancel active effects (slomo overlay, orbit animations, etc.)
  this.clearActiveEffects();

  // 4. Teleport to spawn point
  const spawn = this.getWorld()?.getActors(ENGINE.PlayerStart)[0];
  if (spawn) {
    const pos = new THREE.Vector3();
    spawn.rootComponent.getWorldPosition(pos);
    this.teleportTo(pos);
  }
}
```

Call `prepareForMissionStart` in two places — once during world reset, and again as a safety net just before gameplay unlocks — to guard against any state that changed during the intro sequence.

---

## 4. Mission start sequence

```ts
export function beginMission(world: ENGINE.World, mission: MissionDef): void {
  // Lock input and clear pause state
  clearMissionPause(world);
  setGameplayUnlocked(false);
  world.inputManager.setInputEnabled(false);

  // Start mission systems
  missionRunner.start(world, mission);

  // Play intro, then call finishIntro when done
  void playMissionIntro(world, () => finishIntro(world));
}

function finishIntro(world: ENGINE.World): void {
  // Second safety-net player reset right before unlock
  world.getFirstPlayerPawn()?.prepareForMissionStart();

  // Unlock gameplay and physics
  setGameplayUnlocked(true);
  resumeGame(world);
  world.inputManager.setInputEnabled(true);

  // Reset audio state (slomo rates etc.) then start music
  resetGameplayAudioState(world);
  BackgroundMusicActor.ensurePlaying(world);
}
```

---

## 5. Transient actor cleanup

Separate runtime-spawned actors from scene-placed ones. Only destroy the runtime ones on reset — placed actors should be restored to their editor positions.

```ts
const TRANSIENT_MARKER = 'isTransient';

// When spawning at runtime:
const proj = ProjectileActor.create();
proj.userData[TRANSIENT_MARKER] = true;
world.addActor(proj);

// In cleanup:
function destroyTransientActors(world: ENGINE.World): void {
  for (const actor of world.getActors()) {
    if (actor.userData?.[TRANSIENT_MARKER]) {
      actor.destroy();
    }
  }
}
```

Alternatively, track runtime actors in a `Set` and iterate that directly — more efficient than scanning all actors.

---

## 6. Pause / input lock helpers

```ts
// Stop physics (fail screen, cutscene)
export function pauseGame(world: ENGINE.World): void {
  const w = world as { slomo?: number };
  _savedSlomo = w.slomo ?? 1;
  w.slomo = 0;
  _paused = true;
  world.inputManager.setInputEnabled(false);
}

// Restore physics (without unlocking gameplay)
export function clearMissionPause(world: ENGINE.World): void {
  const w = world as { slomo?: number };
  if (_paused) {
    w.slomo = _savedSlomo > 0 ? _savedSlomo : 1;
    _paused = false;
  } else if ((w.slomo ?? 1) <= 0) {
    w.slomo = 1;
  }
}

// Unlock gameplay and input (call at end of intro)
export function unlockGameplay(world: ENGINE.World): void {
  setGameplayUnlocked(true);
  world.inputManager.setInputEnabled(true);
}
```

Keep `setGameplayUnlocked` and `pauseGame` separate — they control different things. A fail screen needs both: physics frozen (`pauseGame`) and gameplay locked (`setGameplayUnlocked(false)`). During map screen: gameplay locked but physics running so the teleport can commit.

---

## Constraints

- Always call `clearMissionPause` before queuing a teleport. Physics must step for the teleport to commit.
- Always call `missionRunner.stop` before modifying the live world. A running horde or mission tick can conflict with actor destruction.
- Call `prepareForMissionStart` twice: once during world reset and once at the moment gameplay unlocks. The second call guards against any state change during the intro.
- `setGameplayUnlocked(false)` does not stop physics — it only blocks game logic that checks `isGameplayUnlocked()`. Use it to prevent abilities/AI from firing during transitions.
