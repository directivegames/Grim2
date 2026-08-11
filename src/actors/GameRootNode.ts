/**
 * Placeable gameplay root — replacement for deprecated {@link ENGINE.Actor}.
 * Always a semantic world root; provides the NPC movement no-op predictor shim.
 */
import * as ENGINE from '@gnsx/genesys.js';

export abstract class GameRootNode extends ENGINE.PrimitiveNode {
  public override get isRoot(): boolean {
    return true;
  }

  public override set isRoot(value: boolean) {
    super.isRoot = value;
  }

  /**
   * Match deprecated Actor: non-networked roots are locally authoritative.
   * SceneNode defaults to false without a ReplicationGroup, which skips
   * BasePawnMovementNode ticks and freezes NPC / projectile movement.
   */
  public override hasAuthority(): boolean {
    const group = this.getReplicationGroup();
    return group ? group.hasAuthority() : true;
  }

  /**
   * Engine movement nodes call `owner?.getMovementPredictor()`. Pawns implement
   * this; plain roots need a no-op so the null check skips cleanly.
   */
  public getMovementPredictor(): null {
    return null;
  }
}
