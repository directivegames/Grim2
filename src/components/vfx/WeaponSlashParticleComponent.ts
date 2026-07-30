/**
 * WeaponSlashParticleComponent — Purple crescent slash burst along the swing arc.
 *
 * Spawns additive streaks + soft glow blobs on a circular arc (attack start → end).
 * Colours: electric purple tail → bright white/cyan leading edge.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

const STREAK_LIFETIME = 0.22;
const GLOW_LIFETIME = 0.28;

const STREAK_COUNT = 48;
const GLOW_COUNT = 16;

const INNER_RADIUS = 0.5;
const OUTER_RADIUS = 2.8;

const SWING_SPEED = 6;
const OUTWARD_SPEED = 1.2;
const UP_SPEED = 0.8;

const STREAK_GEO = new THREE.PlaneGeometry(0.06, 0.28);
const GLOW_GEO = new THREE.SphereGeometry(0.12, 6, 6);

const POOL_SIZE = 80;

const _up = new THREE.Vector3(0, 1, 0);
const _dir = new THREE.Vector3();
const _axis = new THREE.Vector3();
const _pos = new THREE.Vector3();
const _vel = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _outward = new THREE.Vector3();
const _streakColorScratch = new THREE.Color();
const _glowColorScratch = new THREE.Color(0.55, 0.2, 0.95);

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function applySlashStreakColor(tNorm: number, out: THREE.Color): THREE.Color {
  return out.setRGB(
    THREE.MathUtils.lerp(0.75, 0.95, tNorm),
    THREE.MathUtils.lerp(0.15, 1.0, tNorm),
    1.0,
  );
}

interface SlashParticle {
  mesh: THREE.Mesh;
  elapsed: number;
  velocity: THREE.Vector3;
  lifetime: number;
  active: boolean;
  isGlow: boolean;
}

function _orientStreak(mesh: THREE.Mesh, tangent: THREE.Vector3): void {
  _dir.copy(tangent).normalize();
  _axis.crossVectors(_up, _dir).normalize();
  const ang = Math.acos(Math.min(1, Math.abs(_up.dot(_dir))));
  if (_axis.lengthSq() > 0.001) {
    mesh.quaternion.setFromAxisAngle(_axis, ang);
  } else {
    mesh.quaternion.identity();
  }
  mesh.rotateZ(randomBetween(-0.35, 0.35));
}

@ENGINE.GameClass()
export class WeaponSlashParticleComponent extends ENGINE.SceneComponent {
  private readonly _pool: SlashParticle[] = [];
  private readonly _free: SlashParticle[] = [];
  private readonly _active: SlashParticle[] = [];
  private _poolBuilt = false;

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    super.beginPlay();
    this._ensurePool();
    const world = this.getWorld();
    if (!world) return true;
    for (const p of this._pool) {
      world.scene.add(p.mesh);
    }
    return true;
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    for (const p of this._active) {
      p.mesh.visible = false;
      p.active = false;
      this._free.push(p);
    }
    this._active.length = 0;
    for (const p of this._pool) {
      p.mesh.removeFromParent();
      p.mesh.visible = false;
      p.active = false;
    }
    this._free.length = 0;
    super.endPlay();
    return true;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._updateParticles(deltaTime);
  }

  /**
   * Burst particles along the weapon swing arc (orbit angles, +X = cos, +Z = sin).
   */
  public burstArc(
    playerPos: THREE.Vector3,
    startAngle: number,
    endAngle: number,
    heightOffset: number,
  ): void {
    const world = this.getWorld();
    if (!world) return;

    this._ensurePool();

    let delta = endAngle - startAngle;
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    const swingSign = delta >= 0 ? 1 : -1;

    const baseY = playerPos.y + heightOffset;

    for (let i = 0; i < STREAK_COUNT; i++) {
      const p = this._acquire();
      if (!p) break;

      const t = STREAK_COUNT > 1 ? i / (STREAK_COUNT - 1) : 0;
      const angle = startAngle + delta * t;
      const radius = randomBetween(INNER_RADIUS, OUTER_RADIUS);

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      _pos.set(
        playerPos.x + cos * radius,
        baseY + randomBetween(-0.08, 0.12),
        playerPos.z + sin * radius,
      );

      _tangent.set(-sin * swingSign, 0, cos * swingSign);
      _outward.set(cos, 0, sin);

      _vel
        .copy(_tangent)
        .multiplyScalar(SWING_SPEED * randomBetween(0.7, 1.2))
        .addScaledVector(_outward, OUTWARD_SPEED * randomBetween(0.4, 1.0));
      _vel.y += UP_SPEED * randomBetween(0.3, 1.0);

      applySlashStreakColor(t, _streakColorScratch);
      this._spawnParticle(p, _pos, _vel, _streakColorScratch, STREAK_LIFETIME, false);
      _orientStreak(p.mesh, _tangent);

      const lenScale = randomBetween(0.75, 1.0);
      p.mesh.scale.set(randomBetween(0.55, 0.85) * lenScale, lenScale, 1);
    }

    for (let i = 0; i < GLOW_COUNT; i++) {
      const p = this._acquire();
      if (!p) break;

      const t = GLOW_COUNT > 1 ? i / (GLOW_COUNT - 1) : 0;
      const angle = startAngle + delta * t;
      const radius = randomBetween(INNER_RADIUS * 0.6, OUTER_RADIUS * 0.95);

      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      _pos.set(
        playerPos.x + cos * radius,
        baseY + randomBetween(-0.05, 0.1),
        playerPos.z + sin * radius,
      );

      _tangent.set(-sin * swingSign, 0, cos * swingSign);
      _outward.set(cos, 0, sin);

      _vel
        .copy(_tangent)
        .multiplyScalar(SWING_SPEED * 0.45)
        .addScaledVector(_outward, OUTWARD_SPEED * 0.35);
      _vel.y += UP_SPEED * 0.5;

      this._spawnParticle(p, _pos, _vel, _glowColorScratch, GLOW_LIFETIME, true);
      p.mesh.scale.setScalar(randomBetween(0.6, 1.0));
    }
  }

  private _ensurePool(): void {
    if (this._poolBuilt) return;
    this._poolBuilt = true;

    for (let i = 0; i < POOL_SIZE; i++) {
      const isGlow = i >= POOL_SIZE - 20;
      const geo = isGlow ? GLOW_GEO : STREAK_GEO;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;

      const particle: SlashParticle = {
        mesh,
        elapsed: 0,
        velocity: new THREE.Vector3(),
        lifetime: STREAK_LIFETIME,
        active: false,
        isGlow,
      };
      this._pool.push(particle);
      this._free.push(particle);
    }
  }

  private _acquire(): SlashParticle | null {
    return this._free.pop() ?? null;
  }

  private _spawnParticle(
    p: SlashParticle,
    pos: THREE.Vector3,
    vel: THREE.Vector3,
    color: THREE.Color,
    lifetime: number,
    isGlow: boolean,
  ): void {
    const mat = p.mesh.material as THREE.MeshBasicMaterial;
    mat.color.copy(color);
    mat.opacity = isGlow ? 0.55 : 1;

    p.mesh.position.copy(pos);
    p.mesh.visible = true;
    p.velocity.copy(vel);
    p.elapsed = 0;
    p.lifetime = lifetime;
    p.active = true;
    p.isGlow = isGlow;

    this._active.push(p);
  }

  private _updateParticles(deltaTime: number): void {
    const list = this._active;
    for (let i = list.length - 1; i >= 0; i--) {
      const p = list[i]!;
      p.elapsed += deltaTime;
      const progress = p.elapsed / p.lifetime;
      const alpha = (1 - progress) * (1 - progress);

      p.mesh.position.addScaledVector(p.velocity, deltaTime);
      p.velocity.y -= (p.isGlow ? 2.5 : 5) * deltaTime;

      const mat = p.mesh.material as THREE.MeshBasicMaterial;
      mat.opacity = (p.isGlow ? 0.55 : 1) * alpha;

      if (p.isGlow) {
        const s = THREE.MathUtils.lerp(p.mesh.scale.x, p.mesh.scale.x * 0.4, progress);
        p.mesh.scale.setScalar(s);
      }

      if (progress >= 1) {
        p.mesh.visible = false;
        p.active = false;
        this._free.push(p);
        list[i] = list[list.length - 1]!;
        list.pop();
      }
    }
  }
}
