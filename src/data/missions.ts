/** Difficulty shown on the mission briefing panel. */
export type MissionDifficulty = 'Easy' | 'Medium' | 'Hard';

/** One selectable location on the Burdenville map. */
export interface MissionDef {
  /** Stable id, e.g. `suburbs`. */
  id: string;
  /** Map load path passed to `gameLoop.loadMap()` (no `.genesys-scene` suffix). */
  scenePath: string;
  /** Display name, e.g. Break Out. */
  name: string;
  /** Secondary line, e.g. Level 1. */
  subtitle: string;
  difficulty: MissionDifficulty;
  description: string;
  objectives: string[];
  /** Which map icon to use (`icon1.png` … `icon7.png`). */
  iconIndex: number;
  /** If false, icon is visible but not selectable (coming soon). */
  selectable: boolean;
}

/** All Burdenville map locations. Only selectable missions can be started. */
export const MISSIONS: readonly MissionDef[] = [
  {
    id: 'suburbs',
    scenePath: 'assets/default',
    name: 'Break Out',
    subtitle: 'Level 1',
    difficulty: 'Easy',
    description:
      'Fight through the suburbs and clear the undead. Placeholder briefing — replace with final copy.',
    objectives: [
      'Survive the suburban streets',
      'Defeat the zombie horde',
      'Reach the extraction point',
    ],
    iconIndex: 1,
    selectable: true,
  },
  {
    id: 'downtown',
    scenePath: 'assets/default',
    name: 'Downtown',
    subtitle: 'Level 1',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 2,
    selectable: false,
  },
  {
    id: 'industrial',
    scenePath: 'assets/default',
    name: 'Industrial',
    subtitle: 'Level 1',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 3,
    selectable: false,
  },
  {
    id: 'hospital',
    scenePath: 'assets/default',
    name: 'Hospital',
    subtitle: 'Level 1',
    difficulty: 'Hard',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 4,
    selectable: false,
  },
  {
    id: 'cemetery',
    scenePath: 'assets/default',
    name: 'Cemetery',
    subtitle: 'Level 1',
    difficulty: 'Hard',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 5,
    selectable: false,
  },
  {
    id: 'mall',
    scenePath: 'assets/default',
    name: 'Mall',
    subtitle: 'Level 1',
    difficulty: 'Medium',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 6,
    selectable: false,
  },
  {
    id: 'outskirts',
    scenePath: 'assets/default',
    name: 'Outskirts',
    subtitle: 'Level 1',
    difficulty: 'Easy',
    description: 'Coming soon.',
    objectives: [],
    iconIndex: 7,
    selectable: false,
  },
] as const;

export function getMissionById(id: string): MissionDef | undefined {
  return MISSIONS.find((m) => m.id === id);
}

export function getSelectableMissions(): MissionDef[] {
  return MISSIONS.filter((m) => m.selectable);
}
