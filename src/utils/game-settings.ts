const STORAGE_KEY = 'grim2-settings';

export const GAME_SETTINGS_DEFAULTS = {
  sfxVolume: 0.8,
  musicVolume: 0.7,
  disable360Spin: false,
} as const;

export type GameSettingsSnapshot = {
  sfxVolume: number;
  musicVolume: number;
  disable360Spin: boolean;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function readStoredSettings(): GameSettingsSnapshot {
  if (typeof localStorage === 'undefined') {
    return { ...GAME_SETTINGS_DEFAULTS };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { ...GAME_SETTINGS_DEFAULTS };
    }

    const parsed = JSON.parse(raw) as Partial<GameSettingsSnapshot>;
    return {
      sfxVolume: clamp01(
        typeof parsed.sfxVolume === 'number' ? parsed.sfxVolume : GAME_SETTINGS_DEFAULTS.sfxVolume,
      ),
      musicVolume: clamp01(
        typeof parsed.musicVolume === 'number' ? parsed.musicVolume : GAME_SETTINGS_DEFAULTS.musicVolume,
      ),
      disable360Spin:
        typeof parsed.disable360Spin === 'boolean'
          ? parsed.disable360Spin
          : GAME_SETTINGS_DEFAULTS.disable360Spin,
    };
  } catch {
    return { ...GAME_SETTINGS_DEFAULTS };
  }
}

class GameSettings {
  private _sfxVolume: number;
  private _musicVolume: number;
  private _disable360Spin: boolean;

  public constructor() {
    const stored = readStoredSettings();
    this._sfxVolume = stored.sfxVolume;
    this._musicVolume = stored.musicVolume;
    this._disable360Spin = stored.disable360Spin;
  }

  public get sfxVolume(): number {
    return this._sfxVolume;
  }

  public set sfxVolume(value: number) {
    this._sfxVolume = clamp01(value);
    this.save();
  }

  public get musicVolume(): number {
    return this._musicVolume;
  }

  public set musicVolume(value: number) {
    this._musicVolume = clamp01(value);
    this.save();
  }

  public get disable360Spin(): boolean {
    return this._disable360Spin;
  }

  public set disable360Spin(value: boolean) {
    this._disable360Spin = value;
    this.save();
  }

  public resetToDefaults(): void {
    this._sfxVolume = GAME_SETTINGS_DEFAULTS.sfxVolume;
    this._musicVolume = GAME_SETTINGS_DEFAULTS.musicVolume;
    this._disable360Spin = GAME_SETTINGS_DEFAULTS.disable360Spin;
    this.save();
  }

  public snapshot(): GameSettingsSnapshot {
    return {
      sfxVolume: this._sfxVolume,
      musicVolume: this._musicVolume,
      disable360Spin: this._disable360Spin,
    };
  }

  public save(): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.snapshot()));
    } catch {
      /* ignore quota / privacy mode errors */
    }
  }
}

export const gameSettings = new GameSettings();
