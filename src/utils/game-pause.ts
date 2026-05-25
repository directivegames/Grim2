import * as ENGINE from '@gnsx/genesys.js';

import { OptionsMenuUI } from '../ui/OptionsMenuUI.js';
import { StartMenuUI } from '../ui/StartMenuUI.js';

let _gameplayUnlocked = false;
let _paused = false;
let _savedSlomo = 1;

export function setGameplayUnlocked(unlocked: boolean): void {
  _gameplayUnlocked = unlocked;
}

export function isGameplayUnlocked(): boolean {
  return _gameplayUnlocked;
}

export function isPaused(): boolean {
  return _paused;
}

function isReadyToReapActive(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return document.querySelector('.grim-rtr-overlay') != null;
}

/** True when ESC should open the pause menu (in active gameplay). */
export function canOpenPause(world: ENGINE.World): boolean {
  if (!_gameplayUnlocked || _paused) {
    return false;
  }
  if (StartMenuUI.isVisible(world)) {
    return false;
  }
  if (OptionsMenuUI.isOpen(world)) {
    return false;
  }
  if (isReadyToReapActive()) {
    return false;
  }
  return true;
}

export function pauseGame(world: ENGINE.World): void {
  if (_paused) {
    return;
  }

  const w = world as unknown as { slomo?: number };
  _savedSlomo = typeof w.slomo === 'number' && w.slomo > 0 ? w.slomo : 1;
  w.slomo = 0;
  _paused = true;

  try {
    world.inputManager.setInputEnabled(false);
  } catch {
    /* */
  }
}

export function resumeGame(world: ENGINE.World): void {
  if (!_paused) {
    return;
  }

  const w = world as unknown as { slomo?: number };
  w.slomo = _savedSlomo > 0 ? _savedSlomo : 1;
  _paused = false;
  _savedSlomo = 1;

  try {
    world.inputManager.setInputEnabled(true);
  } catch {
    /* */
  }
}

export function togglePause(world: ENGINE.World): boolean {
  if (_paused) {
    return false;
  }
  if (!canOpenPause(world)) {
    return false;
  }
  pauseGame(world);
  return true;
}
