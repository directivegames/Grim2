/**
 * Shared pool for editor-placed scene meshes (fists, weapons).
 * Names: "fistofannoyance", "fistofannoyance 02", "weapon", "weapon 02", etc.
 *
 * Engine 14: scene weapons/fists serialize as ModelMeshActor (SceneNode roots),
 * not Actor — collect via getRootNodes, never getRootNodes().
 */
import * as ENGINE from '@gnsx/genesys.js';

const FIST_PREFIX = 'fistofannoyance';
const WEAPON_PREFIX = 'weapon';

const HIDDEN_Y = -1000;

function normalizeName(name: string): string {
  return name.toLowerCase().trim();
}

function fistSortIndex(name: string): number {
  const n = normalizeName(name);
  if (n === FIST_PREFIX) return 0;
  const match = n.match(/^fistofannoyance\s+0*(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 999;
}

function weaponSortIndex(name: string): number {
  const n = normalizeName(name);
  if (n === WEAPON_PREFIX) return 0;
  const match = n.match(/^weapon\s+0*(\d+)$/);
  return match ? parseInt(match[1]!, 10) : 999;
}

export function isSceneFistActor(name: string): boolean {
  const n = normalizeName(name);
  return n === FIST_PREFIX || n.startsWith(`${FIST_PREFIX} `);
}

export function isSceneWeaponActor(name: string): boolean {
  const n = normalizeName(name);
  return n === WEAPON_PREFIX || /^weapon\s+0*\d+$/.test(n);
}

function sortByIndex(a: ENGINE.SceneNode, b: ENGINE.SceneNode, indexFn: (name: string) => number): number {
  const da = indexFn(a.name);
  const db = indexFn(b.name);
  if (da !== db) return da - db;
  return a.name.localeCompare(b.name);
}

export function collectSceneFists(world: ENGINE.World): ENGINE.SceneNode[] {
  const fists: ENGINE.SceneNode[] = [];
  for (const root of world.getRootNodes()) {
    if (isSceneFistActor(root.name)) {
      fists.push(root);
    }
  }
  fists.sort((a, b) => sortByIndex(a, b, fistSortIndex));
  return fists;
}

export function collectSceneWeapons(world: ENGINE.World): ENGINE.SceneNode[] {
  const weapons: ENGINE.SceneNode[] = [];
  for (const root of world.getRootNodes()) {
    if (isSceneWeaponActor(root.name)) {
      weapons.push(root);
    }
  }
  weapons.sort((a, b) => sortByIndex(a, b, weaponSortIndex));
  return weapons;
}

// ─── Fist pool ───────────────────────────────────────────────────────────────

const _fistsInUse = new Set<ENGINE.SceneNode>();

export function acquireSceneFist(world: ENGINE.World): ENGINE.SceneNode | null {
  for (const fist of collectSceneFists(world)) {
    if (!_fistsInUse.has(fist)) {
      _fistsInUse.add(fist);
      return fist;
    }
  }
  return null;
}

export function releaseSceneFist(fist: ENGINE.SceneNode | null): void {
  if (!fist) return;
  _fistsInUse.delete(fist);
  fist.position.y = HIDDEN_Y;
}

export function parkAllSceneFists(world: ENGINE.World): void {
  for (const fist of collectSceneFists(world)) {
    if (!_fistsInUse.has(fist)) {
      fist.position.y = HIDDEN_Y;
    }
  }
}

export function parkAllSceneWeapons(world: ENGINE.World): void {
  for (const weapon of collectSceneWeapons(world)) {
    weapon.visible = false;
  }
}
