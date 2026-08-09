/**
 * DebugCheatsActor — dev hotkeys for testing (P / O / R / L on map).
 * Uses a window key listener so cheats work when map/menus disable engine input.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  debugForcePostmanMission,
  debugGrantVaultResources,
  debugRerollMapMissions,
  debugWinMission,
} from '../utils/debug-cheats.js';

@ENGINE.GameClass()
export class DebugCheatsActor extends ENGINE.Actor {
  private readonly _onWindowKeyDown = (e: KeyboardEvent): void => {
    if (e.repeat) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }

    const key = e.key.toLowerCase();
    if (key === 'p') {
      if (debugWinMission(world)) {
        e.preventDefault();
      }
      return;
    }
    if (key === 'o') {
      if (debugGrantVaultResources(world)) {
        e.preventDefault();
      }
      return;
    }
    if (key === 'r') {
      if (debugRerollMapMissions(world)) {
        e.preventDefault();
      }
      return;
    }
    if (key === 'l') {
      if (debugForcePostmanMission(world)) {
        e.preventDefault();
      }
    }
  };

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }if (typeof window !== 'undefined') {
      window.addEventListener('keydown', this._onWindowKeyDown);
    }
  
    return true;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('keydown', this._onWindowKeyDown);
    }
    return true;
  }

  public static ensureExists(world: ENGINE.World): DebugCheatsActor {
    const existing = world.getActors().find(
      (a): a is DebugCheatsActor => a instanceof DebugCheatsActor,
    );
    if (existing) {
      return existing;
    }

    const actor = DebugCheatsActor.create({ name: 'DebugCheats' });
    world.addActor(actor);
    return actor;
  }
}
