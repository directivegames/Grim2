---
name: pickups-interactions-and-doors
description: Genesys player–world interaction components. Use for collectibles, usable objects, doors, switches, and area triggers.
---

# World Interaction

Engine support for player–world interaction lives in `.engine/components/gameplay/` (monorepo: `packages/engine/src/components/gameplay/`). Read source for APIs and options — this skill maps what exists and flags non-obvious pitfalls.

## What's available

**Player (`GameplayPawn.ts` / `DefaultCharacterPawn.ts`)** — these pawn classes auto-receive an `InteractionComponent` in `doBeginPlay` and expose `interact()` / `endInteract()` for a `PlayerController` to call (base `Pawn`/`MovementPawn`/`CharacterPawn` do not). HUD prompts via `getCurrentPrompt()`.

**Interactable contract (`IInteractable.ts`)** — interface for press-to-interact objects: `canInteract`, `beginInteract`, `getInteractionPrompt`, `getInteractionPriority`, optional `endInteract`. Anything can implement it; built-ins use the proximity base below.

**Proximity interactables (`ProximityInteractableComponent.ts`)** — abstract base that detects players in range, registers with the pawn's `InteractionComponent`, and supports key-press or automatic proximity activation. Extend for custom levers, NPCs, terminals, etc.

**Built-in proximity interactables**
- `DoorComponent.ts` — hinged/sliding/garage doors; proximity auto-open or key-press; lock state and animation delegates
- `SwitchComponent.ts` — toggle, proximity, and button switch types; activation delegates

**Pickups (`PickupComponent.ts`)** — overlap-based collection on a trigger mesh; `canPickup` guard, `onPickup` delegate, default destroy-on-collect. Same file: `HealthPickupComponent`, `PickupSpawnerComponent`.

**Trigger volumes (`TriggerZoneComponent.ts`)** — collision volumes with enter/exit/stay delegates; actor filtering via `TriggerFilter`.

**Interaction hub (`InteractionComponent.ts`)** — on the player pawn; holds registered interactables, selects by `canInteract` + priority + distance.

These pieces compose — e.g. a keyed door extends `DoorComponent`, a coin subclasses `PickupComponent`, a level exit uses `TriggerZoneComponent`, a custom crate implements `IInteractable` or extends `ProximityInteractableComponent`.

## Footguns

- **Locked doors hide the prompt** — `DoorComponent.canInteract()` returns `false` when locked, so `getCurrentPrompt()` shows nothing. Override `canInteract()` to return `true` in range; validate keys in `beginInteract()`; return a locked message from `getInteractionPrompt()`.
- **Pickup filter** — default `canPickup` allows any `Pawn`. Override for player-only or inventory checks.
- **Trigger filter** — default `TriggerFilter.All`. Use `PlayerOnly` / `PawnsOnly` / `Custom` or NPCs and debris fire the zone.
- **Pickup trigger mesh** — without a trigger `PrimitiveComponent` (`generateCollisionEvents` + `isTrigger`), overlap never fires.

## Source index

Start with `index.ts`, then open the file for the component you need.

| File | Contents |
| --- | --- |
| `InteractionComponent.ts` | Player-side interactable selection and prompts |
| `IInteractable.ts` | Interactable interface and type guard |
| `ProximityInteractableComponent.ts` | Proximity detection, registration, base for custom interactables |
| `DoorComponent.ts` | Door types, interaction modes, animation, lock state |
| `SwitchComponent.ts` | Switch types and activation |
| `PickupComponent.ts` | Pickup, health pickup, spawner |
| `TriggerZoneComponent.ts` | Area triggers and filters |
| `../actors/GameplayPawn.ts`, `../actors/DefaultCharacterPawn.ts` | InteractionComponent auto-create, `interact()`/`endInteract()` action methods |
