/**
 * EnemySpawnPointActor — place in the scene where horde zombies should spawn.
 *
 * HordeManager picks randomly among the closest enabled markers (XZ) when spawning.
 * Orange gizmo in the editor; hidden in play unless Show Wireframe In Game is on.
 */
import * as ENGINE from '@gnsx/genesys.js';

import {
  registerEnemySpawnPoint,
  unregisterEnemySpawnPoint,
} from '../mission/enemy-spawn-points.js';
import {
  SpawnPointMarkerActor,
  type SpawnPointMarkerColors,
} from './SpawnPointMarkerActor.js';

const ENEMY_MARKER_COLORS: SpawnPointMarkerColors = {
  fill: 0xffaa44,
  edge: 0xff6600,
};

@ENGINE.GameClass()
export class EnemySpawnPointActor extends SpawnPointMarkerActor {
  protected override getMarkerColors(): SpawnPointMarkerColors {
    return ENEMY_MARKER_COLORS;
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    if (!this.getWorld()?.isEditorWorld) {
      registerEnemySpawnPoint(this);
    }
  }

  protected override doEndPlay(): void {
    unregisterEnemySpawnPoint(this);
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
