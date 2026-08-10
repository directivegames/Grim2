/**
 * VomitballProjectileActor — ranged projectile fired by BigUndeadActor.
 *
 * Damages only the player. Passes through enemies. Stops on world geometry.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';

const VOMITBALL_MODEL_URL =
  '@project/assets/models/Vomitball.glb' as ENGINE.ModelPath;

/** Matches scene-placed Vomitball GLTFMeshActor scale. */
const VOMITBALL_SCALE = new THREE.Vector3(5, 5, 5);

const PROJECTILE_SPEED = 10;
const MAX_TRAVEL_DISTANCE = 15;
const MAX_LIFETIME_SEC = 3;
const HIT_RADIUS = 0.65;
const DEFAULT_DAMAGE = 15;

@ENGINE.GameClass()
export class VomitballProjectileActor extends ENGINE.Actor {
  private _visual: ENGINE.ModelMeshNode | null = null;
  private _direction = new THREE.Vector3();
  private _distanceTraveled = 0;
  private _lifetimeSec = 0;
  private _damage = DEFAULT_DAMAGE;
  private _hasHit = false;
  private _ignoredRootNodes: ENGINE.SceneNode[] = [];

  private readonly _scratchPos = new THREE.Vector3();
  private readonly _prevPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();
  private readonly _rayDir = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.SceneNode.create({ name: 'Root' });

    this._visual = ENGINE.ModelMeshNode.create({
      name: 'VomitballVisual',
      modelUrl: VOMITBALL_MODEL_URL,
      scale: VOMITBALL_SCALE.clone(),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    root.add(this._visual);

    super.initialize(options);
    this.add(root);
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    const visual = this._visual;
    if (!visual || visual.isModelLoaded()) return true;

    void visual.waitForLoad().catch(() => {
      console.warn('VomitballProjectileActor: failed to load Vomitball.glb');
      this._retire();
    });
  
    return true;
  }

  /** Hide and destroy only after GLTF load callbacks have settled. */
  private _retire(): void {
    if (!this.getWorld()) return;
    this._hasHit = true;
    this.setHiddenInGame(true);
    destroyActorWhenGltfIdle(this);
  }

  /**
   * Spawn a vomitball flying from `from` toward `target` (XZ aim).
   */
  public static spawn(
    world: ENGINE.World,
    from: THREE.Vector3,
    target: THREE.Vector3,
    damage: number = DEFAULT_DAMAGE,
    owner: ENGINE.Actor | null = null,
  ): VomitballProjectileActor {
    const projectile = VomitballProjectileActor.create();
    projectile._damage = damage;
    projectile._ignoredRootNodes = VomitballProjectileActor._buildIgnoreList(world, owner);

    projectile.position.copy(from);

    projectile._direction.copy(target);
    projectile._direction.y = projectile.position.y;
    projectile._direction.sub(projectile.position);
    projectile._direction.y = 0;
    if (projectile._direction.lengthSq() < 1e-8) {
      projectile._direction.set(0, 0, 1);
    } else {
      projectile._direction.normalize();
    }

    projectile.rotation.y = Math.atan2(
      projectile._direction.x,
      projectile._direction.z,
    );

    projectile.getWorldPosition(projectile._prevPos);

    world.add(projectile);
    return projectile;
  }

  private static _buildIgnoreList(world: ENGINE.World, owner: ENGINE.Actor | null): ENGINE.SceneNode[] {
    const ignored: ENGINE.SceneNode[] = zombieSpatialManager.getAllRegisteredZombies();
    if (owner && !ignored.includes(owner)) {
      ignored.push(owner);
    }
    const player = world.getFirstPlayerPawn();
    if (player && !ignored.includes(player)) {
      ignored.push(player);
    }
    return ignored;
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

    this.getWorldPosition(this._prevPos);

    const step = PROJECTILE_SPEED * deltaTime;
    if (this._tryHitPlayer()) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (this._tryHitWorld(step)) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    this.position.addScaledVector(this._direction, step);
    this._distanceTraveled += step;

    if (this._distanceTraveled >= MAX_TRAVEL_DISTANCE) {
      this._retire();
    }

    super.tickPrePhysics(deltaTime);
  }

  private _tryHitPlayer(): boolean {
    if (!isGameplayUnlocked()) return false;

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return false;

    this.getWorldPosition(this._scratchPos);
    player.getWorldPosition(this._playerPos);
    this._playerPos.y = this._scratchPos.y;

    if (this._scratchPos.distanceTo(this._playerPos) > HIT_RADIUS) return false;

    this._hasHit = true;

    const hitInfo: DamageHitInfo = {
      hitLocation: this._scratchPos.clone(),
      hitNormal: this._direction.clone().negate(),
    };

    const stats = player.getNode(ENGINE.CharacterStatsNode);
    if (stats) {
      stats.takeDamage(this._damage, hitInfo);
    }

    if (player instanceof IsometricPlayerPawn) {
      player.triggerScreenShake(0.08, 0.15);
    }

    this._retire();
    return true;
  }

  private _tryHitWorld(step: number): boolean {
    const world = this.getWorld();
    if (!world || step <= 0) return false;

    const physics = this.getPhysicsEngine();
    if (!physics) return false;

    this._rayDir.copy(this._direction);

    const hits = physics.performHitTest({
      origin: this._prevPos,
      direction: this._rayDir,
      maxDistance: step,
      stopOnFirstHit: true,
      ignoredRootNodes: this._ignoredRootNodes,
    });

    if (!hits || hits.length === 0) return false;

    const hit = hits[0];
    if (hit.hitRoot && this._ignoredRootNodes.includes(hit.hitRoot)) {
      return false;
    }

    this._hasHit = true;
    this._retire();
    return true;
  }

  /** Remove active vomitballs when a mission ends or resets. */
  public static destroyAllRuntime(world: ENGINE.World): void {
    const toDestroy: VomitballProjectileActor[] = [];
    for (const actor of world.getRootNodes()) {
      if (actor instanceof VomitballProjectileActor) {
        toDestroy.push(actor);
      }
    }
    for (const projectile of toDestroy) {
      projectile._retire();
    }
  }
}
