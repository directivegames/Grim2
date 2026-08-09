/**
 * PauseManagerActor — listens for ESC to toggle the pause menu during gameplay.
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ensureGameplayInputFlushOnBlur } from '../utils/flush-gameplay-input.js';
import {
  canOpenPause,
  isPaused,
  pauseGame,
  resumeGame,
} from '../utils/game-pause.js';
import { MapUI } from '../ui/MapUI.js';
import { OptionsMenuUI } from '../ui/OptionsMenuUI.js';
import { PauseMenuUI } from '../ui/PauseMenuUI.js';
import { returnToMainMenu } from '../utils/return-to-main-menu.js';

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

      if (OptionsMenuUI.isOpen(world)) {
        OptionsMenuUI.close(world);
        return true;
      }

      if (MapUI.isOpen(world)) {
        MapUI.close(world);
        returnToMainMenu(world);
        return true;
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

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }const world = this.getWorld();
    if (world) {
      ensureGameplayInputFlushOnBlur(world);
      world.inputManager.addInputHandler(this._inputHandler);
    }
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
    const world = this.getWorld();
    if (world) {
      PauseMenuUI.close(world);
    }
    return true;
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
