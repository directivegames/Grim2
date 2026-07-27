/**
 * MissionLifecycle.ts
 *
 * Generic helpers for mission cleanup, world reset, and mission start.
 * Copy this file and replace the TODO sections with your game-specific actors.
 *
 * Key constraint: physics must be running (world.slomo > 0) for teleports to commit.
 * Always call clearMissionPause() before queuing any teleport.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// ─── Pause / gameplay lock ────────────────────────────────────────────────────

let _gameplayUnlocked = false;
let _paused = false;
let _savedSlomo = 1;

/** True when game logic (abilities, AI, mission ticks) should run. */
export function isGameplayUnlocked(): boolean {
  return _gameplayUnlocked;
}

export function setGameplayUnlocked(unlocked: boolean): void {
  _gameplayUnlocked = unlocked;
}

/**
 * Freeze physics and disable input (fail screen, death, cutscene).
 * Saves the current slomo so resumeGame can restore it.
 */
export function pauseGame(world: ENGINE.World): void {
  if (_paused) return;
  const w = world as unknown as { slomo?: number };
  _savedSlomo = (typeof w.slomo === 'number' && w.slomo > 0) ? w.slomo : 1;
  w.slomo = 0;
  _paused = true;
  try { world.inputManager.setInputEnabled(false); } catch { /* */ }
}

/**
 * Restore physics and input (gameplay resumes).
 */
export function resumeGame(world: ENGINE.World): void {
  if (_paused) {
    const w = world as unknown as { slomo?: number };
    w.slomo = _savedSlomo > 0 ? _savedSlomo : 1;
    _paused = false;
    _savedSlomo = 1;
  }
  try { world.inputManager.setInputEnabled(true); } catch { /* */ }
}

/**
 * Lift the physics freeze WITHOUT unlocking gameplay or input.
 *
 * Use during mission cleanup: the fail-screen freeze must be lifted so the
 * queued teleport can commit during the map / intro phase, but input must
 * stay locked until the intro finishes.
 */
export function clearMissionPause(world: ENGINE.World): void {
  const w = world as unknown as { slomo?: number };
  if (_paused) {
    w.slomo = _savedSlomo > 0 ? _savedSlomo : 1;
    _paused = false;
    _savedSlomo = 1;
  } else if (typeof w.slomo === 'number' && w.slomo <= 0) {
    w.slomo = 1;
  }
}

export function isPaused(): boolean {
  return _paused;
}

// ─── Transient actor tracking ─────────────────────────────────────────────────

const _transientActors = new Set<ENGINE.Actor>();

/** Mark an actor as runtime-spawned so it is destroyed on reset. */
export function markTransient(actor: ENGINE.Actor): void {
  _transientActors.add(actor);
}

/** Destroy all tracked transient actors and clear the registry. */
export function destroyTransientActors(world: ENGINE.World): void {
  for (const actor of _transientActors) {
    if (actor.getWorld() === world) {
      actor.destroy();
    }
  }
  _transientActors.clear();
}

// ─── World reset ──────────────────────────────────────────────────────────────

export interface ResetLevelOptions {
  /** Return scene-placed enemies to their editor positions. Default: true. */
  restorePlacedEnemies?: boolean;
  /** Teleport player to spawn and restore health. Default: true. */
  resetPlayer?: boolean;
}

/**
 * Restore the play space toward a clean mission start.
 *
 * Prerequisites:
 *   - clearMissionPause() must be called before this (so the teleport can commit).
 *   - missionRunner.stop() should be called before this (so no live tick conflicts).
 */
export function resetLevelWorld(world: ENGINE.World, options: ResetLevelOptions = {}): void {
  const { restorePlacedEnemies = true, resetPlayer = true } = options;

  // Destroy all runtime-spawned actors (projectiles, VFX, runtime enemies)
  destroyTransientActors(world);

  // TODO: clear your spatial hash here, e.g.:
  // enemySpatialHash.clear();

  // TODO: reset your enemy spawner, e.g.:
  // for (const actor of world.getActors()) {
  //   if (actor instanceof EnemySpawnerActor) { actor.resetForMissionStart(); break; }
  // }

  // Restore scene-placed enemies to their editor positions
  if (restorePlacedEnemies) {
    // TODO: iterate placed enemy actors and call restoreToScenePlacement(), e.g.:
    // for (const actor of world.getActors()) {
    //   if (actor instanceof PlacedEnemyActor) { actor.restoreToScenePlacement(); }
    // }
  }

  // Reset player
  if (resetPlayer) {
    const pawn = world.getFirstPlayerPawn();
    if (pawn && 'prepareForMissionStart' in pawn) {
      (pawn as unknown as { prepareForMissionStart(): void }).prepareForMissionStart();
    }
  }
}

// ─── Mission start ────────────────────────────────────────────────────────────

/**
 * Template for beginning a mission.
 *
 * Replace `MissionDef` and `missionRunner` with your own types.
 * Replace `playMissionIntro` with your intro sequence (ReadyToReap, cutscene, fade, etc.).
 */
export function beginMission(
  world: ENGINE.World,
  onIntroFinished: () => void,
): void {
  // 1. Ensure physics is running, gameplay is locked
  clearMissionPause(world);
  setGameplayUnlocked(false);
  try { world.inputManager.setInputEnabled(false); } catch { /* */ }

  // 2. TODO: start your mission runner / horde manager here

  // 3. Play intro, call onIntroFinished when done
  void playIntro(world, onIntroFinished);
}

/**
 * Call at the end of the mission intro, right before unlocking gameplay.
 * Runs a second safety-net player reset to handle any state that changed during intro.
 */
export function finishMissionIntro(world: ENGINE.World): void {
  // Safety-net: reset player one more time right before unlock
  const pawn = world.getFirstPlayerPawn();
  if (pawn && 'prepareForMissionStart' in pawn) {
    (pawn as unknown as { prepareForMissionStart(): void }).prepareForMissionStart();
  }

  // Unlock gameplay
  setGameplayUnlocked(true);
  resumeGame(world);

  // TODO: reset audio state and start gameplay music, e.g.:
  // resetGameplayAudioState(world);
  // BackgroundMusicActor.ensurePlaying(world);
}

// ─── Intro placeholder ────────────────────────────────────────────────────────

/**
 * Replace this with your actual intro sequence.
 * Call `onDone` when the intro is complete.
 */
async function playIntro(world: ENGINE.World, onDone: () => void): Promise<void> {
  // Example: simple fade-in delay
  await new Promise<void>((resolve) => setTimeout(resolve, 1000));
  if (world) { /* suppress lint */ }
  onDone();
}

// ─── Teleport helper ─────────────────────────────────────────────────────────

const _spawnPos = new THREE.Vector3();

/**
 * Teleport the pawn to the first PlayerStart in the world.
 *
 * IMPORTANT: for KinematicVelocityBased pawns, use setPawnWorldTransform on the
 * movement component — writing rootComponent.position directly has no effect.
 * See the grim-mission-reset skill for details.
 */
export function teleportPawnToSpawn(pawn: ENGINE.Pawn, world: ENGINE.World): void {
  const spawn = world.getActors(ENGINE.PlayerStart)[0];
  if (!spawn) return;

  spawn.rootComponent.getWorldPosition(_spawnPos);

  // Generic path — works for most pawn types
  pawn.rootComponent.position.copy(_spawnPos);

  // TODO: for KinematicVelocityBased pawns, replace the above with:
  // const mc = pawn.getComponent(IsometricMovementComponent);
  // mc?.setPawnWorldTransform({ position: _spawnPos });
}
