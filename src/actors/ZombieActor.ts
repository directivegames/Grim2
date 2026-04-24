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
        slideEnabled: false,
        snapToGroundDistance: 0.05,
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

    this.blackboard = new ENGINE.Blackboard(this);
    this.buildBehaviorTree();
    this.behaviorRoot?.initialize(this.blackboard);
  }

  protected override doEndPlay(): void {
    this.getComponent(ENGINE.CharacterStatsComponent)?.onHealthChanged.remove(this._onHealthChanged);
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

    // Keep blackboard fresh (updates DistanceToPlayer, PlayerActor, SelfPosition)
    this.blackboard?.updateGameState();

    // Sticky aggro: once triggered, never drops
    if (!this._hasAggro && this.blackboard) {
      const dist = this.blackboard.getValue<number>('DistanceToPlayer');
      if (dist !== undefined && dist <= this.aggroRadius) {
        this._hasAggro = true;
        this.blackboard.setValue('HasAggro', true);
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

    void this.tickBehaviorTreeAsync(deltaTime);
    this.applyDirectSteerChase();
    this.syncAnimationState();
    super.tickPrePhysics(deltaTime);
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

    // Launch away from player
    const launch = new THREE.Vector3(0, 0.55, 0);
    const ownerPos = new THREE.Vector3();
    this.rootComponent.getWorldPosition(ownerPos);
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      const pp = new THREE.Vector3();
      player.rootComponent.getWorldPosition(pp);
      const flat = ownerPos.clone().sub(pp);
      flat.y = 0;
      if (flat.lengthSq() > 1e-6) launch.add(flat.normalize().multiplyScalar(0.65));
    }
    launch.multiplyScalar(this.deathLaunchForce);
    root.setPhysicsVectorParam(ENGINE.PhysicsVectorParam.LinearVelocity, [launch.x, launch.y, launch.z]);

    globalThis.setTimeout(() => this.destroy(), 3000);
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  /**
   * Seek player on XZ + light separation from other zombies; `useNavigationServer` off during chase
   * so movement is a straight steer goal (Vampire Survivors style, avoids paired nav follow rubber-banding).
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

    this._steerSep.set(0, 0, 0);
    const rSep = STEER_SEPARATION_RADIUS;
    const rSepSq = rSep * rSep;
    const others = w.getActors(ZombieActor);
    for (let i = 0; i < others.length; i++) {
      const z = others[i];
      if (z === this || z._deathSequenceStarted) continue;
      z.rootComponent.getWorldPosition(this._steerOtherPos);
      let dx = this._steerMyPos.x - this._steerOtherPos.x;
      let dz = this._steerMyPos.z - this._steerOtherPos.z;
      const dsq = dx * dx + dz * dz;
      if (dsq >= rSepSq || dsq < 1e-10) continue;
      const d = Math.sqrt(dsq);
      dx /= d;
      dz /= d;
      const pen = rSep - d;
      this._steerSep.x += dx * pen * STEER_SEPARATION_WEIGHT;
      this._steerSep.z += dz * pen * STEER_SEPARATION_WEIGHT;
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

    // Hit-reaction takes priority for its duration
    const w = this.getWorld();
    if (w && w.getGameTime() < this._hitAnimEndTime) {
      anim.setParameter('state', 'hit');
      return;
    }

    const dist = this.blackboard?.getValue<number>('DistanceToPlayer');

    if (dist === undefined) {
      anim.setParameter('state', 'idle');
      return;
    }

    const engage = this.attackRange + ATTACK_ZONE_HYSTERESIS_MARGIN;
    let state: 'idle' | 'walk' | 'attack';
    if (dist <= engage) {
      state = 'attack';
    } else if (this._hasAggro || dist <= this.aggroRadius) {
      state = 'walk';
    } else {
      state = 'idle';
    }
    anim.setParameter('state', state);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Pawn';
  }
}
