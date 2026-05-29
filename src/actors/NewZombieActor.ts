/**
 * NewZombieActor — identical behaviour to ZombieActor, uses the new stylised zombie model.
 *
 * Animation mapping (new model clips → state machine states):
 *   idle    → "Gunshot_Reaction"         (standing still, no aggro)
 *   walk    → "Limping_Walk_3_inplace"   (chasing player)
 *   attack  → "run_fast_6_inplace"       (melee range)
 *   hit     → "NewZombie_Hit"            (taking damage, looped while held)
 *   death   → "run_fast_10_inplace"      (on death, 2.0s then park for reset)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import {
  ZOMBIE_STEER_GOAL_STOP,
  ZOMBIE_STEER_SEPARATION_RADIUS,
  ZOMBIE_STEER_SEPARATION_WEIGHT,
  computeZombieSteerGoal,
  createZombieSteerScratch,
  ensureSteerGoalMinDistance,
  tangentialSignFromSeed,
} from './zombie-steering.js';
import { killStreakTracker } from './KillStreakTracker.js';
import { comboMeterTracker } from './ComboMeterTracker.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { GoreExplosionActor } from './GoreExplosionActor.js';
import { KOSignUI } from '../ui/KOSignUI.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { ENEMY_TYPE_ZOMBIE } from '../data/items.js';
import { awardSoulFromEnemyKill } from '../utils/award-soul.js';
import { tryRollMissionItemDropOnEnemyKill } from '../utils/mission-enemy-drops.js';
import { BlobShadowComponent } from '../components/vfx/BlobShadowComponent.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { ZOMBIE_BASE_ATTACK_DAMAGE } from '../data/combat-balance.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { getCachedPlayerPawn, getCachedWorldFrame } from '../utils/world-tick-cache.js';
import { trackDeathSmokeActor } from '../utils/runtime-vfx-cleanup.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const NEW_ZOMBIE_NPC_PROFILE = 'NewZombieNPC';

/** Shared with ZombieHordeManager for GLB preload at horde start. */
export const NEW_ZOMBIE_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/new zombie/Meshy_AI_Stylized_undead_subur_biped/Newzombie2.glb` as ENGINE.ModelPath;
const NEW_ZOMBIE_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/new zombie/Meshy_AI_Stylized_undead_subur_biped/Zombienewanimations.anim.json`;
const NEW_ZOMBIE_MATERIAL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/textures/Zombie2.material.json` as ENGINE.MaterialPath;

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.75;

/** Root Y offset so capsule feet sit on the nav floor (root is capsule center). */
export const NEW_ZOMBIE_CAPSULE_HALF_HEIGHT = CAPSULE_HEIGHT * 0.5;
/** Blob shadow sits on the actor root at foot height (not on the body-center pivot). */
const BLOB_SHADOW_FEET_Y = 0.02;
const NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE = 0.82;

const ATTACK_ZONE_HYSTERESIS_MARGIN = 0.38;
const HIT_REACTION_HOLD_SEC = 0.95;
const SPEED_JITTER_RANGE = 0.8;

const NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY = 0.25;

const SHARED_ROOT_GEOMETRY = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

// ─── Collision profile ────────────────────────────────────────────────────────

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

function patchNewZombieNpcResponses(profile: ENGINE.CollisionProfile): void {
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

function ensureNewZombieNpcCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(NEW_ZOMBIE_NPC_PROFILE);
  if (existing) {
    patchNewZombieNpcResponses(existing);
    return;
  }
  const profile = new ENGINE.CollisionProfile(
    NEW_ZOMBIE_NPC_PROFILE,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.Pawn,
    []
  );
  patchNewZombieNpcResponses(profile);
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

// ─── Sticky-chase condition ───────────────────────────────────────────────────

class NewZombieStickyChaseCondition extends ENGINE.ConditionEvaluator {
  constructor(private readonly initialRange: number) {
    super({ name: 'NewZombieStickyChase' });
  }

  protected override async onEvaluate(blackboard: ENGINE.Blackboard): Promise<ENGINE.BehaviorStatus> {
    if (blackboard.getValue<boolean>('HasAggro')) {
      return ENGINE.BehaviorStatus.Success;
    }
    const dist = blackboard.getValue<number>('DistanceToPlayer');
    return dist !== undefined && dist <= this.initialRange
      ? ENGINE.BehaviorStatus.Success
      : ENGINE.BehaviorStatus.Failure;
  }
}

class NewZombieSteerChaseNoopAction extends ENGINE.BehaviorAction {
  constructor() {
    super({ name: 'NewZombieSteerChase' });
  }

  protected override onInitialize(_blackboard: ENGINE.Blackboard): void {}

  protected override onEnter(blackboard: ENGINE.Blackboard): void {
    this.getOwner(blackboard)?.getComponent(ENGINE.NpcMovementComponent)?.stop();
  }

  protected override async onUpdate(
    _blackboard: ENGINE.Blackboard,
    _deltaTime: number,
  ): Promise<ENGINE.BehaviorStatus> {
    return ENGINE.BehaviorStatus.Running;
  }
}

// ─── NewZombieActor ───────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class NewZombieActor extends ENGINE.Actor {

  // ── Editor-tunable properties ──────────────────────────────────────────────

  @ENGINE.property({ type: 'number', min: 1, max: 5000, step: 1, category: 'Zombie' })
  public maxHealth: number = 100;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.1, category: 'Zombie' })
  public moveSpeed: number = 3.5;

  @ENGINE.property({ type: 'number', min: 1, max: 100, step: 0.5, category: 'Zombie' })
  public aggroRadius: number = 15;

  @ENGINE.property({ type: 'number', min: 0.35, max: 5, step: 0.05, category: 'Zombie' })
  public attackRange: number = 1.05;

  @ENGINE.property({ type: 'number', min: 0, max: 500, step: 1, category: 'Zombie' })
  public attackDamage: number = 10;

  @ENGINE.property({ type: 'number', min: 0.1, max: 10, step: 0.05, category: 'Zombie' })
  public attackCooldown: number = 0.65;

  @ENGINE.property({ type: 'number', min: 0, max: 10, step: 0.1, category: 'Zombie' })
  public deathLaunchForce: number = 3;

  @ENGINE.property({ type: 'number', min: 2, max: 50, step: 0.5, category: 'Zombie' })
  public wanderRadius: number = 12;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.5, category: 'Zombie' })
  public wanderWaitMin: number = 4;

  @ENGINE.property({ type: 'number', min: 0.5, max: 30, step: 0.5, category: 'Zombie' })
  public wanderWaitMax: number = 10;

  // ── Private state ──────────────────────────────────────────────────────────

  private blackboard: ENGINE.Blackboard | null = null;
  private behaviorRoot: ENGINE.SelectorNode | null = null;
  private animationComponent: ENGINE.AnimationStateMachineComponent | null = null;

  private _hasAggro = false;
  private _deathSequenceStarted = false;
  private _btBusy = false;
  private _btBranch: 'wander' | 'chase' | 'attack' = 'wander';
  private _attackZoneLatched = false;
  private _hitAnimEndTime = -Infinity;
  private _wasInHitReaction = false;
  private _lastTrackedHealth = 0;
  private _navRestoreRemainingSec = 0;
  private _navRestoreSetting = true;

  private _jitteredSpeed = 3.5;
  private readonly _steerMyPos = new THREE.Vector3();
  private readonly _steerToPlayer = new THREE.Vector3();
  private readonly _steerSep = new THREE.Vector3();
  private readonly _steerOtherPos = new THREE.Vector3();
  private readonly _steerGoal = new THREE.Vector3();
  private readonly _steerScratch = createZombieSteerScratch();
  private _tangentialSign = 1;
  private _visibilityReassertTicks = 0;
  private _distanceToPlayerLinear = Infinity;
  private _npcComponent: {
    useNavigationServer: boolean;
    enabled: boolean;
    hasCharacterController: boolean;
    maxSpeed: number;
    setTargetPosition: (p: THREE.Vector3, stop?: number) => void;
    stop: () => void;
  } | null = null;

  /** Scratch vectors — reused each tick to avoid per-frame GC. */
  private readonly _lodMyPos      = new THREE.Vector3();
  private readonly _lodPlayerPos  = new THREE.Vector3();
  private readonly _animCurrentPos  = new THREE.Vector3();
  private readonly _stuckCurrentPos = new THREE.Vector3();

  private readonly _deathScratch = {
    launch: new THREE.Vector3(),
    ownerPos: new THREE.Vector3(),
    playerPos: new THREE.Vector3(),
    flat: new THREE.Vector3(),
  };

  private readonly _ragdollVelocity = new THREE.Vector3();
  private _ragdollGroundY = 0;
  private _ragdollLandPos: THREE.Vector3 | null = null;
  private _ragdollPivot: ENGINE.SceneComponent | null = null;
  private _blobShadow: BlobShadowComponent | null = null;
  private _ragdollTimer = 0;

  /** Tuned so first ground contact aligns with end of death clip (~1s fall). */
  private static readonly DEATH_ANIM_DURATION_SEC = 1.0;
  private static readonly DEATH_SETTLE_SEC = 0.5;
  private static readonly DEATH_GRAVITY = 9;
  private static readonly DEATH_SMOKE_SCALE = 2.0;

  private _lastSeparationTime = 0;
  private static readonly SEPARATION_INTERVAL_MS = 50;
  private static readonly MAX_SEPARATION_CHECKS = 8;

  private _lastAnimPosition = new THREE.Vector3();
  private _isActuallyMoving = false;
  private _animStateChangeTimer = 0;

  // FIX: Debounce timer for idle↔walk animation switching to prevent rapid oscillation
  private _idleWalkDebounceTimer = 0;
  private _pendingAnimState: 'idle' | 'walk' | 'attack' | null = null;
  private static readonly IDLE_WALK_DEBOUNCE_TIME = 0.25; // 250ms debounce before switching
  private static readonly MOVEMENT_THRESHOLD = 0.015; // Slightly higher threshold (was 0.008)

  private _stuckCheckTimer = 0;
  private _stuckCheckPosition = new THREE.Vector3();
  private _consecutiveStuckChecks = 0;
  private static readonly STUCK_CHECK_INTERVAL = 0.5;
  private static readonly STUCK_DISTANCE_THRESHOLD = 0.15;
  private static readonly STUCK_CONSECUTIVE_THRESHOLD = 2;

  private _distanceToPlayer = Infinity;
  private _isHighLOD = true;
  private static readonly HIGH_LOD_DISTANCE = 20;
  private static readonly MEDIUM_LOD_DISTANCE = 35;
  private static readonly HIGH_LOD_DISTANCE_SQ = 20 * 20;
  private static readonly MEDIUM_LOD_DISTANCE_SQ = 35 * 35;
  private _lodLevel: 'high' | 'medium' | 'low' = 'high';

  // Frozen position during death animation - prevents any residual movement
  private _deathPosition: THREE.Vector3 | null = null;

  // Pooling support
  public isPooled = false;
  public onDied: (() => void) | null = null;
  private _pooledHidden = false;
  /** Scene-placed start transform — restored between mission attempts. */
  private _placedStartPosition: THREE.Vector3 | null = null;
  private _placedStartRotation: THREE.Euler | null = null;

  private _tickOffset = 0;
  private static readonly TICK_INTERVAL = 2;
  private static readonly TICK_INTERVAL_LOW = 4;

  private _btTimer = 0;
  private static readonly BT_UPDATE_INTERVAL = 0.15;
  private _animTimer = Math.random() * 0.1;
  private static readonly ANIM_UPDATE_INTERVAL = 0.033; // 30Hz animation updates (was 0.1 = 10Hz)
  private _shadowCheckTimer = 0;
  private static readonly SHADOW_CHECK_INTERVAL = 0.5;

  private _individualOffset = Math.random() * 1000;
  private _stateChangeTimer = 0;
  private _nextStateChangeTime = 2 + Math.random() * 4;

  // FIX: Startup animation randomization - wait for animation system to be ready
  private _animInitTimer = 0;
  private static readonly ANIM_INIT_TIMEOUT = 5.0; // Max 5 seconds to wait for animation ready
  private _animationInitialized = false;

  // FIX: Per-zombie initial idle delay for random startup behavior
  private _initialIdleDelay = 0;
  private _startupTimer = 0;
  private _startupComplete = false;

  // ── Damage → hit-reaction ──────────────────────────────────────────────────

  private readonly _onHealthChanged = (current: number, _max: number): void => {
    if (this._deathSequenceStarted || current >= this._lastTrackedHealth || current <= 0) {
      this._lastTrackedHealth = current;
      return;
    }
    const w = this.getWorld();
    if (w) {
      this._hitAnimEndTime = w.getGameTime() + HIT_REACTION_HOLD_SEC;

      // Play random zombie hit sound (zombiehit1 or zombiehit2)
      const audioManager = getGameAudioManager(w);
      if (audioManager) {
        const hitSound = Math.random() < 0.5 ? 'zombieHit1' : 'zombieHit2';
        audioManager.play(hitSound, 1.0, true);
      }
    }

    // Cancel idle/walk/attack debounce so syncAnimationState cannot override hit (BigUndead has no debounce).
    this._pendingAnimState = null;
    this._idleWalkDebounceTimer = 0;

    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.setParameter('state', 'hit');
    }

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();

    this._lastTrackedHealth = current;
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public override initialize(options?: ActorOptions): void {
    ensureNewZombieNpcCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
        collisionProfile: NEW_ZOMBIE_NPC_PROFILE,
      },
    });

    // Ragdoll pivot sits at body center; visual hangs below it so rotation is around center
    const pivot = ENGINE.SceneComponent.create({
      position: new THREE.Vector3(0, CAPSULE_HEIGHT * 0.5, 0),
    });
    this._ragdollPivot = pivot;

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: NEW_ZOMBIE_MODEL_URL,
      material: NEW_ZOMBIE_MATERIAL_URL,
      position: new THREE.Vector3(0, -CAPSULE_HEIGHT * 0.5, 0),
      rotation: new THREE.Euler(0, Math.PI, 0),
      physicsOptions: { enabled: false },
      castShadow: false,
      receiveShadow: false,
    });

    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: NEW_ZOMBIE_ANIM_URL });
    this.animationComponent = anim;

    const stats = ENGINE.CharacterStatsComponent.create({
      maxHealth: this.maxHealth,
      healthRegen: 0,
      attackCooldown: this.attackCooldown,
      attackRange: this.attackRange,
      attackDamage: this.attackDamage,
      speed: this.moveSpeed,
    });

    const npc = ENGINE.NpcMovementComponent.create({
      pathFollowingAccuracy: NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY,
      actorFollowingDistance: NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE,
      stopDistance: NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE,
      movementSpeed: this.moveSpeed,
      useNavigationServer: true,
      turnSpeed: 2.5,
      characterControllerOptions: {
        ...ENGINE.CharacterMovementComponent.DEFAULT_CHARACTER_CONTROLLER_OPTIONS,
        simulatedGravityScale: 1.0,
        applyImpulsesToDynamicBodies: false,
        slideEnabled: true,
        snapToGroundDistance: 0.3,
        autoStepConfig: {
          maxHeight: 0.4,
          minWidth: 0.1,
          includeDynamicBodies: false,
        },
      },
    });

    (npc as unknown as { pathFollowingAccuracy: number }).pathFollowingAccuracy = NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY;
    (npc as unknown as { actorFollowingDistance: number }).actorFollowingDistance = NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE;

    this._blobShadow = BlobShadowComponent.create({ radius: 0.45, opacity: 0.3 });

    // Hierarchy: root (capsule) -> pivot (body center) -> visual + anim; shadow on root at feet
    pivot.add(visual);
    pivot.add(anim);
    root.add(pivot);
    root.add(this._blobShadow);

    super.initialize({ ...options, rootComponent: root, sceneComponents: [stats, npc] });
    this._npcComponent = npc as unknown as typeof this._npcComponent;
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // Ensure shadows are disabled (overrides scene file castShadow=true for placed zombies)
    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (visual) {
      visual.castShadow = false;
      visual.receiveShadow = false;
    }

    this._ensureBlobShadowAtFeet();

    this._tickOffset = Math.floor(Math.random() * 100);
    this._tangentialSign = tangentialSignFromSeed(this._tickOffset + this._individualOffset);

    this._jitteredSpeed = this.moveSpeed + (Math.random() - 0.5) * SPEED_JITTER_RANGE;
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      maxSpeed: number;
      pathFollowingAccuracy: number;
      actorFollowingDistance: number;
    } | null;
    if (npc) {
      npc.maxSpeed = this._jitteredSpeed;
      npc.pathFollowingAccuracy = NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY;
      npc.actorFollowingDistance = NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE;
      this._npcComponent = npc as unknown as typeof this._npcComponent;
    }

    this.syncStatsAndMovementFromProperties();

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      this._lastTrackedHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
    }

    // FIX: Per-zombie initial idle delay - 30% start idle, 70% start walking
    // This creates a natural mix of behaviors from the first frame
    const startAsIdler = Math.random() < 0.3; // 30% chance to start as idler
    if (startAsIdler) {
      this._initialIdleDelay = 1.0 + Math.random() * 4.0; // 1-5 second idle delay
    } else {
      this._initialIdleDelay = 0; // No delay, start wandering immediately
    }

    // FIX: Startup animation randomization - will be applied once animation system is ready
    // We can't set it here because the model isn't loaded yet (isReady() returns false)
    // The actual initialization happens in tickPrePhysics

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      this.rootComponent.getWorldPosition(this._lodMyPos);
      player.rootComponent.getWorldPosition(this._lodPlayerPos);
      this._distanceToPlayer = this._lodMyPos.distanceTo(this._lodPlayerPos);
      this._updateLODLevel();
    }

    this.rootComponent.getWorldPosition(this._stuckCheckPosition);

    if (!this.isPooled) {
      if (!this._placedStartPosition) {
        this._placedStartPosition = this._stuckCheckPosition.clone();
        this._placedStartRotation = this.rootComponent.rotation.clone();
      }
    }

    this.blackboard = new ENGINE.Blackboard(this);
    this.buildBehaviorTree();
    this.behaviorRoot?.initialize(this.blackboard);

    zombieSpatialManager.registerZombie(this);
  }

  public override tickPrePhysics(deltaTime: number): void {
    // PERFORMANCE: Skip all processing for hidden (pooled) zombies
    if (this.isHiddenInGame()) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (this._visibilityReassertTicks > 0) {
      this._reassertVisibility();
      this._visibilityReassertTicks--;
    }

    if (!isGameplayUnlocked()) {
      this.getComponent(ENGINE.NpcMovementComponent)?.stop();
      const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
      if (anim?.isReady()) anim.setParameter('state', 'idle');
      return;
    }

    if (this._deathSequenceStarted) {
      this.tickRagdoll(deltaTime);
      super.tickPrePhysics(deltaTime);
      return;
    }

    const world = this.getWorld();
    const player = world ? getCachedPlayerPawn(world) : null;
    if (player) {
      this.rootComponent.getWorldPosition(this._lodMyPos);
      player.rootComponent.getWorldPosition(this._lodPlayerPos);
      this._distanceToPlayer = this._lodMyPos.distanceToSquared(this._lodPlayerPos);
      this._distanceToPlayerLinear = Math.sqrt(this._distanceToPlayer);
      this._updateLODLevel();
    }

    this.blackboard?.updateGameState();

    let justGotAggro = false;
    if (!this._hasAggro && this.blackboard) {
      const dist = this.blackboard.getValue<number>('DistanceToPlayer');
      if (dist !== undefined && dist <= this.aggroRadius) {
        this._hasAggro = true;
        this.blackboard.setValue('HasAggro', true);
        justGotAggro = true;
      }
    } else if (this._hasAggro && this.blackboard) {
      this.blackboard.setValue('HasAggro', true);
    }

    const distForLatch = this.blackboard?.getValue<number>('DistanceToPlayer');
    if (distForLatch !== undefined) {
      if (distForLatch <= this.attackRange) this._attackZoneLatched = true;
      else if (distForLatch > this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN) {
        this._attackZoneLatched = false;
      }
    }

    const frameCount = world ? getCachedWorldFrame(world) : 0;
    const tickInterval = this._isHighLOD ? NewZombieActor.TICK_INTERVAL : NewZombieActor.TICK_INTERVAL_LOW;
    const shouldUpdate = ((frameCount + this._tickOffset) % tickInterval) === 0;

    const inHitReaction = world !== null && world !== undefined && world.getGameTime() < this._hitAnimEndTime;
    if (!inHitReaction) {
      if (this._wasInHitReaction && this._hasAggro) {
        this._btBranch = 'chase';
      }
      this._wasInHitReaction = false;
      this.applyDirectSteerChase();
    } else {
      this._wasInHitReaction = true;
      // Keep stopping the NPC every tick during hit reaction - its internal tick
      // will resume pathfinding otherwise even after a single npc.stop() call
      const npc = this.getComponent(ENGINE.NpcMovementComponent);
      npc?.stop();
    }

    if (this._navRestoreRemainingSec > 0) {
      this._navRestoreRemainingSec -= deltaTime;
      if (this._navRestoreRemainingSec <= 0 && !this._deathSequenceStarted) {
        const npcNav = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
          useNavigationServer?: boolean;
        } | null;
        if (npcNav) {
          npcNav.useNavigationServer = this._navRestoreSetting;
        }
      }
    }

    this._tickFlash(deltaTime);

    // FIX: Handle startup animation initialization - wait for animation system to be ready
    if (!this._animationInitialized) {
      this._animInitTimer += deltaTime;
      const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
      if (anim?.isReady()) {
        // Animation system is ready - always start idle
        anim.setParameter('state', 'idle');
        this._animationInitialized = true;
      } else if (this._animInitTimer >= NewZombieActor.ANIM_INIT_TIMEOUT) {
        // Timeout - give up waiting
        this._animationInitialized = true;
      }
    }

    // FIX: Handle initial idle delay - some zombies idle at startup
    if (!this._startupComplete && !this._hasAggro) {
      this._startupTimer += deltaTime;
      if (this._startupTimer < this._initialIdleDelay) {
        // Still in initial idle period - stop movement
        const npc = this.getComponent(ENGINE.NpcMovementComponent);
        if (npc) {
          npc.stop();
        }
        // Force idle animation during startup delay (only set once to avoid state machine thrashing)
        const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
        if (anim?.isReady() && this._animationInitialized) {
          const currentState = anim.getGraphState('base');
          if (currentState !== 'idle') {
            anim.setParameter('state', 'idle');
          }
        }
      } else {
        this._startupComplete = true;
      }
    }

    if (!this._hasAggro && this._startupComplete) {
      this.updateIndividualBehavior(deltaTime);
    }

    if (justGotAggro) {
      void this.tickBehaviorTreeAsync(deltaTime);
    }

    this._animTimer += deltaTime;
    if (this._animTimer >= NewZombieActor.ANIM_UPDATE_INTERVAL) {
      this._animTimer = 0;
      if (this._lodLevel === 'high') {
        this.syncAnimationState();
      } else {
        this.syncAnimationStateLowLOD();
      }
    }

    if (!shouldUpdate) {
      this.updateStuckDetection(deltaTime);
      super.tickPrePhysics(deltaTime);
      return;
    }

    if (!justGotAggro) {
      this._btTimer += deltaTime;
      if (this._btTimer >= NewZombieActor.BT_UPDATE_INTERVAL) {
        this._btTimer = 0;
        void this.tickBehaviorTreeAsync(deltaTime);
      }
    }

    this._shadowCheckTimer += deltaTime;
    if (this._shadowCheckTimer >= NewZombieActor.SHADOW_CHECK_INTERVAL) {
      this._shadowCheckTimer = 0;
      this.updateShadowLOD();
    }

    this.updateStuckDetection(deltaTime);
    super.tickPrePhysics(deltaTime);
  }

  private _updateLODLevel(): void {
    if (this._distanceToPlayer <= NewZombieActor.HIGH_LOD_DISTANCE_SQ) {
      this._lodLevel = 'high';
      this._isHighLOD = true;
    } else if (this._distanceToPlayer <= NewZombieActor.MEDIUM_LOD_DISTANCE_SQ) {
      this._lodLevel = 'medium';
      this._isHighLOD = false;
    } else {
      this._lodLevel = 'low';
      this._isHighLOD = false;
    }
  }

  private syncAnimationStateLowLOD(): void {
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (!anim?.isReady()) return;

    // Never override death or hit animations
    if (this._deathSequenceStarted) return;

    const w = this.getWorld();
    if (w && w.getGameTime() < this._hitAnimEndTime) {
      this._pendingAnimState = null;
      this._idleWalkDebounceTimer = 0;
      anim.setParameter('state', 'hit');
      return;
    }

    const currentPos = this._animCurrentPos;
    this.rootComponent.getWorldPosition(currentPos);
    const wasMoving = this._isActuallyMoving;
    this._isActuallyMoving = currentPos.distanceTo(this._lastAnimPosition) > NewZombieActor.MOVEMENT_THRESHOLD;
    this._lastAnimPosition.copy(currentPos);

    if (this._hasAggro) {
      const dist = this.blackboard?.getValue<number>('DistanceToPlayer');
      const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;

      if (dist !== undefined && dist <= engage) {
        anim.setParameter('state', 'attack');
      } else {
        anim.setParameter('state', 'walk');
      }
      this._pendingAnimState = null;
      this._idleWalkDebounceTimer = 0;
      return;
    }

    // No aggro = always idle immediately
    anim.setParameter('state', 'idle');
    this._pendingAnimState = null;
    this._idleWalkDebounceTimer = 0;
  }

  /** Scene zombies serialize the blob on the pivot at body height — move it to the feet on root. */
  private _ensureBlobShadowAtFeet(): void {
    const shadow = this._blobShadow ?? this.getComponent(BlobShadowComponent);
    if (!shadow) {
      return;
    }
    this._blobShadow = shadow;

    const pivot = this._ragdollPivot;
    if (pivot && shadow.parent === pivot) {
      pivot.remove(shadow);
      this.rootComponent.add(shadow);
    }

    shadow.position.set(0, BLOB_SHADOW_FEET_Y, 0);
    shadow.visible = !this._deathSequenceStarted && !this.isHiddenInGame();
  }

  private _hideBlobShadow(): void {
    const shadow = this._blobShadow ?? this.getComponent(BlobShadowComponent);
    if (!shadow) {
      return;
    }
    this._blobShadow = shadow;
    shadow.visible = false;
  }

  private _showBlobShadow(): void {
    if (this._deathSequenceStarted) {
      return;
    }
    const shadow = this._blobShadow ?? this.getComponent(BlobShadowComponent);
    if (!shadow) {
      return;
    }
    this._blobShadow = shadow;
    this._ensureBlobShadowAtFeet();

    shadow.visible = true;
    shadow.traverse(obj => {
      obj.visible = true;
      obj.layers.enable(0);
    });
  }

  /**
   * PERFORMANCE: Shadow casting disabled entirely for performance.
   * Shadows were causing significant frame drops on mid-range GPUs.
   */
  private updateShadowLOD(): void {
    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) return;
    visual.castShadow = false;
    visual.receiveShadow = false;
  }

  private updateStuckDetection(deltaTime: number): void {
    if (this._deathSequenceStarted) return;

    this._stuckCheckTimer += deltaTime;
    if (this._stuckCheckTimer < NewZombieActor.STUCK_CHECK_INTERVAL) return;

    this._stuckCheckTimer = 0;

    const currentPos = this._stuckCurrentPos;
    this.rootComponent.getWorldPosition(currentPos);
    const movedDist = currentPos.distanceTo(this._stuckCheckPosition);

    const shouldBeMoving = this._hasAggro;

    if (shouldBeMoving && movedDist < NewZombieActor.STUCK_DISTANCE_THRESHOLD) {
      this._consecutiveStuckChecks++;

      if (this._consecutiveStuckChecks >= NewZombieActor.STUCK_CONSECUTIVE_THRESHOLD) {
        this.attemptUnstuck();
        this._consecutiveStuckChecks = 0;
      }
    } else {
      this._consecutiveStuckChecks = 0;
    }

    this._stuckCheckPosition.copy(currentPos);
  }

  private attemptUnstuck(): void {
    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    if (!npc) return;

    npc.stop();

    const navComponent = npc as unknown as { useNavigationServer: boolean };
    if (navComponent.useNavigationServer !== undefined) {
      const currentNavSetting = navComponent.useNavigationServer;
      navComponent.useNavigationServer = true;

      if (this._hasAggro && !this._attackZoneLatched) {
        const nudgeDir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          0,
          (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(0.5);

        const newPos = this.rootComponent.position.clone().add(nudgeDir);
        this.rootComponent.position.copy(newPos);

        this._navRestoreSetting = currentNavSetting;
        this._navRestoreRemainingSec = 0.05;
      }
    }

    this._lastSeparationTime = 0;
  }

  // ─── Death ─────────────────────────────────────────────────────────────────

  public override handleDeath(hitInfo?: DamageHitInfo): void {
    if (this._deathSequenceStarted) return;
    this._deathSequenceStarted = true;

    this._hideBlobShadow();

    zombieSpatialManager.unregisterZombie(this);

    // Track kill for streak detection
    const world = this.getWorld();
    if (world) {
      killStreakTracker.recordKill(world);
      void comboMeterTracker.recordKill(world);
      awardSoulFromEnemyKill(world);
      tryRollMissionItemDropOnEnemyKill(ENEMY_TYPE_ZOMBIE);

      // Camera FOV punch on individual kill for visceral feedback
      const player = world.getFirstPlayerPawn();
      if (player && 'triggerFOVPunch' in player) {
        (player as unknown as { triggerFOVPunch(intensity: number): void }).triggerFOVPunch(0.5);
      }
    }

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();

    // Disable the NPC component entirely so its internal tick can't apply
    // any further velocity to the physics body after death
    if (npc) {
      (npc as unknown as { enabled: boolean }).enabled = false;
    }

    // Capture position at death moment
    const deathPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(deathPos);
    this._deathPosition = deathPos.clone();

    // Show KO sign at death position
    if (world) {
      KOSignUI.getInstance(world).showKO(deathPos);
    }

    // Drive a simple ragdoll-style launch directly. The dynamic body switch was
    // unreliable here because the movement component leaves transform sync state behind.
    const root = this.rootComponent as ENGINE.MeshComponent;
    root.overridePhysicsOptions({ enabled: false });

    // Stop character controller from blocking physics rotation sync.
    if (npc) {
      (npc as unknown as { hasCharacterController: boolean }).hasCharacterController = false;
      (npc as unknown as { setVelocities(f: number, r: number, v: number): void }).setVelocities(0, 0, 0);
    }

    // Compute launch direction from hit info, fallback to random.
    const launchDir = new THREE.Vector3();
    if (hitInfo?.hitNormal) {
      // hitNormal is already "away from damage source" — use directly
      launchDir.copy(hitInfo.hitNormal).setY(0).normalize();
    } else if (hitInfo?.hitLocation) {
      launchDir.copy(deathPos).sub(hitInfo.hitLocation).setY(0).normalize();
    } else {
      const angle = Math.random() * Math.PI * 2;
      launchDir.set(Math.cos(angle), 0, Math.sin(angle));
    }
    if (launchDir.lengthSq() < 0.001) launchDir.set(1, 0, 0);

    // Face travel direction so knockback reads chest-first, not flying backward.
    this.rootComponent.rotation.y = Math.atan2(launchDir.x, launchDir.z);

    const lateralSpeed = 7 + Math.random() * 4;
    const upSpeed = (NewZombieActor.DEATH_ANIM_DURATION_SEC * NewZombieActor.DEATH_GRAVITY) / 2;
    this._ragdollLandPos = null;
    this._ragdollTimer = 0;
    this._ragdollVelocity.set(
      launchDir.x * lateralSpeed,
      upSpeed,
      launchDir.z * lateralSpeed,
    );
    this._ragdollGroundY = deathPos.y;

    // Play death animation to stop walk/attack looping and show limp body
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.setParameter('state', 'death');
    }

    // Cleanup is driven by game-time accumulator in tickRagdoll so slow-mo doesn't cause
    // premature vanishing (globalThis.setTimeout uses wall-clock time, not game time).
  }

  /**
   * Restore a scene-placed zombie to its initial spot and pre-aggro state.
   * Horde-pooled zombies are skipped.
   */
  public restorePlacedForMissionReset(): void {
    if (this.isPooled || !this._placedStartPosition || !this._placedStartRotation) {
      return;
    }

    this._deathSequenceStarted = false;
    this._deathPosition = null;
    this._ragdollLandPos = null;
    this._ragdollTimer = 0;
    this._ragdollVelocity.set(0, 0, 0);
    this._wasInHitReaction = false;
    this._navRestoreRemainingSec = 0;

    // Position must be set BEFORE re-enabling physics. overridePhysicsOptions
    // destroys and recreates the Rapier body at the component's current world
    // position, so moving the component afterwards leaves the body at the old
    // (death) location and physics will snap the zombie back there next tick.
    this.rootComponent.position.copy(this._placedStartPosition);
    this.rootComponent.rotation.copy(this._placedStartRotation);
    this.rootComponent.updateWorldMatrix(true, false);

    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
    });

    this.setHiddenInGame(false);

    this._hasAggro = false;
    this._attackZoneLatched = false;
    this._btBranch = 'wander';
    this._hitAnimEndTime = -Infinity;
    this._consecutiveStuckChecks = 0;
    this._stuckCheckPosition.copy(this._placedStartPosition);
    this._animStateChangeTimer = 0;
    this._pendingAnimState = null;
    this._idleWalkDebounceTimer = 0;
    this._animInitTimer = 0;
    this._startupTimer = 0;
    this._animTimer = 0;
    this._animationInitialized = false;
    this._startupComplete = false;
    this._isActuallyMoving = false;
    this._lastAnimPosition.copy(this._placedStartPosition);

    if (this.blackboard) {
      this.blackboard.clear();
      this.blackboard.setValue('HasAggro', false);
      const player = this.getWorld()?.getFirstPlayerPawn();
      if (player) {
        const dist = this.rootComponent.position.distanceTo(player.rootComponent.position);
        this.blackboard.setValue('DistanceToPlayer', dist);
      }
    }

    this.behaviorRoot?.reset();

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
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

    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      enabled: boolean;
      hasCharacterController: boolean;
      maxSpeed: number;
      useNavigationServer: boolean;
    } | null;
    if (npc) {
      npc.enabled = true;
      npc.hasCharacterController = true;
      npc.maxSpeed = this._jitteredSpeed;
      npc.useNavigationServer = true;
    }
    this.getComponent(ENGINE.NpcMovementComponent)?.stop();

    zombieSpatialManager.unregisterZombie(this);
    zombieSpatialManager.registerZombie(this);

    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.transitionGraphToState('base', 'idle');
      anim.setParameter('state', 'idle');
      this._animationInitialized = true;
      this._startupComplete = true;
    }

    this._showBlobShadow();
  }

  /** Force-hide when quitting to the main menu (horde reset). */
  public parkForHordeReset(): void {
    if (this._deathSequenceStarted) {
      this.setHiddenInGame(true);
      this.rootComponent.position.set(0, -1000, 0);
      zombieSpatialManager.unregisterZombie(this);
      return;
    }
    this.recycle();
  }

  /**
   * Recycle this pooled zombie — hide it and park it off-screen.
   * The HordeManager will later call softReset() to respawn it.
   */
  private recycle(): void {
    // Restore ragdoll state and physics for respawn.
    this._ragdollVelocity.set(0, 0, 0);
    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
    });

    // Hide the zombie
    this.setHiddenInGame(true);

    // Disable physics while parked — removes Rapier body cost for idle pool zombies.
    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: false,
      motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
    });

    // Move it far off-screen (won't be visible until respawned)
    this.rootComponent.position.set(0, -1000, 0);

    // Reset death state flags so it can be reused
    this._deathSequenceStarted = false;
    this._deathPosition = null;
    this._ragdollLandPos = null;

    // Reset animation init flags so the tick's wait-for-ready loop runs again on
    // respawn — same as doBeginPlay() does for a freshly created actor. Without
    // this, the animation never restarts if isReady() returns false in softReset().
    this._animationInitialized = false;
    this._startupComplete = false;
    this._animInitTimer = 0;
    this._startupTimer = 0;
    this._animTimer = 0;

    // Unregister from spatial manager while hidden (prevents weapon hit detection)
    zombieSpatialManager.unregisterZombie(this);
  }

  private tickRagdoll(deltaTime: number): void {
    const airDrag = Math.pow(0.7, deltaTime);

    this._ragdollVelocity.y -= NewZombieActor.DEATH_GRAVITY * deltaTime;
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

    // Accumulate game time — fires cleanup after full animation+settle duration even in slomo.
    this._ragdollTimer += deltaTime;
    const cleanupSec = NewZombieActor.DEATH_ANIM_DURATION_SEC + NewZombieActor.DEATH_SETTLE_SEC;
    if (this._ragdollTimer >= cleanupSec) {
      this._ragdollTimer = -999; // Prevent re-entry
      const w = this.getWorld();
      if (w) {
        GoreExplosionActor.spawnAt(w, this._ragdollLandPos ?? this.rootComponent.position);
        getGameAudioManager(w).play('zombieDeath', 1.0, true);
      }
      this.spawnDeathObjects(this._ragdollLandPos ?? this.rootComponent.position.clone());
      this.onDied?.();
      // Scene-placed zombies are part of the authored level layout. Keep them
      // parked instead of destroying them so mission replay/rank changes can
      // restore the same level state from their captured editor positions.
      this.recycle();
    }
  }

  /**
   * Soft reset for pooled zombies — respawn at a new position with full health.
   * Immediately enters chase mode (aggro = true).
   */
  public softReset(position: THREE.Vector3): void {
    // Clear death before unhide so blob shadow restore is allowed
    this._deathSequenceStarted = false;
    this._deathPosition = null;
    this._ragdollLandPos = null;
    this._ragdollTimer = 0;
    this._ragdollVelocity.set(0, 0, 0);

    this.setHiddenInGame(false);

    // Move to spawn position
    this.rootComponent.position.copy(position);
    this.rootComponent.updateMatrixWorld();

    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
    });

    // Reset aggro / BT state
    this._hasAggro = true;
    this._attackZoneLatched = false;
    this._btBranch = 'chase';
    this._hitAnimEndTime = -Infinity;
    this._consecutiveStuckChecks = 0;
    this._stuckCheckPosition.copy(position);
    this._animStateChangeTimer = 0;
    this._pendingAnimState = null;
    this._idleWalkDebounceTimer = 0;
    this._animInitTimer = 0;
    this._startupTimer = 0;
    this._animTimer = 0;
    this._animationInitialized = false;

    // Reset blackboard for immediate chase
    if (this.blackboard) {
      this.blackboard.clear();
      this.blackboard.setValue('HasAggro', true);
      const player = this.getWorld()?.getFirstPlayerPawn();
      if (player) {
        const dist = this.rootComponent.position.distanceTo(player.rootComponent.position);
        this.blackboard.setValue('DistanceToPlayer', dist);
      } else {
        this.blackboard.setValue('DistanceToPlayer', 15);
      }
    }

    // Reset behavior tree
    if (this.behaviorRoot) {
      this.behaviorRoot.reset();
    }

    // Reset health
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      // Revive the engine stats component. setMaxHealth() clamps health but does
      // not clear the private isDead flag, so pooled zombies would ignore damage.
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

    // Re-enable NPC component - let applyDirectSteerChase handle movement
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      enabled: boolean;
      hasCharacterController: boolean;
      maxSpeed: number;
      useNavigationServer: boolean;
    } | null;
    if (npc) {
      npc.enabled = true;
      npc.hasCharacterController = true; // Controller was never removed, just restore flag
      npc.maxSpeed = this._jitteredSpeed;
      npc.useNavigationServer = false; // Direct steer chase
      this._npcComponent = npc as unknown as typeof this._npcComponent;
      // Do NOT call followActor or stop - applyDirectSteerChase runs every tick
    }

    // Update spatial manager
    zombieSpatialManager.unregisterZombie(this);
    zombieSpatialManager.registerZombie(this);

    // Start in walk animation if animation is already ready (likely on 2nd+ respawn).
    // If not yet ready, _animationInitialized stays false and the tick's wait-for-ready
    // loop will catch it and set the state once isReady() returns true.
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.transitionGraphToState('base', 'walk');
      anim.setParameter('state', 'walk');
      this._animationInitialized = true;
    }
    this._startupComplete = true;

    this._showBlobShadow();
    this.beginVisibilityReassert();
  }

  /** Re-apply render layers for a few ticks after reveal — catches late-attached GLTF meshes. */
  public beginVisibilityReassert(ticks = 3): void {
    this._visibilityReassertTicks = ticks;
  }

  private _reassertVisibility(): void {
    if (this._pooledHidden) {
      return;
    }
    this.rootComponent.visible = true;
    this.rootComponent.traverse(obj => {
      obj.visible = true;
      obj.layers.enable(0);
    });
  }

  /**
   * Actor-level pooled visibility state.
   *
   * The engine's hidden-in-game implementation ultimately lives on
   * SceneComponent and hides by disabling render layers. Keeping our own flag
   * plus explicitly applying it to the root hierarchy prevents reused pooled
   * zombies from staying layer-hidden after a respawn.
   */
  public override isHiddenInGame(): boolean {
    return this._pooledHidden;
  }

  public override setHiddenInGame(hidden: boolean): void {
    this._pooledHidden = hidden;
    this.rootComponent.setHiddenInGame(hidden);
    this.rootComponent.visible = !hidden;
    this.rootComponent.traverse(obj => {
      obj.visible = !hidden;
      if (hidden) {
        obj.layers.disableAll();
      } else {
        obj.layers.enable(0);
      }
    });

    if (!hidden && !this._deathSequenceStarted) {
      this._showBlobShadow();
    }
  }

  /**
   * Spawn grave at landing position and award one soul to the player UI.
   */
  private spawnDeathObjects(deathPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    const landPos = this._ragdollLandPos ?? deathPos;
    const gravePos = landPos.clone().add(new THREE.Vector3(0, 0.5, 0));
    DeadGraveActor.spawnAt(world, gravePos, new THREE.Vector3(0, 0, 0));

    const smokeActor = ENGINE.Actor.create();
    smokeActor.rootComponent.position.copy(landPos);
    smokeActor.rootComponent.position.y += 0.1;
    smokeActor.rootComponent.scale.setScalar(NewZombieActor.DEATH_SMOKE_SCALE);
    const smokeVfx = ENGINE.VFXComponent.create({
      vfxPath: '@project/assets/VFX/smoke.vfx.json',
      autoStart: true,
    });
    smokeActor.rootComponent.add(smokeVfx);
    world.addActor(smokeActor);
    trackDeathSmokeActor(smokeActor);

    setTimeout(() => {
      smokeActor.destroy();
    }, 3000);

  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private applyDirectSteerChase(): void {
    const npc = this._npcComponent;
    if (!npc) return;

    const steerChase = this._hasAggro && !this._attackZoneLatched;
    if (!steerChase) {
      npc.useNavigationServer = true;
      return;
    }

    const w = this.getWorld();
    if (!w) {
      npc.useNavigationServer = true;
      return;
    }

    const player = getCachedPlayerPawn(w);
    if (!player) {
      npc.useNavigationServer = true;
      return;
    }

    npc.useNavigationServer = false;

    this.rootComponent.getWorldPosition(this._steerMyPos);
    player.rootComponent.getWorldPosition(this._steerToPlayer);
    this._steerToPlayer.sub(this._steerMyPos);
    this._steerToPlayer.y = 0;
    if (this._steerToPlayer.lengthSq() < 1e-8) {
      this._steerToPlayer.set(1, 0, 0);
    } else {
      this._steerToPlayer.normalize();
    }

    this._steerSep.set(0, 0, 0);
    const now = performance.now();
    if (now - this._lastSeparationTime >= NewZombieActor.SEPARATION_INTERVAL_MS) {
      this._lastSeparationTime = now;

      zombieSpatialManager.updateZombiePosition(this);

      const rSep = ZOMBIE_STEER_SEPARATION_RADIUS;
      const rSepSq = rSep * rSep;

      const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._steerMyPos, rSep);

      let checksPerformed = 0;
      for (const z of nearbyZombies) {
        if (checksPerformed >= NewZombieActor.MAX_SEPARATION_CHECKS) break;
        if (z === this || (z as unknown as { _deathSequenceStarted: boolean })._deathSequenceStarted) continue;

        z.rootComponent.getWorldPosition(this._steerOtherPos);

        const dx = this._steerMyPos.x - this._steerOtherPos.x;
        const dz = this._steerMyPos.z - this._steerOtherPos.z;
        if (Math.abs(dx) > rSep || Math.abs(dz) > rSep) continue;

        checksPerformed++;
        const dsq = dx * dx + dz * dz;
        if (dsq >= rSepSq || dsq < 1e-10) continue;

        const d = Math.sqrt(dsq);
        const nx = dx / d;
        const nz = dz / d;
        const pen = rSep - d;
        this._steerSep.x += nx * pen * ZOMBIE_STEER_SEPARATION_WEIGHT;
        this._steerSep.z += nz * pen * ZOMBIE_STEER_SEPARATION_WEIGHT;
      }
    }

    computeZombieSteerGoal({
      myPos: this._steerMyPos,
      seekDir: this._steerToPlayer,
      separation: this._steerSep,
      tangentialSign: this._tangentialSign,
      distToPlayer: this._distanceToPlayerLinear,
      attackRange: this.attackRange,
      scratch: this._steerScratch,
    });
    this._steerGoal.copy(this._steerScratch.goal);

    const nav = w.getNavigationServer() as {
      isReady?: () => boolean;
      isPointOnNavigationMesh?: (p: THREE.Vector3) => boolean;
      getClosestPointOnNavigationMesh?: (p: THREE.Vector3) => THREE.Vector3;
    } | null;
    if (
      nav?.isReady?.() &&
      nav.isPointOnNavigationMesh &&
      !nav.isPointOnNavigationMesh(this._steerGoal) &&
      nav.getClosestPointOnNavigationMesh
    ) {
      try {
        this._steerGoal.copy(nav.getClosestPointOnNavigationMesh(this._steerGoal));
      } catch {
        /* keep raw goal */
      }
    }

    ensureSteerGoalMinDistance(
      this._steerMyPos,
      this._steerGoal,
      this._steerToPlayer,
      this._steerScratch.goalDelta,
    );

    npc.setTargetPosition(this._steerGoal, ZOMBIE_STEER_GOAL_STOP);
  }

  private static readonly BASE_MAX_HEALTH = 100;
  private static readonly BASE_ATTACK_DAMAGE = ZOMBIE_BASE_ATTACK_DAMAGE;

  /** Apply mission risk multipliers to this zombie's combat stats. */
  public applyMissionRiskMultipliers(healthMult: number, damageMult: number): void {
    this.maxHealth = NewZombieActor.BASE_MAX_HEALTH * healthMult;
    this.attackDamage = NewZombieActor.BASE_ATTACK_DAMAGE * damageMult;
    this.syncStatsAndMovementFromProperties();

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (!stats || this._deathSequenceStarted) return;

    const mutableStats = stats as unknown as {
      maxHealth: number;
      currentHealth: number;
      onHealthChanged: { invoke(current: number, max: number): void };
    };
    mutableStats.maxHealth = this.maxHealth;
    mutableStats.currentHealth = this.maxHealth;
    this._lastTrackedHealth = this.maxHealth;
    mutableStats.onHealthChanged.invoke(this.maxHealth, this.maxHealth);
  }

  protected syncStatsAndMovementFromProperties(): void {
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.setMaxHealth(this.maxHealth);
      stats.setAttackCooldown(this.attackCooldown);
      stats.setAttackRange(this.attackRange);
      stats.setAttackDamage(this.attackDamage);
      stats.setSpeed(this.moveSpeed);
    }
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      maxSpeed: number;
      pathFollowingAccuracy: number;
      actorFollowingDistance: number;
    } | null;
    if (npc) {
      npc.maxSpeed = this._jitteredSpeed > 0 ? this._jitteredSpeed : this.moveSpeed;
      npc.pathFollowingAccuracy = NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY;
      npc.actorFollowingDistance = NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE;
    }
  }

  private buildBehaviorTree(): void {
    const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;
    const attackSequence = new ENGINE.SequenceNode({
      name: 'AttackBranch',
      conditions: [new ENGINE.IsPlayerNearCondition({ range: engage })],
      children: [
        new ENGINE.MeleeAttackAction({
          attackRange: engage,
          damage: this.attackDamage,
          attackCooldown: this.attackCooldown,
          attackDuration: 0.45,
        }),
      ],
    });

    const chaseSequence = new ENGINE.SequenceNode({
      name: 'ChaseBranch',
      conditions: [new NewZombieStickyChaseCondition(this.aggroRadius)],
      children: [new NewZombieSteerChaseNoopAction()],
    });

    const wander = new ENGINE.WanderAction({
      wanderRadius: this.wanderRadius,
      minWaitTime: this.wanderWaitMin,
      maxWaitTime: this.wanderWaitMax,
    });

    this.behaviorRoot = new ENGINE.SelectorNode({
      name: 'NewZombieRoot',
      children: [attackSequence, chaseSequence, wander],
    });
  }

  private async tickBehaviorTreeAsync(deltaTime: number): Promise<void> {
    if (!this.behaviorRoot || !this.blackboard || this._btBusy) return;

    let desired: 'wander' | 'chase' | 'attack';
    if (this._attackZoneLatched) desired = 'attack';
    else if (this._hasAggro) desired = 'chase';
    else desired = 'wander';

    if (desired !== this._btBranch) {
      this.behaviorRoot.reset();
      this._btBranch = desired;
    }

    this._btBusy = true;
    try {
      const status = await this.behaviorRoot.execute(this.blackboard, deltaTime);
      if (status !== ENGINE.BehaviorStatus.Running) {
        this.behaviorRoot.reset();
        if (this._attackZoneLatched) this._btBranch = 'attack';
        else if (this._hasAggro) this._btBranch = 'chase';
        else this._btBranch = 'wander';
      }
    } catch (e) {
      console.error('[NewZombieActor] BT error', e);
      this.behaviorRoot.reset();
      this._btBranch = 'wander';
    } finally {
      this._btBusy = false;
    }
  }

  private syncAnimationState(): void {
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (!anim?.isReady()) return;

    // Never override death or hit animations
    if (this._deathSequenceStarted) return;

    const currentPos = this._animCurrentPos;
    this.rootComponent.getWorldPosition(currentPos);
    const movedDist = currentPos.distanceTo(this._lastAnimPosition);
    const wasMoving = this._isActuallyMoving;
    this._isActuallyMoving = movedDist > NewZombieActor.MOVEMENT_THRESHOLD;
    this._lastAnimPosition.copy(currentPos);

    const w = this.getWorld();
    if (w && w.getGameTime() < this._hitAnimEndTime) {
      this._pendingAnimState = null;
      this._idleWalkDebounceTimer = 0;
      anim.setParameter('state', 'hit');
      return;
    }

    const dist = this.blackboard?.getValue<number>('DistanceToPlayer');
    const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;
    let desiredState: 'idle' | 'walk' | 'attack';

    if (this._hasAggro) {
      if (dist !== undefined && dist <= engage) {
        desiredState = 'attack';
      } else {
        desiredState = 'walk';
      }
    } else {
      // No aggro = always idle immediately, no debounce
      anim.setParameter('state', 'idle');
      this._pendingAnimState = null;
      this._idleWalkDebounceTimer = 0;
      return;
    }

    // With aggro: debounce walk↔attack transitions
    const currentState = this._pendingAnimState ?? (wasMoving ? 'walk' : 'idle');
    const isTransition = desiredState !== currentState;

    if (isTransition) {
      if (wasMoving !== this._isActuallyMoving) {
        this._idleWalkDebounceTimer = 0;
        this._pendingAnimState = desiredState;
      } else {
        this._idleWalkDebounceTimer += NewZombieActor.ANIM_UPDATE_INTERVAL;
        if (this._idleWalkDebounceTimer >= NewZombieActor.IDLE_WALK_DEBOUNCE_TIME) {
          this._pendingAnimState = null;
          anim.setParameter('state', desiredState);
        }
      }
    } else {
      this._pendingAnimState = null;
      this._idleWalkDebounceTimer = 0;
      anim.setParameter('state', desiredState);
    }
  }

  private updateIndividualBehavior(deltaTime: number): void {
    if (this._hasAggro) return;

    this._stateChangeTimer += deltaTime;
    if (this._stateChangeTimer >= this._nextStateChangeTime) {
      this._stateChangeTimer = 0;
      this._nextStateChangeTime = 3 + Math.random() * 5;

      const npc = this.getComponent(ENGINE.NpcMovementComponent);
      if (npc) {
        const shouldWander = Math.random() > 0.3;
        if (!shouldWander) {
          npc.stop();
        }
      }
    }
  }

  // ─── Visual Feedback ────────────────────────────────────────────────────────

  private _isFlashing = false;
  private _flashRemainingSec = 0;
  private _flashRestoreFns: Array<() => void> = [];

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

    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) {
      this._isFlashing = false;
      return;
    }

    type RestoreEntry = {
      mesh: THREE.Mesh;
      restore: () => void;
    };

    const restoreList: RestoreEntry[] = [];

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
          return () => { mat.emissive.copy(prevEmissive); mat.emissiveIntensity = prevIntensity; };
        } else if ('color' in mat) {
          const colored = mat as THREE.MeshBasicMaterial;
          const prevColor = colored.color.clone();
          colored.color.lerp(new THREE.Color(0xffff00), 0.4);
          return () => { colored.color.copy(prevColor); };
        }
        return () => { /* nothing to restore */ };
      };

      if (Array.isArray(mesh.material)) {
        const restoreFns = (mesh.material as THREE.Material[]).map(applyToMat);
        restoreList.push({ mesh, restore: () => restoreFns.forEach(fn => fn()) });
      } else {
        const restoreFn = applyToMat(mesh.material as THREE.Material);
        restoreList.push({ mesh, restore: restoreFn });
      }
    });

    if (restoreList.length === 0) {
      this._isFlashing = false;
      return;
    }

    this._flashRestoreFns = restoreList.map(({ restore }) => restore);
    this._flashRemainingSec = 0.15;
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  protected override doEndPlay(): void {
    this.getComponent(ENGINE.CharacterStatsComponent)?.onHealthChanged.remove(this._onHealthChanged);

    zombieSpatialManager.unregisterZombie(this);

    if (this.behaviorRoot) {
      this.behaviorRoot.reset();
      this.behaviorRoot.destroy();
      this.behaviorRoot = null;
    }
    this.blackboard?.clear();
    this.blackboard = null;
    super.doEndPlay();
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
