/**
 * SoulActor - Floating soul that appears when a zombie dies.
 *
 * Slowly rotates and bobs in place. Only Grim can collect it by touching it.
 * Zombies walk through it without interaction.
 */
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

import type { ActorOptions } from '@gnsx/genesys.js';
import { SoulCounterUI } from '../ui/SoulCounterUI.js';
import { IsometricPlayerPawn } from './IsometricPlayerPawn.js';

const SOUL_MODEL_URL = `${ENGINE.PROJECT_PATH_PREFIX}/assets/models/soul.glb` as ENGINE.ModelPath;

/** Collection radius - Grim must be within this distance to collect the soul. */
const COLLECTION_RADIUS = 1.0;

/** Bob amplitude in world units. */
const BOB_AMPLITUDE = 0.15;

/** Bob speed in rad/s. */
const BOB_SPEED = 1.5;

/** Rotation speed in rad/s. */
const ROTATION_SPEED = 2.0;


@ENGINE.GameClass()
export class SoulActor extends ENGINE.Actor {

  private _baseY = 0;
  private _bobPhase = 0;
  private _isCollected = false;

  // Scratch vectors to avoid per-frame allocations
  private readonly _scratchPos = new THREE.Vector3();
  private readonly _playerPos = new THREE.Vector3();

  public override initialize(options?: ActorOptions): void {
    const visual = ENGINE.GLTFMeshComponent.create({
      modelUrl: SOUL_MODEL_URL,
      scale: new THREE.Vector3(0.1, 0.1, 0.1),
      physicsOptions: { enabled: false }, // No physics - floats freely
      castShadow: false,
    });

    // NOTE: No PointLightComponent here. Adding/removing a light at runtime
    // changes the scene's light count, which forces Three.js to recompile
    // every lit material's shader and causes a freeze. Scene-placed Soul
    // actors still provide atmospheric lighting.

    super.initialize({ ...options, rootComponent: visual });

    // Record base Y for bobbing
    this._baseY = this.rootComponent.position.y;

    // Random starting rotation
    this.rootComponent.rotation.y = Math.random() * Math.PI * 2;
  }

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    // Ensure UI exists on first soul spawn
    SoulCounterUI.getInstance(this.getWorld());
  }

  public override tickPrePhysics(deltaTime: number): void {
    super.tickPrePhysics(deltaTime);

    if (this._isCollected) return;

    // Bobbing animation
    this._bobPhase += deltaTime * BOB_SPEED;
    const bobOffset = Math.sin(this._bobPhase) * BOB_AMPLITUDE;
    this.rootComponent.position.y = this._baseY + bobOffset;

    // Rotation
    this.rootComponent.rotation.y += deltaTime * ROTATION_SPEED;

    // Check for collection by player (Grim)
    this._checkCollection();
  }

  /**
   * Check if Grim is close enough to collect this soul.
   * Only the player (IsometricPlayerPawn) can collect souls.
   */
  private _checkCollection(): void {
    const world = this.getWorld();
    if (!world) return;

    const player = world.getFirstPlayerPawn();
    if (!player) return;

    // Only IsometricPlayerPawn (Grim) can collect souls
    if (!(player instanceof IsometricPlayerPawn)) return;

    // Get positions
    this.rootComponent.getWorldPosition(this._scratchPos);
    player.rootComponent.getWorldPosition(this._playerPos);

    // Check distance (squared for efficiency)
    const dx = this._scratchPos.x - this._playerPos.x;
    const dz = this._scratchPos.z - this._playerPos.z;
    const distSq = dx * dx + dz * dz;

    if (distSq <= COLLECTION_RADIUS * COLLECTION_RADIUS) {
      this._collectSoul(player);
    }
  }

  /**
   * Collect this soul - increment counter and destroy immediately.
   */
  private _collectSoul(player: IsometricPlayerPawn): void {
    if (this._isCollected) return;
    this._isCollected = true;

    // Increment player's soul counter
    player.soulsCollected++;

    // Update UI
    const ui = SoulCounterUI.getInstance(this.getWorld());
    ui.increment();

    // Defer destroy to after the current tick completes — calling destroy()
    // synchronously inside tickPrePhysics mutates the actor list mid-iteration.
    globalThis.setTimeout(() => this.destroy(), 0);
  }

  public override getEditorClassIcon(): string | null {
    return 'Icon_Light';
  }
}
