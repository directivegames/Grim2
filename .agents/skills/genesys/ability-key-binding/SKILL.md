# ability-key-binding

Wire mouse buttons and keyboard keys to game abilities using the Genesys input system. Each binding reads the current skill level from a vault, checks a per-ability cooldown, and triggers the ability. Expose a public trigger method on each ability so HUD buttons and mobile controls can fire the same logic.

---

## How it works

Implement `ENGINE.IInputHandler` on your actor (or as a private field). Register it with `world.inputManager.addInputHandler` in `beginPlay` and remove it in `endPlay`. Each handler method returns `false` so input continues propagating.

Cooldowns are tracked with a timestamp map keyed by ability ID. Check `world.getGameTime() - lastTime < COOLDOWN` before triggering.

---

## 1. Create the input handler field

```ts
private readonly _inputHandler: ENGINE.IInputHandler = {
  handleMouseDown: (button) => {
    if (button === ENGINE.MouseButton.Left)  { this._onLMB(); return false; }
    if (button === ENGINE.MouseButton.Right) { this._onRMB(); return false; }
    return false;
  },
  handleMouseUp: (button) => {
    if (button === ENGINE.MouseButton.Left) { this._onLMBUp(); return false; }
    return false;
  },
  handleKeyDown: (e) => {
    if (e.key === 'e' || e.key === 'E') { this._onEKey(); return false; }
    if (e.key === 'f' || e.key === 'F') { this._onFKey(); return false; }
    return false;
  },
  handleKeyUp:      () => false,
  handleMouseMove:  () => false,
  handleMouseClick: () => false,
  setInputManager:  () => { /* no-op */ },
};
```

---

## 2. Register and unregister

```ts
protected override doBeginPlay(): void {
  super.doBeginPlay();
  this.getWorld()?.inputManager.addInputHandler(this._inputHandler);
}

protected override doEndPlay(): void {
  this.getWorld()?.inputManager.removeInputHandler(this._inputHandler);
  super.doEndPlay();
}
```

---

## 3. Implement each ability method

```ts
private _onLMB(): void {
  if (this._isBlocked()) return;     // e.g. transformation active
  this._combo.onMouseDown();          // delegate to combo-attack
}

private _onRMB(): void {
  if (!this._canUseThrow()) return;
  this._launchBoomerang();
}

private _onEKey(): void {
  if (!this._canUseAbilityE()) return;
  this._triggerSpecialAbility();
}
```

---

## 4. Level gating

Read the ability's unlock level from your vault before doing anything:

```ts
private _canUseThrow(): boolean {
  if (vault.getSkillLevel('myThrow') < 1) return false;  // not unlocked
  if (this._isTransformationActive()) return false;
  return true;
}
```

A level of 0 means the ability has not been purchased. Gate all ability logic behind this check.

---

## 5. Per-ability cooldown

Track last-used time per ability and compare against `world.getGameTime()`:

```ts
private _lastETime = -Infinity;
private readonly E_COOLDOWN = 8.0; // seconds

private _canUseAbilityE(): boolean {
  const world = this.getWorld();
  if (!world) return false;
  if (vault.getSkillLevel('abilityE') < 1) return false;
  return world.getGameTime() - this._lastETime >= E_COOLDOWN;
}

private _triggerSpecialAbility(): void {
  if (!this._canUseAbilityE()) return;
  // ... spawn the ability actor
  this._lastETime = this.getWorld()!.getGameTime();
}
```

---

## 6. Expose public trigger methods for HUD / mobile

```ts
/** Called by the HUD button or mobile control. Same code path as the key. */
public triggerAbilityE(): void {
  this._onEKey();
}

/** Static helper so other actors can trigger without holding a reference. */
public static triggerAbilityE(world: ENGINE.World): void {
  const actor = world.getActors().find((a): a is MyWeaponActor => a instanceof MyWeaponActor);
  actor?.triggerAbilityE();
}
```

---

## 7. Block input when gameplay is suspended

When the game is paused or the player is on a map screen, clear held buttons:

```ts
public releaseAllInput(): void {
  this._combo.releaseCombatInput();
  this._boomerang.dismissAll();
}
```

Call this from your pause handler or from the pawn when it transitions to a non-gameplay state.

---

## Cooldown display helper

Expose remaining cooldown fraction for HUD progress bars:

```ts
getAbilityECooldownFraction(): number {
  const world = this.getWorld();
  if (!world) return 0;
  const elapsed = world.getGameTime() - this._lastETime;
  return Math.max(0, 1 - elapsed / E_COOLDOWN);
}
```

---

## Constraints

- All `handleXxx` methods must return `false` unless you want to swallow the input and prevent other handlers from receiving it.
- Do not register the handler in the constructor. Always register in `beginPlay` after the world is available.
- Keep each `_onXxx` method focused on one concern. Dispatch to sub-systems (`_combo`, `_boomerang`) rather than implementing the ability logic inline.
- `setInputManager` should be a no-op unless you need to track the manager reference.
