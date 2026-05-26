/**
 * InnocentSpawnPointActor — place in the scene where innocents should appear.
 *
 * Mission code picks an unused marker per save (then reuses when all are spent).
 * Green gizmo in the editor; hidden in play unless Show Wireframe In Game is on.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  registerInnocentSpawnPoint,
  unregisterInnocentSpawnPoint,
} from '../mission/innocent-spawn-points.js';
import {
  SpawnPointMarkerActor,
  type SpawnPointMarkerColors,
} from './SpawnPointMarkerActor.js';

const INNOCENT_MARKER_COLORS: SpawnPointMarkerColors = {
  fill: 0x55ff88,
  edge: 0x22ff66,
};

@ENGINE.GameClass()
export class InnocentSpawnPointActor extends SpawnPointMarkerActor {
  protected override getMarkerColors(): SpawnPointMarkerColors {
    return INNOCENT_MARKER_COLORS;
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    if (!this.getWorld()?.isEditorWorld) {
      registerInnocentSpawnPoint(this);
    }
  }

  protected override doEndPlay(): void {
    unregisterInnocentSpawnPoint(this);
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
