/**
 * WarmupActor - Pre-loads all runtime assets and compiles shaders during loading screen.
 *
 * Spawns hidden instances of every actor type that can appear during gameplay,
 * forces material/shader compilation, and signals when the game is ready.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { SoulActor } from './SoulActor.js';
import { GameAudioManager } from './GameAudioManager.js';

/** Off-screen position for warmup actors - far enough to never be visible. */
const HIDDEN_POS = new THREE.Vector3(0, -1000, 0);

/** Time to keep warmup actors alive for GPU shader compilation. */
const WARMUP_HOLD_MS = 500;

/** Time between checking if warmup is complete. */
const CHECK_INTERVAL_MS = 50;

type WarmupCallback = () => void;

@ENGINE.GameClass()
export class WarmupActor extends ENGINE.Actor {
  private _onComplete: WarmupCallback | null = null;
  private _warmupActors: ENGINE.Actor[] = [];
  private _audioManager: GameAudioManager | null = null;
  private _slashMesh: THREE.Mesh | null = null;
  private _startTime = 0;
  private _minDurationMs = 2000;
  private _isComplete = false;

  // Component references for pool pre-building
  private _boomerangTrail: ENGINE.SceneComponent | null = null;
  private _summonVFX: ENGINE.SceneComponent | null = null;
  private _bloodSplatter: ENGINE.SceneComponent | null = null;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });
  }

  /**
   * Start the warmup process. Must be called during loading screen.
   * @param onComplete - Called when all warmups are finished.
   */
  public startWarmup(onComplete: WarmupCallback): void {
    this._onComplete = onComplete;
    this._startTime = performance.now();

    const world = this.getWorld();
    if (!world) {
      this._signalComplete();
      return;
    }

    // 1. Ensure audio manager exists and preload all sounds
    this._audioManager = GameAudioManager.ensureExists(world);

    // 2. Pre-warm grave actors (spawn multiple to cover rapid kills)
    for (let i = 0; i < 3; i++) {
      const grave = DeadGraveActor.create({ position: HIDDEN_POS });
      world.addActor(grave);
      this._warmupActors.push(grave);
    }

    // 3. Pre-warm gore explosions (MAX_ACTIVE = 3, so warm 3)
    for (let i = 0; i < 3; i++) {
      const gore = GoreExplosionActor.create({ position: HIDDEN_POS.clone() });
      world.addActor(gore);
      this._warmupActors.push(gore);
    }

    // 4. Pre-warm soul actors
    for (let i = 0; i < 2; i++) {
      const soul = SoulActor.create({ position: HIDDEN_POS.clone() });
      world.addActor(soul);
      this._warmupActors.push(soul);
    }

    // 5. Park fist underground if it exists
    for (const actor of world.getActors()) {
      if (actor.name.toLowerCase() === 'fistofannoyance') {
        actor.rootComponent.position.y = -1000;
        break;
      }
    }

    // 6. Force shader compilation by rendering frames
    this._forceShaderCompilation();

    // 7. Schedule cleanup and completion check
    setTimeout(() => this._checkComplete(), WARMUP_HOLD_MS + CHECK_INTERVAL_MS);
  }

  /**
   * Register components for internal warmup (called by other actors during their setup).
   */
  public registerComponent(component: ENGINE.SceneComponent, type: 'boomerangTrail' | 'summonVFX' | 'bloodSplatter'): void {
    switch (type) {
      case 'boomerangTrail':
        this._boomerangTrail = component;
        break;
      case 'summonVFX':
        this._summonVFX = component;
        break;
      case 'bloodSplatter':
        this._bloodSplatter = component;
        break;
    }
  }

  /**
   * Called by WeaponSlashComponent to register its mesh for warmup rendering.
   */
  public registerSlashMesh(mesh: THREE.Mesh): void {
    this._slashMesh = mesh;
  }

  private _forceShaderCompilation(): void {
    const world = this.getWorld();
    if (!world) return;

    // Force the renderer to compile shaders by rendering a few frames
    // The warmup actors are at -1000 Y, so they're off-screen but shaders compile
    const renderer = (world as unknown as { _renderer?: { render: () => void } })._renderer;
    if (renderer) {
      // Render 3 frames to force shader compilation
      for (let i = 0; i < 3; i++) {
        renderer.render();
      }
    }
  }

  private _checkComplete(): void {
    const elapsed = performance.now() - this._startTime;
    const minTimeMet = elapsed >= this._minDurationMs;

    // Check if all warmup actors have had time to initialize
    const allActorsReady = this._warmupActors.every(actor => {
      // Check if GLTF meshes are loaded
      const gltfMesh = actor.getComponent(ENGINE.GLTFMeshComponent);
      if (gltfMesh) {
        return (gltfMesh as unknown as { isReady?: () => boolean }).isReady?.() ?? true;
      }
      return true;
    });

    // Also check audio manager is ready
    const audioReady = this._audioManager !== null;

    if (minTimeMet && allActorsReady && audioReady) {
      this._cleanupAndComplete();
    } else {
      // Check again in a bit
      setTimeout(() => this._checkComplete(), CHECK_INTERVAL_MS);
    }
  }

  private _cleanupAndComplete(): void {
    // Destroy warmup actors (they've served their purpose)
    for (const actor of this._warmupActors) {
      actor.destroy();
    }
    this._warmupActors.length = 0;

    this._isComplete = true;
    this._signalComplete();
  }

  private _signalComplete(): void {
    if (this._onComplete) {
      this._onComplete();
      this._onComplete = null;
    }
  }

  public isComplete(): boolean {
    return this._isComplete;
  }

  public static spawnAndWarmup(world: ENGINE.World, onComplete: () => void): WarmupActor {
    const warmup = WarmupActor.create({ position: HIDDEN_POS });
    world.addActor(warmup);
    warmup.startWarmup(onComplete);
    return warmup;
  }
}
