# Mobile Trigger Pattern

## Problem

On touch devices there is no keyboard and the mouse position is unreliable. HUD buttons must call the same ability code that key presses and mouse clicks trigger.

## Solution

Expose one public trigger method per ability on the actor. Make it call the same private `_onXxx()` handler that the `IInputHandler` calls. Add a static convenience overload that finds the actor in the world.

```ts
// Instance method — used by the HUD element that holds a reference
public triggerAbilityE(): void {
  this._onEKey();
}

// Static helper — used when only the world reference is available
public static triggerAbilityE(world: ENGINE.World): void {
  const actor = world.getActors().find(
    (a): a is MyAbilityActor => a instanceof MyAbilityActor,
  );
  actor?.triggerAbilityE();
}
```

## HUD wiring

```ts
const btn = document.createElement('button');
btn.textContent = 'E';
btn.addEventListener('pointerdown', () => {
  MyAbilityActor.triggerAbilityE(world);
});
world.gameContainer.appendChild(btn);
```

Or use a `BaseUIComponent` button widget and wire the click callback the same way.

## Auto-swing on mobile (melee)

For LMB-driven combo attacks on mobile, expose a method the HUD joystick's `onHeld` callback can call:

```ts
// Inside your ability actor:
public tryMobileAutoMelee(): void {
  if (this._isGlobalBlock()) return;
  this._combo.onMouseDown();
}
```

Call `tryMobileAutoMelee()` each frame the movement stick is held, and call `_combo.onMouseUp()` when the stick is released.
