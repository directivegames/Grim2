/**
 * NewZombieActor — identical behaviour to ZombieActor, uses the new stylised zombie model.
 *
 * Animation mapping (new model clips → state machine states):
 *   idle    → "Gunshot_Reaction"         (standing still, no aggro)
 *   walk    → "Limping_Walk_3_inplace"   (chasing player)
 *   attack  → "run_fast_6_inplace"       (melee range)
 *   hit     → "Walking"                  (taking damage, looped while held)
 *   death   → "run_fast_10_inplace"      (on death, 2.0s then destroy)
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { DeadGraveActor } from './DeadGraveActor.js';
import { SoulActor } from './SoulActor.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const NEW_ZOMBIE_NPC_PROFILE = 'NewZombieNPC';

const NEW_ZOMBIE_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/new zombie/Meshy_AI_Stylized_undead_subur_biped/Newzombie2.glb` as ENGINE.ModelPath;
const NEW_ZOMBIE_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/new zombie/Meshy_AI_Stylized_undead_subur_biped/Zombienewanimations.anim.json`;

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.75;
const NEW_ZOMBIE_FOLLOW_HOLD_DISTANCE = 0.82;

const ATTACK_ZONE_HYSTERESIS_MARGIN = 0.38;
const HIT_REACTION_HOLD_SEC = 0.95;
const SPEED_JITTER_RANGE = 0.8;

const STEER_LOOKAHEAD = 3.5;
const STEER_GOAL_STOP = 0.12;
const STEER_SEPARATION_RADIUS = 0.88;
const STEER_SEPARATION_WEIGHT = 2.0;
const NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY = 0.25;
const STEER_GOAL_MIN_XY_FROM_AGENT = NEW_ZOMBIE_PATH_FOLLOWING_ACCURACY + 0.1;

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
  private _lastTrackedHealth = 0;

  private _jitteredSpeed = 3.5;
  private readonly _steerMyPos = new THREE.Vector3();
  private readonly _steerToPlayer = new THREE.Vector3();
  private readonly _steerSep = new THREE.Vector3();
  private readonly _steerOtherPos = new THREE.Vector3();
  private readonly _steerGoal = new THREE.Vector3();

  private readonly _deathScratch = {
    launch: new THREE.Vector3(),
    ownerPos: new THREE.Vector3(),
    playerPos: new THREE.Vector3(),
    flat: new THREE.Vector3(),
  };

  private _deathSpinRate = new THREE.Vector3();
  private _deathStartY = 0;
  private _deathLanded = false;

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
  private _lodLevel: 'high' | 'medium' | 'low' = 'high';

  // Frozen position during death animation - prevents any residual movement
  private _deathPosition: THREE.Vector3 | null = null;

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
    }
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.setParameter('state', 'hit');
    }

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();

    globalThis.setTimeout(() => {
      if (!this._deathSequenceStarted) {
        const npcAfter = this.getComponent(ENGINE.NpcMovementComponent);
        if (npcAfter && this._hasAggro) {
          this._btBranch = 'chase';
        }
      }
    }, HIT_REACTION_HOLD_SEC * 1000);

    this._lastTrackedHealth = current;
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public override initialize(options?: ActorOptions): void {
    ensureNewZombieNpcCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      geometry: new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2),
      material: new THREE.MeshStandardMaterial({ visible: false }),
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
        collisionProfile: NEW_ZOMBIE_NPC_PROFILE,
      },
    });

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: NEW_ZOMBIE_MODEL_URL,
      rotation: new THREE.Euler(0, Math.PI, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
      receiveShadow: true,
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

    root.add(visual);
    root.add(anim);

    super.initialize({ ...options, rootComponent: root, sceneComponents: [stats, npc] });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    this._tickOffset = Math.floor(Math.random() * 100);

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
      const myPos = new THREE.Vector3();
      this.rootComponent.getWorldPosition(myPos);
      const playerPos = new THREE.Vector3();
      player.rootComponent.getWorldPosition(playerPos);
      this._distanceToPlayer = myPos.distanceTo(playerPos);
      this._updateLODLevel();
    }

    this.rootComponent.getWorldPosition(this._stuckCheckPosition);

    this.blackboard = new ENGINE.Blackboard(this);
    this.buildBehaviorTree();
    this.behaviorRoot?.initialize(this.blackboard);

    zombieSpatialManager.registerZombie(this);
  }

  public override tickPrePhysics(deltaTime: number): void {
    if (this._deathSequenceStarted) {
      // Lock physics capsule position to death spot
      if (this._deathPosition) {
        this.rootComponent.position.set(
          this._deathPosition.x,
          this._deathPosition.y,
          this._deathPosition.z
        );
      }
      // Also lock the visual mesh's local position to prevent animation
      // root motion from sliding the mesh within the physics capsule
      const visual = this.getComponent(ENGINE.GLTFMeshComponent);
      if (visual) {
        visual.position.set(0, 0, 0);
      }
      super.tickPrePhysics(deltaTime);
      return;
    }

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      const myPos = new THREE.Vector3();
      this.rootComponent.getWorldPosition(myPos);
      const playerPos = new THREE.Vector3();
      player.rootComponent.getWorldPosition(playerPos);
      this._distanceToPlayer = myPos.distanceTo(playerPos);
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

    const world = this.getWorld();
    const frameCount = world ? (world as unknown as { frameCount?: number }).frameCount ?? 0 : 0;
    const tickInterval = this._isHighLOD ? NewZombieActor.TICK_INTERVAL : NewZombieActor.TICK_INTERVAL_LOW;
    const shouldUpdate = ((frameCount + this._tickOffset) % tickInterval) === 0;

    const inHitReaction = world !== null && world !== undefined && world.getGameTime() < this._hitAnimEndTime;
    if (!inHitReaction) {
      this.applyDirectSteerChase();
    } else {
      // Keep stopping the NPC every tick during hit reaction - its internal tick
      // will resume pathfinding otherwise even after a single npc.stop() call
      const npc = this.getComponent(ENGINE.NpcMovementComponent);
      npc?.stop();
    }

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
    if (this._distanceToPlayer <= NewZombieActor.HIGH_LOD_DISTANCE) {
      this._lodLevel = 'high';
      this._isHighLOD = true;
    } else if (this._distanceToPlayer <= NewZombieActor.MEDIUM_LOD_DISTANCE) {
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
      anim.setParameter('state', 'hit');
      return;
    }

    const currentPos = new THREE.Vector3();
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

  private updateShadowLOD(): void {
    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) return;

    const shouldCastShadow = this._distanceToPlayer < NewZombieActor.HIGH_LOD_DISTANCE;
    visual.castShadow = shouldCastShadow;
  }

  private updateStuckDetection(deltaTime: number): void {
    if (this._deathSequenceStarted) return;

    this._stuckCheckTimer += deltaTime;
    if (this._stuckCheckTimer < NewZombieActor.STUCK_CHECK_INTERVAL) return;

    this._stuckCheckTimer = 0;

    const currentPos = new THREE.Vector3();
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

        setTimeout(() => {
          if (!this._deathSequenceStarted) {
            navComponent.useNavigationServer = currentNavSetting;
          }
        }, 50);
      }
    }

    this._lastSeparationTime = 0;
  }

  // ─── Death ─────────────────────────────────────────────────────────────────

  public override handleDeath(_hitInfo?: DamageHitInfo): void {
    if (this._deathSequenceStarted) return;
    this._deathSequenceStarted = true;

    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    npc?.stop();
    const physics = this.getPhysicsEngine();
    if (npc && physics) physics.removeCharacterController(npc);

    // Disable the NPC component entirely so its internal tick can't apply
    // any further velocity to the physics body after death
    if (npc) {
      (npc as unknown as { enabled: boolean }).enabled = false;
    }

    // Capture and freeze position so the zombie doesn't drift during death anim
    const deathPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(deathPos);
    this._deathPosition = deathPos.clone();

    // Play death animation
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.setParameter('state', 'death');
    }

    // At 0.95s (HIT_REACTION_HOLD_SEC), destroy zombie and spawn grave + soul.
    // Cut short before root motion slide starts.
    globalThis.setTimeout(() => {
      this.spawnDeathObjects(deathPos);
      this.destroy();
    }, HIT_REACTION_HOLD_SEC * 1000);
  }

  /**
   * Spawn grave and soul at death position.
   */
  private spawnDeathObjects(deathPos: THREE.Vector3): void {
    const world = this.getWorld();
    if (!world) return;

    const gravePos = deathPos.clone().add(new THREE.Vector3(0, 0.5, 0));
    const grave = DeadGraveActor.create({ position: gravePos });
    world.addActor(grave);

    const soulPos = deathPos.clone().add(new THREE.Vector3(0, 0.8, 0));
    const soul = SoulActor.create({ position: soulPos });
    world.addActor(soul);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private applyDirectSteerChase(): void {
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      useNavigationServer: boolean;
      setTargetPosition: (p: THREE.Vector3, stop?: number) => void;
    } | null;
    if (!npc) return;

    const steerChase = this._hasAggro && !this._attackZoneLatched;
    if (!steerChase) {
      npc.useNavigationServer = true;
      return;
    }

    const w = this.getWorld();
    const player = w?.getFirstPlayerPawn();
    if (!w || !player) {
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

      const rSep = STEER_SEPARATION_RADIUS;
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
        this._steerSep.x += nx * pen * STEER_SEPARATION_WEIGHT;
        this._steerSep.z += nz * pen * STEER_SEPARATION_WEIGHT;
      }
    }

    this._steerGoal.copy(this._steerToPlayer).add(this._steerSep);
    this._steerGoal.y = 0;
    if (this._steerGoal.lengthSq() < 1e-8) {
      this._steerGoal.copy(this._steerToPlayer);
    } else {
      this._steerGoal.normalize();
    }

    this._steerGoal.multiplyScalar(STEER_LOOKAHEAD).add(this._steerMyPos);

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

    this._steerOtherPos.copy(this._steerGoal).sub(this._steerMyPos);
    this._steerOtherPos.y = 0;
    if (this._steerOtherPos.length() < STEER_GOAL_MIN_XY_FROM_AGENT) {
      this._steerGoal
        .copy(this._steerMyPos)
        .addScaledVector(this._steerToPlayer, Math.max(STEER_LOOKAHEAD, STEER_GOAL_MIN_XY_FROM_AGENT));
    }

    npc.setTargetPosition(this._steerGoal, STEER_GOAL_STOP);
  }

  private syncStatsAndMovementFromProperties(): void {
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

    const currentPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(currentPos);
    const movedDist = currentPos.distanceTo(this._lastAnimPosition);
    const wasMoving = this._isActuallyMoving;
    this._isActuallyMoving = movedDist > NewZombieActor.MOVEMENT_THRESHOLD;
    this._lastAnimPosition.copy(currentPos);

    const w = this.getWorld();
    if (w && w.getGameTime() < this._hitAnimEndTime) {
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
  private _flashTimeoutId: ReturnType<typeof globalThis.setTimeout> | null = null;

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
          mat.emissiveIntensity = 1.5;
          return () => { mat.emissive.copy(prevEmissive); mat.emissiveIntensity = prevIntensity; };
        } else if ('color' in mat) {
          const colored = mat as THREE.MeshBasicMaterial;
          const prevColor = colored.color.clone();
          colored.color.setHex(0xffff00);
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

    this._flashTimeoutId = globalThis.setTimeout(() => {
      for (const { restore } of restoreList) {
        restore();
      }
      this._isFlashing = false;
      this._flashTimeoutId = null;
    }, 150);
  }

  // ─── Cleanup ───────────────────────────────────────────────────────────────

  protected override doEndPlay(): void {
    if (this._flashTimeoutId !== null) {
      globalThis.clearTimeout(this._flashTimeoutId);
      this._flashTimeoutId = null;
    }

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
