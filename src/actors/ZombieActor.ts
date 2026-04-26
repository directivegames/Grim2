/**
 * ZombieActor — configurable NPC.
 *
 * Behaviour:
 *  1. Wanders in a small radius when the player is out of aggro range.
 *  2. Once the player enters aggroRadius the zombie locks on and ALWAYS chases
 *     (sticky aggro — never drops). Chase uses direct XZ steer + separation (Vampire Survivors style),
 *     not Recast follow-to-player.
 *  3. When within attackRange (tight, “on top” of player), melee attack + attack anim;
 *    damage comes from MeleeAttackAction only.
 *  4. On death: stops, plays death clip, gets launched, destroyed after 3 s.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';

// ─── Constants ───────────────────────────────────────────────────────────────

const ZOMBIE_NPC_PROFILE = 'ZombieNPC';

const ZOMBIE_MODEL_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Zombie/Meshy_AI_Voxel_Zombie_biped/Meshy_AI_Voxel_Zombie_biped_Meshy_AI_Meshy_Merged_Animations.glb` as ENGINE.ModelPath;
const ZOMBIE_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Zombie/Meshy_AI_Voxel_Zombie_biped/Zombie.anim.json`;

const CAPSULE_RADIUS = 0.35;
const CAPSULE_HEIGHT = 1.75;
/** Chase / follow stop: ~player + zombie capsule radii so kinematic bodies don’t shove the player. */
const ZOMBIE_FOLLOW_HOLD_DISTANCE = 0.82;

/**
 * Extra distance beyond `attackRange` for leaving the “attack” BT branch and for
 * `IsPlayerNear` / melee checks. Stops attack↔chase thrashing (path clears / BT resets)
 * when distance jitters at the boundary.
 */
const ATTACK_ZONE_HYSTERESIS_MARGIN = 0.38;

/** How long (seconds) to hold the hit-reaction anim before locomotion takes back over. */
const HIT_REACTION_HOLD_SEC = 0.95;

/** Speed variance per zombie so the horde staggers (less synchronized blob). */
const SPEED_JITTER_RANGE = 0.8;

/** Vampire Survivors–style chase: XZ seek + separation, no Recast path to the player. */
const STEER_LOOKAHEAD = 3.5;
const STEER_GOAL_STOP = 0.12;
const STEER_SEPARATION_RADIUS = 0.88;
const STEER_SEPARATION_WEIGHT = 2.0;
/** Tight waypoint tolerance; must be less than `STEER_LOOKAHEAD` and less than engine default (3). */
const ZOMBIE_PATH_FOLLOWING_ACCURACY = 0.25;
/** `setPath` drops waypoints closer than `pathFollowingAccuracy` on 3D distance — keep XZ goal beyond that. */
const STEER_GOAL_MIN_XY_FROM_AGENT = ZOMBIE_PATH_FOLLOWING_ACCURACY + 0.1;

// ─── Collision profile (horde: zombies never block each other) ───────────────
// All zombies use object channel `Pawn` with `Pawn → Ignore` so capsule-vs-capsule
// does not depenetrate / shove. Patch existing profile too (hot reload / old data).

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

function patchZombieNpcResponses(profile: ENGINE.CollisionProfile): void {
  const responses = (profile as unknown as { responses: MutableProfileResponses }).responses;
  const set = (channel: ENGINE.CollisionChannel, response: ENGINE.CollisionResponse): void => {
    const ch = channel as unknown as string;
    const i = responses.findIndex(r => r.channel === ch);
    if (i >= 0) responses[i] = { channel: ch, response };
    else responses.push({ channel: ch, response });
  };
  // Ground / props — keep solid
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Block);
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Block);
  // Horde: no pawn-vs-pawn blocking (zombie–zombie; same channel as player Character “ignore pawn”)
  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
}

function ensureZombieNpcCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(ZOMBIE_NPC_PROFILE);
  if (existing) {
    patchZombieNpcResponses(existing);
    return;
  }
  const profile = new ENGINE.CollisionProfile(
    ZOMBIE_NPC_PROFILE,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.Pawn,
    []
  );
  patchZombieNpcResponses(profile);
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

// ─── Sticky-chase condition ───────────────────────────────────────────────────
// Passes once `HasAggro` is true on the blackboard (set the moment the player
// first enters aggroRadius), then passes forever regardless of distance.

class StickyChaseCondition extends ENGINE.ConditionEvaluator {
  constructor(private readonly initialRange: number) {
    super({ name: 'StickyChase' });
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

/**
 * Chase placeholder — locomotion is {@link ZombieActor.applyDirectSteerChase} (no `FollowActorAction` / no nav path to player).
 */
class SteerChaseNoopAction extends ENGINE.BehaviorAction {
  constructor() {
    super({ name: 'SteerChase' });
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

// ─── ZombieActor ─────────────────────────────────────────────────────────────

@ENGINE.GameClass()
export class ZombieActor extends ENGINE.Actor {

  // ── Editor-tunable properties ──────────────────────────────────────────────

  @ENGINE.property({ type: 'number', min: 1, max: 5000, step: 1, category: 'Zombie' })
  public maxHealth: number = 100;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.1, category: 'Zombie' })
  public moveSpeed: number = 3.5;

  /** Distance at which the zombie first spots and locks on to the player. */
  @ENGINE.property({ type: 'number', min: 1, max: 100, step: 0.5, category: 'Zombie' })
  public aggroRadius: number = 15;

  /** 3D root distance at which chase becomes melee (must exceed follow stop so attacks still trigger). */
  @ENGINE.property({ type: 'number', min: 0.35, max: 5, step: 0.05, category: 'Zombie' })
  public attackRange: number = 1.05;

  @ENGINE.property({ type: 'number', min: 0, max: 500, step: 1, category: 'Zombie' })
  public attackDamage: number = 10;

  @ENGINE.property({ type: 'number', min: 0.1, max: 10, step: 0.05, category: 'Zombie' })
  public attackCooldown: number = 0.65;

  @ENGINE.property({ type: 'number', min: 0, max: 30, step: 0.5, category: 'Zombie' })
  public deathLaunchForce: number = 8;

  @ENGINE.property({ type: 'number', min: 2, max: 50, step: 0.5, category: 'Zombie' })
  public wanderRadius: number = 12;

  @ENGINE.property({ type: 'number', min: 0.5, max: 20, step: 0.5, category: 'Zombie' })
  public wanderWaitMin: number = 2;

  @ENGINE.property({ type: 'number', min: 0.5, max: 30, step: 0.5, category: 'Zombie' })
  public wanderWaitMax: number = 5;

  // ── Private state ──────────────────────────────────────────────────────────

  private blackboard: ENGINE.Blackboard | null = null;
  private behaviorRoot: ENGINE.SelectorNode | null = null;
  private animationComponent: ENGINE.AnimationStateMachineComponent | null = null;

  private _hasAggro = false;
  private _deathSequenceStarted = false;
  private _btBusy = false;
  private _btBranch: 'wander' | 'chase' | 'attack' = 'wander';
  /** True while player is inside the attack band (with hysteresis on exit). */
  private _attackZoneLatched = false;
  private _hitAnimEndTime = -Infinity;
  private _lastTrackedHealth = 0;

  /** Effective chase speed (`moveSpeed` ± jitter) — set in `doBeginPlay`. */
  private _jitteredSpeed = 3.5;
  private readonly _steerMyPos = new THREE.Vector3();
  private readonly _steerToPlayer = new THREE.Vector3();
  private readonly _steerSep = new THREE.Vector3();
  private readonly _steerOtherPos = new THREE.Vector3();
  private readonly _steerGoal = new THREE.Vector3();

  // Scratch vectors for death sequence to avoid per-frame allocations
  private readonly _deathScratch = {
    launch: new THREE.Vector3(),
    ownerPos: new THREE.Vector3(),
    playerPos: new THREE.Vector3(),
    flat: new THREE.Vector3(),
  };

  // Performance: throttle separation checks to 20Hz and add broad-phase culling
  private _lastSeparationTime = 0;
  private static readonly SEPARATION_INTERVAL_MS = 50; // 20Hz
  private static readonly MAX_SEPARATION_CHECKS = 8; // Limit per-frame checks

  // Animation desync: track position to detect actual movement
  private _lastAnimPosition = new THREE.Vector3();
  private _isActuallyMoving = false;
  private _animStateChangeTimer = 0;

  // Stuck detection
  private _stuckCheckTimer = 0;
  private _stuckCheckPosition = new THREE.Vector3();
  private _consecutiveStuckChecks = 0;
  private static readonly STUCK_CHECK_INTERVAL = 0.5; // seconds
  private static readonly STUCK_DISTANCE_THRESHOLD = 0.15; // units
  private static readonly STUCK_CONSECUTIVE_THRESHOLD = 2; // checks before unsticking

  // PERFORMANCE: LOD (Level of Detail) settings for large hordes
  private _distanceToPlayer = Infinity;
  private _isHighLOD = true;
  private static readonly HIGH_LOD_DISTANCE = 20; // Units - full detail within this range
  private static readonly MEDIUM_LOD_DISTANCE = 35; // Units - reduced detail
  private _lodLevel: 'high' | 'medium' | 'low' = 'high';

  // PERFORMANCE: Tick staggering - distribute updates across frames
  private _tickOffset = 0;
  private static readonly TICK_INTERVAL = 2; // Update every Nth frame (high LOD)
  private static readonly TICK_INTERVAL_LOW = 4; // Update every Nth frame (low LOD)

  // PERFORMANCE: Throttle expensive systems
  private _btTimer = 0;
  private static readonly BT_UPDATE_INTERVAL = 0.15; // 6.67Hz behavior tree updates
  // FIX: Random initial animation timer to prevent sync
  private _animTimer = Math.random() * 0.1;
  private static readonly ANIM_UPDATE_INTERVAL = 0.1; // 10Hz animation updates
  private _shadowCheckTimer = 0;
  private static readonly SHADOW_CHECK_INTERVAL = 0.5; // Check shadows every 0.5s

  // Individual behavior randomization
  private _individualOffset = Math.random() * 1000; // Unique offset for this zombie
  private _stateChangeTimer = 0;
  private _nextStateChangeTime = 2 + Math.random() * 4; // 2-6 seconds for state changes

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
    this._lastTrackedHealth = current;
  };

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  public override initialize(options?: ActorOptions): void {
    ensureZombieNpcCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      geometry: new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2),
      material: new THREE.MeshStandardMaterial({ visible: false }),
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.KinematicVelocityBased,
        collisionProfile: ZOMBIE_NPC_PROFILE,
      },
    });

    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: ZOMBIE_MODEL_URL,
      rotation: new THREE.Euler(0, Math.PI, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: ZOMBIE_ANIM_URL });
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
      pathFollowingAccuracy: ZOMBIE_PATH_FOLLOWING_ACCURACY,
      actorFollowingDistance: ZOMBIE_FOLLOW_HOLD_DISTANCE,
      stopDistance: ZOMBIE_FOLLOW_HOLD_DISTANCE,
      movementSpeed: this.moveSpeed,
      useNavigationServer: true,
      turnSpeed: 2.5,
      characterControllerOptions: {
        ...ENGINE.CharacterMovementComponent.DEFAULT_CHARACTER_CONTROLLER_OPTIONS,
        simulatedGravityScale: 1.0,
        applyImpulsesToDynamicBodies: false,
        // FIX: Enable sliding so zombies can slide around obstacles when stuck
        slideEnabled: true,
        // FIX: Increase snap distance so zombies reliably snap to ground (was 0.05)
        snapToGroundDistance: 0.3,
        // FIX: Add auto-stepping to help zombies step over small curbs/obstacles
        autoStepConfig: {
          maxHeight: 0.4,
          minWidth: 0.1,
          includeDynamicBodies: false,
        },
      },
    });

    // Stock `NpcMovementComponent.initialize` may not apply accuracy/follow from `create()` — force instance fields.
    (npc as unknown as { pathFollowingAccuracy: number }).pathFollowingAccuracy = ZOMBIE_PATH_FOLLOWING_ACCURACY;
    (npc as unknown as { actorFollowingDistance: number }).actorFollowingDistance = ZOMBIE_FOLLOW_HOLD_DISTANCE;

    root.add(visual);
    root.add(anim);

    super.initialize({ ...options, rootComponent: root, sceneComponents: [stats, npc] });
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();

    // PERFORMANCE: Random tick offset to distribute updates across frames
    this._tickOffset = Math.floor(Math.random() * 100);

    this._jitteredSpeed = this.moveSpeed + (Math.random() - 0.5) * SPEED_JITTER_RANGE;
    const npc = this.getComponent(ENGINE.NpcMovementComponent) as unknown as {
      maxSpeed: number;
      pathFollowingAccuracy: number;
      actorFollowingDistance: number;
    } | null;
    if (npc) {
      npc.maxSpeed = this._jitteredSpeed;
      npc.pathFollowingAccuracy = ZOMBIE_PATH_FOLLOWING_ACCURACY;
      npc.actorFollowingDistance = ZOMBIE_FOLLOW_HOLD_DISTANCE;
    }

    this.syncStatsAndMovementFromProperties();

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      this._lastTrackedHealth = stats.getCurrentHealth();
      stats.onHealthChanged.add(this._onHealthChanged);
    }

    // FIX: Better animation randomization - use the actual animation system
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      // Set random initial state - some idle, some already walking
      const initialState = Math.random() > 0.5 ? 'idle' : 'walk';
      anim.setParameter('state', initialState);

      // Try to offset internal mixer time if accessible
      const anyAnim = anim as unknown as {
        mixer?: { time: number };
        _mixer?: { time: number };
      };
      const mixer = anyAnim.mixer ?? anyAnim._mixer;
      if (mixer) {
        mixer.time = Math.random() * 10; // 0-10 second offset
      }
    }

    // PERFORMANCE: Initialize LOD and position tracking
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      const myPos = new THREE.Vector3();
      this.rootComponent.getWorldPosition(myPos);
      const playerPos = new THREE.Vector3();
      player.rootComponent.getWorldPosition(playerPos);
      this._distanceToPlayer = myPos.distanceTo(playerPos);
      this._updateLODLevel();
    }

    // Initialize stuck detection position
    this.rootComponent.getWorldPosition(this._stuckCheckPosition);

    this.blackboard = new ENGINE.Blackboard(this);
    this.buildBehaviorTree();
    this.behaviorRoot?.initialize(this.blackboard);

    // PERFORMANCE: Register with spatial grid for efficient separation queries
    zombieSpatialManager.registerZombie(this);
  }

  protected override doEndPlay(): void {
    this.getComponent(ENGINE.CharacterStatsComponent)?.onHealthChanged.remove(this._onHealthChanged);

    // PERFORMANCE: Unregister from spatial grid
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

  public override tickPrePhysics(deltaTime: number): void {
    if (this._deathSequenceStarted) {
      super.tickPrePhysics(deltaTime);
      return;
    }

    // PERFORMANCE: Update distance to player for LOD
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      const myPos = new THREE.Vector3();
      this.rootComponent.getWorldPosition(myPos);
      const playerPos = new THREE.Vector3();
      player.rootComponent.getWorldPosition(playerPos);
      this._distanceToPlayer = myPos.distanceTo(playerPos);
      this._updateLODLevel();
    }

    // CRITICAL FIX: Always update blackboard for player detection (not throttled)
    this.blackboard?.updateGameState();

    // CRITICAL FIX: Always check aggro - this must run every frame
    // Sticky aggro: once triggered, never drops
    let justGotAggro = false;
    if (!this._hasAggro && this.blackboard) {
      const dist = this.blackboard.getValue<number>('DistanceToPlayer');
      if (dist !== undefined && dist <= this.aggroRadius) {
        this._hasAggro = true;
        this.blackboard.setValue('HasAggro', true);
        justGotAggro = true; // Mark that we just got aggro
      }
    } else if (this._hasAggro && this.blackboard) {
      this.blackboard.setValue('HasAggro', true);
    }

    // Attack-zone hysteresis: enter at attackRange, leave only past attackRange + margin.
    const distForLatch = this.blackboard?.getValue<number>('DistanceToPlayer');
    if (distForLatch !== undefined) {
      if (distForLatch <= this.attackRange) this._attackZoneLatched = true;
      else if (distForLatch > this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN) {
        this._attackZoneLatched = false;
      }
    }

    // PERFORMANCE: Tick staggering - skip expensive logic on some frames
    const world = this.getWorld();
    const frameCount = world ? (world as unknown as { frameCount?: number }).frameCount ?? 0 : 0;
    const tickInterval = this._isHighLOD ? ZombieActor.TICK_INTERVAL : ZombieActor.TICK_INTERVAL_LOW;
    const shouldUpdate = ((frameCount + this._tickOffset) % tickInterval) === 0;

    // Always update physics and chase movement
    this.applyDirectSteerChase();

    // FIX: Individual idle/wander randomization (prevents all zombies syncing)
    if (!this._hasAggro) {
      this.updateIndividualBehavior(deltaTime);
    }

    // CRITICAL FIX: If we just got aggro, force immediate BT update
    if (justGotAggro) {
      void this.tickBehaviorTreeAsync(deltaTime);
    }

    // ANIMATION: Drive independently of tick stagger so it never gets skipped
    this._animTimer += deltaTime;
    if (this._animTimer >= ZombieActor.ANIM_UPDATE_INTERVAL) {
      this._animTimer = 0;
      if (this._lodLevel === 'high') {
        this.syncAnimationState();
      } else {
        this.syncAnimationStateLowLOD();
      }
    }

    // Tick stagger only applies to expensive systems: BT, shadows, stuck detection
    if (!shouldUpdate) {
      this.updateStuckDetection(deltaTime);
      super.tickPrePhysics(deltaTime);
      return;
    }

    // PERFORMANCE: Throttle behavior tree updates (6.67Hz instead of 60Hz)
    if (!justGotAggro) {
      this._btTimer += deltaTime;
      if (this._btTimer >= ZombieActor.BT_UPDATE_INTERVAL) {
        this._btTimer = 0;
        void this.tickBehaviorTreeAsync(deltaTime);
      }
    }

    // PERFORMANCE: Update shadows periodically
    this._shadowCheckTimer += deltaTime;
    if (this._shadowCheckTimer >= ZombieActor.SHADOW_CHECK_INTERVAL) {
      this._shadowCheckTimer = 0;
      this.updateShadowLOD();
    }

    this.updateStuckDetection(deltaTime);
    super.tickPrePhysics(deltaTime);
  }

  /**
   * PERFORMANCE: Update LOD level based on distance to player.
   */
  private _updateLODLevel(): void {
    if (this._distanceToPlayer <= ZombieActor.HIGH_LOD_DISTANCE) {
      this._lodLevel = 'high';
      this._isHighLOD = true;
    } else if (this._distanceToPlayer <= ZombieActor.MEDIUM_LOD_DISTANCE) {
      this._lodLevel = 'medium';
      this._isHighLOD = false;
    } else {
      this._lodLevel = 'low';
      this._isHighLOD = false;
    }
  }

  /**
   * PERFORMANCE: Simple animation for low LOD - just idle/walk based on velocity.
   * Uses individual timing to prevent synchronization.
   * CRITICAL FIX: Never shows idle when _hasAggro is true.
   */
  private syncAnimationStateLowLOD(): void {
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (!anim?.isReady()) return;

    // Keep _isActuallyMoving up to date for low-LOD zombies too
    const currentPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(currentPos);
    this._isActuallyMoving = currentPos.distanceTo(this._lastAnimPosition) > 0.008;
    this._lastAnimPosition.copy(currentPos);

    // CRITICAL FIX: Check _hasAggro FIRST - never idle when chasing
    if (this._hasAggro) {
      const dist = this.blackboard?.getValue<number>('DistanceToPlayer');
      const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;

      if (dist !== undefined && dist <= engage) {
        anim.setParameter('state', 'attack');
      } else {
        anim.setParameter('state', 'walk');  // Always walk when aggro
      }
      return;
    }

    // Mirror the high-LOD logic: walk only if actually moving, otherwise idle
    anim.setParameter('state', this._isActuallyMoving ? 'walk' : 'idle');
  }

  /**
   * PERFORMANCE: Distance-based shadow casting.
   */
  private updateShadowLOD(): void {
    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) return;

    // Only cast shadows if close to player
    const shouldCastShadow = this._distanceToPlayer < ZombieActor.HIGH_LOD_DISTANCE;
    visual.castShadow = shouldCastShadow;
  }

  /**
   * Detects and auto-resolves stuck zombies.
   * Zombies are considered stuck if they should move but haven't moved much over multiple checks.
   */
  private updateStuckDetection(deltaTime: number): void {
    if (this._deathSequenceStarted) return;

    this._stuckCheckTimer += deltaTime;
    if (this._stuckCheckTimer < ZombieActor.STUCK_CHECK_INTERVAL) return;

    this._stuckCheckTimer = 0;

    const currentPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(currentPos);
    const movedDist = currentPos.distanceTo(this._stuckCheckPosition);

    // Check if zombie should be moving
    const shouldBeMoving = this._hasAggro || this._btBranch === 'wander';

    if (shouldBeMoving && movedDist < ZombieActor.STUCK_DISTANCE_THRESHOLD) {
      this._consecutiveStuckChecks++;

      if (this._consecutiveStuckChecks >= ZombieActor.STUCK_CONSECUTIVE_THRESHOLD) {
        console.log(`[Zombie ${this.uuid.substring(0, 6)}] Stuck detected (moved ${movedDist.toFixed(3)} in ${(ZombieActor.STUCK_CHECK_INTERVAL * ZombieActor.STUCK_CONSECUTIVE_THRESHOLD).toFixed(1)}s), attempting unstuck...`);
        this.attemptUnstuck();
        this._consecutiveStuckChecks = 0;
      }
    } else {
      // Reset counter if moved enough or shouldn't be moving
      this._consecutiveStuckChecks = 0;
    }

    this._stuckCheckPosition.copy(currentPos);
  }

  /**
   * Attempts to unstick the zombie by resetting movement and nudging position.
   */
  private attemptUnstuck(): void {
    const npc = this.getComponent(ENGINE.NpcMovementComponent);
    if (!npc) return;

    // Stop current movement to clear any stuck path
    npc.stop();

    // Reset the navigation server flag to allow fresh path calculation
    const navComponent = npc as unknown as { useNavigationServer: boolean };
    if (navComponent.useNavigationServer !== undefined) {
      const currentNavSetting = navComponent.useNavigationServer;
      navComponent.useNavigationServer = true;

      // If we were chasing, temporarily switch to nav-based for one frame to recalculate
      if (this._hasAggro && !this._attackZoneLatched) {
        // Force a position nudge in a random direction to break out of collision
        const nudgeDir = new THREE.Vector3(
          (Math.random() - 0.5) * 2,
          0,
          (Math.random() - 0.5) * 2
        ).normalize().multiplyScalar(0.5);

        const newPos = this.rootComponent.position.clone().add(nudgeDir);
        this.rootComponent.position.copy(newPos);

        // Re-enable direct steering on next frame
        setTimeout(() => {
          if (!this._deathSequenceStarted) {
            navComponent.useNavigationServer = currentNavSetting;
          }
        }, 50);
      }
    }

    // Reset separation timer to force fresh neighbor check
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

    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    anim?.isReady() && anim.setParameter('state', 'death');

    const root = this.rootComponent as ENGINE.MeshComponent;
    root.overridePhysicsOptions({
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.Dynamic,
      gravityScale: 1,
      collisionProfile: ENGINE.DefaultCollisionProfile.Ragdoll,
    });

    // Launch away from player using pre-allocated scratch vectors
    const s = this._deathScratch;
    s.launch.set(0, 0.55, 0);
    this.rootComponent.getWorldPosition(s.ownerPos);
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      player.rootComponent.getWorldPosition(s.playerPos);
      s.flat.copy(s.ownerPos).sub(s.playerPos);
      s.flat.y = 0;
      if (s.flat.lengthSq() > 1e-6) {
        s.flat.normalize().multiplyScalar(0.65);
        s.launch.add(s.flat);
      }
    }
    s.launch.multiplyScalar(this.deathLaunchForce);
    root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [s.launch.x, s.launch.y, s.launch.z]);

    globalThis.setTimeout(() => this.destroy(), 3000);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Seek player on XZ + light separation from other zombies; `useNavigationServer` off during chase
   * so movement is a straight steer goal (Vampire Survivors style, avoids paired nav follow rubber-banding).
   *
   * PERFORMANCE: Separation is throttled to 20Hz with broad-phase culling to avoid O(n²) costs.
   */
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

    // PERFORMANCE: Throttle separation checks to 20Hz instead of every frame
    // PERFORMANCE: Use spatial grid instead of scanning all actors (O(1) vs O(n))
    this._steerSep.set(0, 0, 0);
    const now = performance.now();
    if (now - this._lastSeparationTime >= ZombieActor.SEPARATION_INTERVAL_MS) {
      this._lastSeparationTime = now;

      // Update position in spatial grid periodically
      zombieSpatialManager.updateZombiePosition(this);

      const rSep = STEER_SEPARATION_RADIUS;
      const rSepSq = rSep * rSep;

      // PERFORMANCE: Spatial grid lookup - only gets zombies in nearby cells
      const nearbyZombies = zombieSpatialManager.getNearbyZombies(this._steerMyPos, rSep);

      let checksPerformed = 0;
      for (const z of nearbyZombies) {
        if (checksPerformed >= ZombieActor.MAX_SEPARATION_CHECKS) break;
        if (z === this || z._deathSequenceStarted) continue;

        z.rootComponent.getWorldPosition(this._steerOtherPos);

        // Broad-phase AABB cull before expensive distance calculation
        const dx = this._steerMyPos.x - this._steerOtherPos.x;
        const dz = this._steerMyPos.z - this._steerOtherPos.z;
        if (Math.abs(dx) > rSep || Math.abs(dz) > rSep) continue; // Outside bounding box

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
      npc.pathFollowingAccuracy = ZOMBIE_PATH_FOLLOWING_ACCURACY;
      npc.actorFollowingDistance = ZOMBIE_FOLLOW_HOLD_DISTANCE;
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
      conditions: [new StickyChaseCondition(this.aggroRadius)],
      children: [new SteerChaseNoopAction()],
    });

    const wander = new ENGINE.WanderAction({
      wanderRadius: this.wanderRadius,
      minWaitTime: this.wanderWaitMin,
      maxWaitTime: this.wanderWaitMax,
    });

    this.behaviorRoot = new ENGINE.SelectorNode({
      name: 'ZombieRoot',
      children: [attackSequence, chaseSequence, wander],
    });
  }

  private async tickBehaviorTreeAsync(deltaTime: number): Promise<void> {
    if (!this.behaviorRoot || !this.blackboard || this._btBusy) return;

    let desired: 'wander' | 'chase' | 'attack';
    if (this._attackZoneLatched) desired = 'attack';
    else if (this._hasAggro) desired = 'chase';
    else desired = 'wander';

    // When priority branch changes, reset so the SelectorNode re-evaluates from child 0.
    if (desired !== this._btBranch) {
      this.behaviorRoot.reset();
      this._btBranch = desired;
    }

    this._btBusy = true;
    try {
      const status = await this.behaviorRoot.execute(this.blackboard, deltaTime);
      if (status !== ENGINE.BehaviorStatus.Running) {
        this.behaviorRoot.reset();
        // Do not force `wander` after a finished attack — that caused a full-tree reset
        // every tick while still in range and broke repeat melee. Match real priority.
        if (this._attackZoneLatched) this._btBranch = 'attack';
        else if (this._hasAggro) this._btBranch = 'chase';
        else this._btBranch = 'wander';
      }
    } catch (e) {
      console.error('[ZombieActor] BT error', e);
      this.behaviorRoot.reset();
      this._btBranch = 'wander';
    } finally {
      this._btBusy = false;
    }
  }

  private syncAnimationState(): void {
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (!anim?.isReady()) return;

    // Track actual movement for animation state
    const currentPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(currentPos);
    const movedDist = currentPos.distanceTo(this._lastAnimPosition);
    this._isActuallyMoving = movedDist > 0.008; // Moved more than ~0.8cm since last frame
    this._lastAnimPosition.copy(currentPos);

    // Hit-reaction takes priority for its duration
    const w = this.getWorld();
    if (w && w.getGameTime() < this._hitAnimEndTime) {
      anim.setParameter('state', 'hit');
      return;
    }

    const dist = this.blackboard?.getValue<number>('DistanceToPlayer');
    const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;
    let state: 'idle' | 'walk' | 'attack';

    // CRITICAL FIX: If has aggro, NEVER show idle - always walk (or attack if close)
    if (this._hasAggro) {
      // Has aggro - check if close enough to attack
      if (dist !== undefined && dist <= engage) {
        state = 'attack';
      } else {
        state = 'walk';  // Always walk when chasing, even if not moving much
      }
    } else if (dist !== undefined && dist <= this.aggroRadius) {
      // Just spotted player but hasn't locked aggro yet
      state = 'walk';
    } else if (this._isActuallyMoving) {
      // Wandering and moving
      state = 'walk';
    } else {
      // Truly idle
      state = 'idle';
    }

    anim.setParameter('state', state);
  }

  /**
   * FIX: Individual idle/walk randomization to prevent synchronization.
   * Some zombies idle, some wander, with different timing per zombie.
   */
  private updateIndividualBehavior(deltaTime: number): void {
    if (this._hasAggro) return; // Only when not chasing

    this._stateChangeTimer += deltaTime;
    if (this._stateChangeTimer >= this._nextStateChangeTime) {
      this._stateChangeTimer = 0;
      // Random next change time (3-8 seconds)
      this._nextStateChangeTime = 3 + Math.random() * 5;

      // Randomly decide to idle or wander (only if using navigation)
      const npc = this.getComponent(ENGINE.NpcMovementComponent);
      if (npc) {
        const shouldWander = Math.random() > 0.3; // 70% chance to wander, 30% idle
        if (!shouldWander) {
          npc.stop(); // Stop and idle for a while
        }
      }
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
