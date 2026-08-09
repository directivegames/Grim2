/**
 * Grim - isometric character game.
 */

import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

// Must run before any actor ticks — harness bundle may omit patched `NpcMovementNode` from `node_modules`.
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
import { FilmGrainActor } from './post/FilmGrainActor.js';
import { CloudShadowActor } from './cloudShadow/CloudShadowActor.js';
import { DEFAULT_CLOUD_SHADOW_MAP } from './cloudShadow/CloudShadowState.js';
import { gameSettings } from './utils/game-settings.js';
import { StartMenuUI } from './ui/StartMenuUI.js';
import { MobileLandscapeOverlayUI } from './ui/MobileLandscapeOverlayUI.js';
import { MobileCombatChromeUI } from './ui/MobileCombatChromeUI.js';
import { MobileCombatActor } from './actors/MobileCombatActor.js';
import { MobileSceneChunkLoaderActor } from './actors/MobileSceneChunkLoaderActor.js';
import { LoadingScreenUI, LoadingStages, mapWarmupProgress } from './ui/LoadingScreenUI.js';
import { setGameplayUnlocked } from './utils/game-pause.js';
import { hideGameplayPresentation } from './utils/presentation-mode.js';
import { isMobileDevice } from './utils/mobile-device.js';
import { DebugCheatsActor } from './actors/DebugCheatsActor.js';
import { EnemySpawnPointActor } from './actors/EnemySpawnPointActor.js';
import { PauseManagerActor } from './actors/PauseManagerActor.js';
import { GrimIntroActor } from './actors/GrimIntroActor.js';
import { ZombieHordeManager } from './actors/ZombieHordeManager.js';
import { GrimGrinderControllerComponent } from './components/GrimGrinderControllerComponent.js';
import { PostmanBossActor } from './actors/PostmanBossActor.js';
import { BackgroundMusicActor } from './actors/BackgroundMusicActor.js';
import { MenuMusicActor } from './actors/MenuMusicActor.js';
import { PoliceLightFlasherComponent } from './components/PoliceLightFlasherComponent.js';
import { FireLightFlickerComponent } from './components/FireLightFlickerComponent.js';
import { shouldDisableWebGpuTslEffects } from './utils/browser-compat.js';
import { applyGraphicsQuality, getGraphicsQualityProfile } from './utils/apply-graphics-quality.js';

/** Spring-arm length (world units). */
const ISO_CAMERA_DISTANCE = 20;
const MOBILE_STARTUP_SCENE_PATH = ENGINE.AssetPath.fromString('@project/assets/mobile-empty.genesys-scene');

/** Block browser right-click menu so RMB can throw weapons without interruption. */
function disableBrowserContextMenu(host: HTMLElement): void {
  host.addEventListener('contextmenu', (e) => {
    e.preventDefault();
  }, true);
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
      // Engine 13+: WASD/gamepad mapping lives on DefaultPlayerController, not PlayerController.
      playerControllerFactory: async () =>
        ENGINE.DefaultPlayerController.create({ noPointerLock: true }),
    });
  }
}

class MyGame extends ENGINE.BaseGameLoop {

  public override getWorldConfiguration(): ENGINE.WorldOptions {
    const base = super.getWorldConfiguration();
    const mobile = isMobileDevice();
    return {
      ...base,
      navigationOptions: {
        engine: ENGINE.NavigationEngine.RecastNavigation,
        generateOnStartUp: true,
        options: {
          cs: mobile ? 0.9 : 0.5,
          ch: mobile ? 0.3 : 0.2,
          walkableSlopeAngle: 35,
          walkableHeight: 2,
          walkableClimb: mobile ? 0.45 : 0.3,
          walkableRadius: mobile ? 0.7 : 0.5,
          maxEdgeLen: mobile ? 18 : 12,
          maxSimplificationError: mobile ? 2.0 : 1.3,
          minRegionArea: mobile ? 16 : 8,
          mergeRegionArea: mobile ? 40 : 20,
          maxVertsPerPoly: 6,
          detailSampleDist: mobile ? 12 : 6,
          detailSampleMaxError: mobile ? 2 : 1,
        },
      },
    };
  }

  /**
   * Disable antialias for both backends – the biggest single render-cost saving.
   * Isometric games rarely need edge AA; the camera angle hides aliasing naturally.
   */
  public override getDefaultRendererOptions(): ENGINE.RendererOptions {
    const options: ENGINE.RendererOptions = {
      webgl: { powerPreference: 'high-performance', antialias: false },
      webgpu: {
        powerPreference: 'high-performance',
        antialias: false,
      },
    };
    return options;
  }

  public override async start(): Promise<void> {
    await super.start();
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

    if (!isMobileDevice() && !shouldDisableWebGpuTslEffects()) {
      this._spawnScenicFogCards(world);
      this._spawnCloudShadows(world);
    }
    if (!isMobileDevice()) {
      this._spawnFilmGrain(world);
    }
    this._attachPoliceLightFlashers(world);
    this._attachFireLightFlickers(world);
    PauseManagerActor.ensureExists(world);
    DebugCheatsActor.ensureExists(world);
    this._attachGrimGrinderController(world);

    applyGraphicsQuality(world, this.renderer ? { renderer: this.renderer } : undefined);

    hideGameplayPresentation(world);

    MobileLandscapeOverlayUI.attach(world);
    MobileCombatChromeUI.attach(world);
    if (isMobileDevice()) {
      this._ensureMobileRuntimeSceneActors(world);
      MobileSceneChunkLoaderActor.ensureExists(world);
      MobileCombatActor.ensureExists(world);
      // Pre-create BackgroundMusicActor so the MP3 preloads during the menu phase.
      // ensurePlaying is NOT called here — we don't want music during menus.
      // When a mission starts, ensurePlaying finds this existing actor (already loaded)
      // and calls start(), which then works reliably.
      if (!world.getRootNodes().some(a => a instanceof BackgroundMusicActor)) {
        world.add(BackgroundMusicActor.create({ name: 'BackgroundMusicActor' }));
      }
    }

    const startMenu = StartMenuUI.attach(world, () => {
      world.add(GrimIntroActor.create({ name: 'GrimIntroActor' }));
    });

    // Menu-only music until PLAY is pressed.
    MenuMusicActor.ensureExists(world);

    this._startWarmupSequence(world, startMenu);
  }

  /** Scene-placed cinematic cameras must not override the pawn isometric camera during play. */
  private _disableSceneViewTargetCameras(world: ENGINE.World): void {
    for (const actor of world.getRootNodes()) {
      for (const vtc of actor.getNodes(ENGINE.ViewTargetCameraNode)) {
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
    for (const actor of world.getRootNodes()) {
      if (!actor.name.startsWith('Policerdone')) {
        continue;
      }
      const mesh = actor.getNode(ENGINE.ModelMeshNode);
      if (!mesh?.modelUrl?.includes('policerdone')) {
        continue;
      }
      if (actor.getNode(PoliceLightFlasherComponent)) {
        continue;
      }
      const flasher = PoliceLightFlasherComponent.create({ name: 'PoliceLightFlasher' });
      actor.add(flasher);
    }
  }

  /** Burning props (e.g. Car 1 Redon 03) — organic fire light flicker. */
  private _attachFireLightFlickers(world: ENGINE.World): void {
    for (const actor of world.getRootNodes()) {
      if (!this._actorHasFireVfx(actor)) {
        continue;
      }
      if (actor.getNode(FireLightFlickerComponent)) {
        continue;
      }
      const lights = actor.getNodes(ENGINE.PointLightNode);
      if (lights.length === 0) {
        continue;
      }
      const flicker = FireLightFlickerComponent.create({ name: 'FireLightFlicker' });
      actor.add(flicker);
    }
  }

  private _actorHasFireVfx(actor: ENGINE.SceneNode): boolean {
    for (const vfx of actor.getNodes(ENGINE.VFXNode)) {
      const path = (vfx as { vfxPath?: string }).vfxPath;
      if (path?.includes('fire.vfx')) {
        return true;
      }
    }
    return false;
  }

  /**
   * Mobile starts from a tiny scene to avoid decoding the full editor scene at boot.
   * Spawn only gameplay-critical marker/manager actors here; desktop keeps the scene-authored setup.
   */
  private _ensureMobileRuntimeSceneActors(world: ENGINE.World): void {
    if (!world.getRootNodes().some(actor => actor instanceof ZombieHordeManager)) {
      world.add(ZombieHordeManager.create({ name: 'MobileZombieHordeManager' }));
    }

    // Weapon mesh roots — the mobile-empty scene has none placed in the editor.
    // SpinningWeaponActor.beginPlay calls collectSceneWeapons which finds these by
    // name via getRootNodes; without them _meleeWeapon() returns null and melee tick bails.
    // Slot 0 = melee weapon; slots 1 & 2 = soul-throw blades.
    const WEAPON_MODEL = '@project/assets/models/weapon.glb' as ENGINE.ModelPath;
    for (const wName of ['weapon', 'weapon 02', 'weapon 03'] as const) {
      if (!world.getRootNodes().some(node => node.name === wName)) {
        world.add(ENGINE.ModelMeshNode.create({
          name: wName,
          isRoot: true,
          modelUrl: WEAPON_MODEL,
          rotation: new THREE.Euler(Math.PI / 2, 0, 0),
          scale: new THREE.Vector3(0.35, 0.352, 0.229),
          physicsOptions: { enabled: false },
          castShadow: false,
          receiveShadow: false,
        }));
      }
    }

    // Fist mesh roots — FistOfAnnoyanceActor.beginPlay calls acquireSceneFist
    // which looks these up by name. Without them the fist destroys itself immediately.
    const FIST_MODEL = '@project/assets/models/fistofannoyance.glb' as ENGINE.ModelPath;
    for (const fName of ['fistofannoyance', 'fistofannoyance 02', 'fistofannoyance 03'] as const) {
      if (!world.getRootNodes().some(node => node.name === fName)) {
        world.add(ENGINE.ModelMeshNode.create({
          name: fName,
          isRoot: true,
          modelUrl: FIST_MODEL,
          rotation: new THREE.Euler(Math.PI, 1.22173, Math.PI),
          scale: new THREE.Vector3(0.65, 0.65, 0.65),
          physicsOptions: { enabled: false },
          castShadow: false,
          receiveShadow: false,
        }));
      }
    }

    // Pre-spawn the boss at his authored scene position (hidden) so that
    // PostmanBossActor.activateForMission finds an existing instance rather than
    // using the player-relative fallback spawn.
    if (!world.getRootNodes().some(actor => actor instanceof PostmanBossActor)) {
      const boss = PostmanBossActor.create({
        name: 'PostmanBossActor',
        position: new THREE.Vector3(113.5, -7.1, -11.3),
      });
      world.add(boss);
    }

    if (world.getRootNodes(EnemySpawnPointActor).length > 0) {
      return;
    }

    // Ring the markers around the real mission PlayerStart (matches
    // mobile-empty.genesys-scene), not the world origin — otherwise the horde
    // spawns ~50 units from where Grim actually starts.
    const spawnAnchor = new THREE.Vector3(51.244, 0, -2.041);
    const ringOffsets = [
      new THREE.Vector3(0, 0, -18),
      new THREE.Vector3(14, 0, -14),
      new THREE.Vector3(18, 0, 0),
      new THREE.Vector3(14, 0, 14),
      new THREE.Vector3(0, 0, 18),
      new THREE.Vector3(-14, 0, 14),
      new THREE.Vector3(-18, 0, 0),
      new THREE.Vector3(-14, 0, -14),
    ];
    const placements = ringOffsets.map(offset => spawnAnchor.clone().add(offset));

    placements.forEach((position, index) => {
      world.add(EnemySpawnPointActor.create({
        name: `MobileEnemySpawn_${index + 1}`,
        position,
      }));
    });
  }

  /** World-space cloud shadows — flat multiply overlay plane. */
  private _spawnCloudShadows(world: ENGINE.World): void {
    world.add(CloudShadowActor.create({
      name: 'CloudShadows',
      cloudMapUrl: DEFAULT_CLOUD_SHADOW_MAP,
    }));
  }

  /** Cheap CSS film-grain overlay — cinematic without a GPU post stack. */
  private _spawnFilmGrain(world: ENGINE.World): void {
    if (world.getRootNodes().some(a => a instanceof FilmGrainActor)) {
      return;
    }
    const profile = getGraphicsQualityProfile();
    world.add(FilmGrainActor.create({
      name: 'FilmGrain',
      enabled: profile.filmGrain,
      opacity: profile.filmGrainOpacity || 0.09,
      animated: true,
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
      fog.position.copy(position);
      fog.scale.set(scale, 1, scale);
      world.add(fog);
    }
  }

  /** Compile shaders during the title screen, then enable PLAY when ready. */
  private _startWarmupSequence(world: ENGINE.World, startMenu: StartMenuUI): void {
    const weaponActor = SpinningWeaponActor.create();
    world.add(weaponActor);

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
  MobileLandscapeOverlayUI.ensureOnHost(container);
  disableBrowserContextMenu(container);

  const mergedOptions: Partial<ENGINE.BaseGameLoopOptions> = {
    ...options,
    rendererOptions: options?.rendererOptions,
    // Disable the Three.js GPU-timestamp inspector – it forces a CPU/GPU sync
    // barrier every frame and caps the renderer at ~30fps even on fast hardware.
    debugUIMode: 'none',
    initialWorldPath: isMobileDevice()
      ? MOBILE_STARTUP_SCENE_PATH
      : options?.initialWorldPath,
    defaultGameModeClass: MyGameMode,
  };
  const game = new MyGame(container, mergedOptions);
  return game;
}
