const STORAGE_KEY = 'grim2-settings';

export type GraphicsQuality = 'low' | 'medium' | 'high';

export const GAME_SETTINGS_DEFAULTS = {
  sfxVolume: 0.8,
  musicVolume: 0.7,
  disable360Spin: false,
  alwaysShowTutorials: false,
  skipAllCutscenes: false,
  graphicsQuality: 'high' as GraphicsQuality,
} as const;

export type GameSettingsSnapshot = {
  sfxVolume: number;
  musicVolume: number;
  disable360Spin: boolean;
  alwaysShowTutorials: boolean;
  skipAllCutscenes: boolean;
  graphicsQuality: GraphicsQuality;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function parseGraphicsQuality(value: unknown): GraphicsQuality {
  if (value === 'low' || value === 'medium' || value === 'high') {
    return value;
  }
  return GAME_SETTINGS_DEFAULTS.graphicsQuality;
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
      alwaysShowTutorials:
        typeof parsed.alwaysShowTutorials === 'boolean'
          ? parsed.alwaysShowTutorials
          : GAME_SETTINGS_DEFAULTS.alwaysShowTutorials,
      skipAllCutscenes:
        typeof parsed.skipAllCutscenes === 'boolean'
          ? parsed.skipAllCutscenes
          : GAME_SETTINGS_DEFAULTS.skipAllCutscenes,
      graphicsQuality: parseGraphicsQuality(parsed.graphicsQuality),
    };
  } catch {
    return { ...GAME_SETTINGS_DEFAULTS };
  }
}

class GameSettings {
  private _sfxVolume: number;
  private _musicVolume: number;
  private _disable360Spin: boolean;
  private _alwaysShowTutorials: boolean;
  private _skipAllCutscenes: boolean;
  private _graphicsQuality: GraphicsQuality;

  public constructor() {
    const stored = readStoredSettings();
    this._sfxVolume = stored.sfxVolume;
    this._musicVolume = stored.musicVolume;
    this._disable360Spin = stored.disable360Spin;
    this._alwaysShowTutorials = stored.alwaysShowTutorials;
    this._skipAllCutscenes = stored.skipAllCutscenes;
    this._graphicsQuality = stored.graphicsQuality;
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

  public get alwaysShowTutorials(): boolean {
    return this._alwaysShowTutorials;
  }

  public set alwaysShowTutorials(value: boolean) {
    this._alwaysShowTutorials = value;
    this.save();
  }

  public get skipAllCutscenes(): boolean {
    return this._skipAllCutscenes;
  }

  public set skipAllCutscenes(value: boolean) {
    this._skipAllCutscenes = value;
    this.save();
  }

  public get graphicsQuality(): GraphicsQuality {
    return this._graphicsQuality;
  }

  public set graphicsQuality(value: GraphicsQuality) {
    this._graphicsQuality = parseGraphicsQuality(value);
    this.save();
  }

  public cycleGraphicsQuality(direction: 1 | -1 = 1): GraphicsQuality {
    const order: GraphicsQuality[] = ['low', 'medium', 'high'];
    const index = order.indexOf(this._graphicsQuality);
    const next = order[(index + direction + order.length) % order.length]!;
    this.graphicsQuality = next;
    return next;
  }

  public resetToDefaults(): void {
    this._sfxVolume = GAME_SETTINGS_DEFAULTS.sfxVolume;
    this._musicVolume = GAME_SETTINGS_DEFAULTS.musicVolume;
    this._disable360Spin = GAME_SETTINGS_DEFAULTS.disable360Spin;
    this._alwaysShowTutorials = GAME_SETTINGS_DEFAULTS.alwaysShowTutorials;
    this._skipAllCutscenes = GAME_SETTINGS_DEFAULTS.skipAllCutscenes;
    this._graphicsQuality = GAME_SETTINGS_DEFAULTS.graphicsQuality;
    this.save();
  }

  public snapshot(): GameSettingsSnapshot {
    return {
      sfxVolume: this._sfxVolume,
      musicVolume: this._musicVolume,
      disable360Spin: this._disable360Spin,
      alwaysShowTutorials: this._alwaysShowTutorials,
      skipAllCutscenes: this._skipAllCutscenes,
      graphicsQuality: this._graphicsQuality,
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
