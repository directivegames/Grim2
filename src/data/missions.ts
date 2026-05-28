import type { MissionConfig } from './mission-types.js';

/** Difficulty shown on the mission briefing panel. */
export type MissionDifficulty = 'Easy' | 'Medium' | 'Hard';

/** One selectable location on the Burdenville map. */
export interface MissionDef {
  /** Stable id, e.g. `suburbs`. */
  id: string;
  /** Map load path passed to `gameLoop.loadMap()` (no `.genesys-scene` suffix). */
  scenePath: string;
  /** Plaque title on the map, e.g. "3. OAKRIDGE SUBURBS". */
  mapTitle: string;
  /** Plaque tagline, e.g. "HOME OF THE LIVING... AND THE DEAD." */
  mapTagline: string;
  /** Display name on briefing, e.g. Break Out. */
  name: string;
  /** Secondary line, e.g. Level 1. */
  subtitle: string;
  /** Briefing subheading override (e.g. "Level Risk 1"). Falls back to `subtitle · difficulty`. */
  briefingSubline?: string;
  difficulty: MissionDifficulty;
  description: string;
  objectives: string[];
  /** Map marker PNG under `assets/UI/` (e.g. `sub.png`). */
  iconFile: string;
  /** Icon position on the map image (0–1, top-left origin). */
  mapX: number;
  mapY: number;
  /** If false, icon is visible but not selectable (coming soon). */
  selectable: boolean;
  /**
   * Mission goal pool id — goals are rolled at START from [`mission-pools.ts`](./mission-pools.ts).
   * Legacy fixed `missionConfig` is still supported for one-off entries.
   */
  missionPoolId?: string;
  /** @deprecated Prefer `missionPoolId` + risk roll. */
  missionConfig?: MissionConfig;
}

/** All Burdenville map locations. Only selectable missions can be started. */
export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'mall',
    scenePath: 'assets/default',
    mapTitle: '1. BURDENVILLE MALL',
    mapTagline: 'THE HEART OF CONSUMPTION.',
    name: 'Burdenville Mall',
    subtitle: 'Coming Soon',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'ShopC.png',
    mapX: 0.52,
    mapY: 0.18,
    selectable: false,
  },
  {
    id: 'cinema',
    scenePath: 'assets/default',
    mapTitle: '2. ECLIPSE CINEMA',
    mapTagline: 'WHERE NIGHTMARES PLAY',
    name: 'Eclipse Cinema',
    subtitle: 'Coming Soon',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'Cinema.png',
    mapX: 0.8,
    mapY: 0.2,
    selectable: false,
  },
  {
    id: 'suburbs',
    scenePath: 'assets/default',
    mapTitle: '3. OAKRIDGE SUBURBS',
    mapTagline: 'HOME OF THE LIVING... AND THE DEAD.',
    name: 'Oakridge Suburbs',
    subtitle: 'Level Risk',
    difficulty: 'Easy',
    description:
      'Reap the souls in the local suburb, where getting the mail and becoming possessed go hand in hand.',
    objectives: [],
    iconFile: 'sub.png',
    mapX: 0.76,
    mapY: 0.44,
    selectable: true,
    missionPoolId: 'suburbs',
  },
  {
    id: 'underworld',
    scenePath: 'assets/default',
    mapTitle: '4. THE UNDERWORLD PIT',
    mapTagline: "A 'THRILLING' DROP... ONE WAY DOWN.",
    name: 'The Underworld Pit',
    subtitle: 'Coming Soon',
    difficulty: 'Hard',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'underworld.png',
    mapX: 0.48,
    mapY: 0.52,
    selectable: false,
  },
  {
    id: 'hospital',
    scenePath: 'assets/default',
    mapTitle: "5. ST. MARY'S HOSPITAL",
    mapTagline: 'NO HELP LEFT HERE.',
    name: "St. Mary's Hospital",
    subtitle: 'Coming Soon',
    difficulty: 'Hard',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'hosptial.png',
    mapX: 0.2,
    mapY: 0.74,
    selectable: false,
  },
  {
    id: 'factory',
    scenePath: 'assets/default',
    mapTitle: '6. ABANDONED FACTORY',
    mapTagline: 'SOMETHING STIRS WITHIN.',
    name: 'Abandoned Factory',
    subtitle: 'Coming Soon',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'factory.png',
    mapX: 0.16,
    mapY: 0.36,
    selectable: false,
  },
  {
    id: 'police',
    scenePath: 'assets/default',
    mapTitle: '7. BURDENVILLE PD',
    mapTagline: 'HOLD THE LINE.',
    name: 'Burdenville PD',
    subtitle: 'Coming Soon',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconFile: 'police.png',
    mapX: 0.78,
    mapY: 0.76,
    selectable: false,
  },
] as const;

export function getMissionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function getSelectableMissions(): MissionDef[] {
  return MISSIONS.filter((m) => m.selectable);
}

/** Fixed gameplay config when a mission still uses `missionConfig` directly. */
export function getMissionGameplayConfig(mission: MissionDef): MissionConfig | undefined {
  return mission.missionConfig;
}
