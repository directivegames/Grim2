/**
 * DemonboxActor — suicide-bomber enemy.
 *
 * Animation mapping (Demonbox.glb clips → state machine states):
 *   idle   → "Arm_Circle_Shuffle"  (standing still, no aggro)
 *   run    → "run_fast_3_inplace"  (chasing player)
 *   windup → "Clapping_Run"        (stopped at blast range, building to explosion)
 *   death  → "dying_backwards"     (killed by player before explosion)
 *
 * Behaviour:
 *   idle   — waits until player enters aggroRadius
 *   chase  — navigates toward player via NPC movement
 *   windup — stops, plays windup anim, flashes red slow→fast over windupDuration seconds,
 *            then explodes: damages player if inside blastRadius, spawns mail VFX, destroys self
 *   dead   — triggered when health reaches 0; plays death anim + ragdoll, no explosion
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { killStreakTracker } from './KillStreakTracker.js';
import { comboMeterTracker } from './ComboMeterTracker.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { KOSignUI } from '../ui/KOSignUI.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { awardSoulFromEnemyKill } from '../utils/award-soul.js';
import { tryRollMissionItemDropOnEnemyKill } from '../utils/mission-enemy-drops.js';
import { BlobShadowComponent } from '../components/vfx/BlobShadowComponent.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { DEMONBOX_BASE_BLAST_DAMAGE } from '../data/combat-balance.js';
import { ENEMY_TYPE_DEMONBOX } from '../data/items.js';
import { DemonboxMailExplosionVFXActor } from './DemonboxMailExplosionVFXActor.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEMONBOX_NPC_PROFILE = 'DemonboxNPC';

export const DEMONBOX_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Demonbox.glb` as ENGINE.ModelPath;
const DEMONBOX_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Demonbox.anim.json`;

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.75;
const BLOB_SHADOW_FEET_Y = 0.02;

/** Period of a single red flash at the START of the wind-up (seconds per half-cycle). */
const FLASH_HALF_PERIOD_START = 0.4;
/** Period at the END of the wind-up — flash is at peak frequency just before explosion. */
const FLASH_HALF_PERIOD_END = 0.05;

/** How long until ragdoll cleanup fires after death is triggered. */
const DEATH_ANIM_DURATION_SEC = 1.0;
const DEATH_SETTLE_SEC = 0.5;
const DEATH_GRAVITY = 9;

/** Throttle NPC path updates — no need to recalculate path every frame. */
const PATH_UPDATE_INTERVAL_SEC = 0.2;

const SHARED_ROOT_GEOMETRY = new THREE.CapsuleGeometry(
  CAPSULE_RADIUS,
  CAPSULE_HEIGHT - CAPSULE_RADIUS * 2,
);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

// ─── Collision profile ────────────────────────────────────────────────────────

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

function patchDemonboxNpcResponses(profile: ENGINE.CollisionProfile): void {
  const responses = (profile as unknown as { responses: MutableProfileResponses }).responses;
  const set = (channel: ENGINE.CollisionChannel, response: ENGINE.CollisionResponse): void => {
    const ch = channel as unknown as string;
    const i = responses.findIndex(r => r.channel === ch);
    if (i >= 0) responses[i] = { channel: ch, response };
    else responses.push({ channel: ch, response });
  };
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Block);
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Ignore);
  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
}

function ensureDemonboxNpcCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(DEMONBOX_NPC_PROFILE);
  if (existing) {
    patchDemonboxNpcResponses(existing);
    return;
  }
  const profile = new ENGINE.CollisionProfile(
    DEMONBOX_NPC_PROFILE,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.Pawn,
    [],
  );
  patchDemonboxNpcResponses(profile);
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

// ─── State ────────────────────────────────────────────────────────────────────

type DemonboxState = 'idle' | 'chase' | 'windup' | 'dead';

// ─── DemonboxActor ────────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class DemonboxActor extends ENGINE.Actor {

  /** Set by horde manager to count this enemy's death toward wave tracking. */
  public onDied: (() => void) | null = null;

  // ── Editor-tunable properties ────────────────────────────────────────────

  @ENGINE.property({ type: 'number', min: 1, max: 5000, step: 1, category: 'Demonbox' })
  public maxHealth: number = 80;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.1, category: 'Demonbox' })
  public moveSpeed: number = 4.5;

  @ENGINE.property({ type: 'number', min: 1, max: 100, step: 0.5, category: 'Demonbox' })
  public aggroRadius: number = 15;

  @ENGINE.property({ type: 'number', min: 0.5, max: 10, step: 0.1, category: 'Demonbox' })
  public blastStopRange: number = 4.5;

  @ENGINE.property({ type: 'number', min: 0.5, max: 15, step: 0.25, category: 'Demonbox' })
  public blastRadius: number = 3.5;

  @ENGINE.property({ type: 'number', min: 0, max: 500, step: 1, category: 'Demonbox' })
  public blastDamage: number = DEMONBOX_BASE_BLAST_DAMAGE;

  @ENGINE.property({ type: 'number', min: 1.0, max: 10.0, step: 0.25, category: 'Demonbox' })
  public windupDuration: number = 3.0;

  // ── Private state ────────────────────────────────────────────────────────

  private _state: DemonboxState = 'idle';
  private _hasAggro = false;
  private _deathSequenceStarted = false;
  private _explosionTriggered = false;

  private _windupTimer = 0;
  private _flashAccum = 0;
  private _flashOn = false;
  private _flashMatsCloned = false;

  private _isHitFlashing = false;
  private _hitFlashRemainingSec = 0;
  private _hitFlashRestoreFns: Array<() => void> = [];

  private _animationComponent: ENGINE.AnimationStateMachineComponent | null = null;
  private _blobShadow: BlobShadowComponent | null = null;

  private _animationInitialized = false;
  private _animInitTimer = 0;
  private static readonly ANIM_INIT_TIMEOUT = 5.0;

  private _animSyncTimer = 0;
  private static readonly ANIM_SYNC_INTERVAL = 0.1;

  private _pathUpdateTimer = 0;
  private _spatialUpdateTimer = 0;
  private static readonly SPATIAL_UPDATE_INTERVAL = 0.2;
  private _lastTrackedHealth = 0;

  private readonly _ragdollVelocity = new THREE.Vector3();
  private _ragdollGroundY = 0;
  private _ragdollLandPos: THREE.Vector3 | null = null;
  private _ragdollTimer = 0;

  private readonly _myPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();
  private readonly _steerGoal = new THREE.Vector3();

  private static readonly BASE_MAX_HEALTH = 80;
  private static readonly BASE_BLAST_DAMAGE = DEMONBOX_BASE_BLAST_DAMAGE;

  // ── Health-changed handler ───────────────────────────────────────────────

  private readonly _onHealthChanged = (current: number, _max: number): void => {
    if (this._deathSequenceStarted || this._explosionTriggered) return;
    if (current >= this._lastTrackedHealth || current <= 0) {
      this._lastTrackedHealth = current;
      return;
    }
    const world = this.getWorld();
    if (world) {
      const audio = getGameAudioManager(world);
      if (audio) {
        const clip = Math.random() < 0.5 ? 'zombieHit1' : 'zombieHit2';
        audio.play(clip, 1.0, true);
      }
    }
    // Only flash yellow when not in windup — windup already uses red flash
    if (this._state !== 'windup') {
      this._flashYellow();
    }
    this._lastTrackedHealth = current;
  };

  // ── initialize ───────────────────────────────────────────────────────────

  public override initialize(options?: ActorOptions): void {
    ensureDemonboxNpcCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
        collisionProfile: DEMONBOX_NPC_PROFILE,
      },
    });

    const pivot = ENGINE.SceneComponent.create({
      position: new THREE.Vector3(0, CAPSULE_HEIGHT * 0.5, 0),
    });

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: DEMONBOX_MODEL_URL,
      position: new THREE.Vector3(0, -CAPSULE_HEIGHT * 0.5, 0),
      rotation: new THREE.Euler(0, Math.PI, 0),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: DEMONBOX_ANIM_URL });
    this._animationComponent = anim;

    const stats = ENGINE.CharacterStatsComponent.create({
      maxHealth: this.maxHealth,
      healthRegen: 0,
      attackCooldown: 1,
      attackRange: this.blastStopRange,
      attackDamage: this.blastDamage,
      speed: this.moveSpeed,
    });

    const npc = ENGINE.NpcMovementComponent.create({
      pathFollowingAccuracy: 0.25,
      actorFollowingDistance: this.blastStopRange,
      stopDistance: this.blastStopRange,
      movementSpeed: this.moveSpeed,
      useNavigationServer: true,
      turnSpeed: 3.0,
      characterControllerOptions: {
        ...ENGINE.CharacterMovementComponent.DEFAULT_CHARACTER_CONTROLLER_OPTIONS,
        simulatedGravityScale: 1.0,
        applyImpulsesToDynamicBodies: false,
        slideEnabled: true,
        snapToGroundDistance: 0.3,
        autoStepConfig: {
          maxHeight: 0.5,
          minWidth: 0.12,
          includeDynamicBodies: false,
        },
      },
    });

    this._blobShadow = BlobShadowComponent.create({ radius: 0.45, opacity: 0.3 });

    pivot.add(visual);
    pivot.add(anim);
    root.add(pivot);
    root.add(this._blobShadow);

    super.initialize({ ...options, rootComponent: root, sceneComponents: [stats, npc] });
  }

  // ── doBeginPlay ──────────────────────────────────────────────────────────

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (visual) {
      visual.castShadow = false;
      visual.receiveShadow = false;
    }

    const shadow = this._blobShadow ?? this.getComponent(BlobShadowComponent);
    if (shadow) {
      this._blobShadow = shadow;
      shadow.position.set(0, BLOB_SHADOW_FEET_Y, 0);
    }

    const npc = this.getComponent(ENGINE.NpcMovementComponent) as { maxSpeed: number } | null;
    if (npc) npc.maxSpeed = this.moveSpeed;

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.setMaxHealth(this.maxHealth);
      this._lastTrackedHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
    }

    zombieSpatialManager.registerZombie(this);
  }

  // ── tick ─────────────────────────────────────────────────────────────────

  public override tickPrePhysics(deltaTime: number): void {
    if (this.isHiddenInGame()) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (!isGameplayUnlocked()) {
      this.getComponent(ENGINE.NpcMovementComponent)?.stop();
      const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
      if (anim?.isReady()) anim.setParameter('state', 'idle');
      super.tickPrePhysics(deltaTime);
      return;
    }

    this._tickAnimationInit(deltaTime);
    this._tickHitFlash(deltaTime);

    if (this._deathSequenceStarted) {
      this._tickRagdoll(deltaTime);
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (this._explosionTriggered) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    this._tickBehaviour(deltaTime);
    this._tickAnimationSync(deltaTime);
    this._tickSpatialUpdate(deltaTime);
    super.tickPrePhysics(deltaTime);
  }

  // ── Animation init + sync ────────────────────────────────────────────────

  private _tickAnimationInit(deltaTime: number): void {
    if (this._animationInitialized) return;
    this._animInitTimer += deltaTime;
    const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      // Use the current behaviour state so a fast aggro-acquire before the anim
      // system is ready doesn't result in 'idle' stomping over 'run'.
      anim.setParameter('state', this._animTargetFromState());
      this._animationInitialized = true;
    } else if (this._animInitTimer >= DemonboxActor.ANIM_INIT_TIMEOUT) {
      this._animationInitialized = true;
    }
  }

  /** Continuously re-drives the animation parameter so a missed setParameter
   *  on a state transition (e.g. anim not ready at that exact frame) is
   *  corrected within one sync interval. */
  private _tickAnimationSync(deltaTime: number): void {
    if (!this._animationInitialized) return;
    this._animSyncTimer += deltaTime;
    if (this._animSyncTimer < DemonboxActor.ANIM_SYNC_INTERVAL) return;
    this._animSyncTimer = 0;
    const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (!anim?.isReady()) return;
    anim.setParameter('state', this._animTargetFromState());
  }

  private _animTargetFromState(): string {
    switch (this._state) {
      case 'chase': return 'run';
      case 'windup': return 'windup';
      default: return 'idle';
    }
  }

  /** Keep the spatial grid cell current so the weapon can find this actor. */
  private _tickSpatialUpdate(deltaTime: number): void {
    this._spatialUpdateTimer += deltaTime;
    if (this._spatialUpdateTimer < DemonboxActor.SPATIAL_UPDATE_INTERVAL) return;
    this._spatialUpdateTimer = 0;
    zombieSpatialManager.updateZombiePosition(this);
  }

  // ── Behaviour state machine ──────────────────────────────────────────────

  private _tickBehaviour(deltaTime: number): void {
    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) return;

    this.rootComponent.getWorldPosition(this._myPos);
    player.rootComponent.getWorldPosition(this._playerPos);
    const dist = this._myPos.distanceTo(this._playerPos);

    if (!this._hasAggro && dist <= this.aggroRadius) {
      this._hasAggro = true;
    }

    switch (this._state) {
      case 'idle':
        if (this._hasAggro) this._enterChase();
        break;
      case 'chase':
        this._tickChase(dist, deltaTime);
        break;
      case 'windup':
        this._tickWindup(deltaTime, dist, world, player);
        break;
      default:
        break;
    }
  }

  private _enterChase(): void {
    this._state = 'chase';
    const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) anim.setParameter('state', 'run');
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as { enabled: boolean } | null;
    if (npc) npc.enabled = true;
  }

  private _tickChase(distToPlayer: number, deltaTime: number): void {
    if (distToPlayer <= this.blastStopRange) {
      this._enterWindup();
      return;
    }

    this._pathUpdateTimer += deltaTime;
    if (this._pathUpdateTimer < PATH_UPDATE_INTERVAL_SEC) return;
    this._pathUpdateTimer = 0;

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    if (!npc) return;
    this._steerGoal.copy(this._playerPos);
    this._steerGoal.y = this._myPos.y;
    npc.setTargetPosition(this._steerGoal, 0.15);
  }

  private _enterWindup(): void {
    this._state = 'windup';
    this._windupTimer = 0;
    this._flashAccum = 0;
    this._flashOn = false;

    this.getComponent(ENGINE.NpcMovementComponent)?.stop();

    const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) anim.setParameter('state', 'windup');
  }

  private _tickWindup(
    deltaTime: number,
    distToPlayer: number,
    world: ENGINE.World,
    player: ENGINE.Pawn,
  ): void {
    this._windupTimer += deltaTime;

    // Flash period interpolates from slow → fast as the timer progresses
    const progress = Math.min(this._windupTimer / this.windupDuration, 1.0);
    const halfPeriod =
      FLASH_HALF_PERIOD_START + (FLASH_HALF_PERIOD_END - FLASH_HALF_PERIOD_START) * progress;

    this._flashAccum += deltaTime;
    if (this._flashAccum >= halfPeriod) {
      this._flashAccum = 0;
      this._flashOn = !this._flashOn;
      this._setRedFlash(this._flashOn);
    }

    if (this._windupTimer >= this.windupDuration) {
      this._explode(distToPlayer, world, player);
    }
  }

  // ── Red flash ─────────────────────────────────────────────────────────────

  private _setRedFlash(on: boolean): void {
    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) return;

    // Clone materials once so we don't modify shared assets
    if (!this._flashMatsCloned) {
      this._flashMatsCloned = true;
      visual.traverse((child: THREE.Object3D) => {
        if (!(child instanceof THREE.Mesh)) return;
        const mesh = child as THREE.Mesh;
        if (!mesh.userData['_dbRedMat']) {
          const orig = mesh.material;
          mesh.userData['_dbRedMat'] = Array.isArray(orig)
            ? (orig as THREE.Material[]).map(m => m.clone())
            : (orig as THREE.Material).clone();
          mesh.material = mesh.userData['_dbRedMat'];
        }
      });
    }

    visual.traverse((child: THREE.Object3D) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mats: THREE.Material[] = Array.isArray(child.material)
        ? (child.material as THREE.Material[])
        : [child.material as THREE.Material];
      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          mat.emissive.setHex(on ? 0xff2200 : 0x000000);
          mat.emissiveIntensity = on ? 0.9 : 0;
        }
      }
    });
  }

  // ── Yellow hit flash ──────────────────────────────────────────────────────

  public flashYellow(): void {
    this._flashYellow();
  }

  private _flashYellow(): void {
    if (this._isHitFlashing) return;
    this._isHitFlashing = true;

    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) { this._isHitFlashing = false; return; }

    const restoreList: Array<() => void> = [];

    visual.traverse((child: THREE.Object3D) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child as THREE.Mesh;

      if (!mesh.userData['_dbHitMat']) {
        const orig = mesh.material;
        mesh.userData['_dbHitMat'] = Array.isArray(orig)
          ? (orig as THREE.Material[]).map(m => m.clone())
          : (orig as THREE.Material).clone();
        mesh.material = mesh.userData['_dbHitMat'];
      }

      const mats: THREE.Material[] = Array.isArray(mesh.material)
        ? (mesh.material as THREE.Material[])
        : [mesh.material as THREE.Material];

      for (const mat of mats) {
        if (mat instanceof THREE.MeshStandardMaterial) {
          const prevEmissive = mat.emissive.clone();
          const prevIntensity = mat.emissiveIntensity;
          mat.emissive.setHex(0xffff00);
          mat.emissiveIntensity = 0.5;
          restoreList.push(() => {
            mat.emissive.copy(prevEmissive);
            mat.emissiveIntensity = prevIntensity;
          });
        }
      }
    });

    if (restoreList.length === 0) { this._isHitFlashing = false; return; }
    this._hitFlashRestoreFns = restoreList;
    this._hitFlashRemainingSec = 0.15;
  }

  private _tickHitFlash(deltaTime: number): void {
    if (this._hitFlashRemainingSec <= 0) return;
    const world = this.getWorld();
    const realDt = world ? getUnscaledDeltaTime(world, deltaTime) : deltaTime;
    this._hitFlashRemainingSec -= realDt;
    if (this._hitFlashRemainingSec > 0) return;
    for (const fn of this._hitFlashRestoreFns) fn();
    this._hitFlashRestoreFns.length = 0;
    this._isHitFlashing = false;
  }

  // ── Explosion ─────────────────────────────────────────────────────────────

  private _explode(distToPlayer: number, world: ENGINE.World, player: ENGINE.Pawn): void {
    this._explosionTriggered = true;
    this._setRedFlash(false);

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();

    if (this._blobShadow) this._blobShadow.visible = false;

    this.rootComponent.getWorldPosition(this._myPos);

    if (distToPlayer <= this.blastRadius && isGameplayUnlocked()) {
      const stats = player.getComponent(ENGINE.CharacterStatsComponent);
      if (stats) {
        const hitInfo: DamageHitInfo = {
          hitLocation: this._myPos.clone(),
          hitNormal: new THREE.Vector3(0, 1, 0),
        };
        stats.takeDamage(this.blastDamage, hitInfo);
      }
      if (player instanceof IsometricPlayerPawn) {
        player.triggerScreenShake(0.18, 0.35);
      }
    }

    killStreakTracker.recordKill(world);
    void comboMeterTracker.recordKill(world);
    awardSoulFromEnemyKill(world);
    tryRollMissionItemDropOnEnemyKill(ENEMY_TYPE_DEMONBOX);
    KOSignUI.getInstance(world).showKO(this._myPos);

    const audio = getGameAudioManager(world);
    audio?.play('zombieDeath', 1.0, true);

    DemonboxMailExplosionVFXActor.spawnAt(world, this._myPos.clone());

    zombieSpatialManager.unregisterZombie(this);

    this.onDied?.();
    this.destroy();
  }

  // ── handleDeath (killed by player before explosion) ───────────────────────

  public override handleDeath(hitInfo?: DamageHitInfo): void {
    if (this._deathSequenceStarted) return;
    this._deathSequenceStarted = true;

    this._setRedFlash(false);
    if (this._blobShadow) this._blobShadow.visible = false;

    zombieSpatialManager.unregisterZombie(this);

    const world = this.getWorld();
    if (world) {
      killStreakTracker.recordKill(world);
      void comboMeterTracker.recordKill(world);
      awardSoulFromEnemyKill(world);
      tryRollMissionItemDropOnEnemyKill(ENEMY_TYPE_DEMONBOX);
      const player = world.getFirstPlayerPawn();
      if (player && 'triggerFOVPunch' in player) {
        (player as unknown as { triggerFOVPunch(i: number): void }).triggerFOVPunch(0.5);
      }
    }

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();
    if (npc) {
      (npc as unknown as { enabled: boolean }).enabled = false;
      (npc as unknown as { hasCharacterController: boolean }).hasCharacterController = false;
      (npc as unknown as { setVelocities(f: number, r: number, v: number): void }).setVelocities(0, 0, 0);
    }

    const root = this.rootComponent as ENGINE.MeshComponent;
    root.overridePhysicsOptions({ enabled: false });

    const deathPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(deathPos);

    if (world) {
      KOSignUI.getInstance(world).showKO(deathPos);
    }

    const launchDir = new THREE.Vector3();
    if (hitInfo?.hitNormal) {
      launchDir.copy(hitInfo.hitNormal).setY(0).normalize();
    } else if (hitInfo?.hitLocation) {
      launchDir.copy(deathPos).sub(hitInfo.hitLocation).setY(0).normalize();
    } else {
      const angle = Math.random() * Math.PI * 2;
      launchDir.set(Math.cos(angle), 0, Math.sin(angle));
    }
    if (launchDir.lengthSq() < 0.001) launchDir.set(1, 0, 0);

    this.rootComponent.rotation.y = Math.atan2(launchDir.x, launchDir.z);

    const lateralSpeed = 7 + Math.random() * 4;
    const upSpeed = (DEATH_ANIM_DURATION_SEC * DEATH_GRAVITY) / 2;
    this._ragdollLandPos = null;
    this._ragdollTimer = 0;
    this._ragdollVelocity.set(
      launchDir.x * lateralSpeed,
      upSpeed,
      launchDir.z * lateralSpeed,
    );
    this._ragdollGroundY = deathPos.y;

    const anim = this._animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) anim.setParameter('state', 'death');
  }

  // ── Ragdoll ───────────────────────────────────────────────────────────────

  private _tickRagdoll(deltaTime: number): void {
    const airDrag = Math.pow(0.7, deltaTime);

    this._ragdollVelocity.y -= DEATH_GRAVITY * deltaTime;
    this._ragdollVelocity.x *= airDrag;
    this._ragdollVelocity.z *= airDrag;
    this.rootComponent.position.addScaledVector(this._ragdollVelocity, deltaTime);

    if (this.rootComponent.position.y <= this._ragdollGroundY) {
      this.rootComponent.position.y = this._ragdollGroundY;
      if (this._ragdollLandPos === null) {
        this._ragdollLandPos = this.rootComponent.position.clone();
        this._ragdollVelocity.y = 0;
      } else if (this._ragdollVelocity.y < 0) {
        this._ragdollVelocity.y = 0;
      }
      const groundFriction = Math.pow(0.72, deltaTime * 60);
      this._ragdollVelocity.x *= groundFriction;
      this._ragdollVelocity.z *= groundFriction;
    }

    this._ragdollTimer += deltaTime;
    const cleanupSec = DEATH_ANIM_DURATION_SEC + DEATH_SETTLE_SEC;
    if (this._ragdollTimer >= cleanupSec) {
      this._ragdollTimer = -999;

      const w = this.getWorld();
      if (w) {
        const landPos = this._ragdollLandPos ?? this.rootComponent.position.clone();
        GoreExplosionActor.spawnAt(w, landPos);
        DeadGraveActor.spawnAt(w, landPos.clone().add(new THREE.Vector3(0, 0.5, 0)), new THREE.Vector3(0, 0, 0));
        getGameAudioManager(w).play('zombieDeath', 1.0, true);
      }

      this.onDied?.();
      this.destroy();
    }
  }

  // ── Horde interface ───────────────────────────────────────────────────────

  /** Called by the horde manager after reveal — skip aggro wait and start chasing. */
  public wakeForHordeSpawn(): void {
    if (this._deathSequenceStarted || this._explosionTriggered) return;
    this._hasAggro = true;
    if (this._state === 'idle') this._enterChase();
    zombieSpatialManager.unregisterZombie(this);
    zombieSpatialManager.registerZombie(this);
  }

  /** Apply mission risk multipliers from the horde manager. */
  public applyMissionRiskMultipliers(healthMult: number, damageMult: number): void {
    this.maxHealth = DemonboxActor.BASE_MAX_HEALTH * healthMult;
    this.blastDamage = Math.round(DemonboxActor.BASE_BLAST_DAMAGE * damageMult);

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (!stats || this._deathSequenceStarted) return;

    stats.setMaxHealth(this.maxHealth);
    const mutableStats = stats as unknown as {
      maxHealth: number;
      currentHealth: number;
      isDead: boolean;
      onHealthChanged: { invoke(current: number, max: number): void };
    };
    mutableStats.maxHealth = this.maxHealth;
    mutableStats.currentHealth = this.maxHealth;
    mutableStats.isDead = false;
    this._lastTrackedHealth = this.maxHealth;
    mutableStats.onHealthChanged.invoke(this.maxHealth, this.maxHealth);
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  protected override doEndPlay(): void {
    this._setRedFlash(false);
    this.getComponent(ENGINE.CharacterStatsComponent)?.onHealthChanged.remove(this._onHealthChanged);
    zombieSpatialManager.unregisterZombie(this);
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
