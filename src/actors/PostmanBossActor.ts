/**
 * PostmanBossActor — bullet-hell boss for "The Postman Comes" missions.
 *
 * Place **one** PostmanBossActor in the scene at the desired position/scale.
 * Optional: place a hidden PostmanBulletActor in the scene to define demonletter scale.
 * Activates when a boss-fight mission starts; stays hidden otherwise.
 *
 * Animation mapping (GLB clips → state machine states):
 *   idle    → "air_squat"
 *   walk    → "run_fast_3_inplace"
 *   attack  → "magic_soell_cast"
 *   death   → "Shot_and_Fall_Backward"
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions, DamageHitInfo } from '@gnsx/genesys.js';
import {
  POSTMAN_BOSS_BASE_BULLET_DAMAGE,
  POSTMAN_BOSS_BASE_BULLET_SPEED,
  POSTMAN_BOSS_BASE_HEALTH,
  POSTMAN_BOSS_BASE_MOVE_SPEED,
} from '../data/combat-balance.js';
import type { RiskLevel } from '../data/risk-levels.js';
import { computeRisk5PlusScaling } from '../game/risk5-plus.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';
import { PostmanBulletActor } from './PostmanBulletActor.js';
import { BlobShadowComponent } from '../components/vfx/BlobShadowComponent.js';
import {
  pickRandomPostmanVoiceLine,
  rollPostmanVoiceIntervalSec,
} from '../data/postman-voice-lines.js';
import { awardSoulFromEnemyKill } from '../utils/award-soul.js';
import { getGameAudioManager } from '../utils/game-audio.js';
import { isGameplayUnlocked } from '../utils/game-pause.js';
import { getUnscaledDeltaTime } from '../utils/slomo-time.js';
import { destroyActorWhenGltfIdle } from '../utils/safe-actor-destroy.js';
import {
  snapPositionToNavFloor,
  type NavMeshQuery,
} from '../mission/innocent-spawn-position.js';
import {
  buildPostmanWalkTiles,
  pickPostmanWalkPoint,
  type PostmanWalkTile,
} from '../game/postman-road-waypoints.js';

export const POSTMAN_BOSS_MODEL_URL =
  '@project/assets/models/Thepostman2.glb' as ENGINE.ModelPath;
const POSTMAN_BOSS_ANIM_URL =
  `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Postman.animconfig.json`;

const CAPSULE_RADIUS = 0.55;
const CAPSULE_HEIGHT = 2.1;
const BLOB_SHADOW_FEET_Y = 0.02;

const SHARED_ROOT_GEOMETRY = new THREE.CapsuleGeometry(CAPSULE_RADIUS, CAPSULE_HEIGHT - CAPSULE_RADIUS * 2);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

const INTRO_IDLE_SEC = 0.8;
const MOVE_ARRIVE_DIST = 1.2;
/** Just above walkable floor — matches scene PostmanBulletActor reference height (~0.1). */
const BULLET_GROUND_Y_OFFSET = 0.01;
const POSTMAN_BOSS_MUZZLE_FORWARD = 0.4;
/** Root Y offset so capsule feet sit on nav floor — mirrors NewZombieActor spawn. */
export const POSTMAN_BOSS_CAPSULE_HALF_HEIGHT = CAPSULE_HEIGHT * 0.5;

/** Breathing room between pattern bursts. */
const IDLE_BEAT_SEC = 1.35;
const MOVE_BEAT_MAX_SEC = 3.5;
/** #4 Aimed shot burst */
const AIMED_BURST_SHOTS = 4;
const AIMED_BURST_GAP_SEC = 0.38;
/** #3 Double spiral — slow rotation, wide gaps between shots */
const DOUBLE_SPIRAL_DURATION_SEC = 2.8;
const DOUBLE_SPIRAL_FIRE_INTERVAL_SEC = 0.2;
const DOUBLE_SPIRAL_ANGLE_STEP = 0.11;
/** #6 Spread / fan — three readable waves */
const SPREAD_FAN_WAVES = 3;
const SPREAD_FAN_WAVE_GAP_SEC = 0.8;
/** #8 Ring with pause between outer (slow) and inner (fast) */
const DELAYED_RING_PAUSE_SEC = 1.45;
const DELAYED_RING_OUTER_SPEED = 0.58;
const DELAYED_RING_INNER_SPEED = 0.95;
/** #22 Safe lane ring — gap positions rotate each use */
const SAFE_LANE_RING_SLOTS = 10;
const SAFE_LANE_GAP_WIDTH = 3;
const SAFE_LANE_ROTATION_STEP = 0.32;
/** Below this XZ speed we treat the boss as stationary (attack anim). */
const STATIONARY_MOVE_THRESHOLD = 0.35;

type BossAiState = 'dormant' | 'intro' | 'combat';
type CombatBeat = 'attack' | 'idle' | 'move';

/** Fixed loop — no chained attacks; clear dodge windows between bursts. */
const COMBAT_CYCLE: readonly CombatBeat[] = [
  'attack',
  'idle',
  'attack',
  'move',
  'attack',
  'idle',
  'move',
  'attack',
];
type PatternId =
  | 'aimedBurst'
  | 'doubleSpiral'
  | 'spreadFan'
  | 'delayedRing'
  | 'safeLaneRing';

interface PostmanRiskTuning {
  maxHealth: number;
  bulletSpeed: number;
  patternBulletCount: number;
  cooldownSec: number;
  moveSpeed: number;
  bulletDamage: number;
}

const RISK_TUNING: Record<RiskLevel, PostmanRiskTuning> = {
  1: { maxHealth: 600, bulletSpeed: 12, patternBulletCount: 5, cooldownSec: 2.8, moveSpeed: 2.2, bulletDamage: 16 },
  2: { maxHealth: 800, bulletSpeed: 13, patternBulletCount: 6, cooldownSec: 2.5, moveSpeed: 2.5, bulletDamage: 18 },
  3: { maxHealth: 1100, bulletSpeed: 14, patternBulletCount: 7, cooldownSec: 2.0, moveSpeed: 2.8, bulletDamage: 20 },
  4: { maxHealth: 1500, bulletSpeed: 15, patternBulletCount: 8, cooldownSec: 1.5, moveSpeed: 3.1, bulletDamage: 23 },
  5: { maxHealth: 2200, bulletSpeed: 16, patternBulletCount: 9, cooldownSec: 1.0, moveSpeed: 3.5, bulletDamage: 26 },
};

function tuningForRisk(risk: RiskLevel, risk5PlusTier = 0): PostmanRiskTuning {
  const base = RISK_TUNING[risk] ?? RISK_TUNING[2];
  if (risk5PlusTier <= 0) {
    return base;
  }

  const scale = computeRisk5PlusScaling(risk5PlusTier - 1);
  return {
    maxHealth: Math.round(base.maxHealth * scale.healthMult),
    bulletSpeed: base.bulletSpeed * (1 + Math.min(risk5PlusTier * 0.02, 0.25)),
    patternBulletCount: Math.min(12, base.patternBulletCount + Math.floor(risk5PlusTier / 3)),
    cooldownSec: Math.max(0.65, base.cooldownSec * scale.waveIntervalMult),
    moveSpeed: base.moveSpeed * (1 + Math.min(risk5PlusTier * 0.015, 0.2)),
    bulletDamage: Math.round(base.bulletDamage * scale.damageMult),
  };
}

@ENGINE.GameClass()
export class PostmanBossActor extends ENGINE.Actor {
  public onDied: (() => void) | null = null;
  public onHealthChanged: ((current: number, max: number) => void) | null = null;

  private _aiState: BossAiState = 'dormant';
  private _deathSequenceStarted = false;
  private _bossActive = false;
  /** Armed for a boss mission but kept hidden until gameplay unlocks (Ready To Reap done). */
  private _awaitingReveal = false;

  private _bulletSpeed = POSTMAN_BOSS_BASE_BULLET_SPEED;
  private _bulletDamage = POSTMAN_BOSS_BASE_BULLET_DAMAGE;
  private _moveSpeed = POSTMAN_BOSS_BASE_MOVE_SPEED;
  private _patternBulletCount = 8;
  private _fightMaxHealth = POSTMAN_BOSS_BASE_HEALTH;

  private _cycleIndex = 0;
  private _beatTimer = 0;
  private _stateTimer = 0;
  private _patternId: PatternId | null = null;
  private _patternTimer = 0;
  private _patternStep = 0;
  /** Rotating arm angle for double-spiral. */
  private _spiralAngle = 0;
  /** Rotating gap placement for safe-lane ring. */
  private _safeLaneGapAngle = 0;
  /** Shot cadence accumulator for double-spiral only. */
  private _spiralShotClock = 0;
  private _spatialUpdateTimer = 0;
  private _voiceCooldownSec = 4;

  private _walkTiles: PostmanWalkTile[] = [];

  private animationComponent: ENGINE.AnimationStateMachineComponent | null = null;
  private _visualMesh: ENGINE.GLTFMeshComponent | null = null;
  /** Pivot between root and GLTF — only this node yaws for facing. */
  private _facingPivot: ENGINE.SceneComponent | null = null;
  /** World travel yaw (radians); matches player pawn atan2(x, z). */
  private _facingYaw = 0;
  private _animationInitialized = false;
  private _animInitTimer = 0;
  private static readonly ANIM_INIT_TIMEOUT = 8.0;
  /** Editor-placed world position — restored between mission attempts. */
  private _scenePlacementPosition: THREE.Vector3 | null = null;
  private _scenePlacementYaw = 0;

  private _isFlashing = false;
  private _flashRemainingSec = 0;
  private _flashRestoreFns: Array<() => void> = [];

  private readonly _myPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();
  private readonly _muzzlePos = new THREE.Vector3();
  private readonly _flatDir = new THREE.Vector3();
  private readonly _moveGoal = new THREE.Vector3();

  private readonly _onHealthChanged = (current: number, max: number): void => {
    this.onHealthChanged?.(current, max);
    if (current <= 0 && !this._deathSequenceStarted) {
      this.handleDeath();
    }
  };

  public override initialize(options?: ActorOptions): void {
    const root = ENGINE.MeshComponent.create({
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: { enabled: false },
    });

    const pivot = ENGINE.SceneComponent.create({
      position: new THREE.Vector3(0, CAPSULE_HEIGHT * 0.5, 0),
    });

    this._visualMesh = ENGINE.GLTFMeshComponent.create({
      modelUrl: POSTMAN_BOSS_MODEL_URL,
      position: new THREE.Vector3(0, -CAPSULE_HEIGHT * 0.5, 0),
      rotation: new THREE.Euler(0, 0, 0),
      physicsOptions: { enabled: false },
      castShadow: true,
      receiveShadow: false,
    });

    const anim = ENGINE.AnimationStateMachineComponent.create({ configUrl: POSTMAN_BOSS_ANIM_URL });
    this.animationComponent = anim;

    const stats = ENGINE.CharacterStatsComponent.create({
      maxHealth: POSTMAN_BOSS_BASE_HEALTH,
      healthRegen: 0,
      attackCooldown: 1,
      attackRange: 2,
      attackDamage: 0,
      speed: this._moveSpeed,
    });

    pivot.add(this._visualMesh);
    pivot.add(anim);
    root.add(pivot);
    this._facingPivot = pivot;

    const shadow = BlobShadowComponent.create({
      radius: 0.7,
      opacity: 0.35,
      yOffset: BLOB_SHADOW_FEET_Y,
    });
    root.add(shadow);

    super.initialize({ ...options, rootComponent: root, sceneComponents: [stats] });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    stats?.onHealthChanged.add(this._onHealthChanged);

    if (!this._visualMesh) {
      this._visualMesh = this.getComponent(ENGINE.GLTFMeshComponent);
    }
    if (!this.animationComponent) {
      this.animationComponent = this.getComponent(ENGINE.AnimationStateMachineComponent);
    }

    this._syncVisualFacingOffset();
    const visual = this._visualMesh ?? this.getComponent(ENGINE.GLTFMeshComponent);
    if (visual && !visual.isModelLoaded()) {
      void visual.waitForLoad().then(() => {
        this._syncAnimState('idle');
      }).catch(() => {
        console.warn('[PostmanBossActor] Failed to load Thepostman.glb');
      });
    }

    this.rootComponent.getWorldPosition(this._myPos);
    if (!this._scenePlacementPosition) {
      this._scenePlacementPosition = this._myPos.clone();
      const pivot = this._facingPivot;
      this._scenePlacementYaw =
        pivot && pivot !== this.rootComponent ? pivot.rotation.y : this.rootComponent.rotation.y;
    }

    this._enterDormant();
    return true;
  }

  /** Return boss to editor placement and dormant state between missions. */
  public resetToScenePlacement(): void {
    if (!this._scenePlacementPosition) {
      return;
    }

    this._deathSequenceStarted = false;
    this.deactivateBossFight();

    this.rootComponent.position.copy(this._scenePlacementPosition);
    this.rootComponent.rotation.y = 0;

    const pivot = this._facingPivot;
    if (pivot && pivot !== this.rootComponent) {
      pivot.rotation.y = this._scenePlacementYaw;
    } else {
      this.rootComponent.rotation.y = this._scenePlacementYaw;
    }
    this._facingYaw = this._scenePlacementYaw;
    this._syncVisualFacingOffset();

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.setMaxHealth(POSTMAN_BOSS_BASE_HEALTH);
      stats.heal(POSTMAN_BOSS_BASE_HEALTH);
    }

    this._setAnimState('idle');
    this.setHiddenInGame(true);
  }

  public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    stats?.onHealthChanged.remove(this._onHealthChanged);
    if (this._bossActive) {
      zombieSpatialManager.unregisterZombie(this);
    }
    return true;
  }

  /** Find scene boss or spawn fallback, then start the fight. */
  public static activateForMission(
    world: ENGINE.World,
    riskLevel: RiskLevel,
    onDied: () => void,
    risk5PlusTier = 0,
  ): PostmanBossActor | null {
    for (const actor of world.getActors()) {
      if (actor instanceof PostmanBossActor) {
        actor._beginBossFight(riskLevel, onDied, risk5PlusTier);
        return actor;
      }
    }

    const boss = PostmanBossActor.create({ name: 'PostmanBoss' });
    const player = world.getFirstPlayerPawn();
    const spawn = new THREE.Vector3(0, 0, -8);
    if (player) {
      player.rootComponent.getWorldPosition(spawn);
      spawn.z -= 8;
    }
    boss.rootComponent.position.copy(spawn);
    world.addActor(boss);
    boss._beginBossFight(riskLevel, onDied, risk5PlusTier);
    return boss;
  }

  /** Show the boss and register combat — call when Ready To Reap / intro finishes. */
  public revealForCombat(): void {
    if (!this._bossActive || !this._awaitingReveal || this._deathSequenceStarted) {
      return;
    }

    this._awaitingReveal = false;
    this.setHiddenInGame(false);
    zombieSpatialManager.registerZombie(this);
    this.onHealthChanged?.(this._fightMaxHealth, this._fightMaxHealth);
  }

  public deactivateBossFight(): void {
    if (!this._bossActive && !this._awaitingReveal) {
      return;
    }

    const world = this.getWorld();
    if (world) {
      PostmanBulletActor.destroyAllRuntime(world);
    }

    this._enterDormant();
  }

  private _beginBossFight(
    riskLevel: RiskLevel,
    onDied: () => void,
    risk5PlusTier = 0,
  ): void {
    const tuning = tuningForRisk(riskLevel, risk5PlusTier);
    this._fightMaxHealth = tuning.maxHealth;
    this.onDied = onDied;
    this._bulletSpeed = tuning.bulletSpeed;
    this._bulletDamage = tuning.bulletDamage;
    this._moveSpeed = tuning.moveSpeed;
    this._patternBulletCount = tuning.patternBulletCount;

    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (stats) {
      stats.setMaxHealth(tuning.maxHealth);
      stats.heal(tuning.maxHealth);
    }

    this._snapBossToNavFloor();
    this.rootComponent.getWorldPosition(this._myPos);

    const world = this.getWorld();
    if (world) {
      this._walkTiles = buildPostmanWalkTiles(world);
    }

    this._prepareForFreeMovement();

    this._bossActive = true;
    this._awaitingReveal = true;
    this._deathSequenceStarted = false;
    this._aiState = 'intro';
    this._stateTimer = INTRO_IDLE_SEC;
    this._patternId = null;
    this._patternStep = 0;
    this._patternTimer = 0;
    this._cycleIndex = 0;
    this._beatTimer = 0;
    this._spiralAngle = 0;
    this._spiralShotClock = 0;
    this._voiceCooldownSec = 3 + Math.random() * 4;

    this.setHiddenInGame(true);
    this._setAnimState('idle');
  }

  private _enterDormant(): void {
    this._bossActive = false;
    this._awaitingReveal = false;
    this._aiState = 'dormant';
    this._patternId = null;
    this._patternStep = 0;
    this._patternTimer = 0;
    this._cycleIndex = 0;
    this._beatTimer = 0;
    this.onDied = null;

    if (!this._deathSequenceStarted) {
      zombieSpatialManager.unregisterZombie(this);
      this.setHiddenInGame(true);
    }
  }

  public override tickPrePhysics(deltaTime: number): void {
    const world = this.getWorld();
    const dt = world ? getUnscaledDeltaTime(world, deltaTime) : deltaTime;
    super.tickPrePhysics(deltaTime);

    this._tickAnimationInit(dt);
    this._tickFlash(dt);

    if (!this._bossActive || this._awaitingReveal || this._deathSequenceStarted) return;
    if (!isGameplayUnlocked()) return;

    this._tickBossVoice(dt);

    this._spatialUpdateTimer += dt;
    if (this._spatialUpdateTimer >= 0.5) {
      this._spatialUpdateTimer = 0;
      zombieSpatialManager.updateZombiePosition(this);
    }

    switch (this._aiState) {
      case 'intro':
        this._tickIntro(dt);
        break;
      case 'combat':
        this._tickCombat(dt);
        break;
      default:
        break;
    }
  }

  public override tickPostPhysics(deltaTime: number): void {
    super.tickPostPhysics(deltaTime);
    if (!this._bossActive || this._awaitingReveal || this._deathSequenceStarted) return;
    if (!isGameplayUnlocked()) return;

    if (this._aiState === 'intro' || this._aiState === 'combat') {
      this._enforceFacing();
    }
  }

  /** Re-apply facing after animation/movement so rotation is not overwritten. */
  private _enforceFacing(): void {
    if (this._aiState === 'intro') {
      this._facePlayer();
      return;
    }

    const beat = COMBAT_CYCLE[this._cycleIndex];
    if (beat === 'move') {
      this.rootComponent.getWorldPosition(this._myPos);
      const dx = this._moveGoal.x - this._myPos.x;
      const dz = this._moveGoal.z - this._myPos.z;
      if (dx * dx + dz * dz > 1e-8) {
        this._applyFacingFromDirection(dx, dz);
        return;
      }
    }

    this._facePlayer();
  }

  private _tickBossVoice(dt: number): void {
    const world = this.getWorld();
    if (!world) return;

    this._voiceCooldownSec -= dt;
    if (this._voiceCooldownSec > 0) return;

    getGameAudioManager(world).play(pickRandomPostmanVoiceLine(), 1.0, true);
    this._voiceCooldownSec = rollPostmanVoiceIntervalSec();
  }

  private _tickIntro(dt: number): void {
    this._stateTimer -= dt;
    this._facePlayer();
    this._setAnimState('idle');
    if (this._stateTimer <= 0) {
      this._startCombat();
    }
  }

  private _startCombat(): void {
    this._aiState = 'combat';
    this._cycleIndex = 0;
    this._setupCombatBeat();
  }

  private _tickCombat(dt: number): void {
    const beat = COMBAT_CYCLE[this._cycleIndex];
    if (!beat) {
      this._startCombat();
      return;
    }

    switch (beat) {
      case 'attack':
        this._tickCombatAttackBeat(dt);
        break;
      case 'idle':
        this._tickCombatIdleBeat(dt);
        break;
      case 'move':
        this._tickCombatMoveBeat(dt);
        break;
    }
  }

  private _setupCombatBeat(): void {
    const beat = COMBAT_CYCLE[this._cycleIndex];
    this._patternId = null;
    this._patternTimer = 0;
    this._patternStep = 0;
    this._beatTimer = 0;
    this._spiralAngle = 0;
    this._safeLaneGapAngle = 0;
    this._spiralShotClock = 0;

    if (beat === 'attack') {
      this._patternId = this._pickPattern();
      if (this._patternId === 'spreadFan') {
        this._patternStep = -1;
      }
    } else if (beat === 'idle') {
      this._beatTimer = IDLE_BEAT_SEC;
    } else if (beat === 'move') {
      this._beatTimer = MOVE_BEAT_MAX_SEC;
      this._pickRoadWaypoint();
    }
  }

  private _advanceCombatCycle(): void {
    this._cycleIndex = (this._cycleIndex + 1) % COMBAT_CYCLE.length;
    this._setupCombatBeat();
  }

  /** One pattern burst while standing still — then mandatory idle/move beat. */
  private _tickCombatAttackBeat(dt: number): void {
    if (!this._patternId) {
      this._advanceCombatCycle();
      return;
    }

    this._facePlayer();
    this._setAnimState('attack');

    if (this._tickPattern(dt)) {
      this._patternId = null;
      this._advanceCombatCycle();
    }
  }

  private _tickCombatIdleBeat(dt: number): void {
    this._facePlayer();
    this._setAnimState('idle');
    this._beatTimer -= dt;
    if (this._beatTimer <= 0) {
      this._advanceCombatCycle();
    }
  }

  private _tickCombatMoveBeat(dt: number): void {
    this._beatTimer -= dt;
    const moving = this._tickStrafeMovement(dt);
    if (moving) {
      this._setAnimState('walk');
    } else {
      this._facePlayer();
      this._setAnimState('idle');
    }

    if (!moving || this._beatTimer <= 0) {
      this._advanceCombatCycle();
    }
  }

  /** Scene-placed boss may still have physics on root — turn off so position writes work. */
  private _prepareForFreeMovement(): void {
    const root = this.rootComponent as unknown as {
      setPhysicsOptions?: (o: { enabled: boolean }) => void;
    };
    root.setPhysicsOptions?.({ enabled: false });
    this.getComponent(ENGINE.NpcMovementComponent)?.stop();
  }

  /** @returns true while the boss is actively repositioning (walk anim). */
  private _tickStrafeMovement(dt: number): boolean {
    this.rootComponent.getWorldPosition(this._myPos);
    this._moveGoal.y = this._myPos.y;

    const dx = this._moveGoal.x - this._myPos.x;
    const dz = this._moveGoal.z - this._myPos.z;
    const dist = Math.hypot(dx, dz);

    if (dist <= MOVE_ARRIVE_DIST || dist < 1e-6) {
      return false;
    }

    const step = Math.min(this._moveSpeed * dt, dist - MOVE_ARRIVE_DIST * 0.5);
    if (step > 0) {
      this.rootComponent.position.x += (dx / dist) * step;
      this.rootComponent.position.z += (dz / dist) * step;
      zombieSpatialManager.updateZombiePosition(this);
    }

    this._applyFacingFromDirection(dx, dz);

    this.rootComponent.getWorldPosition(this._myPos);
    const remain = Math.hypot(this._moveGoal.x - this._myPos.x, this._moveGoal.z - this._myPos.z);
    return remain > STATIONARY_MOVE_THRESHOLD;
  }

  private _pickRoadWaypoint(): void {
    this.rootComponent.getWorldPosition(this._myPos);

    if (
      this._walkTiles.length > 0 &&
      pickPostmanWalkPoint(this._walkTiles, this._moveGoal, this._myPos.y)
    ) {
      return;
    }

    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      player.rootComponent.getWorldPosition(this._playerPos);
      const angle = Math.random() * Math.PI * 2;
      const radius = 5 + Math.random() * 4;
      this._moveGoal.set(
        this._playerPos.x + Math.sin(angle) * radius,
        this._myPos.y,
        this._playerPos.z + Math.cos(angle) * radius,
      );
    }
  }

  private _snapBossToNavFloor(): void {
    const world = this.getWorld();
    if (!world) return;

    this.rootComponent.getWorldPosition(this._myPos);
    const nav = (world.gameLoop?.navigationServer ?? null) as NavMeshQuery | null;
    const snapped = new THREE.Vector3();
    if (nav && snapPositionToNavFloor(nav, this._myPos, snapped)) {
      snapped.y += POSTMAN_BOSS_CAPSULE_HALF_HEIGHT;
      this.rootComponent.position.copy(snapped);
      return;
    }

    if (this._myPos.y < POSTMAN_BOSS_CAPSULE_HALF_HEIGHT) {
      this._myPos.y = POSTMAN_BOSS_CAPSULE_HALF_HEIGHT;
      this.rootComponent.position.copy(this._myPos);
    }
  }

  private _pickPattern(): PatternId {
    const pool: PatternId[] = [
      'aimedBurst',
      'doubleSpiral',
      'spreadFan',
      'delayedRing',
      'safeLaneRing',
    ];
    return pool[Math.floor(Math.random() * pool.length)] ?? 'aimedBurst';
  }

  private _getPhase(): 1 | 2 | 3 {
    const stats = this.getComponent(ENGINE.CharacterStatsComponent);
    if (!stats) return 1;
    const ratio = stats.getCurrentHealth() / Math.max(1, stats.getMaxHealth());
    if (ratio > 0.66) return 1;
    if (ratio > 0.33) return 2;
    return 3;
  }

  private _phaseSpeedMult(): number {
    const phase = this._getPhase();
    if (phase >= 3) return 1.08;
    if (phase >= 2) return 1.04;
    return 1.0;
  }

  private _patternBulletTotal(): number {
    return Math.max(5, Math.min(9, this._patternBulletCount));
  }

  private _tickPattern(dt: number): boolean {
    switch (this._patternId) {
      case 'aimedBurst':
        return this._patternAimedBurst(dt);
      case 'doubleSpiral':
        return this._patternDoubleSpiral(dt);
      case 'spreadFan':
        return this._patternSpreadFan(dt);
      case 'delayedRing':
        return this._patternDelayedRing(dt);
      case 'safeLaneRing':
        return this._patternSafeLaneRing();
      default:
        return true;
    }
  }

  /** #4 — rapid shots at the player's current position. */
  private _patternAimedBurst(dt: number): boolean {
    this._patternTimer += dt;

    if (this._patternStep >= AIMED_BURST_SHOTS) {
      return true;
    }

    const gap = this._patternStep === 0 ? 0.08 : AIMED_BURST_GAP_SEC;
    if (this._patternTimer < gap) {
      return false;
    }

    this._facePlayer();
    this._fireAimedAtPlayer();
    this._patternStep += 1;
    this._patternTimer = 0;
    return this._patternStep >= AIMED_BURST_SHOTS;
  }

  /** #3 — two spiral arms 180° apart, bullets emit from boss along travel axis. */
  private _patternDoubleSpiral(dt: number): boolean {
    this._patternTimer += dt;
    if (this._patternTimer >= DOUBLE_SPIRAL_DURATION_SEC) {
      return true;
    }

    this._spiralShotClock += dt;
    while (this._spiralShotClock >= DOUBLE_SPIRAL_FIRE_INTERVAL_SEC) {
      this._spiralShotClock -= DOUBLE_SPIRAL_FIRE_INTERVAL_SEC;
      this._flatDir.set(Math.sin(this._spiralAngle), 0, Math.cos(this._spiralAngle));
      this._fireBullet(this._flatDir);
      this._flatDir.set(
        Math.sin(this._spiralAngle + Math.PI),
        0,
        Math.cos(this._spiralAngle + Math.PI),
      );
      this._fireBullet(this._flatDir);
      this._spiralAngle += DOUBLE_SPIRAL_ANGLE_STEP;
    }
    return false;
  }

  /** #6 — three cone waves aimed at the player; spread tightens in later phases. */
  private _patternSpreadFan(dt: number): boolean {
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) {
      return true;
    }

    this._patternTimer += dt;
    const wave = Math.floor(this._patternTimer / SPREAD_FAN_WAVE_GAP_SEC);
    if (wave >= SPREAD_FAN_WAVES) {
      return true;
    }

    if (wave <= this._patternStep) {
      return false;
    }
    this._patternStep = wave;

    player.rootComponent.getWorldPosition(this._playerPos);
    this.rootComponent.getWorldPosition(this._myPos);
    this._flatDir.copy(this._playerPos).sub(this._myPos).setY(0);
    if (this._flatDir.lengthSq() < 1e-6) {
      this._flatDir.set(0, 0, 1);
    } else {
      this._flatDir.normalize();
    }

    const baseYaw = Math.atan2(this._flatDir.x, this._flatDir.z);
    const spread = this._spreadFanSpreadRad();
    this._facePlayer();
    const count = Math.max(4, Math.floor(this._patternBulletTotal() * 0.4));

    for (let i = 0; i < count; i++) {
      const t = count <= 1 ? 0.5 : i / (count - 1);
      const yaw = baseYaw - spread + spread * 2 * t;
      this._flatDir.set(Math.sin(yaw), 0, Math.cos(yaw));
      this._fireBullet(this._flatDir);
    }
    return false;
  }

  /** #8 — slow outer ring, pause, then faster inner ring. */
  private _patternDelayedRing(dt: number): boolean {
    this._patternTimer += dt;

    if (this._patternStep === 0) {
      if (this._patternTimer < 0.06) {
        return false;
      }
      this._facePlayer();
      this._fireRadialBurst(this._patternBulletTotal(), { speedMult: DELAYED_RING_OUTER_SPEED });
      this._patternStep = 1;
      this._patternTimer = 0;
      return false;
    }

    if (this._patternStep === 1) {
      if (this._patternTimer < DELAYED_RING_PAUSE_SEC) {
        return false;
      }
      this._facePlayer();
      const innerCount = Math.max(6, this._patternBulletTotal() - 2);
      this._fireRadialBurst(innerCount, {
        speedMult: DELAYED_RING_INNER_SPEED,
        startAngle: Math.PI / innerCount,
      });
      this._patternStep = 2;
      return true;
    }

    return true;
  }

  /** #22 — full ring with two rotating safe gaps. */
  private _patternSafeLaneRing(): boolean {
    if (this._patternStep > 0) {
      return true;
    }

    this._facePlayer();
    const count = SAFE_LANE_RING_SLOTS;
    const gap1 =
      Math.floor((this._safeLaneGapAngle / (Math.PI * 2)) * count) % count;
    const gap2 = (gap1 + Math.floor(count / 2)) % count;

    this._fireRadialBurst(count, {
      startAngle: this._safeLaneGapAngle,
      skipSlotRanges: [
        { startSlot: gap1, width: SAFE_LANE_GAP_WIDTH },
        { startSlot: gap2, width: SAFE_LANE_GAP_WIDTH },
      ],
    });

    this._safeLaneGapAngle += SAFE_LANE_ROTATION_STEP;
    this._patternStep = 1;
    return true;
  }

  private _spreadFanSpreadRad(): number {
    const phase = this._getPhase();
    const deg = phase >= 3 ? 48 : phase >= 2 ? 54 : 62;
    return THREE.MathUtils.degToRad(deg);
  }

  private _fireAimedAtPlayer(): void {
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) {
      return;
    }
    player.rootComponent.getWorldPosition(this._playerPos);
    this.rootComponent.getWorldPosition(this._myPos);
    this._flatDir.copy(this._playerPos).sub(this._myPos).setY(0);
    if (this._flatDir.lengthSq() < 1e-6) {
      this._flatDir.set(0, 0, 1);
    } else {
      this._flatDir.normalize();
    }
    this._fireBullet(this._flatDir);
  }

  private _isRadialSlotSkipped(
    slot: number,
    count: number,
    ranges: Array<{ startSlot: number; width: number }>,
  ): boolean {
    for (const range of ranges) {
      for (let w = 0; w < range.width; w++) {
        if ((range.startSlot + w) % count === slot) {
          return true;
        }
      }
    }
    return false;
  }

  private _fireRadialBurst(
    count: number,
    opts: {
      spawnRadius?: number;
      speedMult?: number;
      startAngle?: number;
      skipSlotRanges?: Array<{ startSlot: number; width: number }>;
    } = {},
  ): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    this.rootComponent.getWorldPosition(this._myPos);
    this._flatDir.set(0, 0, 1);
    this._computeBulletSpawnPos(this._muzzlePos, this._flatDir);
    const muzzleY = this._muzzlePos.y;
    const speed = this._bulletSpeed * this._phaseSpeedMult() * (opts.speedMult ?? 1);
    const start = opts.startAngle ?? 0;
    const radius = opts.spawnRadius ?? 0;
    const skips = opts.skipSlotRanges ?? [];

    for (let i = 0; i < count; i++) {
      if (this._isRadialSlotSkipped(i, count, skips)) {
        continue;
      }
      const angle = start + (i / count) * Math.PI * 2;
      this._flatDir.set(Math.sin(angle), 0, Math.cos(angle));
      this._muzzlePos.copy(this._myPos).addScaledVector(this._flatDir, radius);
      this._muzzlePos.y = muzzleY;
      PostmanBulletActor.spawn(
        world,
        this._muzzlePos,
        this._flatDir,
        speed,
        this._bulletDamage,
        this,
      );
    }
  }

  private _fireBullet(direction: THREE.Vector3, speedMult = 1): void {
    const world = this.getWorld();
    if (!world) {
      return;
    }

    this._flatDir.copy(direction).setY(0);
    if (this._flatDir.lengthSq() < 1e-8) {
      this._flatDir.set(0, 0, 1);
    } else {
      this._flatDir.normalize();
    }

    this._computeBulletSpawnPos(this._muzzlePos, this._flatDir);
    PostmanBulletActor.spawn(
      world,
      this._muzzlePos,
      this._flatDir,
      this._bulletSpeed * this._phaseSpeedMult() * speedMult,
      this._bulletDamage,
      this,
    );
  }

  /** Floor-height spawn point, nudged along the bullet's travel direction. */
  private _computeBulletSpawnPos(out: THREE.Vector3, travelDir: THREE.Vector3): void {
    this.rootComponent.getWorldPosition(out);

    let floorY = out.y - POSTMAN_BOSS_CAPSULE_HALF_HEIGHT;
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (player) {
      player.rootComponent.getWorldPosition(this._playerPos);
      floorY = this._playerPos.y;
    }

    const nav = (this.getWorld()?.gameLoop?.navigationServer ?? null) as NavMeshQuery | null;
    const snapped = new THREE.Vector3();
    if (nav && snapPositionToNavFloor(nav, out, snapped)) {
      floorY = snapped.y;
    }

    out.y = floorY + BULLET_GROUND_Y_OFFSET;

    const dirX = travelDir.x;
    const dirZ = travelDir.z;
    const len = Math.hypot(dirX, dirZ);
    if (len > 1e-8) {
      out.x += (dirX / len) * POSTMAN_BOSS_MUZZLE_FORWARD;
      out.z += (dirZ / len) * POSTMAN_BOSS_MUZZLE_FORWARD;
    }
  }

  public override setHiddenInGame(hidden: boolean): void {
    super.setHiddenInGame(hidden);
    this.rootComponent.visible = !hidden;
    this.rootComponent.traverse(obj => {
      obj.visible = !hidden;
      if (hidden) {
        obj.layers.disableAll();
      } else {
        obj.layers.enable(0);
      }
    });
    const visual = this._visualMesh ?? this.getComponent(ENGINE.GLTFMeshComponent);
    if (visual) {
      visual.visible = !hidden;
      visual.traverse(child => {
        child.visible = !hidden;
        if (hidden) {
          child.layers.disableAll();
        } else {
          child.layers.enable(0);
        }
      });
    }
  }

  private _facePlayer(): void {
    const player = this.getWorld()?.getFirstPlayerPawn();
    if (!player) {
      return;
    }
    player.rootComponent.getWorldPosition(this._playerPos);
    this.rootComponent.getWorldPosition(this._myPos);
    this._flatDir.copy(this._playerPos).sub(this._myPos).setY(0);
    if (this._flatDir.lengthSq() < 1e-8) {
      return;
    }
    this._applyFacingFromDirection(this._flatDir.x, this._flatDir.z);
  }

  /** Reset hierarchy so only one node carries travel yaw (like Grim's visual mesh). */
  private _syncVisualFacingOffset(): void {
    const visual = this._visualMesh ?? this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) {
      return;
    }

    visual.rotation.y = 0;
    const parent = visual.parent;
    if (parent instanceof ENGINE.SceneComponent && parent !== this.rootComponent) {
      parent.rotation.y = 0;
      this._facingPivot = parent;
    }
    this.rootComponent.rotation.y = 0;
  }

  /**
   * Snap facing — atan2(x, z) on body pivot or root (same as Grim movement facing).
   */
  private _applyFacingFromDirection(dx: number, dz: number): void {
    if (dx * dx + dz * dz < 1e-10) {
      return;
    }

    const yaw = Math.atan2(dx, dz);
    this._facingYaw = yaw;

    const visual = this._visualMesh ?? this.getComponent(ENGINE.GLTFMeshComponent);
    const parent = visual?.parent;

    if (parent instanceof ENGINE.SceneComponent && parent !== this.rootComponent) {
      parent.rotation.y = yaw;
      if (visual) {
        visual.rotation.y = 0;
      }
      return;
    }

    this.rootComponent.rotation.y = yaw;
    if (visual) {
      visual.rotation.y = 0;
    }
  }

  private _setAnimState(state: 'idle' | 'walk' | 'attack' | 'death'): void {
    this._syncAnimState(state);
  }

  private _syncAnimState(state: 'idle' | 'walk' | 'attack' | 'death'): void {
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      anim.setParameter('state', state);
    }
  }

  private _tickAnimationInit(dt: number): void {
    if (this._animationInitialized) return;
    this._animInitTimer += dt;
    const anim = this.animationComponent ?? this.getComponent(ENGINE.AnimationStateMachineComponent);
    if (anim?.isReady()) {
      this._syncAnimState(this._bossActive ? 'idle' : 'idle');
      this._animationInitialized = true;
      return;
    }
    if (this._animInitTimer >= PostmanBossActor.ANIM_INIT_TIMEOUT) {
      this._animationInitialized = true;
    }
  }

  public flashYellow(): void {
    if (this._isFlashing) return;
    this._isFlashing = true;
    this._flashRemainingSec = 0.12;

    const visual = this.getComponent(ENGINE.GLTFMeshComponent);
    if (!visual) {
      this._isFlashing = false;
      return;
    }

    visual.traverse((child: THREE.Object3D) => {
      if (!(child instanceof THREE.Mesh)) return;
      const mesh = child;
      if (!mesh.userData._flashMat) {
        const orig = mesh.material;
        mesh.userData._flashMat = Array.isArray(orig)
          ? orig.map((m: THREE.Material) => m.clone())
          : (orig as THREE.Material).clone();
      }
      mesh.material = mesh.userData._flashMat;
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat instanceof THREE.MeshStandardMaterial) {
        const prev = mat.emissive.clone();
        const prevI = mat.emissiveIntensity;
        mat.emissive.setHex(0xffff00);
        mat.emissiveIntensity = 0.5;
        this._flashRestoreFns.push(() => {
          mat.emissive.copy(prev);
          mat.emissiveIntensity = prevI;
        });
      }
    });
  }

  private _tickFlash(dt: number): void {
    if (!this._isFlashing) return;
    this._flashRemainingSec -= dt;
    if (this._flashRemainingSec > 0) return;
    for (const restore of this._flashRestoreFns) restore();
    this._flashRestoreFns.length = 0;
    this._isFlashing = false;
  }

  public handleDeath(hitInfo?: DamageHitInfo): void {
    void hitInfo;
    if (this._deathSequenceStarted) return;
    this._deathSequenceStarted = true;
    this._bossActive = false;

    zombieSpatialManager.unregisterZombie(this);

    const world = this.getWorld();
    if (world) {
      awardSoulFromEnemyKill(world);
    }

    this._setAnimState('death');
    const cb = this.onDied;
    this.onDied = null;
    cb?.();

    window.setTimeout(() => {
      if (this.getWorld()) {
        destroyActorWhenGltfIdle(this);
      }
    }, 2200);
  }
}
