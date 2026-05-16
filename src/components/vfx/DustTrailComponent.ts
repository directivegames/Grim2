import * as ENGINE from '@gnsx/genesys.js';

import { IsometricMovementComponent } from '../movement/IsometricMovementComponent.js';

const MIN_SPEED_SQ = 0.3 * 0.3;
/** How often to check movement state (seconds). */
const CHECK_INTERVAL = 0.08;

@ENGINE.GameClass()
export class DustTrailComponent extends ENGINE.SceneComponent {
  private _vfx: ENGINE.VFXComponent | null = null;
  private _timer = 0;
  private _isEmitting = false;

  public override initialize(options?: ENGINE.SceneComponentOptions): void {
    super.initialize(options);

    this._vfx = ENGINE.VFXComponent.create({
      vfxPath: '@project/assets/VFX/dust-cloud.vfx.json',
      autoStart: false,
    });
    this.add(this._vfx);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this._timer += deltaTime;
    if (this._timer < CHECK_INTERVAL) return;
    this._timer = 0;

    const actor = this.getActor();
    const mc = actor?.getComponent(IsometricMovementComponent);
    const isMoving = !!mc && mc.getWorldVelocity().lengthSq() >= MIN_SPEED_SQ;

    if (isMoving && !this._isEmitting) {
      this._vfx?.startEmitting();
      this._isEmitting = true;
    } else if (!isMoving && this._isEmitting) {
      this._vfx?.stopEmitting();
      this._isEmitting = false;
    }
  }

  public override endPlay(): void {
    if (this._isEmitting) {
      this._vfx?.stopEmitting();
      this._isEmitting = false;
    }
    super.endPlay();
  }
}
