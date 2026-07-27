# ability-key-binding — Rationale

## Why IInputHandler instead of DOM events

Registering on `document.addEventListener('keydown')` bypasses the engine's input priority system. The engine can have multiple handlers registered (dialogue boxes, camera controls, the ability actor) and routes events in order. An ability actor that hooks the DOM directly will fire even when a modal is open and consuming input.

## Why a field rather than implementing the interface on the actor

```ts
private readonly _inputHandler: ENGINE.IInputHandler = { ... }
```

An actor that implements `IInputHandler` directly becomes harder to read because the private `_onLMB()` logic is mixed with the interface contract methods. Keeping the handler as a private field separates "what keys map to what" (the field) from "what happens" (the private methods). It also makes it trivial to add or remove the handler conditionally.

## Why all handlers return false

Returning `false` (not consuming input) lets multiple handlers co-exist. The ability actor should never swallow input events — it reacts to them and fires side effects. Camera, UI, and other systems should also receive the same events without needing to know about abilities.

## Why per-ability cooldown timestamps instead of timers

A decrementing `_eCooldownRemaining -= deltaTime` in `tick()` couples the cooldown logic to the tick loop. Timestamp comparison (`now - lastUsed < cooldown`) works the same way but does not require a tick method on the cooldown system itself, and is resilient to frame rate spikes — if a frame takes 200 ms the cooldown is still correct.

## Combining with combo-attack and projectile-boomerang

The `combo-attack` skill provides `ComboAttack` which handles its own LMB state. Wire it in `_onLMB()` and `_onLMBUp()`. The `projectile-boomerang` skill provides `BoomerangSystem` — wire `launch()` in `_onRMB()`. Both sub-systems live inside the same actor that owns the `AbilityInputMixin`.
