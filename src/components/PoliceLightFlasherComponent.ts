/**
 * Alternating red/blue police bar light pattern for scene-placed emergency lights.
 * Toggles intensity only (never adds/removes lights) to avoid shader recompilation stalls.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

/** Full red-on / blue-on half-cycle duration (seconds). */
const HALF_CYCLE = 0.28;
/** Crossfade window at each hand-off (fraction of half-cycle). */
const CROSSFADE = 0.22;
/** Brief blackout between sides (fraction of full cycle). */
const DEAD_ZONE = 0.04;
/** Min/max seconds between optional stutter pauses. */
const STUTTER_INTERVAL_MIN = 3.5;
const STUTTER_INTERVAL_MAX = 7.5;
const STUTTER_CHANCE = 0.4;
const STUTTER_DURATION_MIN = 0.028;
const STUTTER_DURATION_MAX = 0.055;
/** Skip light updates when farther than this from the player (world units). */
const UPDATE_DISTANCE = 25;
const UPDATE_DISTANCE_SQ = UPDATE_DISTANCE * UPDATE_DISTANCE;
/** Flicker update rate when in range (seconds between intensity updates). */
const UPDATE_INTERVAL = 0.1;

@ENGINE.GameClass()
export class PoliceLightFlasherComponent extends ENGINE.SceneNode {
  private _red: ENGINE.PointLightNode | null = null;
  private _blue: ENGINE.PointLightNode | null = null;
  private _redBase = 0;
  private _blueBase = 0;
  private _elapsed = 0;
  private _phaseOffset = 0;
  private _stutterCountdown = 0;
  private _stutterHold = 0;
  private _bound = false;
  private _updateAccumulator = 0;
  private _lightsActive = false;
  private readonly _myPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (!this._bound) {
      this._bindLights();
    }
    if (!this._red || !this._blue) {
      return;
    }

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (player) {
      this.getWorldPosition(this._myPos);
      player.getWorldPosition(this._playerPos);
      if (this._myPos.distanceToSquared(this._playerPos) > UPDATE_DISTANCE_SQ) {
        if (this._lightsActive) {
          this._setIntensities(0, 0);
          this._lightsActive = false;
        }
        return;
      }
      this._lightsActive = true;
    }

    this._updateAccumulator += deltaTime;
    if (this._updateAccumulator < UPDATE_INTERVAL) {
      return;
    }
    const step = this._updateAccumulator;
    this._updateAccumulator = 0;

    if (this._stutterHold > 0) {
      this._stutterHold -= step;
      this._setIntensities(0, 0);
      return;
    }

    this._stutterCountdown -= step;
    if (this._stutterCountdown <= 0) {
      if (Math.random() < STUTTER_CHANCE) {
        this._stutterHold =
          STUTTER_DURATION_MIN + Math.random() * (STUTTER_DURATION_MAX - STUTTER_DURATION_MIN);
      }
      this._stutterCountdown =
        STUTTER_INTERVAL_MIN +
        Math.random() * (STUTTER_INTERVAL_MAX - STUTTER_INTERVAL_MIN);
    }

    this._elapsed += step;
    const cycle = HALF_CYCLE * 2;
    let phase = ((this._elapsed + this._phaseOffset) % cycle) / cycle;

    const deadStart = 0.5 - DEAD_ZONE * 0.5;
    const deadEnd = 0.5 + DEAD_ZONE * 0.5;
    if (phase >= deadStart && phase < deadEnd) {
      this._setIntensities(0, 0);
      return;
    }

    const redHalf = phase < 0.5;
    const localPhase = redHalf ? phase * 2 : (phase - 0.5) * 2;
    const redEnv = redHalf ? this._sideEnvelope(localPhase) : this._fadeOutEnvelope(localPhase);
    const blueEnv = redHalf ? this._fadeOutEnvelope(localPhase) : this._sideEnvelope(localPhase);

    this._setIntensities(this._redBase * redEnv, this._blueBase * blueEnv);
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this._setIntensities(0, 0);
    return true;
  }

  private _bindLights(): void {
    this._bound = true;
    const actor = this.getRoot();
    if (!actor) {
      return;
    }

    const lights = actor.getNodes(ENGINE.PointLightNode);
    if (lights.length < 2) {
      return;
    }

    for (const light of lights) {
      const { r, g, b } = this._readRgb(light);
      if (r > 0.5 && b < 0.25 && g < 0.2) {
        this._red = light;
        this._redBase = light.intensity;
      } else if (b > 0.5 && r < 0.1) {
        this._blue = light;
        this._blueBase = light.intensity;
      }
    }

    if (this._red && this._blue) {
      this._phaseOffset = Math.random() * HALF_CYCLE * 2;
      this._stutterCountdown =
        STUTTER_INTERVAL_MIN +
        Math.random() * (STUTTER_INTERVAL_MAX - STUTTER_INTERVAL_MIN);
      this._setIntensities(0, 0);
      return;
    }

    this._red = null;
    this._blue = null;
  }

  private _readRgb(light: ENGINE.PointLightNode): { r: number; g: number; b: number } {
    const c = light.color as THREE.Color | number | { _: number[] };
    if (c instanceof THREE.Color) {
      return { r: c.r, g: c.g, b: c.b };
    }
    if (typeof c === 'number') {
      return {
        r: ((c >> 16) & 255) / 255,
        g: ((c >> 8) & 255) / 255,
        b: (c & 255) / 255,
      };
    }
    if (c && typeof c === 'object' && '_' in c) {
      const [r, g, b] = (c as { _: number[] })._;
      return { r: r ?? 0, g: g ?? 0, b: b ?? 0 };
    }
    return { r: 1, g: 1, b: 1 };
  }

  /** Attack → hold → release for the active side. */
  private _sideEnvelope(t: number): number {
    const attackEnd = CROSSFADE;
    const holdEnd = 1 - CROSSFADE;
    if (t < attackEnd) {
      return this._smoothstep(0, attackEnd, t);
    }
    if (t < holdEnd) {
      return 1;
    }
    return 1 - this._smoothstep(holdEnd, 1, t);
  }

  /** Opposite side trails off during crossfade. */
  private _fadeOutEnvelope(t: number): number {
    if (t > CROSSFADE) {
      return 0;
    }
    return (1 - this._smoothstep(0, CROSSFADE, t)) * 0.12;
  }

  private _smoothstep(edge0: number, edge1: number, x: number): number {
    const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
    return t * t * (3 - 2 * t);
  }

  private _setIntensities(red: number, blue: number): void {
    if (this._red) {
      this._red.intensity = red;
    }
    if (this._blue) {
      this._blue.intensity = blue;
    }
  }
}
