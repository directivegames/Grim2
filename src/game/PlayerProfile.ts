import { isRiskLevel, type RiskLevel } from '../data/risk-levels.js';
import {
  PROFILE_STORAGE_KEY,
  PROFILE_VERSION,
  type PlayerProfile,
} from './player-profile-types.js';

export type { GrimStats, PlayerProfile } from './player-profile-types.js';
export { BASE_GRIM_STATS } from './player-profile-types.js';

export function defaultProfile(): PlayerProfile {
  return {
    souls: 0,
    statLevels: {},
    skillLevels: { fistOfAnnoyance: 1, soulThrow: 1 },
    inventory: {},
    discoveredItems: ['bone_shard'],
    shopPurchaseCounts: {},
    unlockedRiskLevel: 1,
  };
}

function sanitizeStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw.filter((v): v is string => typeof v === 'string' && v.length > 0);
}

function sanitizePurchaseCounts(raw: unknown): PlayerProfile['shopPurchaseCounts'] {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'number' && val >= 0 && Number.isFinite(val)) {
      out[key] = Math.floor(val);
    }
  }
  return out;
}

function clampRiskLevel(value: unknown): RiskLevel {
  if (typeof value === 'number' && isRiskLevel(value)) {
    return value;
  }
  return 1;
}

function sanitizeInventory(raw: unknown): PlayerProfile['inventory'] {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'number' && val > 0 && Number.isFinite(val)) {
      out[key] = Math.floor(val);
    }
  }
  return out;
}

function sanitizeLevelMap(raw: unknown): Partial<Record<string, number>> {
  if (!raw || typeof raw !== 'object') {
    return {};
  }
  const out: Record<string, number> = {};
  for (const [key, val] of Object.entries(raw)) {
    if (typeof val === 'number' && val >= 0 && Number.isFinite(val)) {
      out[key] = Math.floor(val);
    }
  }
  return out;
}

export function loadProfile(): PlayerProfile {
  if (typeof localStorage === 'undefined') {
    return defaultProfile();
  }

  try {
    const raw = localStorage.getItem(PROFILE_STORAGE_KEY);
    if (!raw) {
      return defaultProfile();
    }

    const parsed = JSON.parse(raw) as Partial<PlayerProfile> & { version?: number };
    const base = defaultProfile();

    return {
      souls:
        typeof parsed.souls === 'number' && parsed.souls >= 0 && Number.isFinite(parsed.souls)
          ? Math.floor(parsed.souls)
          : base.souls,
      statLevels: sanitizeLevelMap(parsed.statLevels),
      skillLevels: (() => {
        const levels = {
          ...base.skillLevels,
          ...sanitizeLevelMap(parsed.skillLevels),
        };
        if ((levels.soulThrow ?? 0) < 1) {
          levels.soulThrow = 1;
        }
        return levels;
      })(),
      inventory: sanitizeInventory(parsed.inventory),
      discoveredItems: (() => {
        const discovered = sanitizeStringArray(parsed.discoveredItems);
        if (!discovered.includes('bone_shard')) {
          discovered.push('bone_shard');
        }
        return discovered;
      })(),
      shopPurchaseCounts: sanitizePurchaseCounts(parsed.shopPurchaseCounts),
      unlockedRiskLevel: clampRiskLevel(parsed.unlockedRiskLevel),
    };
  } catch {
    return defaultProfile();
  }
}

export function saveProfile(profile: PlayerProfile): void {
  if (typeof localStorage === 'undefined') {
    return;
  }

  try {
    const payload = { version: PROFILE_VERSION, ...profile };
    localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    /* quota / private mode */
  }
}
