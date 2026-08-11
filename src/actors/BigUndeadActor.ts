/**
 * BigUndeadActor �?ranged kiting elite. Fires 3 vomitballs, retreats when rushed.
 *
 * Animation mapping (GLB clips �?state machine states):
 *   idle    �?"dying_backwards"
 *   walk    �?"Running"
 *   attack  �?"dying_backwards"
 *   hit     �?"Charged_Spell_Cast"
 *   death   �?"Walking"
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import type { PrimitiveNodeOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { killStreakTracker } from './KillStreakTracker.js';
import { comboMeterTracker } from './ComboMeterTracker.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { KOSignUI } from '../ui/KOSignUI.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { awardSoulFromEnemyKill } from '../utils/award-soul.js';
import { tryRollMissionItemDropOnEnemyKill } from '../utils/mission-enemy-drops.js';

const ENEMY_TYPE_BIG_UNDEAD = 'big_undead';
import { BlobShadowComponent } from '../components/vfx/BlobShadowComponent.js';
import { VomitballProjectileActor } from './VomitballProjectileActor.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { BIG_UNDEAD_BASE_PROJECTILE_DAMAGE } from '../data/combat-balance.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { RootDeathCharacterStats } from '../components/RootDeathCharacterStats.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const BIG_UNDEAD_NPC_PROFILE = 'BigUndeadNPC';

export const BIG_UNDEAD_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Bigundead/Meshy_AI_Oozebound_Office_Zomb_biped/Meshy_AI_Oozebound_Office_Zomb_biped_Character_output.glb` as ENGINE.ModelPath;
const BIG_UNDEAD_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Bigundead/Meshy_AI_Oozebound_Office_Zomb_biped/BigUndead.animconfig.json`;

const CAPSULE_RADIUS = 0.55;
const CAPSULE_HEIGHT = 2.2;
const BLOB_SHADOW_FEET_Y = 0.02;

const HIT_REACTION_HOLD_SEC = 0.95;
const STEER_LOOKAHEAD = 4.0;
const STEER_GOAL_STOP = 0.15;

const BALLS_PER_BURST = 3;
const BALL_INTERVAL_SEC = 0.25;
const POST_BURST_COOLDOWN_SEC = 2.0;
const RETREAT_MIN_DIST = 5.5;
const RETREAT_SAFE_DIST = 7.0;

const DEATH_ANIM_DURATION_SEC = 1.0;
const DEATH_SETTLE_SEC = 0.5;
const DEATH_GRAVITY = 9;

const SHARED_ROOT_GEOMETRY = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

type KiteState = 'wander' | 'approach' | 'fire' | 'retreat' | 'cooldown';

function patchBigUndeadNpcResponses(profile: ENGINE.CollisionProfile): void {
  const responses = (profile as unknown as { responses: MutableProfileResponses }).responses;
  const set = (channel: ENGINE.CollisionChannel, response: ENGINE.CollisionResponse): void => {
    const ch = channel as unknown as string;
    const i = responses.findIndex(r => r.channel === ch);
    if (i >= 0) responses[i] = { channel: ch, response };
    else responses.push({ channel: ch, response });
  };
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Block);
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Block);
  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
}

function ensureBigUndeadNpcCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(BIG_UNDEAD_NPC_PROFILE);
  if (existing) {
    patchBigUndeadNpcResponses(existing);
    return;
  }
  const profile = new ENGINE.CollisionProfile(
    BIG_UNDEAD_NPC_PROFILE,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.Pawn,
    [],
  );
  patchBigUndeadNpcResponses(profile);
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

@ENGINE.GameClass()
export class BigUndeadActor extends GameRootNode {

  /** Horde manager sets this for pooled horde spawns. */
  public onDied: (() => void) | null = null;

  @ENGINE.property({ type: 'number', min: 1, max: 10000, step: 1, category: 'Big Undead' })
  public maxHealth: number = 150;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.1, category: 'Big Undead' })
  public moveSpeed: number = 2.2;

  @ENGINE.property({ type: 'number', min: 1, max: 100, step: 0.5, category: 'Big Undead' })
  public aggroRadius: number = 18;

  @ENGINE.property({ type: 'number', min: 2, max: 20, step: 0.5, category: 'Big Undead' })
  public fireRange: number = 8;

  @ENGINE.property({ type: 'number', min: 0, max: 500, step: 1, category: 'Big Undead' })
  public projectileDamage: number = 15;

  @ENGINE.property({ type: 'number', min: 2, max: 50, step: 0.5, category: 'Big Undead' })
  public wanderRadius: number = 10;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.5, category: 'Big Undead' })
  public wanderWaitMin: number = 4;

  @ENGINE.property({ type: 'number', min: 0.5, max: 30, step: 0.5, category: 'Big Undead' })
  public wanderWaitMax: number = 10;

  private blackboard: ENGINE.Blackboard | null = null;
  private wanderRoot: ENGINE.WanderAction | null = null;
  private animationComponent: ENGINE.AnimationStateMachineNode | null = null;
  private _blobShadow: BlobShadowComponent | null = null;
  private _ragdollPivot: ENGINE.SceneNode | null = null;

  private _kiteState: KiteState = 'wander';
  private _hasAggro = false;
  private _deathSequenceStarted = false;
  private _hitAnimEndTime = -Infinity;
  private _lastTrackedHealth = 0;
  private _animationInitialized = false;
  private _animInitTimer = 0;
  private static readonly ANIM_INIT_TIMEOUT = 5.0;

  private _shotsFired = 0;
  private _fireShotTimer = 0;
  private _postBurstTimer = 0;

  private _btTimer = 0;
  private static readonly BT_UPDATE_INTERVAL = 0.2;
  private _spatialUpdateTimer = 0;
  private static readonly SPATIAL_UPDATE_INTERVAL = 0.05;

  private readonly _myPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();
  private readonly _steerGoal = new THREE.Vector3();
  private readonly _flatDir = new THREE.Vector3();
  private readonly _muzzlePos = new THREE.Vector3();

  private readonly _ragdollVelocity = new THREE.Vector3();
  private _ragdollGroundY = 0;
  private _ragdollLandPos: THREE.Vector3 | null = null;
  private _ragdollTimer = 0;

  private _isFlashing = false;
  private _flashRemainingSec = 0;
  private _flashRestoreFns: Array<() => void> = [];

  private readonly _onHealthChanged = (current: number, _max: number): void => {
    if (this._deathSequenceStarted || current >= this._lastTrackedHealth || current <= 0) {
      this._lastTrackedHealth = current;
      return;
    }
    const w = this.getWorld();
    if (w) {
      this._hitAnimEndTime = w.getGameTime() + HIT_REACTION_HOLD_SEC;
      const audioManager = getGameAudioManager(w);
      if (audioManager) {
        const hitSound = Math.random() < 0.5 ? 'zombieHit1' : 'zombieHit2';
        audioManager.play(hitSound, 1.0, true);
      }
    }
    const anim = this.animationComponent ?? this.getNode(ENGINE.AnimationStateMachineNode);
    if (anim?.isReady()) {
      anim.setParameter('state', 'hit');
    }
    this.getNode(ENGINE.NpcMovementNode)?.stop();
    if (this._kiteState === 'fire') {
      this._kiteState = 'cooldown';
      this._shotsFired = BALLS_PER_BURST;
      this._postBurstTimer = 0;
    }
    this._lastTrackedHealth = current;
  };

  public override initialize(options?: PrimitiveNodeOptions): void {
    ensureBigUndeadNpcCollisionProfile();

    const root = ENGINE.MeshNode.create({
      name: 'CapsuleRoot',
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
        collisionProfile: BIG_UNDEAD_NPC_PROFILE,
      },
    });

    const pivot = ENGINE.SceneNode.create({
      name: 'Pivot',
      position: new THREE.Vector3(0, CAPSULE_HEIGHT * 0.5, 0),
    });
    this._ragdollPivot = pivot;

    const visual = ENGINE.ModelMeshNode.create({
      name: 'Visual',
      modelUrl: BIG_UNDEAD_MODEL_URL,
      position: new THREE.Vector3(0, -CAPSULE_HEIGHT * 0.5, 0),
      rotation: new THREE.Euler(0, Math.PI, 0),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    const anim = ENGINE.AnimationStateMachineNode.create({ name: 'Animation', configUrl: BIG_UNDEAD_ANIM_URL });
    this.animationComponent = anim;

    const stats = RootDeathCharacterStats.create({
      name: 'Stats',
      maxHealth: this.maxHealth,
      healthRegen: 0,
      attackCooldown: 1,
      attackRange: this.fireRange,
      attackDamage: this.projectileDamage,
      speed: this.moveSpeed,
    });

    const npc = ENGINE.NpcMovementNode.create({
      name: 'NpcMovement',
      pathFollowingAccuracy: 0.3,
      actorFollowingDistance: 1.0,
      stopDistance: 1.0,
      movementSpeed: this.moveSpeed,
      useNavigationServer: true,
      turnSpeed: 2.0,
      characterControllerOptions: {
        ...ENGINE.CharacterMovementNode.DEFAULT_CHARACTER_CONTROLLER_OPTIONS,
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

    this._blobShadow = BlobShadowComponent.create({ name: 'BlobShadow', radius: 0.65, opacity: 0.35 });

    pivot.add(visual);
    pivot.add(anim);
    root.add(pivot);
    root.add(this._blobShadow);

    super.initialize(options);
    this.add(root);
    root.add(...[stats, npc]);
  }

    public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }const visual = this.getNode(ENGINE.ModelMeshNode);
    if (visual) {
      visual.castShadow = false;
      visual.receiveShadow = false;
    }

    this._ensureBlobShadowAtFeet();

    const npc = this.getNode(ENGINE.NpcMovementNode) as { maxSpeed: number } | null;
    if (npc) {
      npc.maxSpeed = this.moveSpeed;
    }

    const stats = this.getNode(ENGINE.CharacterStatsNode);
    if (stats) {
      stats.setMaxHealth(this.maxHealth);
      this._lastTrackedHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
    }

    this.blackboard = new ENGINE.Blackboard(this);
    this.wanderRoot = new ENGINE.WanderAction({
      wanderRadius: this.wanderRadius,
      minWaitTime: this.wanderWaitMin,
      maxWaitTime: this.wanderWaitMax,
    });
    this.wanderRoot.initialize(this.blackboard);

    zombieSpatialManager.registerZombie(this);
  
    return true;
  }

  /** Horde spawn / relocate �?immediately chase instead of waiting for aggro radius. */
  public wakeForHordeSpawn(): void {
    if (this._deathSequenceStarted) {
      return;
    }
    this._hasAggro = true;
    this._kiteState = 'approach';
    this._shotsFired = 0;
    this._fireShotTimer = 0;
    this._postBurstTimer = 0;
    this.wanderRoot?.reset();
    const npc = this.getNode(ENGINE.NpcMovementNode) as { enabled?: boolean } | null;
    if (npc) {
      npc.enabled = true;
    }
    zombieSpatialManager.unregisterZombie(this);
    zombieSpatialManager.registerZombie(this);
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this.isHiddenInGame()) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (!isGameplayUnlocked()) {
      this.getNode(ENGINE.NpcMovementNode)?.stop();
      const anim = this.getNode(ENGINE.AnimationStateMachineNode);
      if (anim?.isReady()) anim.setParameter('state', 'idle');
      return;
    }

    if (this._deathSequenceStarted) {
      this._tickRagdoll(deltaTime);
      super.tickPrePhysics(deltaTime);
      return;
    }

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!world || !player) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    this.getWorldPosition(this._myPos);
    player.getWorldPosition(this._playerPos);
    const dist = this._myPos.distanceTo(this._playerPos);

    this._spatialUpdateTimer += deltaTime;
    if (this._spatialUpdateTimer >= BigUndeadActor.SPATIAL_UPDATE_INTERVAL) {
      this._spatialUpdateTimer = 0;
      zombieSpatialManager.updateZombiePosition(this);
    }

    this._tickFlash(deltaTime);
    this._tickAnimationInit(deltaTime);

    const inHitReaction = world !== null && world.getGameTime() < this._hitAnimEndTime;

    if (!this._hasAggro && dist <= this.aggroRadius) {
      this._hasAggro = true;
      this._kiteState = 'approach';
      this.wanderRoot?.reset();
    }

    if (!inHitReaction) {
      this._updateKiteState(dist);
      this._applyKiteMovement(dist);
      this._tickFireBurst(world, player, deltaTime, dist);
    } else {
      this.getNode(ENGINE.NpcMovementNode)?.stop();
    }

    if (this._kiteState === 'wander' && this.blackboard && this.wanderRoot) {
      this._btTimer += deltaTime;
      if (this._btTimer >= BigUndeadActor.BT_UPDATE_INTERVAL) {
        this._btTimer = 0;
        this.blackboard.updateGameState();
        void this.wanderRoot.execute(this.blackboard, deltaTime);
      }
    }

    this._syncAnimation(dist, inHitReaction);
    super.tickPrePhysics(deltaTime);
  }

  private _updateKiteState(dist: number): void {
    if (!this._hasAggro) {
      this._kiteState = 'wander';
      return;
    }

    switch (this._kiteState) {
      case 'wander':
        this._kiteState = 'approach';
        break;
      case 'approach':
        if (dist < RETREAT_MIN_DIST) {
          this._kiteState = 'retreat';
        } else if (dist <= this.fireRange) {
          this._enterFireState();
        }
        break;
      case 'retreat':
        if (dist >= RETREAT_SAFE_DIST) {
          this._kiteState = 'approach';
        }
        break;
      case 'fire':
      case 'cooldown':
        break;
      default:
        break;
    }
  }

  private _stopNpcMovement(): void {
    const npc = this.getNode(ENGINE.NpcMovementNode) as {
      stop: () => void;
      useNavigationServer: boolean;
    } | null;
    if (!npc) return;
    npc.stop();
    npc.useNavigationServer = false;
  }

  private _enterFireState(): void {
    this._kiteState = 'fire';
    this._shotsFired = 0;
    this._fireShotTimer = 0;
    this._stopNpcMovement();
    const anim = this.animationComponent ?? this.getNode(ENGINE.AnimationStateMachineNode);
    if (anim?.isReady()) {
      anim.setParameter('state', 'attack');
    }
  }

  private _tickFireBurst(
    world: ENGINE.World,
    player: ENGINE.Pawn,
    deltaTime: number,
    dist: number,
  ): void {
    if (this._kiteState === 'cooldown') {
      this._postBurstTimer += deltaTime;
      if (this._postBurstTimer >= POST_BURST_COOLDOWN_SEC) {
        this._postBurstTimer = 0;
        if (dist < RETREAT_MIN_DIST) {
          this._kiteState = 'retreat';
        } else if (dist <= this.fireRange) {
          this._enterFireState();
        } else {
          this._kiteState = 'approach';
        }
      }
      return;
    }

    if (this._kiteState !== 'fire') return;

    this._facePlayer(player);
    this._fireShotTimer -= deltaTime;

    if (this._shotsFired < BALLS_PER_BURST && this._fireShotTimer <= 0) {
      this._fireShot(world, player);
      this._shotsFired++;
      this._fireShotTimer = BALL_INTERVAL_SEC;
    }

    if (this._shotsFired >= BALLS_PER_BURST) {
      this._kiteState = 'cooldown';
      this._postBurstTimer = 0;
      this._stopNpcMovement();
    }
  }

  private _fireShot(world: ENGINE.World, player: ENGINE.Pawn): void {
    this._facePlayer(player);
    player.getWorldPosition(this._playerPos);

    const muzzleYaw = this.rotation.y;
    this.getWorldPosition(this._muzzlePos);
    this._muzzlePos.y += 1.1;
    this._muzzlePos.x += Math.sin(muzzleYaw) * 0.4;
    this._muzzlePos.z += Math.cos(muzzleYaw) * 0.4;

    VomitballProjectileActor.spawn(
      world,
      this._muzzlePos,
      this._playerPos,
      this.projectileDamage,
      this,
    );
  }

  private _facePlayer(player: ENGINE.Pawn): void {
    this.getWorldPosition(this._myPos);
    player.getWorldPosition(this._playerPos);
    this._flatDir.copy(this._playerPos).sub(this._myPos);
    this._flatDir.y = 0;
    if (this._flatDir.lengthSq() < 1e-8) return;

    const yaw = Math.atan2(this._flatDir.x, this._flatDir.z);
    // NPC rotates root during movement; visual GLTF child has Math.PI baked in.
    this.rotation.y = yaw + Math.PI;
    if (this._ragdollPivot) {
      this._ragdollPivot.rotation.y = 0;
    }
  }

  private _applyKiteMovement(dist: number): void {
    const npc = this.getNode(ENGINE.NpcMovementNode) as {
      useNavigationServer: boolean;
      setTargetPosition: (p: THREE.Vector3, stop?: number) => void;
      stop: () => void;
    } | null;
    if (!npc) return;

    if (!this._hasAggro || this._kiteState === 'fire' || this._kiteState === 'cooldown') {
      if (this._hasAggro) {
        this._stopNpcMovement();
      }
      return;
    }

    const world = this.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!player) return;

    // Direct steer (no nav mesh path) so root yaw matches movement like NewZombieActor.
    npc.useNavigationServer = false;
    if (this._ragdollPivot) {
      this._ragdollPivot.rotation.y = 0;
    }

    this.getWorldPosition(this._myPos);
    player.getWorldPosition(this._playerPos);

    if (this._kiteState === 'retreat' || dist < RETREAT_MIN_DIST) {
      this._flatDir.copy(this._myPos).sub(this._playerPos);
      this._flatDir.y = 0;
      if (this._flatDir.lengthSq() < 1e-8) {
        this._flatDir.set(1, 0, 0);
      } else {
        this._flatDir.normalize();
      }
      this._steerGoal.copy(this._myPos).addScaledVector(this._flatDir, STEER_LOOKAHEAD);
      npc.setTargetPosition(this._steerGoal, STEER_GOAL_STOP);
      return;
    }

    if (this._kiteState === 'approach') {
      if (dist <= this.fireRange) {
        this._stopNpcMovement();
        return;
      }

      this._flatDir.copy(this._playerPos).sub(this._myPos);
      this._flatDir.y = 0;
      if (this._flatDir.lengthSq() < 1e-8) {
        this._flatDir.set(0, 0, 1);
      } else {
        this._flatDir.normalize();
      }
      this._steerGoal.copy(this._myPos).addScaledVector(this._flatDir, STEER_LOOKAHEAD);
      npc.setTargetPosition(this._steerGoal, STEER_GOAL_STOP);
      return;
    }

    this._stopNpcMovement();
  }

  private _syncAnimation(_dist: number, inHitReaction: boolean): void {
    const anim = this.animationComponent ?? this.getNode(ENGINE.AnimationStateMachineNode);
    if (!anim?.isReady()) return;
    if (this._deathSequenceStarted) return;

    if (inHitReaction) {
      anim.setParameter('state', 'hit');
      return;
    }

    switch (this._kiteState) {
      case 'wander':
        anim.setParameter('state', 'idle');
        break;
      case 'approach':
      case 'retreat':
        anim.setParameter('state', 'walk');
        break;
      case 'fire':
        anim.setParameter('state', 'attack');
        break;
      case 'cooldown':
        anim.setParameter('state', 'idle');
        break;
      default:
        break;
    }
  }

  private _tickAnimationInit(deltaTime: number): void {
    if (this._animationInitialized) return;
    this._animInitTimer += deltaTime;
    const anim = this.animationComponent ?? this.getNode(ENGINE.AnimationStateMachineNode);
    if (anim?.isReady()) {
      anim.setParameter('state', 'idle');
      this._animationInitialized = true;
    } else if (this._animInitTimer >= BigUndeadActor.ANIM_INIT_TIMEOUT) {
      this._animationInitialized = true;
    }
  }

  public handleDeath(hitInfo?: DamageHitInfo): void {
    if (this._deathSequenceStarted) return;
    this._deathSequenceStarted = true;

    this._hideBlobShadow();
    zombieSpatialManager.unregisterZombie(this);

    const world = this.getWorld();
    if (world) {
      killStreakTracker.recordKill(world);
      void comboMeterTracker.recordKill(world);
      awardSoulFromEnemyKill(world);
      tryRollMissionItemDropOnEnemyKill(ENEMY_TYPE_BIG_UNDEAD);
      const player = world.getFirstPlayerPawn();
      if (player && 'triggerFOVPunch' in player) {
        (player as unknown as { triggerFOVPunch(intensity: number): void }).triggerFOVPunch(0.5);
      }
    }

    const npc = this.getNode(ENGINE.NpcMovementNode);
    npc?.stop();
    if (npc) {
      (npc as unknown as { enabled: boolean }).enabled = false;
    }

    const deathPos = new THREE.Vector3();
    this.getWorldPosition(deathPos);

    if (world) {
      KOSignUI.getInstance(world).showKO(deathPos);
    }

    this.overridePhysicsOptions({ enabled: false });

    if (npc) {
      (npc as unknown as { hasCharacterController: boolean }).hasCharacterController = false;
      (npc as unknown as { setVelocities(f: number, r: number, v: number): void }).setVelocities(0, 0, 0);
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

    this.rotation.y = Math.atan2(launchDir.x, launchDir.z);

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

    const anim = this.animationComponent ?? this.getNode(ENGINE.AnimationStateMachineNode);
    if (anim?.isReady()) {
      anim.setParameter('state', 'death');
    }
  }

  private _tickRagdoll(deltaTime: number): void {
    const airDrag = Math.pow(0.7, deltaTime);

    this._ragdollVelocity.y -= DEATH_GRAVITY * deltaTime;
    this._ragdollVelocity.x *= airDrag;
    this._ragdollVelocity.z *= airDrag;
    this.position.addScaledVector(this._ragdollVelocity, deltaTime);

    if (this.position.y <= this._ragdollGroundY) {
      this.position.y = this._ragdollGroundY;
      if (this._ragdollLandPos === null) {
        this._ragdollLandPos = this.position.clone();
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
        GoreExplosionActor.spawnAt(w, this._ragdollLandPos ?? this.position);
        getGameAudioManager(w).play('zombieDeath', 1.0, true);
      }
      this._spawnDeathObjects(this._ragdollLandPos ?? this.position.clone());
      this.onDied?.();
      this.destroy();
    }
  }

  private _spawnDeathObjects(deathPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    const landPos = this._ragdollLandPos ?? deathPos;
    const gravePos = landPos.clone();
    DeadGraveActor.spawnAt(world, gravePos, new THREE.Vector3(0, 0, 0));

    const smokeActor = ENGINE.PrimitiveNode.create({ isRoot: true });
    smokeActor.position.copy(landPos);
    smokeActor.position.y += 0.1;
    const smokeVfx = ENGINE.VFXNode.create({
      vfxPath: '@project/assets/VFX/smoke.vfx.json',
      autoStart: true,
    });
    smokeActor.add(smokeVfx);
    world.add(smokeActor);

    setTimeout(() => {
      smokeActor.destroy();
    }, 3000);
  }

  private _ensureBlobShadowAtFeet(): void {
    const shadow = this._blobShadow ?? this.getNode(BlobShadowComponent);
    if (!shadow) return;
    this._blobShadow = shadow;

    const pivot = this._ragdollPivot;
    if (pivot && shadow.parent === pivot) {
      pivot.remove(shadow);
      this.add(shadow);
    }
    shadow.position.set(0, BLOB_SHADOW_FEET_Y, 0);
    shadow.visible = !this._deathSequenceStarted;
  }

  private _hideBlobShadow(): void {
    const shadow = this._blobShadow ?? this.getNode(BlobShadowComponent);
    if (!shadow) return;
    this._blobShadow = shadow;
    shadow.visible = false;
  }

  private static readonly BASE_MAX_HEALTH = 150;

  /** Apply mission risk multipliers (health + vomitball damage). */
  public applyMissionRiskMultipliers(healthMult: number, damageMult: number): void {
    this.maxHealth = BigUndeadActor.BASE_MAX_HEALTH * healthMult;
    this.projectileDamage = Math.round(BIG_UNDEAD_BASE_PROJECTILE_DAMAGE * damageMult);

    const stats = this.getNode(ENGINE.CharacterStatsNode);
    if (!stats || this._deathSequenceStarted) {
      return;
    }

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

  private _tickFlash(deltaTime: number): void {
    if (this._flashRemainingSec <= 0) return;
    const world = this.getWorld();
    const realDt = world ? getUnscaledDeltaTime(world, deltaTime) : deltaTime;
    this._flashRemainingSec -= realDt;
    if (this._flashRemainingSec > 0) return;
    for (const restore of this._flashRestoreFns) {
      restore();
    }
    this._flashRestoreFns.length = 0;
    this._isFlashing = false;
  }

  public flashYellow(): void {
    if (this._isFlashing) return;
    this._isFlashing = true;

    const visual = this.getNode(ENGINE.ModelMeshNode);
    if (!visual) {
      this._isFlashing = false;
      return;
    }

    const restoreList: Array<() => void> = [];

    visual.traverse((child: THREE.Object3D) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child;
      if (!mesh.userData._flashMat) {
        const orig = mesh.material;
        if (Array.isArray(orig)) {
          mesh.userData._flashMat = orig.map((m: THREE.Material) => m.clone());
        } else {
          mesh.userData._flashMat = (orig as THREE.Material).clone();
        }
      }
      mesh.material = mesh.userData._flashMat;

      const applyToMat = (mat: THREE.Material): (() => void) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          const prevEmissive = mat.emissive.clone();
          const prevIntensity = mat.emissiveIntensity;
          mat.emissive.setHex(0xffff00);
          mat.emissiveIntensity = 0.5;
          return () => {
            mat.emissive.copy(prevEmissive);
            mat.emissiveIntensity = prevIntensity;
          };
        }
        if ('color' in mat) {
          const colored = mat as THREE.MeshBasicMaterial;
          const prevColor = colored.color.clone();
          colored.color.lerp(new THREE.Color(0xffff00), 0.4);
          return () => { colored.color.copy(prevColor); };
        }
        return () => { /* noop */ };
      };

      if (Array.isArray(mesh.material)) {
        const fns = (mesh.material as THREE.Material[]).map(applyToMat);
        restoreList.push(() => fns.forEach(fn => fn()));
      } else {
        restoreList.push(applyToMat(mesh.material as THREE.Material));
      }
    });

    if (restoreList.length === 0) {
      this._isFlashing = false;
      return;
    }
    this._flashRestoreFns = restoreList;
    this._flashRemainingSec = 0.15;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    this.getNode(ENGINE.CharacterStatsNode)?.onHealthChanged.remove(this._onHealthChanged);
    zombieSpatialManager.unregisterZombie(this);
    this.wanderRoot?.destroy();
    this.wanderRoot = null;
    this.blackboard?.clear();
    this.blackboard = null;
    return true;
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
