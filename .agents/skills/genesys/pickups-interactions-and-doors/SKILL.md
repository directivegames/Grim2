---
name: pickups-interactions-and-doors
description: Genesys player–world interaction nodes. Use for collectibles, usable objects, doors, switches, and area triggers.
---

# World Interaction

Engine support for player–world interaction lives in `.engine/nodes/gameplay/` (monorepo: `packages/engine/src/nodes/gameplay/`). Read source for APIs and options — this skill maps what exists and flags non-obvious pitfalls.

## What's available

**Player (`GameplayPawn.ts` / `DefaultCharacterPawn.ts` under `entities/`)** — these pawn classes auto-receive an `InteractionNode` in `beginPlay` and expose `interact()` / `endInteract()` for a `PlayerController` to call (base `Pawn`/`MovementPawn`/`CharacterPawn` do not). HUD prompts via `getCurrentPrompt()`.

**Interactable contract (`IInteractable.ts`)** — interface for press-to-interact objects: `canInteract`, `beginInteract`, `getInteractionPrompt`, `getInteractionPriority`, optional `endInteract`. Anything can implement it; built-ins use the proximity base below. Player parameters use `SceneNode`.

**Proximity interactables (`ProximityInteractableNode.ts`)** — abstract base that detects players in range, registers with the pawn's `InteractionNode`, and supports key-press or automatic proximity activation. Extend for custom levers, NPCs, terminals, etc.

**Built-in proximity interactables**
- `DoorNode.ts` — hinged/sliding/garage doors; proximity auto-open or key-press; lock state and animation delegates
- `SwitchNode.ts` — toggle, proximity, and button switch types; activation delegates

**Pickups (`PickupNode.ts`)** — overlap-based collection on a trigger mesh; `canPickup` guard, `onPickup` delegate, default destroy-on-collect. Same file: `HealthPickupNode` and `PickupSpawnerNode`. **`PickupSpawnerNode.spawnPickup` is currently a stub** — it only warns `Prefab spawning not implemented` and does not spawn; do not present the spawner as a working variant until that is implemented.

**Trigger volumes (`TriggerZoneNode.ts`)** — collision volumes with enter/exit/stay delegates; root filtering via `TriggerFilter`. (`getActorsInZone` / `isActorInZone` keep their names but accept/return `SceneNode`.)

**Interaction hub (`InteractionNode.ts`)** — on the player pawn; holds registered interactables, selects by `canInteract` + priority + distance.

These pieces compose — e.g. a keyed door extends `DoorNode`, a coin subclasses `PickupNode`, a level exit uses `TriggerZoneNode`, a custom crate implements `IInteractable` or extends `ProximityInteractableNode`.

## Footguns

- **Locked doors hide the prompt** — `DoorNode.canInteract()` returns `false` when locked, so `getCurrentPrompt()` shows nothing. Override `canInteract()` to return `true` in range; validate keys in `beginInteract()`; return a locked message from `getInteractionPrompt()`.
- **Pickup filter** — default `canPickup` allows any `Pawn`. Override for player-only or inventory checks.
- **Trigger filter** — default `TriggerFilter.All`. Use `PlayerOnly` / `PawnsOnly` / `Custom` or NPCs and debris fire the zone.
- **Pickup trigger mesh** — without a trigger `PrimitiveNode` (`generateCollisionEvents` + `isTrigger`), overlap never fires.

## Source index

Start with `index.ts`, then open the file for the node you need.

| File | Contents |
| --- | --- |
| `InteractionNode.ts` | Player-side interactable selection and prompts |
| `IInteractable.ts` | Interactable interface and type guard |
| `ProximityInteractableNode.ts` | Proximity detection, registration, base for custom interactables |
| `DoorNode.ts` | Door types, interaction modes, animation, lock state |
| `SwitchNode.ts` | Switch types and activation |
| `PickupNode.ts` | Pickup, health pickup, spawner (`spawnPickup` stub — warns only) |
| `TriggerZoneNode.ts` | Area triggers and filters |
| `entities/GameplayPawn.ts`, `entities/DefaultCharacterPawn.ts` | InteractionNode auto-create, `interact()`/`endInteract()` action methods |
