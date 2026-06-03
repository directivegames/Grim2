/**
 * Grim - isometric character game.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

// Must run before any actor ticks — harness bundle may omit patched `NpcMovementComponent` from `node_modules`.
import './apply-actor-movement-predictor-engine-patch.js';
import './apply-npc-follow-offset-engine-patch.js';
import './apply-cloud-shadow-engine-patch.js';
import './auto-imports.js';
import './fog/FogSystemActor.js';
import { IsometricPlayerPawn } from './actors/IsometricPlayerPawn.js';
import { SpinningWeaponActor } from './actors/SpinningWeaponActor.js';
import { WarmupActor } from './actors/WarmupActor.js';
import { GameAudioManager } from './actors/GameAudioManager.js';
import { ScenicFogActor } from './actors/ScenicFogActor.js';
import { CloudShadowActor } from './cloudShadow/CloudShadowActor.js';
import { DEFAULT_CLOUD_SHADOW_MAP } from './cloudShadow/CloudShadowState.js';
import { gameSettings } from './utils/game-settings.js';
import { StartMenuUI } from './ui/StartMenuUI.js';
import { LoadingScreenUI, LoadingStages, mapWarmupProgress } from './ui/LoadingScreenUI.js';
import { setGameplayUnlocked } from './utils/game-pause.js';
import { hideGameplayPresentation } from './utils/presentation-mode.js';
import { DebugCheatsActor } from './actors/DebugCheatsActor.js';
import { PauseManagerActor } from './actors/PauseManagerActor.js';
import { GrimIntroActor } from './actors/GrimIntroActor.js';
import { GrimGrinderControllerComponent } from './components/GrimGrinderControllerComponent.js';
import { MenuMusicActor } from './actors/MenuMusicActor.js';
import { PoliceLightFlasherComponent } from './components/PoliceLightFlasherComponent.js';
import { FireLightFlickerComponent } from './components/FireLightFlickerComponent.js';

/** Spring-arm length (world units). */
const ISO_CAMERA_DISTANCE = 20;

/**
 * Cap device pixel ratio to 1. Genesys exposes {@link ENGINE.Renderer} with `.renderer` (IGenesysRenderer);
 * some hosts pass a different shape, so probe safely and never throw.
 */
function trySetPixelRatioOne(wrapper: unknown): void {
  if (wrapper == null || typeof wrapper !== 'object') {
    return;
  }
  const w = wrapper as Record<string, unknown>;
  const inner = w.renderer;
  if (inner != null && typeof inner === 'object' && typeof (inner as { setPixelRatio?: (n: number) => void }).setPixelRatio === 'function') {
    (inner as { setPixelRatio: (n: number) => void }).setPixelRatio(1);
    return;
  }
  if (typeof (w as { setPixelRatio?: (n: number) => void }).setPixelRatio === 'function') {
    (w as { setPixelRatio: (n: number) => void }).setPixelRatio(1);
    return;
  }
  const getNative = (w as { getNativeRenderer?: () => unknown }).getNativeRenderer;
  if (typeof getNative === 'function') {
    const native = getNative.call(wrapper);
    if (native != null && typeof native === 'object' && typeof (native as { setPixelRatio?: (n: number) => void }).setPixelRatio === 'function') {
      (native as { setPixelRatio: (n: number) => void }).setPixelRatio(1);
    }
  }
}

@ENGINE.GameClass()
class MyGameMode extends ENGINE.GameMode {
  constructor() {
    super();
  }

  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      pawnFactory: async () =>
        IsometricPlayerPawn.create({ cameraDistance: ISO_CAMERA_DISTANCE }),
      // Disable pointer lock – isometric movement uses WASD, not mouse look.
      playerControllerFactory: async () =>
        ENGINE.PlayerController.create({ noPointerLock: true }),
    });
  }
}

class MyGame extends ENGINE.BaseGameLoop {

  public override getWorldConfiguration(): ENGINE.WorldOptions {
    const base = super.getWorldConfiguration();
    return {
      ...base,
      navigationOptions: {
        engine: ENGINE.NavigationEngine.RecastNavigation,
        generateOnStartUp: true,
        options: {
          cs: 0.5,
          ch: 0.2,
          walkableSlopeAngle: 35,
          walkableHeight: 2,
          walkableClimb: 0.3,
          walkableRadius: 0.5,
          maxEdgeLen: 12,
          maxSimplificationError: 1.3,
          minRegionArea: 8,
          mergeRegionArea: 20,
          maxVertsPerPoly: 6,
          detailSampleDist: 6,
          detailSampleMaxError: 1,
        },
      },
    };
  }

  /**
   * Disable antialias for both backends – the biggest single render-cost saving.
   * Isometric games rarely need edge AA; the camera angle hides aliasing naturally.
   */
  public override getDefaultRendererOptions(): ENGINE.RendererOptions {
    return {
      webgl: { powerPreference: 'high-performance', antialias: false },
      webgpu: {
        powerPreference: 'high-performance',
        antialias: false,
      },
    };
  }

  /**
   * After the game loop starts, cap the pixel ratio to 1.
   * Without this, HiDPI / 2K / 4K monitors render at 1.5×–2× resolution
   * (e.g. a 2560×1440 display renders at 3840×2160 internally).
   */
  public override async start(): Promise<void> {
    await super.start();
    trySetPixelRatioOne(this.renderer);
    // No lights in this scene use castShadow, so the shadow map system is
    // entirely unused. Disabling it removes per-frame shadow prep overhead
    // (frustum culling pass, map allocation checks) that the engine enables
    // unconditionally in its renderer init.
    if (this.renderer) {
      this.renderer.native.shadowMap.enabled = false;
    }
  }

  /**
   * Cover the canvas as early as possible (before beginPlay / first ticks).
   */
  protected override async preStart(): Promise<void> {
    LoadingScreenUI.setProgress(LoadingStages.boot.percent, LoadingStages.boot.status);
    await super.preStart();
    StartMenuUI.preflightCover(this.getWorld());
  }

  /**
   * Default scene loads at startup (engine waits for all resources).
   * Title menu + Grim's Room cutscene are HTML/camera overlays on this scene.
   */
  protected override postStart(): void {
    super.postStart();
    const world = this.getWorld();
    if (!world) return;

    LoadingScreenUI.setProgress(LoadingStages.worldReady.percent, LoadingStages.worldReady.status);

    setGameplayUnlocked(false);
    world.inputManager.setInputEnabled(false);
    this._disableSceneViewTargetCameras(world);

    this._spawnScenicFogCards(world);
    this._spawnCloudShadows(world);
    this._attachPoliceLightFlashers(world);
    this._attachFireLightFlickers(world);
    PauseManagerActor.ensureExists(world);
    DebugCheatsActor.ensureExists(world);
    this._attachGrimGrinderController(world);

    hideGameplayPresentation(world);

    const startMenu = StartMenuUI.attach(world, () => {
      world.addActor(GrimIntroActor.create({ name: 'GrimIntroActor' }));
    });

    // Menu-only music until PLAY is pressed.
    MenuMusicActor.ensureExists(world);

    this._startWarmupSequence(world, startMenu);
  }

  /** Scene-placed cinematic cameras must not override the pawn isometric camera during play. */
  private _disableSceneViewTargetCameras(world: ENGINE.World): void {
    for (const actor of world.getActors()) {
      for (const vtc of actor.getComponents(ENGINE.ViewTargetCameraComponent)) {
        vtc.setActive(false);
      }
    }
  }

  /** Scene-placed grimgrinder — animations + future transform mode (no custom actor class needed). */
  private _attachGrimGrinderController(world: ENGINE.World): void {
    GrimGrinderControllerComponent.attachAllInWorld(world);
  }

  /** Scene policerdone cars use static point lights — drive them at runtime. */
  private _attachPoliceLightFlashers(world: ENGINE.World): void {
    for (const actor of world.getActors()) {
      if (!actor.name.startsWith('Policerdone')) {
        continue;
      }
      const mesh = actor.getComponent(ENGINE.GLTFMeshComponent);
      if (!mesh?.modelUrl?.includes('policerdone')) {
        continue;
      }
      if (actor.getComponent(PoliceLightFlasherComponent)) {
        continue;
      }
      const flasher = PoliceLightFlasherComponent.create({ name: 'PoliceLightFlasher' });
      actor.rootComponent.add(flasher);
    }
  }

  /** Burning props (e.g. Car 1 Redon 03) — organic fire light flicker. */
  private _attachFireLightFlickers(world: ENGINE.World): void {
    for (const actor of world.getActors()) {
      if (!this._actorHasFireVfx(actor)) {
        continue;
      }
      if (actor.getComponent(FireLightFlickerComponent)) {
        continue;
      }
      const lights = actor.getComponents(ENGINE.PointLightComponent);
      if (lights.length === 0) {
        continue;
      }
      const flicker = FireLightFlickerComponent.create({ name: 'FireLightFlicker' });
      actor.rootComponent.add(flicker);
    }
  }

  private _actorHasFireVfx(actor: ENGINE.Actor): boolean {
    for (const vfx of actor.getComponents(ENGINE.VFXComponent)) {
      const path = (vfx as { vfxPath?: string }).vfxPath;
      if (path?.includes('fire.vfx')) {
        return true;
      }
    }
    return false;
  }

  /** World-space cloud shadows — flat multiply overlay plane. */
  private _spawnCloudShadows(world: ENGINE.World): void {
    world.addActor(CloudShadowActor.create({
      name: 'CloudShadows',
      cloudMapUrl: DEFAULT_CLOUD_SHADOW_MAP,
    }));
  }

  /** Large flowmap fog cards at existing ground-mist cluster positions. */
  private _spawnScenicFogCards(world: ENGINE.World): void {
    const placements: Array<{ position: THREE.Vector3; scale: number }> = [
      { position: new THREE.Vector3(38.9, 0.15, -1.2), scale: 4 },
      { position: new THREE.Vector3(3.9, 0.1, -1.4), scale: 3.5 },
      { position: new THREE.Vector3(-8.9, 0.12, 17.3), scale: 4 },
    ];

    for (const { position, scale } of placements) {
      const fog = ScenicFogActor.create();
      fog.rootComponent.position.copy(position);
      fog.rootComponent.scale.set(scale, 1, scale);
      world.addActor(fog);
    }
  }

  /** Compile shaders during the title screen, then enable PLAY when ready. */
  private _startWarmupSequence(world: ENGINE.World, startMenu: StartMenuUI): void {
    const weaponActor = SpinningWeaponActor.create();
    world.addActor(weaponActor);

    GameAudioManager.ensureExists(world);

    if (WarmupActor.hasCompletedWarmup()) {
      startMenu.markWarmupComplete();
      return;
    }

    LoadingScreenUI.setProgress(LoadingStages.warmupStart.percent, LoadingStages.warmupStart.status);

    WarmupActor.spawnAndWarmup(
      world,
      () => {
        startMenu.markWarmupComplete();
      },
      (frac, status) => {
        mapWarmupProgress(frac, status);
      },
    );
  }
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
  StartMenuUI.injectEarlyLoadCover(container);

  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    // Disable the Three.js GPU-timestamp inspector – it forces a CPU/GPU sync
    // barrier every frame and caps the renderer at ~30fps even on fast hardware.
    debugUIMode: 'none',
    gameContextConfig: {
      ...options?.gameContextConfig,
      defaultGameModeClass: MyGameMode,
    },
  };
  const game = new MyGame(container, mergedOptions);
  return game;
}
