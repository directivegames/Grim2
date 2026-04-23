/**
 * Grim - isometric character game.
 */

import * as ENGINE from '@gnsx/genesys.js';

import { IsometricPlayerPawn } from './actors/IsometricPlayerPawn.js';

/** Spring-arm length (world units). ~25% further than previous default. */
const ISO_CAMERA_DISTANCE = 35;

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
  protected override createLoadingScreen(): ENGINE.ILoadingScreen | null {
    return new ENGINE.DefaultLoadingScreen();
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
