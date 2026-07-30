/**
 * DeadGraveActor - Grave visual spawned when a zombie dies.
 *
 * Uses an invisible box root with brief Dynamic physics so the grave falls
 * and settles onto the ground, then physics is disabled so Grim can never
 * bump into a lingering tombstone collider.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';

const GRAVE_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/Grave.glb` as ENGINE.ModelPath;

// Shared geometry and material reused across every grave to avoid churning
// Three.js buffers/programs when many graves spawn. The material is invisible
// (the root is never rendered) — the visible GLB is a child.
const SHARED_ROOT_GEOMETRY = new THREE.BoxGeometry(0.7, 1.1, 0.3);
const SHARED_ROOT_MATERIAL = new THREE.MeshStandardMaterial({ visible: false });

// ─── Collision profile ────────────────────────────────────────────────────────

const DEAD_GRAVE_PROFILE = 'DeadGraveNoPawnBlock';

type MutableProfileResponses = Array<{ channel: string; response: ENGINE.CollisionResponse }>;

function patchDeadGraveResponses(profile: ENGINE.CollisionProfile): void {
  const responses = (profile as unknown as { responses: MutableProfileResponses }).responses;
  const set = (channel: ENGINE.CollisionChannel, response: ENGINE.CollisionResponse): void => {
    const ch = channel as unknown as string;
    const i = responses.findIndex(r => r.channel === ch);
    if (i >= 0) responses[i] = { channel: ch, response };
    else responses.push({ channel: ch, response });
  };
  // Land on static world geometry (ground, roads, etc.)
  set(ENGINE.CollisionChannel.WorldStatic, ENGINE.CollisionResponse.Block);
  // Never block Grim or any other pawn
  set(ENGINE.CollisionChannel.Pawn, ENGINE.CollisionResponse.Ignore);
  // Graves pass through each other and other dynamic bodies
  set(ENGINE.CollisionChannel.WorldDynamic, ENGINE.CollisionResponse.Ignore);
  set(ENGINE.CollisionChannel.PhysicsBody, ENGINE.CollisionResponse.Ignore);
}

function ensureDeadGraveCollisionProfile(): void {
  const cfg = ENGINE.CollisionConfig.getInstance();
  const existing = cfg.getProfile(DEAD_GRAVE_PROFILE);
  if (existing) {
    patchDeadGraveResponses(existing);
    return;
  }
  const profile = new ENGINE.CollisionProfile(
    DEAD_GRAVE_PROFILE,
    ENGINE.CollisionMode.QueryAndPhysics,
    ENGINE.CollisionChannel.WorldDynamic,
    [],
  );
  patchDeadGraveResponses(profile);
  (cfg as unknown as { profiles: ENGINE.CollisionProfile[] }).profiles.push(profile);
}

/** Seconds before non-pooled grave auto-destroys (pooled graves never destroy). */
const GRAVE_LIFETIME_SEC = 8;

/** Max simultaneous graves — oldest (FIFO) gets recycled when limit hit. */
const MAX_GRAVES = 25;

/** After this many seconds, or once movement stops, drop physics for good. */
const GRAVE_SETTLE_MAX_SEC = 0.75;
const GRAVE_SETTLE_MIN_SEC = 0.12;
const GRAVE_SETTLE_MOVE_EPS_SQ = 0.000004;

// Grave pool management (FIFO: shift front, push back on recycle)
interface PooledGrave {
  actor: DeadGraveActor;
  spawnGameTime: number;
}

let gravePool: PooledGrave[] = [];

@ENGINE.GameClass()
export class DeadGraveActor extends ENGINE.Actor {
  private _aliveSec = 0;
  private _isPooled = false;
  private _physicsActive = true;
  private _settleElapsedSec = 0;
  private readonly _lastSettlePos = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    ensureDeadGraveCollisionProfile();

    const root = ENGINE.MeshComponent.create({
      name: 'GraveRoot',
      geometry: SHARED_ROOT_GEOMETRY,
      material: SHARED_ROOT_MATERIAL,
      physicsOptions: {
        enabled: true,
        motionType: ENGINE.PhysicsMotionType.Dynamic,
        collisionProfile: DEAD_GRAVE_PROFILE,
      },
    });

    root.rotation.y = Math.random() * Math.PI * 2;

    const visual = ENGINE.GLTFMeshComponent.create({
      name: 'GraveVisual',
      modelUrl: GRAVE_MODEL_URL,
      scale: new THREE.Vector3(0.2, 0.2, 0.2),
      physicsOptions: { enabled: false },
      castShadow: true,
    });

    root.add(visual);

    super.initialize({ ...options, rootComponent: root });
  }

  public override beginPlay(): boolean {
    if (!super.beginPlay()) {
      return false;
    }
    this._aliveSec = 0;
    this._beginSettling();
    return true;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    this._aliveSec += deltaTime;

    if (this._physicsActive) {
      this._tickSettle(deltaTime);
    }

    if (!this._isPooled && this._aliveSec >= GRAVE_LIFETIME_SEC) {
      this.destroy();
    }
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Mesh';
  }

  /**
   * Spawn a grave at the given position.
   * Uses pooling — recycles oldest grave if at cap.
   */
  public static spawnAt(
    world: ENGINE.World,
    position: THREE.Vector3,
    _velocity?: THREE.Vector3,
  ): DeadGraveActor {
    void _velocity;
    gravePool = gravePool.filter(g => g.actor.getWorld() !== null);

    const spawnGameTime = world.getGameTime();

    if (gravePool.length >= MAX_GRAVES) {
      const oldest = gravePool.shift();
      if (oldest) {
        oldest.actor.recycle(position);
        gravePool.push({ actor: oldest.actor, spawnGameTime });
        return oldest.actor;
      }
    }

    const grave = DeadGraveActor.create({ position: position.clone() });
    grave._isPooled = true;
    world.addActor(grave);

    gravePool.push({ actor: grave, spawnGameTime });
    return grave;
  }

  /**
   * Destroy all graves and clear the pool. Call this on every mission reset so
   * tombstones from the previous attempt do not bleed into the next mission.
   */
  public static clearForMissionReset(): void {
    for (const entry of gravePool) {
      const world = entry.actor.getWorld();
      if (world) {
        entry.actor.destroy();
      }
    }
    gravePool = [];
  }

  private recycle(position: THREE.Vector3): void {
    this._aliveSec = 0;
    this.rootComponent.position.copy(position);
    this.rootComponent.rotation.y = Math.random() * Math.PI * 2;
    this.rootComponent.updateMatrixWorld();
    this._enableSettlingPhysics();
  }

  private _beginSettling(): void {
    this._settleElapsedSec = 0;
    this._lastSettlePos.copy(this.rootComponent.position);
    this._physicsActive = true;
  }

  private _enableSettlingPhysics(): void {
    this._beginSettling();
    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: true,
      motionType: ENGINE.PhysicsMotionType.Dynamic,
      collisionProfile: DEAD_GRAVE_PROFILE,
    });
  }

  private _tickSettle(deltaTime: number): void {
    this._settleElapsedSec += deltaTime;

    const movedSq = this.rootComponent.position.distanceToSquared(this._lastSettlePos);
    this._lastSettlePos.copy(this.rootComponent.position);

    const stoppedMoving =
      this._settleElapsedSec >= GRAVE_SETTLE_MIN_SEC &&
      movedSq <= GRAVE_SETTLE_MOVE_EPS_SQ;
    const timedOut = this._settleElapsedSec >= GRAVE_SETTLE_MAX_SEC;

    if (stoppedMoving || timedOut) {
      this._freezePhysics();
    }
  }

  /** Remove the Rapier body once the grave has landed — visual stays put. */
  private _freezePhysics(): void {
    if (!this._physicsActive) {
      return;
    }
    this._physicsActive = false;
    (this.rootComponent as ENGINE.MeshComponent).overridePhysicsOptions({
      enabled: false,
    });
  }
}
