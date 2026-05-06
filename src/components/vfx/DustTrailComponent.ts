import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { IsometricMovementComponent } from '../movement/IsometricMovementComponent.js';

const SPAWN_INTERVAL = 0.1;
const MIN_SPEED = 0.3;
const PUFF_LIFETIME = 0.8;

const PUFF_GEOMETRY = new THREE.PlaneGeometry(1, 1);

interface DustPuff {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  elapsed: number;
  maxScale: number;
  startPos: THREE.Vector3;
  drift: THREE.Vector3;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}

@ENGINE.GameClass()
export class DustTrailComponent extends ENGINE.SceneComponent {
  private _timer = 0;
  private readonly _puffs: DustPuff[] = [];

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this._updatePuffs(deltaTime);

    this._timer += deltaTime;
    if (this._timer < SPAWN_INTERVAL) return;

    const actor = this.getActor();
    const mc = actor?.getComponent(IsometricMovementComponent);
    if (!mc || mc.getWorldVelocity().length() < MIN_SPEED) return;

    this._timer = 0;
    this._spawnPuff(actor!.getWorldPosition());
  }

  private _spawnPuff(actorPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    const worldPos = actorPos.clone();
    worldPos.y -= 0.1;

    const worldRot = new THREE.Euler(-Math.PI / 2, 0, randomBetween(0, Math.PI * 2));

    const dustColor = new THREE.Color().setHSL(
      randomBetween(0.08, 0.12),
      randomBetween(0.3, 0.5),
      randomBetween(0.65, 0.8)
    );

    const material = new THREE.MeshBasicMaterial({
      color: dustColor,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    const mesh = new THREE.Mesh(PUFF_GEOMETRY, material);
    mesh.position.copy(worldPos);
    mesh.rotation.copy(worldRot);
    mesh.scale.setScalar(0.1);

    world.scene.add(mesh);

    this._puffs.push({
      mesh,
      elapsed: 0,
      maxScale: randomBetween(0.4, 0.9),
      startPos: worldPos.clone(),
      drift: new THREE.Vector3(
        randomBetween(-0.15, 0.15),
        randomBetween(0.05, 0.25),
        randomBetween(-0.15, 0.15)
      ),
    });
  }

  private _updatePuffs(deltaTime: number): void {
    for (let i = this._puffs.length - 1; i >= 0; i--) {
      const puff = this._puffs[i];
      puff.elapsed += deltaTime;

      const progress = Math.min(puff.elapsed / PUFF_LIFETIME, 1);

      const scale = THREE.MathUtils.lerp(0.1, puff.maxScale, easeOutCubic(progress));
      puff.mesh.scale.setScalar(scale);

      puff.mesh.position.addScaledVector(puff.drift, deltaTime);

      const alpha = 1 - progress;
      puff.mesh.material.opacity = 0.6 * alpha;

      if (progress >= 1) {
        puff.mesh.material.dispose();
        puff.mesh.removeFromParent();
        this._puffs.splice(i, 1);
      }
    }
  }

  public override endPlay(): void {
    for (const puff of this._puffs) {
      puff.mesh.material.dispose();
      puff.mesh.removeFromParent();
    }
    this._puffs.length = 0;
    super.endPlay();
  }
}
