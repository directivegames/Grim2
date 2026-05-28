/**
 * Development cheat keys (P = mission win, O = vault resources, R = reroll map missions, L = Postman).
 */
import * as ENGINE from '@gnsx/genesys.js';

import { ITEMS } from '../data/items.js';
import { grimVault } from '../game/GrimVault.js';
import { missionRunner } from '../mission/MissionRunner.js';
import { missionState } from '../mission/MissionState.js';
import { OptionsMenuUI } from '../ui/OptionsMenuUI.js';
import { StartMenuUI } from '../ui/StartMenuUI.js';
import { MapUI } from '../ui/MapUI.js';
import { UpgradeShopUI } from '../ui/UpgradeShopUI.js';

const DEBUG_SOUL_GRANT = 2000;
const DEBUG_ITEM_QTY = 100;

function isMissionResultOpen(): boolean {
  if (typeof document === 'undefined') {
    return false;
  }
  return (
    document.querySelector('[data-mission-result]') != null ||
    document.querySelector('[data-mission-rewards]') != null
  );
}

/** True when the player is in an active mission run (not map / menus). */
export function canDebugWinMission(world: ENGINE.World): boolean {
  if (!missionRunner.isRunning || !missionState.isActive) {
    return false;
  }
  if (isMissionResultOpen()) {
    return false;
  }
  return true;
}

/** True when vault cheats are allowed (anywhere except title / options). */
export function canDebugGrantVaultResources(world: ENGINE.World): boolean {
  if (StartMenuUI.isVisible(world)) {
    return false;
  }
  if (OptionsMenuUI.isOpen(world)) {
    return false;
  }
  if (isMissionResultOpen()) {
    return false;
  }
  return true;
}

export function debugWinMission(world: ENGINE.World): boolean {
  if (!canDebugWinMission(world)) {
    return false;
  }

  missionState.debugForceSuccess();
  console.info('[Debug] Mission forced to success (P).');
  return true;
}

/** True when the Burdenville map is open. */
export function canDebugRerollMapMissions(world: ENGINE.World): boolean {
  return MapUI.isOpen(world);
}

export function debugRerollMapMissions(world: ENGINE.World): boolean {
  if (!canDebugRerollMapMissions(world)) {
    return false;
  }

  return MapUI.debugRerollMissions(world);
}

export function debugForcePostmanMission(world: ENGINE.World): boolean {
  if (!canDebugRerollMapMissions(world)) {
    return false;
  }

  const ok = MapUI.debugForcePostmanMission(world);
  if (ok) {
    console.info('[Debug] Postman boss mission forced on map board (L).');
  }
  return ok;
}

export function debugGrantVaultResources(world: ENGINE.World): boolean {
  if (!canDebugGrantVaultResources(world)) {
    return false;
  }

  grimVault.addSouls(DEBUG_SOUL_GRANT);
  for (const item of ITEMS) {
    grimVault.addItem(item.id, DEBUG_ITEM_QTY);
  }

  UpgradeShopUI.open(world);

  console.info(
    `[Debug] Granted ${DEBUG_SOUL_GRANT} souls and ${DEBUG_ITEM_QTY} of each item (O).`,
  );
  return true;
}
