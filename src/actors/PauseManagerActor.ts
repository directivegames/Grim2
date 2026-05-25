/**
 * PauseManagerActor — listens for ESC to toggle the pause menu during gameplay.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  canOpenPause,
  isPaused,
  pauseGame,
  resumeGame,
} from '../utils/game-pause.js';
import { PauseMenuUI } from '../ui/PauseMenuUI.js';

@ENGINE.GameClass()
export class PauseManagerActor extends ENGINE.Actor {
  private readonly _inputHandler: ENGINE.IInputHandler = {
    handleKeyDown: (e: KeyboardEvent): boolean => {
      if (e.key !== 'Escape') {
        return false;
      }

      const world = this.getWorld();
      if (!world) {
        return false;
      }

      if (PauseMenuUI.isOpen(world) || isPaused()) {
        PauseMenuUI.close(world);
        resumeGame(world);
        return true;
      }

      if (!canOpenPause(world)) {
        return false;
      }

      pauseGame(world);
      void PauseMenuUI.open(world);
      return true;
    },
    handleKeyUp: () => false,
    handleMouseDown: () => false,
    handleMouseUp: () => false,
    handleMouseMove: () => false,
    handleMouseClick: () => false,
    setInputManager: () => { /* no-op */ },
  };

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    this.getWorld()?.inputManager.addInputHandler(this._inputHandler);
  }

  protected override doEndPlay(): void {
    this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
    const world = this.getWorld();
    if (world) {
      PauseMenuUI.close(world);
    }
    super.doEndPlay();
  }

  public static ensureExists(world: ENGINE.World): PauseManagerActor {
    const existing = world.getActors().find(
      (a): a is PauseManagerActor => a instanceof PauseManagerActor,
    );
    if (existing) {
      return existing;
    }

    const manager = PauseManagerActor.create({ name: 'PauseManager' });
    world.addActor(manager);
    return manager;
  }
}
