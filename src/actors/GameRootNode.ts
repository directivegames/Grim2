/**
 * Placeable gameplay root — replacement for deprecated {@link ENGINE.Actor}.
 * Always a semantic world root; provides the NPC movement no-op predictor shim.
 */
import * as ENGINE from '@gnsx/genesys.js';

export abstract class GameRootNode extends ENGINE.PrimitiveNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  /**
   * Engine movement nodes call `owner?.getMovementPredictor()`. Pawns implement
   * this; plain roots need a no-op so the null check skips cleanly.
   */
  public getMovementPredictor(): null {
    return null;
  }
}
