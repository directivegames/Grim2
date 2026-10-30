# Persistence: the guarded save module

The short version is in [SKILL.md → Persistence](../SKILL.md#persistence). One versioned `localStorage` key per game, every access in try/catch, every field validated and defaulted, so a blocked store or an old or hand-edited save never crashes the title. Load once in `beginPlay` before the title shows; write on Result and on each settings change.

Composed — typechecked against 18.1.0-alpha.317
```ts
export const SAVE_KEY = 'my-game.save.v1';   // bump the version when SaveData changes shape

export interface SaveData { bestScore: number; musicOn: boolean; sfxVolume: number; }
const DEFAULTS: SaveData = { bestScore: 0, musicOn: true, sfxVolume: 0.8 };

export function loadSave(key = SAVE_KEY): SaveData {
  try {
    const raw = window.localStorage.getItem(key);
    const p = (raw ? JSON.parse(raw) : {}) as Partial<SaveData>;
    return {
      bestScore: typeof p.bestScore === 'number' && p.bestScore >= 0 ? p.bestScore : DEFAULTS.bestScore,
      musicOn: typeof p.musicOn === 'boolean' ? p.musicOn : DEFAULTS.musicOn,
      sfxVolume: typeof p.sfxVolume === 'number' ? Math.min(1, Math.max(0, p.sfxVolume)) : DEFAULTS.sfxVolume,
    };
  } catch {
    return { ...DEFAULTS };                       // storage blocked or corrupt JSON
  }
}

export function writeSave(data: SaveData, key = SAVE_KEY): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(data));
  } catch { /* private mode or quota: the value lasts for the session */ }
}
```

During a smoke run, resolve the smoke gate before loading, then pass `` `${SAVE_KEY}.smoke` `` while `isSmokeActive()` is true, so the test never overwrites the creator's best score.
