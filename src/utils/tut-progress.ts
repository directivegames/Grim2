import { grimVault } from '../game/GrimVault.js';
import { gameSettings } from './game-settings.js';

const TUT_SOUL_SEEN_KEY = 'grim2-seen-tutsoul';

export function hasSeenTutSoul(): boolean {
  if (typeof localStorage === 'undefined') {
    return false;
  }
  try {
    return localStorage.getItem(TUT_SOUL_SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markTutSoulSeen(): void {
  if (gameSettings.alwaysShowTutorials) {
    return;
  }
  if (!grimVault.isTutorialCompleted()) {
    return;
  }
  if (typeof localStorage === 'undefined') {
    return;
  }
  try {
    localStorage.setItem(TUT_SOUL_SEEN_KEY, '1');
  } catch {
    /* ignore quota / private mode */
  }
}

/** Show save-innocents tutorial before mission gameplay. */
export function shouldShowTutSoul(): boolean {
  if (gameSettings.alwaysShowTutorials) {
    return true;
  }
  if (!grimVault.isTutorialCompleted()) {
    return true;
  }
  return !hasSeenTutSoul();
}
