/**
 * PostmanBulletActor — demonletter projectile for Postman boss bullet-hell patterns.
 *
 * Damages only the player. No world collision (pure dodge gameplay).
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { POSTMAN_BOSS_BASE_BULLET_DAMAGE, POSTMAN_BOSS_BASE_BULLET_SPEED } from '../data/combat-balance.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';

const POSTMAN_BULLET_MODEL_URL =
  '@project/assets/models/demonletter.glb' as ENGINE.ModelPath;

const MAX_LIFETIME_SEC = 4;
const HIT_RADIUS = 0.72;

/** Flat letter mesh: pitch so it flies edge-on in the XZ plane. */
const BULLET_PITCH_X = Math.PI / 2;

/** Spawned letter size (world units). */
const DEFAULT_BULLET_SCALE = new THREE.Vector3(8, 8, 8);

@ENGINE.GameClass()
export class PostmanBulletActor extends ENGINE.Actor {
  /** World scale copied from the first editor-placed demonletter (if any). */
  private static _editorWorldScale: THREE.Vector3 | null = null;

  private _visual: ENGINE.GLTFMeshComponent | null = null;
  /** True for projectiles created by `spawn()`; false for editor reference actors. */
  private _runtimeSpawned = false;
  private _direction = new THREE.Vector3();
  private _speed = POSTMAN_BOSS_BASE_BULLET_SPEED;
  private _lifetimeSec = 0;
  private _damage = POSTMAN_BOSS_BASE_BULLET_DAMAGE;
  private _hasHit = false;
  private _teardownScheduled = false;

  private readonly _scratchPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneComponent.create();
    const scale = PostmanBulletActor._resolveScale();

    this._visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: POSTMAN_BULLET_MODEL_URL,
      scale: scale.clone(),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    root.add(this._visual);

    super.initialize({ ...options, rootComponent: root });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    if (!this._runtimeSpawned) {
      PostmanBulletActor._captureEditorTemplateScale(this);
      this.setHiddenInGame(true);
      return;
    }

    this._ensureVisible();

    const visual = this._visual;
    if (!visual || visual.isModelLoaded()) return;

    void visual.waitForLoad().then(() => {
      if (this._teardownScheduled || !this.getWorld()) return;
      this._ensureVisible();
    }).catch(() => {
      if (this._teardownScheduled || !this.getWorld()) return;
      console.warn('PostmanBulletActor: failed to load demonletter.glb');
      this._retire();
    });
  }

  /** Copy root world scale from the scene-placed PostmanBulletActor (editor: 2,2,2). */
  private static _captureEditorTemplateScale(actor: PostmanBulletActor): void {
    const rootScale = new THREE.Vector3();
    actor.rootComponent.getWorldScale(rootScale);
    if (rootScale.x > 0 && rootScale.y > 0 && rootScale.z > 0) {
      PostmanBulletActor._editorWorldScale = rootScale.clone();
    }
  }

  private static _resolveScale(): THREE.Vector3 {
    return DEFAULT_BULLET_SCALE.clone();
  }

  private _ensureVisible(): void {
    this.setHiddenInGame(false);
    this.rootComponent.traverse(obj => {
      obj.visible = true;
      obj.layers.enable(0);
    });
  }

  public override setHiddenInGame(hidden: boolean): void {
    this.rootComponent.setHiddenInGame(hidden);
    this.rootComponent.visible = !hidden;
  }

  private _scheduleDestroy(): void {
    if (this._teardownScheduled || !this.getWorld()) return;
    this._teardownScheduled = true;
    this._hasHit = true;
    this.setHiddenInGame(true);
    destroyActorWhenGltfIdle(this);
  }

  private _retire(): void {
    this._scheduleDestroy();
  }

  /** Remove active boss projectiles when a fight ends or is aborted. */
  public static destroyAllRuntime(world: ENGINE.World): void {
    const toDestroy: PostmanBulletActor[] = [];
    for (const actor of world.getActors()) {
      if (actor instanceof PostmanBulletActor && actor._runtimeSpawned) {
        toDestroy.push(actor);
      }
    }
    for (const bullet of toDestroy) {
      bullet._scheduleDestroy();
    }
  }

  /**
   * Spawn a demonletter flying along `direction` (normalized XZ).
   */
  public static spawn(
    world: ENGINE.World,
    from: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number = POSTMAN_BOSS_BASE_BULLET_SPEED,
    damage: number = POSTMAN_BOSS_BASE_BULLET_DAMAGE,
    _owner: ENGINE.Actor | null = null,
  ): PostmanBulletActor {
    void _owner;
    const projectile = PostmanBulletActor.create();
    projectile._runtimeSpawned = true;
    projectile._damage = damage;
    projectile._speed = speed;

    const scale = PostmanBulletActor._resolveScale();
    if (projectile._visual) {
      projectile._visual.scale.copy(scale);
    }

    projectile._direction.copy(direction);
    projectile._direction.y = 0;
    if (projectile._direction.lengthSq() < 1e-8) {
      projectile._direction.set(0, 0, 1);
    } else {
      projectile._direction.normalize();
    }

    projectile.rootComponent.rotation.set(
      BULLET_PITCH_X,
      Math.atan2(projectile._direction.x, projectile._direction.z),
      0,
      'YXZ',
    );

    projectile.rootComponent.position.copy(from);
    world.addActor(projectile);
    projectile._ensureVisible();

    return projectile;
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this._hasHit) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    this._lifetimeSec += deltaTime;
    if (this._lifetimeSec >= MAX_LIFETIME_SEC) {
      this._retire();
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (this._tryHitPlayer()) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    const step = this._speed * deltaTime;
    this.rootComponent.position.addScaledVector(this._direction, step);
    this.rootComponent.updateWorldMatrix(true, false);

    super.tickPrePhysics(deltaTime);
  }

  private _tryHitPlayer(): boolean {
    if (!isGameplayUnlocked()) return false;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return false;

    this.rootComponent.getWorldPosition(this._scratchPos);
    player.rootComponent.getWorldPosition(this._playerPos);
    this._playerPos.y = this._scratchPos.y;

    if (this._scratchPos.distanceTo(this._playerPos) > HIT_RADIUS) return false;

    const hitInfo: DamageHitInfo = {
      hitLocation: this._scratchPos.clone(),
      hitNormal: this._direction.clone().negate(),
    };

    const stats = player.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.takeDamage(this._damage, hitInfo);
    }

    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.08, 0.15);
    }

    this._retire();
    return true;
  }
}
