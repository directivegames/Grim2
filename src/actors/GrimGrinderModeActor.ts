/**
 * Grim Grinder transformation — fade + title, paused gameplay, car ram mode.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { GameRootNode } from './GameRootNode.js';

import type { DamageHitInfo } from '@gnsx/genesys.js';
import type { PrimitiveNodeOptions } from '@gnsx/genesys.js';
import {
  GRIM_GRINDER_BOSS_DAMAGE_FRAC,
  GRIM_GRINDER_BOSS_RESET_RADIUS,
  GRIM_GRINDER_CONTACT_RADIUS,
  GRIM_GRINDER_DURATION_SEC,
  GRIM_GRINDER_SKILL_ID,
  GRIM_GRINDER_SOUL_THRESHOLD,
} from '../data/grim-grinder-config.js';
import { grimVault } from '../game/GrimVault.js';
import { flushGameplayInput } from '../utils/flush-gameplay-input.js';
import { isGameplayUnlocked, setGameplayUnlocked } from '../utils/game-pause.js';
import { GrimGrinderControllerComponent } from '../components/GrimGrinderControllerComponent.js';
import { GrimGrinderUI } from '../ui/GrimGrinderUI.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';
import { PostmanBossActor } from './PostmanBossActor.js';
import { zombieSpatialManager } from './ZombieSpatialManager.js';

function worldSlomo(world: ENGINE.World): { slomo: number } {
  return world as unknown as { slomo: number };
}

@ENGINE.GameClass()
export class GrimGrinderModeActor extends GameRootNode {
  private static _instance: GrimGrinderModeActor | null = null;

  private _active = false;
  private _activating = false;
  private _timeLeft = 0;
  private _pawn: IsometricPlayerPawn | null = null;
  private _car: GrimGrinderControllerComponent | null = null;
  private _bossCanHit = new Map<ENGINE.SceneNode, boolean>();
  private _originalTakeDamage: ((amount: number, hitInfo?: DamageHitInfo) => number) | null = null;
  private _savedSlomo = 1;

  private readonly _playerPos = new THREE.Vector3();
  private readonly _enemyPos = new THREE.Vector3();
  private readonly _hitLocation = new THREE.Vector3();
  private readonly _hitNormal = new THREE.Vector3(1, 0, 0);

  public override initialize(options?: PrimitiveNodeOptions): void {
    super.initialize(options);
    this.add(ENGINE.SceneNode.create({ name: 'Root' }));
  }

  public static isActive(): boolean {
    return Boolean(GrimGrinderModeActor._instance?._active);
  }

  /**
   * Immediately cancel any active or activating transformation.
   * Safe to call even when the mode is not running — used by mission cleanup.
   */
  public static forceStop(world: ENGINE.World): void {
    const inst = GrimGrinderModeActor._instance;
    if (!inst) {
      return;
    }

    inst._activating = false;
    inst._active = false;
    inst._timeLeft = 0;
    inst._restoreSlomo();

    const pawn = inst._pawn ?? (world.getFirstPlayerPawn() instanceof IsometricPlayerPawn
      ? world.getFirstPlayerPawn() as IsometricPlayerPawn
      : null);
    if (pawn) {
      pawn.setGrimGrinderVisualHidden(false);
      pawn.setGrimGrinderInvincible(false);
    }
    if (inst._pawn) {
      inst._unhookInvincibility(inst._pawn);
    }

    const car = inst._car ?? GrimGrinderControllerComponent.findInWorld(world);
    if (car) {
      car.returnHome();
    }

    inst._pawn = null;
    inst._car = null;
    inst._bossCanHit.clear();

    void GrimGrinderUI.fadeFromBlack(world);
  }

  public static tryActivate(world: ENGINE.World): boolean {
    if (!isGameplayUnlocked()) {
      return false;
    }
    if (grimVault.getSkillLevel(GRIM_GRINDER_SKILL_ID) < 1) {
      return false;
    }
    if (GrimGrinderModeActor.isActive()) {
      return false;
    }

    const pawn = world.getFirstPlayerPawn();
    if (!(pawn instanceof IsometricPlayerPawn)) {
      return false;
    }
    if (pawn.grimGrinderSoulProgress < GRIM_GRINDER_SOUL_THRESHOLD) {
      return false;
    }

    const inst = GrimGrinderModeActor.ensureExists(world);
    if (inst._activating || inst._active) {
      return false;
    }

    void inst._runActivation(world, pawn);
    return true;
  }

  public static ensureExists(world: ENGINE.World): GrimGrinderModeActor {
    if (GrimGrinderModeActor._instance?.getWorld()) {
      return GrimGrinderModeActor._instance;
    }
    const actor = GrimGrinderModeActor.create({ name: 'GrimGrinderMode' });
    world.add(actor);
    GrimGrinderModeActor._instance = actor;
    return actor;
  }

    public override endPlay(): boolean {
    if (!super.endPlay()) {
      return false;
    }
    if (GrimGrinderModeActor._instance === this) {
      GrimGrinderModeActor._instance = null;
    }
    this._restoreSlomo();
    void this._endModeImmediate(false);
    return true;
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);
    if (!this._active || !this._pawn || !this._car) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      return;
    }

    this._timeLeft -= deltaTime;
    if (this._timeLeft <= 0) {
      void this._runDeactivation(true);
      return;
    }

    this._pawn.getWorldPosition(this._playerPos);
    this._car.syncTo(this._playerPos, this._pawn.getGrimGrinderCarYaw());
    this._processContacts(world);
  }

  private async _runActivation(world: ENGINE.World, pawn: IsometricPlayerPawn): Promise<void> {
    const car = GrimGrinderControllerComponent.findInWorld(world);
    if (!car) {
      console.warn('[GrimGrinder] Cannot transform — no grimgrinder prop in scene.');
      return;
    }

    this._activating = true;
    this._pauseGameplay(world);

    try {
      await GrimGrinderUI.fadeToBlack(world);

      pawn.consumeGrimGrinderSouls();
      pawn.restoreFullHealth();

      pawn.getWorldPosition(this._playerPos);
      car.teleportTo(this._playerPos, pawn.getGrimGrinderCarYaw());
      pawn.setGrimGrinderVisualHidden(true);

      await GrimGrinderUI.showTransformSequence(world);

      pawn.setGrimGrinderInvincible(true);
      this._hookInvincibility(pawn);

      this._pawn = pawn;
      this._car = car;
      this._active = true;
      this._timeLeft = GRIM_GRINDER_DURATION_SEC;
      this._bossCanHit.clear();

      await GrimGrinderUI.fadeFromBlack(world);
      this._resumeGameplay(world);
    } finally {
      this._activating = false;
      if (!this._active) {
        void GrimGrinderUI.fadeFromBlack(world);
        this._restoreSlomo();
        setGameplayUnlocked(true);
        world.inputManager.setInputEnabled(true);
      }
    }
  }

  private async _runDeactivation(returnCarHome: boolean): Promise<void> {
    if (!this._active) {
      return;
    }

    const world = this.getWorld();
    if (!world) {
      this._endModeImmediate(returnCarHome);
      return;
    }

    this._pauseGameplay(world);
    try {
      await GrimGrinderUI.fadeToBlack(world);
      this._endModeImmediate(returnCarHome);
      await GrimGrinderUI.fadeFromBlack(world);
      this._resumeGameplay(world);
    } catch {
      this._endModeImmediate(returnCarHome);
      this._resumeGameplay(world);
    }
  }

  private _pauseGameplay(world: ENGINE.World): void {
    const w = worldSlomo(world);
    this._savedSlomo = w.slomo ?? 1;
    w.slomo = 0;
    flushGameplayInput(world);
    world.inputManager.setInputEnabled(false);
    setGameplayUnlocked(false);
  }

  private _resumeGameplay(world: ENGINE.World): void {
    worldSlomo(world).slomo = this._savedSlomo;
    world.inputManager.setInputEnabled(true);
    setGameplayUnlocked(true);
  }

  private _restoreSlomo(): void {
    const world = this.getWorld();
    if (world) {
      worldSlomo(world).slomo = 1;
    }
  }

  private _endModeImmediate(returnCarHome: boolean): void {
    const pawn = this._pawn;
    const car = this._car;

    if (pawn) {
      pawn.setGrimGrinderVisualHidden(false);
      pawn.setGrimGrinderInvincible(false);
      this._unhookInvincibility(pawn);
    }

    if (car) {
      if (returnCarHome) {
        car.returnHome();
      } else {
        car.park();
      }
    }

    this._pawn = null;
    this._car = null;
    this._active = false;
    this._timeLeft = 0;
    this._bossCanHit.clear();
  }

  private _hookInvincibility(pawn: IsometricPlayerPawn): void {
    const stats = pawn.getNode(ENGINE.CharacterStatsNode);
    if (!stats || this._originalTakeDamage) {
      return;
    }
    this._originalTakeDamage = stats.takeDamage.bind(stats);
    stats.takeDamage = (amount: number, hitInfo?: DamageHitInfo): number => {
      if (GrimGrinderModeActor.isActive()) {
        return 0;
      }
      return this._originalTakeDamage!(amount, hitInfo);
    };
  }

  private _unhookInvincibility(pawn: IsometricPlayerPawn): void {
    const stats = pawn.getNode(ENGINE.CharacterStatsNode);
    if (!stats || !this._originalTakeDamage) {
      return;
    }
    stats.takeDamage = this._originalTakeDamage;
    this._originalTakeDamage = null;
  }

  private _processContacts(world: ENGINE.World): void {
    this._pawn!.getWorldPosition(this._playerPos);

    const nearby = zombieSpatialManager.getNearbyZombies(this._playerPos, GRIM_GRINDER_CONTACT_RADIUS + 2);
    const contactSq = GRIM_GRINDER_CONTACT_RADIUS * GRIM_GRINDER_CONTACT_RADIUS;
    const resetSq = GRIM_GRINDER_BOSS_RESET_RADIUS * GRIM_GRINDER_BOSS_RESET_RADIUS;

    for (const enemy of nearby) {
      if ((enemy as unknown as { _deathSequenceStarted?: boolean })._deathSequenceStarted) {
        continue;
      }

      enemy.getWorldPosition(this._enemyPos);
      const dx = this._enemyPos.x - this._playerPos.x;
      const dz = this._enemyPos.z - this._playerPos.z;
      const distSq = dx * dx + dz * dz;

      if (enemy instanceof PostmanBossActor) {
        if (distSq > resetSq) {
          this._bossCanHit.set(enemy, true);
        } else if (distSq <= contactSq && this._bossCanHit.get(enemy) !== false) {
          this._damageBoss(enemy);
          this._bossCanHit.set(enemy, false);
        }
        continue;
      }

      if (distSq <= contactSq) {
        this._killEnemy(enemy);
      }
    }
  }

  private _killEnemy(enemy: ENGINE.SceneNode): void {
    const stats = enemy.getNode(ENGINE.CharacterStatsNode);
    if (!stats || stats.getCurrentHealth() <= 0) {
      return;
    }
    this._hitLocation.copy(this._enemyPos);
    stats.takeDamage(stats.getCurrentHealth(), {
      hitLocation: this._hitLocation,
      hitNormal: this._hitNormal,
    });
  }

  private _damageBoss(boss: PostmanBossActor): void {
    const stats = boss.getNode(ENGINE.CharacterStatsNode);
    if (!stats || stats.getCurrentHealth() <= 0) {
      return;
    }
    const dmg = Math.max(1, Math.round(stats.getMaxHealth() * GRIM_GRINDER_BOSS_DAMAGE_FRAC));
    this._hitLocation.copy(this._enemyPos);
    stats.takeDamage(dmg, {
      hitLocation: this._hitLocation,
      hitNormal: this._hitNormal,
    });
  }
}
