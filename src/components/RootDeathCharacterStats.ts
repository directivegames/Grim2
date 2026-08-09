/**
 * CharacterStats that forwards death to the semantic root's `handleDeath`
 * instead of immediately destroying the root (engine 14 default).
 *
 * Restores the v13 Actor.handleDeath override pattern for game actors/pawns.
 */
import * as ENGINE from '@gnsx/genesys.js';

type RootWithDeath = ENGINE.SceneNode & {
  handleDeath?: (hitInfo?: ENGINE.DamageHitInfo) => void;
};

@ENGINE.GameClass()
export class RootDeathCharacterStats extends ENGINE.CharacterStatsNode {
  protected override handleDeath(hitInfo?: ENGINE.DamageHitInfo): void {
    const root = this.getRoot() as RootWithDeath | null;
    if (root?.handleDeath) {
      root.handleDeath(hitInfo);
      return;
    }
    super.handleDeath(hitInfo);
  }
}
