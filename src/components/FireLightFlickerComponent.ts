/**
 * Organic fire-like flicker for scene point lights (e.g. burning car).
 * Modulates intensity and warm color only — never adds/removes lights.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const NOISE_BLEND_SPEED = 9;
const NOISE_REPICK_RATE = 4;
const SURGE_INTERVAL_MIN = 0.35;
const SURGE_INTERVAL_MAX = 1.1;
const SURGE_CHANCE = 0.38;
const INTENSITY_MIN = 0.42;
const INTENSITY_MAX = 1.55;
/** Skip light updates when farther than this from the player (world units). */
const UPDATE_DISTANCE = 25;
const UPDATE_DISTANCE_SQ = UPDATE_DISTANCE * UPDATE_DISTANCE;
/** Flicker update rate when in range (seconds between intensity updates). */
const UPDATE_INTERVAL = 0.1;

@ENGINE.GameClass()
export class FireLightFlickerComponent extends ENGINE.SceneNode {
  private _light: ENGINE.PointLightNode | null = null;
  private _baseIntensity = 0;
  private readonly _baseColor = new THREE.Color();
  private readonly _scratchColor = new THREE.Color();
  private readonly _hotColor = new THREE.Color(1, 0.38, 0.06);

  private _elapsed = 0;
  private _phase1 = 0;
  private _phase2 = 0;
  private _phase3 = 0;
  private _noise = 0.5;
  private _noiseTarget = 0.5;
  private _surgeTimer = 0;
  private _surgeBoost = 0;
  private _bound = false;
  private _updateAccumulator = 0;
  private _lightActive = false;
  private readonly _myPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!this._bound) {
      this._bindLight();
    }
    if (!this._light) {
      return;
    }

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (player) {
      this.getWorldPosition(this._myPos);
      player.getWorldPosition(this._playerPos);
      if (this._myPos.distanceToSquared(this._playerPos) > UPDATE_DISTANCE_SQ) {
        if (this._lightActive) {
          this._light.intensity = 0;
          this._lightActive = false;
        }
        return;
      }
      this._lightActive = true;
    }

    this._updateAccumulator += deltaTime;
    if (this._updateAccumulator < UPDATE_INTERVAL) {
      return;
    }
    const step = this._updateAccumulator;
    this._updateAccumulator = 0;

    this._elapsed += step;

    if (Math.random() < step * NOISE_REPICK_RATE) {
      this._noiseTarget = 0.25 + Math.random() * 0.75;
    }
    const noiseBlend = Math.min(1, step * NOISE_BLEND_SPEED);
    this._noise += (this._noiseTarget - this._noise) * noiseBlend;

    this._surgeTimer -= step;
    if (this._surgeTimer <= 0) {
      this._surgeTimer =
        SURGE_INTERVAL_MIN + Math.random() * (SURGE_INTERVAL_MAX - SURGE_INTERVAL_MIN);
      if (Math.random() < SURGE_CHANCE) {
        this._surgeBoost = 0.18 + Math.random() * 0.32;
      }
    }
    this._surgeBoost *= Math.exp(-step * 6);

    const t = this._elapsed;
    const flicker =
      0.72 +
      0.14 * Math.sin(t * 4.2 + this._phase1) +
      0.09 * Math.sin(t * 11.7 + this._phase2) +
      0.06 * Math.sin(t * 23.3 + this._phase3) +
      (this._noise - 0.5) * 0.24 +
      this._surgeBoost;

    this._light.intensity =
      this._baseIntensity * THREE.MathUtils.clamp(flicker, INTENSITY_MIN, INTENSITY_MAX);

    const colorShift = 0.5 + 0.5 * Math.sin(t * 6.1 + this._phase2);
    this._scratchColor.copy(this._baseColor);
    this._scratchColor.lerp(this._hotColor, (colorShift - 0.5) * 0.28);
    this._light.color = this._scratchColor;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    if (this._light) {
      this._light.intensity = this._baseIntensity;
      this._light.color = this._baseColor;
    }
    return true;
  }

  private _bindLight(): void {
    this._bound = true;
    const actor = this.getRoot();
    if (!actor) {
      return;
    }

    const lights = actor.getNodes(ENGINE.PointLightNode);
    if (lights.length === 0) {
      return;
    }

    const light = lights[0]!;
    this._light = light;
    this._baseIntensity = light.intensity;
    this._readColor(light, this._baseColor);

    this._phase1 = Math.random() * Math.PI * 2;
    this._phase2 = Math.random() * Math.PI * 2;
    this._phase3 = Math.random() * Math.PI * 2;
    this._noise = 0.4 + Math.random() * 0.2;
    this._noiseTarget = this._noise;
    this._surgeTimer = 0.2 + Math.random() * 0.5;
  }

  private _readColor(light: ENGINE.PointLightNode, out: THREE.Color): void {
    const c = light.color as THREE.Color | number | { _: number[] };
    if (c instanceof THREE.Color) {
      out.copy(c);
      return;
    }
    if (typeof c === 'number') {
      out.setHex(c);
      return;
    }
    if (c && typeof c === 'object' && '_' in c) {
      const [r, g, b] = (c as { _: number[] })._;
      out.setRGB(r ?? 1, g ?? 0.5, b ?? 0);
      return;
    }
    out.setRGB(1, 0.55, 0.05);
  }
}
