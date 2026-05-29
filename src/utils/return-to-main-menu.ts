import * as ENGINE from '@gnsx/genesys.js';

import { GrimIntroActor } from '../actors/GrimIntroActor.js';
import { MenuMusicActor } from '../actors/MenuMusicActor.js';
import { MapUI } from '../ui/MapUI.js';
import { cleanupAfterMission } from './return-to-map.js';
import { StartMenuUI } from '../ui/StartMenuUI.js';

/** Reset gameplay state and return to the start menu. */
export function returnToMainMenu(world: ENGINE.World): void {
  MapUI.close(world);
  cleanupAfterMission(world);

  // Re-open the title menu. PLAY runs the in-scene Grim's Room cutscene again.
  const menu = StartMenuUI.reopenAfterQuit(world);
  MenuMusicActor.ensureExists(world);
  menu.setOnPlay(() => {
    world.addActor(GrimIntroActor.create({ name: 'GrimIntroActor' }));
  });
}
