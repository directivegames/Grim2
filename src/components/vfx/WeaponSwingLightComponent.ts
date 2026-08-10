import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Electric cyberpunk cyan — saturated, not washed out. */
const NEON_BLUE = 0x00e8ff;
const SWING_INTENSITY = 72;
const FINISHER_INTENSITY = 110;
const SWING_DISTANCE = 9;
const FINISHER_DISTANCE = 11;
const LIGHT_DECAY = 1.2;
const FADE_DURATION = 0.22;
const BLADE_LIGHT_T = 0.72;
const LIGHT_LIFT = 0.18;

@ENGINE.GameClass()
export class WeaponSwingLightComponent extends ENGINE.SceneNode {
  private _light: ENGINE.PointLightNode | null = null;
  private _currentIntensity = 0;
  private _fadeStartIntensity = 0;
  private _fadeElapsed = 0;
  private _isFading = false;
  private readonly _scratchPos = new THREE.Vector3();

  public override initialize(options?: ENGINE.SceneNodeOptions): void {
    super.initialize(options);

    this._light = ENGINE.PointLightNode.create({
      name: 'WeaponSwingNeonLight',
      color: NEON_BLUE,
      intensity: 0,
      distance: SWING_DISTANCE,
      decay: LIGHT_DECAY,
      castShadow: false,
    });
    this.add(this._light);
  }

  public beginSwing(finisher: boolean): void {
    if (!this._light) return;

    this._isFading = false;
    this._fadeElapsed = 0;
    this._light.distance = finisher ? FINISHER_DISTANCE : SWING_DISTANCE;
    this._setIntensity(finisher ? FINISHER_INTENSITY : SWING_INTENSITY);
  }

  public followBlade(weaponStart: THREE.Vector3, weaponEnd: THREE.Vector3): void {
    if (!this._light) return;

    this._scratchPos.copy(weaponStart).lerp(weaponEnd, BLADE_LIGHT_T);
    this._scratchPos.y += LIGHT_LIFT;
    this._light.setWorldPosition(this._scratchPos);
  }

  public endSwing(): void {
    if (!this._light || this._currentIntensity <= 0) return;

    this._isFading = true;
    this._fadeElapsed = 0;
    this._fadeStartIntensity = this._currentIntensity;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!this._isFading) return;

    this._fadeElapsed += deltaTime;
    const t = Math.min(this._fadeElapsed / FADE_DURATION, 1);
    const eased = 1 - t * t * (3 - 2 * t);
    this._setIntensity(this._fadeStartIntensity * eased);

    if (t >= 1) {
      this._isFading = false;
      this._setIntensity(0);
    }
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._setIntensity(0);
    return true;
  }

  private _setIntensity(value: number): void {
    this._currentIntensity = value;
    if (this._light) {
      this._light.intensity = value;
    }
  }
}
