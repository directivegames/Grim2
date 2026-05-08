/**
 * Grim - isometric character game.
 */

import * as ENGINE from '@gnsx/genesys.js';

// Must run before any actor ticks — harness bundle may omit patched `NpcMovementComponent` from `node_modules`.
import './apply-npc-follow-offset-engine-patch.js';
import './apply-grass-shader-engine-patch.js';
import './auto-imports.js';
// PERFORMANCE: Import grass uniform manager to enable batched uniform updates
import './materials/grass/GrassUniformManager.js';
import { BackgroundMusicActor } from './actors/BackgroundMusicActor.js';
import { IsometricPlayerPawn } from './actors/IsometricPlayerPawn.js';
import { SpinningWeaponActor } from './actors/SpinningWeaponActor.js';

/** Spring-arm length (world units). */
const ISO_CAMERA_DISTANCE = 20;

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

/** Custom loading screen that stays visible until shader warmups complete.
 *  Ensures no stutter from first-time material compilation during gameplay.
 */
class GrimLoadingScreen implements ENGINE.ILoadingScreen {
  private _default = new ENGINE.DefaultLoadingScreen();
  private _startTime = 0;
  private _minDurationMs = 2500; // 2.5s covers navmesh + 2s shader warmup

  public start(world: ENGINE.World): void {
    this._startTime = performance.now();
    this._default.start(world);
  }

  public stop(): void {
    const elapsed = performance.now() - this._startTime;
    const remaining = Math.max(0, this._minDurationMs - elapsed);

    // Delay stop until minimum duration has passed (shader warmups still running)
    setTimeout(() => {
      this._default.stop();
    }, remaining);
  }
}

class MyGame extends ENGINE.BaseGameLoop {
  protected override createLoadingScreen(): ENGINE.ILoadingScreen | null {
    return new GrimLoadingScreen();
  }

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
      webgpu: { powerPreference: 'high-performance', antialias: false },
    };
  }

  /**
   * After the game loop starts, cap the pixel ratio to 1.
   * Without this, HiDPI / 2K / 4K monitors render at 1.5×–2× resolution
   * (e.g. a 2560×1440 display renders at 3840×2160 internally).
   */
  public override async start(): Promise<void> {
    await super.start();
    if (this.renderer) {
      this.renderer.renderer.setPixelRatio(1);
    }
  }

  /**
   * Scene cameras using {@link ENGINE.ViewTargetCameraComponent} sit on a stack and
   * override the pawn camera. Turn them all off so only the pawn isometric camera renders.
   */
  protected override postStart(): void {
    super.postStart();
    const world = this.getWorld();
    if (!world) return;
    for (const actor of world.getActors()) {
      for (const vtc of actor.getComponents(ENGINE.ViewTargetCameraComponent)) {
        vtc.setActive(false);
      }
    }

    // Spawn background music actor
    void this.spawnBackgroundMusic();

    // Spawn spinning weapon actor
    void this.spawnSpinningWeapon();
  }


  private async spawnBackgroundMusic(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;
    const musicActor = await BackgroundMusicActor.create();
    world.addActor(musicActor);
  }

  private async spawnSpinningWeapon(): Promise<void> {
    const world = this.getWorld();
    if (!world) return;
    const weaponActor = await SpinningWeaponActor.create();
    world.addActor(weaponActor);
  }
}

export function main(container: HTMLElement, options?: Partial<ENGINE.BaseGameLoopOptions>): ENGINE.IGameLoop {
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
