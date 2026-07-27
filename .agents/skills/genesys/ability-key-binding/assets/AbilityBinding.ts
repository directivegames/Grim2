/**
 * AbilityBinding.ts
 *
 * Pattern file: IInputHandler wiring with per-ability cooldowns and level gating.
 * Copy this as a starting point and replace the TODO sections with your ability logic.
 *
 * This file does NOT import game-specific actors. Swap the vault import for your
 * own progression store (see the skill-upgrades skill for the store interface).
 */
import * as ENGINE from '@gnsx/genesys.js';

// ─── Cooldown tracker ─────────────────────────────────────────────────────────

/**
 * Tracks last-used timestamps for a set of ability IDs.
 * Use one instance per actor.
 */
export class CooldownTracker {
  private readonly _lastUsed = new Map<string, number>();

  /** Returns true when the ability is off cooldown (or has never been used). */
  isReady(abilityId: string, cooldownSec: number, now: number): boolean {
    const last = this._lastUsed.get(abilityId) ?? -Infinity;
    return now - last >= cooldownSec;
  }

  /** Remaining cooldown in seconds. 0 when ready. */
  remainingSec(abilityId: string, cooldownSec: number, now: number): number {
    const last = this._lastUsed.get(abilityId) ?? -Infinity;
    return Math.max(0, cooldownSec - (now - last));
  }

  /** Fraction of cooldown remaining: 1 = just used, 0 = ready. */
  remainingFraction(abilityId: string, cooldownSec: number, now: number): number {
    return this.remainingSec(abilityId, cooldownSec, now) / cooldownSec;
  }

  /** Record that the ability was used at `now`. */
  consume(abilityId: string, now: number): void {
    this._lastUsed.set(abilityId, now);
  }

  /** Reset a specific ability (e.g. after game reset). */
  reset(abilityId?: string): void {
    if (abilityId !== undefined) {
      this._lastUsed.delete(abilityId);
    } else {
      this._lastUsed.clear();
    }
  }
}

// ─── Ability binding mixin ────────────────────────────────────────────────────

/**
 * AbilityInputMixin provides the boilerplate for wiring an IInputHandler.
 * Extend your actor from ENGINE.Actor, then add this as a field.
 *
 * Usage:
 *
 *   private readonly _abilityInput = new AbilityInputMixin({
 *     onLMBDown:  () => this._onLMB(),
 *     onLMBUp:    () => this._onLMBUp(),
 *     onRMB:      () => this._onRMB(),
 *     onKeyE:     () => this._onEKey(),
 *     onKeyF:     () => this._onFKey(),
 *   });
 *
 *   protected override doBeginPlay(): void {
 *     super.doBeginPlay();
 *     this.getWorld()?.inputManager.addInputHandler(this._abilityInput.handler);
 *   }
 *
 *   protected override doEndPlay(): void {
 *     this.getWorld()?.inputManager.removeInputHandler(this._abilityInput.handler);
 *     super.doEndPlay();
 *   }
 */
export interface AbilityInputOptions {
  onLMBDown?:  () => void;
  onLMBUp?:    () => void;
  onRMBDown?:  () => void;
  onKeyDown?:  (e: KeyboardEvent) => void;
  /** Convenience: shortcut for handling exactly 'e'/'E'. */
  onKeyE?:     () => void;
  /** Convenience: shortcut for handling exactly 'f'/'F'. */
  onKeyF?:     () => void;
}

export class AbilityInputMixin {
  public readonly handler: ENGINE.IInputHandler;

  constructor(options: AbilityInputOptions) {
    const opts = options;

    this.handler = {
      handleMouseDown: (button: ENGINE.MouseButton): boolean => {
        if (button === ENGINE.MouseButton.Left)  { opts.onLMBDown?.();  return false; }
        if (button === ENGINE.MouseButton.Right) { opts.onRMBDown?.();  return false; }
        return false;
      },
      handleMouseUp: (button: ENGINE.MouseButton): boolean => {
        if (button === ENGINE.MouseButton.Left) { opts.onLMBUp?.(); return false; }
        return false;
      },
      handleKeyDown: (e: KeyboardEvent): boolean => {
        opts.onKeyDown?.(e);
        if (e.key === 'e' || e.key === 'E') { opts.onKeyE?.(); return false; }
        if (e.key === 'f' || e.key === 'F') { opts.onKeyF?.(); return false; }
        return false;
      },
      handleKeyUp:      (): boolean => false,
      handleMouseMove:  (): boolean => false,
      handleMouseClick: (): boolean => false,
      setInputManager:  (): void    => { /* no-op */ },
    };
  }
}

// ─── Example actor skeleton ───────────────────────────────────────────────────

/**
 * ExampleAbilityActor shows the full pattern in a single file.
 * Delete or replace for your own actor.
 */
@ENGINE.GameClass()
export class ExampleAbilityActor extends ENGINE.Actor {

  // Cooldown config (seconds)
  private static readonly ABILITY_E_COOLDOWN = 8.0;
  private static readonly ABILITY_F_COOLDOWN = 20.0;

  private readonly _cooldowns = new CooldownTracker();

  private readonly _abilityInput = new AbilityInputMixin({
    onLMBDown:  () => this._onLMB(),
    onLMBUp:    () => this._onLMBUp(),
    onRMBDown:  () => this._onRMB(),
    onKeyE:     () => this._onEKey(),
    onKeyF:     () => this._onFKey(),
  });

  // ── Lifecycle ────────────────────────────────────────────────────────────

  protected override doBeginPlay(): void {
    super.doBeginPlay();
    this.getWorld()?.inputManager.addInputHandler(this._abilityInput.handler);
  }

  protected override doEndPlay(): void {
    this.getWorld()?.inputManager.removeInputHandler(this._abilityInput.handler);
    super.doEndPlay();
  }

  // ── Input handlers ───────────────────────────────────────────────────────

  private _onLMB(): void {
    if (this._isGlobalBlock()) return;
    // TODO: delegate to combo-attack → this._combo.onMouseDown()
  }

  private _onLMBUp(): void {
    // TODO: delegate to combo-attack → this._combo.onMouseUp()
  }

  private _onRMB(): void {
    if (this._isGlobalBlock()) return;
    if (!this._canUseSoulThrow()) return;
    this._executeSoulThrow();
  }

  private _onEKey(): void {
    if (this._isGlobalBlock()) return;
    if (!this._canUseAbilityE()) return;
    this._executeAbilityE();
  }

  private _onFKey(): void {
    const world = this.getWorld();
    if (!world) return;
    // TODO: trigger your transformation / special ability actor here
  }

  // ── Ability E ────────────────────────────────────────────────────────────

  /** Public trigger for HUD buttons and mobile controls. */
  public triggerAbilityE(): void {
    this._onEKey();
  }

  public static triggerAbilityE(world: ENGINE.World): void {
    const actor = world.getActors().find(
      (a): a is ExampleAbilityActor => a instanceof ExampleAbilityActor,
    );
    actor?.triggerAbilityE();
  }

  private _canUseAbilityE(): boolean {
    const world = this.getWorld();
    if (!world) return false;
    // TODO: replace with vault.getSkillLevel('abilityE') >= 1
    return this._cooldowns.isReady('abilityE', ExampleAbilityActor.ABILITY_E_COOLDOWN, world.getGameTime());
  }

  private _executeAbilityE(): void {
    const world = this.getWorld();
    if (!world) return;
    this._cooldowns.consume('abilityE', world.getGameTime());
    // TODO: spawn ability actor, play audio, etc.
  }

  /** 0 = ready, 1 = just used. Expose to HUD for a progress bar. */
  public getAbilityECooldownFraction(): number {
    const world = this.getWorld();
    if (!world) return 0;
    return this._cooldowns.remainingFraction(
      'abilityE',
      ExampleAbilityActor.ABILITY_E_COOLDOWN,
      world.getGameTime(),
    );
  }

  // ── Soul Throw (RMB) ─────────────────────────────────────────────────────

  public triggerSoulThrow(): void {
    this._onRMB();
  }

  private _canUseSoulThrow(): boolean {
    // TODO: replace with vault.getSkillLevel('soulThrow') >= 1
    return true;
  }

  private _executeSoulThrow(): void {
    // TODO: delegate to BoomerangSystem.launch(...)
  }

  // ── Global block ─────────────────────────────────────────────────────────

  /** Return true when all abilities should be suppressed (transformation, death, cutscene). */
  private _isGlobalBlock(): boolean {
    // TODO: return MyTransformationActor.isActive(world) || this._isDead
    return false;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────

  /** Call from your pawn or game mode when entering pause/map/death screens. */
  public releaseAllInput(): void {
    // TODO: this._combo.releaseCombatInput();
    // TODO: this._boomerang.dismissAll();
  }
}
