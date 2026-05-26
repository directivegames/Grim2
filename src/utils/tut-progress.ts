const TUT_SOUL_SEEN_KEY = 'grim2-seen-tutsoul';

/**
 * When true, TutSoul shows on every mission start (testing / no save yet).
 * Set to false once a save system tracks per-profile tutorial flags.
 */
export const ALWAYS_SHOW_TUT_SOUL_UNTIL_SAVE = true;

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
  if (ALWAYS_SHOW_TUT_SOUL_UNTIL_SAVE) {
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

/** Show save-innocents tutorial overlay before first suburbs run (or every run while testing). */
export function shouldShowTutSoul(): boolean {
  if (ALWAYS_SHOW_TUT_SOUL_UNTIL_SAVE) {
    return true;
  }
  return !hasSeenTutSoul();
}
