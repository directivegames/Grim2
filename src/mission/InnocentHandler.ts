import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import { spawnInnocentSmokeAt } from '../actors/InnocentSmokeVFX.js';
import {
  snapPositionToNavFloor,
  type NavMeshQuery,
} from './innocent-spawn-position.js';
import { missionState } from './MissionState.js';
import { horizontalDistanceXZ } from './spawn-exclusion.js';

const SCENE_INNOCENT_NAME = 'innocent';
const SAVE_RADIUS = 1.85;
const REVEAL_DELAY_MS = 380;
const CONCEAL_DELAY_MS = 120;
/** Ignore proximity saves right after spawn (avoids instant "SOUL SAVED" at start). */
const SAVE_GRACE_MS = 2500;

/**
 * Drives the single scene-placed innocent: move, smoke appear/vanish, save / waste.
 * Innocents only die when the mission save timer expires.
 */
export class InnocentHandler {
  private _prop: ENGINE.Actor | null = null;
  private _bound = false;
  private _active = false;
  private _ending = false;
  private _saveAllowedAtMs = 0;
  private readonly _scratchPlayerPos = new THREE.Vector3();
  private readonly _scratchSelfPos = new THREE.Vector3();
  private readonly _worldPos = new THREE.Vector3();

  public get isActive(): boolean {
    return this._active && !this._ending;
  }

  public get hasProp(): boolean {
    return this._prop !== null;
  }

  /** Find scene actor named "innocent" and hide until first spawn. */
  public bind(world: ENGINE.World): boolean {
    this._prop =
      world.getActors().find((a) => a.name.toLowerCase() === SCENE_INNOCENT_NAME) ?? null;

    if (!this._prop) {
      console.warn(
        `[InnocentHandler] No scene actor named "${SCENE_INNOCENT_NAME}" — innocents disabled.`,
      );
      this._bound = false;
      return false;
    }

    this._prop.rootComponent.position.set(0, -1000, 0);
    this._prop.setHiddenInGame(true);
    this._bound = true;
    this._active = false;
    this._ending = false;
    return true;
  }

  public shutdown(): void {
    if (this._prop) {
      this._prop.setHiddenInGame(true);
    }
    this._active = false;
    this._ending = false;
    this._bound = false;
    this._prop = null;
  }

  /** Smoke → reveal at position. Calls `onReady` when the innocent is active. */
  public revealAt(
    world: ENGINE.World,
    position: THREE.Vector3,
    onReady: () => void,
  ): void {
    if (!this._prop || !this._bound) {
      onReady();
      return;
    }

    this._ending = false;
    this._active = false;
    this._prop.setHiddenInGame(true);

    const floorPos = position.clone();
    const nav = (world.gameLoop?.navigationServer ?? null) as NavMeshQuery | null;
    if (nav?.isReady?.()) {
      snapPositionToNavFloor(nav, floorPos, floorPos);
    }
    this._prop.rootComponent.position.copy(floorPos);

    spawnInnocentSmokeAt(world, floorPos);

    window.setTimeout(() => {
      if (!this._prop || !this._bound) return;
      this._prop.setHiddenInGame(false);
      this._active = true;
      this._saveAllowedAtMs = performance.now() + SAVE_GRACE_MS;
      onReady();
    }, REVEAL_DELAY_MS);
  }

  public tick(): void {
    if (!this._active || this._ending || !this._prop || !missionState.isActive) {
      return;
    }

    if (performance.now() < this._saveAllowedAtMs) {
      return;
    }

    const world = this._prop.getWorld();
    const player = world?.getFirstPlayerPawn();
    if (!player) return;

    player.getWorldPosition(this._scratchPlayerPos);
    this._prop.rootComponent.getWorldPosition(this._scratchSelfPos);
    this._scratchSelfPos.y = this._scratchPlayerPos.y;

    if (
      horizontalDistanceXZ(this._scratchSelfPos, this._scratchPlayerPos) <= SAVE_RADIUS
    ) {
      this._save();
    }
  }

  public getWorldPosition(out: THREE.Vector3): boolean {
    if (!this._prop || !this._active || this._ending || this._prop.isHiddenInGame()) {
      return false;
    }
    this._prop.rootComponent.getWorldPosition(out);
    out.y += 0.65;
    return true;
  }

  /** Save timer expired — only way an innocent can die. */
  public expireFromTimer(): void {
    this._waste();
  }

  private _save(): void {
    if (!this._prop || this._ending) return;
    this._ending = true;
    this._active = false;

    const world = this._prop.getWorld();
    if (!world) {
      missionState.onInnocentSaved();
      return;
    }

    this._prop.rootComponent.getWorldPosition(this._worldPos);
    spawnInnocentSmokeAt(world, this._worldPos);
    window.setTimeout(() => {
      this._prop?.setHiddenInGame(true);
      missionState.onInnocentSaved();
    }, CONCEAL_DELAY_MS);
  }

  private _waste(): void {
    if (!this._prop || this._ending) return;
    this._ending = true;
    this._active = false;

    const world = this._prop.getWorld();
    if (!world) {
      missionState.onInnocentKilled();
      return;
    }

    this._prop.rootComponent.getWorldPosition(this._worldPos);
    spawnInnocentSmokeAt(world, this._worldPos);
    window.setTimeout(() => {
      this._prop?.setHiddenInGame(true);
      missionState.onInnocentKilled();
    }, CONCEAL_DELAY_MS);
  }
}
