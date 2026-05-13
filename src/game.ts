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
import { IsometricPlayerPawn } from './actors/IsometricPlayerPawn.js';
import { SpinningWeaponActor } from './actors/SpinningWeaponActor.js';
import { WarmupActor } from './actors/WarmupActor.js';
import { GameAudioManager } from './actors/GameAudioManager.js';
import { StartMenuUI } from './ui/StartMenuUI.js';

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
    trySetPixelRatioOne(this.renderer);
  }

  /**
   * Cover the canvas as early as possible (before beginPlay / first ticks).
   */
  protected override async preStart(): Promise<void> {
    await super.preStart();
    StartMenuUI.preflightCover(this.getWorld());
  }

  /**
   * Scene cameras using {@link ENGINE.ViewTargetCameraComponent} sit on a stack and
   * override the pawn camera. Turn them all off so only the pawn isometric camera renders.
   * Start menu + warmup: menu stays until PLAY after shaders/assets are warmed.
   */
  protected override postStart(): void {
    super.postStart();
    const world = this.getWorld();
    if (!world) return;

    const startMenu = StartMenuUI.attach(world);

    // Disable scene cameras
    for (const actor of world.getActors()) {
      for (const vtc of actor.getComponents(ENGINE.ViewTargetCameraComponent)) {
        vtc.setActive(false);
      }
    }

    this._startWarmupSequence(world, startMenu);
  }

  private _startWarmupSequence(world: ENGINE.World, startMenu: StartMenuUI): void {
    const weaponActor = SpinningWeaponActor.create();
    world.addActor(weaponActor);

    GameAudioManager.ensureExists(world);

    WarmupActor.spawnAndWarmup(world, () => {
      startMenu.markWarmupComplete();
    });
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
