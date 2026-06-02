/**
 * DemonboxMailExplosionVFXActor — plays when a Demonbox self-destructs.
 *
 * Spawns 7 demonletter GLB pieces flying outward with gravity and tumble,
 * plus an immediate orange flash sphere. All pieces fade/scale over a
 * short lifetime, then the actor self-destroys.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMONLETTER_MODEL_URL =
  '@project/assets/models/demonletter.glb' as ENGINE.ModelPath;

const LETTER_COUNT = 7;
const LIFETIME_SEC = 2.5;
const GRAVITY = 9.0;
const LETTER_SCALE = new THREE.Vector3(5, 5, 5);

const FLASH_GEOMETRY = new THREE.SphereGeometry(1, 12, 8);
const SHOCKWAVE_GEOMETRY = new THREE.TorusGeometry(1, 0.04, 6, 32);

const MAX_ACTIVE = 4;
let _activeCount = 0;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function easeOutCubic(t: number): number {
  return 1 - Math.pow(1 - t, 3);
}

// ─── Piece tracking ───────────────────────────────────────────────────────────

interface LetterPiece {
  component: ENGINE.GLTFMeshComponent;
  velocity: THREE.Vector3;
  spinX: number;
  spinY: number;
  spinZ: number;
}

// ─── Actor ────────────────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class DemonboxMailExplosionVFXActor extends ENGINE.Actor {

  private readonly _letters: LetterPiece[] = [];
  private _flash: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial> | null = null;
  private _shockwave: THREE.Mesh<THREE.TorusGeometry, THREE.MeshBasicMaterial> | null = null;
  private _elapsed = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();

    // Orange flash sphere — visible immediately (no async load)
    const flashMat = new THREE.MeshBasicMaterial({
      color: 0xff6600,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
    });
    const flash = new THREE.Mesh(FLASH_GEOMETRY, flashMat);
    flash.scale.setScalar(0.3);
    (root as unknown as THREE.Object3D).add(flash);
    this._flash = flash;

    // Shockwave ring
    const waveMat = new THREE.MeshBasicMaterial({
      color: 0xff9900,
      transparent: true,
      opacity: 0.6,
      depthWrite: false,
    });
    const wave = new THREE.Mesh(SHOCKWAVE_GEOMETRY, waveMat);
    wave.rotation.x = Math.PI / 2;
    (root as unknown as THREE.Object3D).add(wave);
    this._shockwave = wave;

    // Letter pieces — spread evenly around the ring with random burst speed
    for (let i = 0; i < LETTER_COUNT; i++) {
      const angle = (i / LETTER_COUNT) * Math.PI * 2 + Math.random() * 0.6;
      const speed = 3.5 + Math.random() * 4.5;
      const upward = 2.5 + Math.random() * 4;

      const letter = ENGINE.GLTFMeshComponent.create({
        modelUrl: DEMONLETTER_MODEL_URL,
        scale: LETTER_SCALE.clone(),
        rotation: new THREE.Euler(
          Math.PI / 2,
          Math.random() * Math.PI * 2,
          Math.random() * Math.PI * 2,
        ),
        physicsOptions: { enabled: false },
        castShadow: false,
        receiveShadow: false,
      });

      root.add(letter);

      this._letters.push({
        component: letter,
        velocity: new THREE.Vector3(
          Math.cos(angle) * speed,
          upward,
          Math.sin(angle) * speed,
        ),
        spinX: (Math.random() - 0.5) * 10,
        spinY: (Math.random() - 0.5) * 10,
        spinZ: (Math.random() - 0.5) * 10,
      });
    }

    super.initialize({ ...options, rootComponent: root });
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this._elapsed += deltaTime;
    const progress = Math.min(this._elapsed / LIFETIME_SEC, 1);

    // Flash sphere: expand and fade quickly
    if (this._flash) {
      const t = Math.min(this._elapsed / 0.3, 1);
      this._flash.scale.setScalar(THREE.MathUtils.lerp(0.3, 3.5, easeOutCubic(t)));
      this._flash.material.opacity = Math.max(0, 0.85 * (1 - t));
    }

    // Shockwave ring: expand outward and fade
    if (this._shockwave) {
      const t = Math.min(this._elapsed / 0.45, 1);
      this._shockwave.scale.setScalar(THREE.MathUtils.lerp(0.2, 3.0, easeOutCubic(t)));
      this._shockwave.material.opacity = Math.max(0, 0.6 * (1 - t));
    }

    // Letter pieces: fly outward, tumble, then fade out
    const fadeStart = 0.8;
    const letterAlpha = progress < fadeStart
      ? 1
      : Math.max(0, 1 - (progress - fadeStart) / (1 - fadeStart));

    for (const letter of this._letters) {
      letter.velocity.y -= GRAVITY * deltaTime;
      letter.component.position.x += letter.velocity.x * deltaTime;
      letter.component.position.y += letter.velocity.y * deltaTime;
      letter.component.position.z += letter.velocity.z * deltaTime;
      letter.component.rotation.x += letter.spinX * deltaTime;
      letter.component.rotation.y += letter.spinY * deltaTime;
      letter.component.rotation.z += letter.spinZ * deltaTime;

      // Fade the mesh by traversing the loaded GLTF meshes
      if (letterAlpha < 1) {
        (letter.component as unknown as THREE.Object3D).traverse((child: THREE.Object3D) => {
          if (child instanceof THREE.Mesh) {
            const mats = Array.isArray(child.material)
              ? (child.material as THREE.Material[])
              : [child.material as THREE.Material];
            for (const mat of mats) {
              if ('opacity' in mat) {
                (mat as THREE.MeshStandardMaterial).transparent = true;
                (mat as THREE.MeshStandardMaterial).opacity = letterAlpha;
              }
            }
          }
        });
      }
    }

    if (this._elapsed >= LIFETIME_SEC) {
      _activeCount = Math.max(0, _activeCount - 1);
      this.destroy();
    }
  }

  protected override doEndPlay(): void {
    if (this._flash) {
      this._flash.material.dispose();
      this._flash.removeFromParent();
      this._flash = null;
    }
    if (this._shockwave) {
      this._shockwave.material.dispose();
      this._shockwave.removeFromParent();
      this._shockwave = null;
    }
    this._letters.length = 0;
    super.doEndPlay();
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): DemonboxMailExplosionVFXActor | null {
    if (_activeCount >= MAX_ACTIVE) return null;
    _activeCount++;
    const actor = DemonboxMailExplosionVFXActor.create({ position: position.clone() });
    world.addActor(actor);
    return actor;
  }

  /** Clean up all active mail VFX actors on mission reset. */
  public static destroyAllRuntime(world: ENGINE.World): void {
    const toDestroy: DemonboxMailExplosionVFXActor[] = [];
    for (const actor of world.getActors()) {
      if (actor instanceof DemonboxMailExplosionVFXActor) toDestroy.push(actor);
    }
    for (const actor of toDestroy) actor.destroy();
    _activeCount = 0;
  }
}
