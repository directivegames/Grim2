import * as ENGINE from '@gnsx/genesys.js';

import { GrimIntroActor } from '../actors/GrimIntroActor.js';
import { MenuMusicActor } from '../actors/MenuMusicActor.js';
import { MapUI } from '../ui/MapUI.js';
import { cleanupAfterMission } from './return-to-map.js';
import { hideGameplayPresentation } from './presentation-mode.js';
import { removeAllBlockingOverlays } from './screen-transition.js';
import { StartMenuUI } from '../ui/StartMenuUI.js';

/** Reset gameplay state and return to the start menu. */
export function returnToMainMenu(world: ENGINE.World): void {
  MapUI.close(world);
  cleanupAfterMission(world);
  hideGameplayPresentation(world);
  removeAllBlockingOverlays(world);

  // Re-open the title menu.
  const menu = StartMenuUI.reopenAfterQuit(world);
  MenuMusicActor.ensureExists(world);
  menu.setOnPlay(() => {
    world.add(GrimIntroActor.create({ name: 'GrimIntroActor' }));
  });
}
