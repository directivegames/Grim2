/**
 * WarmupActor - Pre-loads all runtime assets and compiles shaders during loading screen.
 *
 * Spawns hidden instances of every actor type that can appear during gameplay,
 * forces material/shader compilation, and signals when the game is ready.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import type { PrimitiveNodeOptions } from '@gnsx/genesys.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { DemonboxMailExplosionVFXActor } from './DemonboxMailExplosionVFXActor.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { GameAudioManager } from './GameAudioManager.js';
import { ZombieRiseVFXActor } from './ZombieRiseVFXActor.js';
import { parkAllSceneFists, parkAllSceneWeapons } from '../utils/scene-visual-pool.js';
import { LoadingScreenUI, mapUiPreloadProgress } from '../ui/LoadingScreenUI.js';
import { isMobileDevice } from '../utils/mobile-device.js';
import { preloadUiImages } from '../utils/ui-image-cache.js';

/** Off-screen position for warmup actors - far enough to never be visible. */
const HIDDEN_POS = new THREE.Vector3(0, -1000, 0);
const FIST_EXPLOSION_CLOUD_VFX = '@project/assets/VFX/explosion-cloud.vfx.json';

/** Time to keep warmup actors alive for GPU shader compilation. */
const WARMUP_HOLD_MS = 500;

/** Time between checking if warmup is complete. */
const CHECK_INTERVAL_MS = 50;

type WarmupCallback = () => void;
type WarmupProgressCallback = (fraction: number, status: string) => void;

@ENGINE.GameClass()
export class WarmupActor extends GameRootNode {
  private static _hasCompletedOnce = false;

  private _onComplete: WarmupCallback | null = null;
  private _onProgress: WarmupProgressCallback | null = null;
  private _warmupActors: ENGINE.SceneNode[] = [];
  private _poolActors: Set<ENGINE.SceneNode> = new Set();
  private _audioManager: GameAudioManager | null = null;
  private _slashMesh: THREE.Mesh | null = null;
  private _startTime = 0;
  private _minDurationMs = 2000;
  private _isComplete = false;
  private _uiImagesReady = false;

  // Component references for pool pre-building
  private _boomerangTrail: ENGINE.SceneNode | null = null;
  private _summonVFX: ENGINE.SceneNode | null = null;
  private _bloodSplatter: ENGINE.SceneNode | null = null;

  public override initialize(options?: PrimitiveNodeOptions): void {
    const root = ENGINE.SceneNode.create({ name: 'Root' });
    super.initialize(options);
    this.add(root);
  }

  /**
   * Start the warmup process. Must be called during loading screen.
   * @param onComplete - Called when all warmups are finished.
   */
  public startWarmup(onComplete: WarmupCallback, onProgress?: WarmupProgressCallback): void {
    this._onComplete = onComplete;
    this._onProgress = onProgress ?? null;
    const mobile = isMobileDevice();
    this._minDurationMs = mobile ? 800 : 2000;
    this._startTime = performance.now();

    const world = this.getWorld();
    if (!world) {
      this._signalComplete();
      return;
    }

    // 1. Ensure audio manager exists and preload all sounds
    this._audioManager = GameAudioManager.ensureExists(world);

    // 1b. Preload UI images (menus/HUD) so pause/options open instantly in browser
    this._reportProgress();
    void preloadUiImages((loaded, total) => {
      LoadingScreenUI.setProgress(mapUiPreloadProgress(loaded, total), 'Loading interface…');
      if (loaded >= total) {
        this._uiImagesReady = true;
        this._reportProgress();
      }
    })
      .then(() => {
        this._uiImagesReady = true;
        this._reportProgress();
      })
      .catch(() => {
        this._uiImagesReady = true;
        this._reportProgress();
      });

    const effectWarmupCount = mobile ? 0 : 3;

    if (!mobile) {
      // Desktop pre-caches combat/VFX assets for smooth first use; mobile loads them only when needed.
      void ENGINE.resourceManager.loadModel(
        ENGINE.AssetPath.fromString('@project/assets/models/demonletter.glb'),
      );
    }

    // 2. Pre-warm grave actors (spawn multiple to cover rapid kills)
    for (let i = 0; i < effectWarmupCount; i++) {
      const grave = DeadGraveActor.create({ position: HIDDEN_POS });
      world.add(grave);
      this._warmupActors.push(grave);
    }

    // 3. Pre-warm gore explosions (MAX_ACTIVE = 3, so warm 3)
    for (let i = 0; i < effectWarmupCount; i++) {
      const gore = GoreExplosionActor.create({ position: HIDDEN_POS.clone() });
      world.add(gore);
      this._warmupActors.push(gore);
    }

    if (effectWarmupCount > 0) {
      const fistExplosionVfx = ENGINE.VFXNode.create({
        vfxPath: FIST_EXPLOSION_CLOUD_VFX,
        autoStart: true,
      });
      this.add(fistExplosionVfx);
    }

    if (!mobile) {
      // Pool actors stay in the world; they are NOT destroyed after warmup.
      const pooledMails = DemonboxMailExplosionVFXActor.prewarmPool(world);
      const pooledRises = ZombieRiseVFXActor.prewarmPool(world);
      for (const a of [...pooledMails, ...pooledRises]) {
        this._warmupActors.push(a);
        this._poolActors.add(a);
      }
    }

    // 4. Park all scene fists / hide weapons until abilities use them
    parkAllSceneFists(world);
    parkAllSceneWeapons(world);

    if (!mobile) {
      // 5. Force shader compilation by rendering frames
      this._forceShaderCompilation();
    }

    // 6. Schedule cleanup and completion check
    setTimeout(() => this._checkComplete(), WARMUP_HOLD_MS + CHECK_INTERVAL_MS);
  }

  /**
   * Register components for internal warmup (called by other actors during their setup).
   */
  public registerComponent(component: ENGINE.SceneNode, type: 'boomerangTrail' | 'summonVFX' | 'bloodSplatter'): void {
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

  private _reportProgress(): void {
    if (!this._onProgress) {
      return;
    }
    const elapsed = performance.now() - this._startTime;
    const minFrac = Math.min(1, elapsed / this._minDurationMs);

    let actorFrac = 1;
    if (this._warmupActors.length > 0) {
      let ready = 0;
      for (const actor of this._warmupActors) {
        let loaded = true;
        for (const gltfMesh of actor.getNodes(ENGINE.ModelMeshNode)) {
          if (gltfMesh.isLoading()) {
            loaded = false;
            break;
          }
        }
        if (loaded) {
          ready += 1;
        }
      }
      actorFrac = ready / this._warmupActors.length;
    }

    const uiFrac = this._uiImagesReady ? 1 : 0;
    const audioFrac = this._audioManager ? 1 : 0;
    const combined = audioFrac * 0.12 + uiFrac * 0.38 + actorFrac * 0.35 + minFrac * 0.15;
    const status = !this._audioManager
      ? 'Loading audio…'
      : !this._uiImagesReady
        ? 'Loading interface…'
        : actorFrac < 1
          ? 'Preparing effects…'
          : minFrac < 1
            ? 'Compiling shaders…'
            : 'Almost ready…';
    this._onProgress(combined, status);
  }

  private _checkComplete(): void {
    const elapsed = performance.now() - this._startTime;
    const minTimeMet = elapsed >= this._minDurationMs;

    this._reportProgress();

    // Check if all warmup actors have had time to initialize
    const allActorsReady = this._warmupActors.every(actor => {
      // Check if every GLTF mesh on the actor has finished loading.
      for (const gltfMesh of actor.getNodes(ENGINE.ModelMeshNode)) {
        if (gltfMesh.isLoading()) {
          return false;
        }
      }
      return true;
    });

    // Also check audio manager and UI images are ready
    const audioReady = this._audioManager !== null;

    if (minTimeMet && allActorsReady && audioReady && this._uiImagesReady) {
      this._cleanupAndComplete();
    } else {
      // Check again in a bit
      setTimeout(() => this._checkComplete(), CHECK_INTERVAL_MS);
    }
  }

  private _cleanupAndComplete(): void {
    // Destroy transient warmup actors; pool actors stay alive in the world for reuse.
    for (const actor of this._warmupActors) {
      if (!this._poolActors.has(actor)) {
        actor.destroy();
      }
    }
    this._warmupActors.length = 0;
    this._poolActors.clear();

    this._isComplete = true;
    WarmupActor._hasCompletedOnce = true;
    this._signalComplete();
    this.destroy();
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

  public static hasCompletedWarmup(): boolean {
    return WarmupActor._hasCompletedOnce;
  }

  public static spawnAndWarmup(
    world: ENGINE.World,
    onComplete: () => void,
    onProgress?: WarmupProgressCallback,
  ): WarmupActor {
    const warmup = WarmupActor.create({ position: HIDDEN_POS });
    world.add(warmup);
    warmup.startWarmup(onComplete, onProgress);
    return warmup;
  }
}
