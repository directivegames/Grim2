/**
 * SoulActor — legacy class stub kept for scene-file compatibility.
 * Physical soul pickups have been removed; kills now award souls directly
 * via awardSoulFromEnemyKill(). This class no longer ticks or spawns.
 */
import * as ENGINE from '@gnsx/genesys.js';

@ENGINE.GameClass()
export class SoulActor extends ENGINE.Actor {
  public override getEditorClassIcon(): string | null {
    return 'Icon_Light';
  }
}
