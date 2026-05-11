/**
 * ZombieRiseVFXActor — Dark smoke/particle effect for zombie spawning.
 *
 * Creates a swirling dark smoke that rises from the ground, hiding the
 * zombie's spawn pop-in. Dark purple/black smoke with ground ripple.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const LIFETIME = 1.5;
const SMOKE_COUNT = 8;
const GROUND_RIPPLE_SEGMENTS = 16;

/** Max simultaneous rise effects — prevents spam. */
const MAX_ACTIVE = 10;
let activeCount = 0;

const SMOKE_GEOMETRY = new THREE.SphereGeometry(1, 10, 8);
const GROUND_GEOMETRY = new THREE.RingGeometry(0.1, 1, GROUND_RIPPLE_SEGMENTS);

interface SmokePiece {
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshBasicMaterial>;
  velocity: THREE.Vector3;
  startScale: number;
  maxScale: number;
  rotationSpeed: THREE.Vector3;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

@ENGINE.GameClass()
export class ZombieRiseVFXActor extends ENGINE.Actor {
  private readonly smokePieces: SmokePiece[] = [];
  private groundRipple: THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> | null = null;
  private elapsed = 0;

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    super.initialize({ ...options, rootComponent: root });

    this.createSmoke(root);
    this.createGroundRipple(root);
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    this.elapsed += deltaTime;
    const progress = Math.min(this.elapsed / LIFETIME, 1);

    // Smoke rises and fades
    const smokeAlpha = Math.max(0, 1 - progress * 0.8);

    for (const piece of this.smokePieces) {
      // Rise up with acceleration
      piece.velocity.y += deltaTime * 1.5; // acceleration
      piece.mesh.position.addScaledVector(piece.velocity, deltaTime);

      // Expand and rotate
      const expansion = THREE.MathUtils.lerp(0, 0.5, easeOutCubic(progress));
      piece.mesh.scale.setScalar(
        piece.startScale + (piece.maxScale - piece.startScale) * easeOutCubic(progress) + expansion
      );

      piece.mesh.rotation.x += piece.rotationSpeed.x * deltaTime;
      piece.mesh.rotation.y += piece.rotationSpeed.y * deltaTime;
      piece.mesh.rotation.z += piece.rotationSpeed.z * deltaTime;

      // Fade out
      piece.mesh.material.opacity = 0.45 * smokeAlpha;
    }

    // Ground ripple expands and fades
    if (this.groundRipple) {
      const rippleProgress = Math.min(this.elapsed / (LIFETIME * 0.6), 1);
      const rippleScale = THREE.MathUtils.lerp(0.2, 3.5, easeOutCubic(rippleProgress));
      this.groundRipple.scale.setScalar(rippleScale);
      this.groundRipple.material.opacity = 0.5 * Math.max(0, 1 - rippleProgress);
    }

    // End of life
    if (this.elapsed >= LIFETIME) {
      activeCount = Math.max(0, activeCount - 1);
      this.destroy();
    }
  }

  public static spawnAt(world: ENGINE.World, position: THREE.Vector3): ZombieRiseVFXActor | null {
    if (activeCount >= MAX_ACTIVE) return null;
    activeCount++;

    const actor = ZombieRiseVFXActor.create({
      position: position.clone().add(new THREE.Vector3(0, 0.1, 0)),
    });
    world.addActor(actor);
    return actor;
  }

  private createSmoke(root: ENGINE.SceneComponent): void {
    // Dark purple/black smoke colors
    const smokeColors = [
      new THREE.Color(0x1a0a2e), // deep purple
      new THREE.Color(0x0d0d0d), // near black
      new THREE.Color(0x2d1b4e), // dark violet
      new THREE.Color(0x1c1c1c), // charcoal
    ];

    for (let i = 0; i < SMOKE_COUNT; i++) {
      const color = smokeColors[Math.floor(Math.random() * smokeColors.length)];
      const material = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.45,
        depthWrite: false,
        blending: THREE.NormalBlending,
      });

      const mesh = new THREE.Mesh(SMOKE_GEOMETRY, material);

      // Random start position near ground
      const angle = Math.random() * Math.PI * 2;
      const radius = randomBetween(0, 0.8);
      mesh.position.set(
        Math.cos(angle) * radius,
        randomBetween(0, 0.3),
        Math.sin(angle) * radius
      );

      const startScale = randomBetween(0.2, 0.4);
      mesh.scale.setScalar(startScale);

      root.add(mesh);

      this.smokePieces.push({
        mesh,
        velocity: new THREE.Vector3(
          randomBetween(-0.3, 0.3),
          randomBetween(1.5, 3.0),
          randomBetween(-0.3, 0.3)
        ),
        startScale,
        maxScale: randomBetween(0.8, 1.4),
        rotationSpeed: new THREE.Vector3(
          randomBetween(-1, 1),
          randomBetween(-2, 2),
          randomBetween(-1, 1)
        ),
      });
    }
  }

  private createGroundRipple(root: ENGINE.SceneComponent): void {
    const material = new THREE.MeshBasicMaterial({
      color: 0x3d1f5c, // dark purple
      transparent: true,
      opacity: 0.5,
      side: THREE.DoubleSide,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });

    this.groundRipple = new THREE.Mesh(GROUND_GEOMETRY, material);
    this.groundRipple.rotation.x = -Math.PI / 2; // flat on ground
    this.groundRipple.position.y = 0.02;
    this.groundRipple.scale.setScalar(0.2);

    root.add(this.groundRipple);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Particle';
  }
}

function easeOutCubic(value: number): number {
  return 1 - Math.pow(1 - value, 3);
}
