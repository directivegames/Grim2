/**
 * DustTrailComponent — foot dust while the player moves (billboard puffs, no VFXComponent).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricMovementComponent } from '../movement/IsometricMovementComponent.js';
import {
  type BillboardSmokePuff,
  disposeBillboardSmokePuffs,
  loadSmokeTexture,
  spawnBillboardSmokeBurst,
  tickBillboardSmokePuffs,
} from './BillboardSmokePuffs.js';

const MIN_SPEED_SQ = 0.3 * 0.3;
const CHECK_INTERVAL = 0.08;
const SPAWN_INTERVAL = 0.1;
const MAX_PUFFS = 24;

const DUST_TEXTURE_PATH = '@project/assets/textures/vfx/DustPuffSoft.webp';

const _spawnPos = new THREE.Vector3();

@ENGINE.GameClass()
export class DustTrailComponent extends ENGINE.SceneComponent {
  private readonly _puffs: BillboardSmokePuff[] = [];
  private _dustTexture: THREE.Texture | null = null;
  private _checkTimer = 0;
  private _spawnTimer = 0;
  private _wasMoving = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    void this._beginPlayAsync();
    return true;
  }

  private async _beginPlayAsync(): Promise<void> {
    this._dustTexture = await loadSmokeTexture(DUST_TEXTURE_PATH);
    const world = this.getWorld();
    if (world && this._dustTexture) {
      spawnBillboardSmokeBurst(world, _spawnPos, this._dustTexture, [], {
        count: 0,
        texturePath: DUST_TEXTURE_PATH,
      });
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    tickBillboardSmokePuffs(this._puffs, deltaTime);

    this._checkTimer += deltaTime;
    if (this._checkTimer < CHECK_INTERVAL) {
      return;
    }
    this._checkTimer = 0;

    const actor = this.getActor();
    const mc = actor?.getComponent(IsometricMovementComponent);
    const isMoving = !!mc && mc.getWorldVelocity().lengthSq() >= MIN_SPEED_SQ;

    if (!isMoving) {
      this._wasMoving = false;
      this._spawnTimer = 0;
      return;
    }

    this._wasMoving = true;
    this._spawnTimer += CHECK_INTERVAL;
    if (this._spawnTimer < SPAWN_INTERVAL || this._puffs.length >= MAX_PUFFS) {
      return;
    }
    this._spawnTimer = 0;

    const world = this.getWorld();
    if (!world) {
      return;
    }

    this.getWorldPosition(_spawnPos);
    _spawnPos.y += 0.05;

    spawnBillboardSmokeBurst(world, _spawnPos, this._dustTexture, this._puffs, {
      count: 2,
      texturePath: DUST_TEXTURE_PATH,
      lifetime: 0.9,
      hue: [0.06, 0.1],
      saturation: [0.3, 0.5],
      lightness: [0.45, 0.62],
      maxScale: [0.7, 1.1],
      horizontalSpeed: [0.15, 0.5],
      verticalSpeed: [0.1, 0.35],
      yOffset: [-0.02, 0.06],
      peakOpacity: 0.45,
      size: 0.65,
    });
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    disposeBillboardSmokePuffs(this._puffs);
    this._dustTexture = null;
    return true;
  }
}
