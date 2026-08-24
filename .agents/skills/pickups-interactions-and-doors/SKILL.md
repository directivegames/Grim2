---
name: pickups-interactions-and-doors
description: Genesys player–world interaction nodes — pickups, collectibles, coins, health packs, usable objects, press-to-interact prompts, doors, levers, switches, buttons, terminals, and area/trigger volumes. Use when the player must collect, use, open, activate, or walk into something, or when the user mentions interact, pickup, door, switch, or trigger zone.
---

# World Interaction

Engine support for player–world interaction lives in `.engine/src/nodes/gameplay/`.
Read source for APIs and options — this skill maps what exists and flags
non-obvious pitfalls.

## What's available

Player — `GameplayPawn.ts` and `DefaultCharacterPawn.ts` in `.engine/src/entities/`
(a sibling of `.engine/src/nodes/gameplay/`, not nested under it). These pawn classes
auto-receive an `InteractionNode` in `beginPlay` and expose `interact()` /
`endInteract()` for a `PlayerController` to call; base `Pawn` / `MovementPawn` /
`CharacterPawn` do not. HUD prompts come from `getCurrentPrompt()`.

Interactable contract (`IInteractable.ts`) — interface for press-to-interact objects:
`canInteract`, `beginInteract`, `getInteractionPrompt`, `getInteractionPriority`, and
optional `endInteract`. Anything can implement it; built-ins use the proximity base
below. Player parameters use `SceneNode`.

Proximity interactables (`ProximityInteractableNode.ts`) — abstract base that detects
players in range, registers with the pawn's `InteractionNode`, and supports key-press
or automatic proximity activation. Extend it for custom levers, NPCs, and terminals.

Built-in proximity interactables:

- `DoorNode.ts` — hinged/sliding/garage doors; proximity auto-open or key-press; lock state and animation delegates.
- `SwitchNode.ts` — toggle, proximity, and button switch types; activation delegates.

Pickups (`PickupNode.ts`) — overlap-based collection on a trigger mesh; `canPickup`
guard, `onPickup` delegate, default destroy-on-collect. The same file holds
`HealthPickupNode` and `PickupSpawnerNode`.

Trigger volumes (`TriggerZoneNode.ts`) — collision volumes with enter/exit/stay
delegates; root filtering via `TriggerFilter`. `getActorsInZone` / `isActorInZone`
keep their names but accept and return `SceneNode`.

Interaction hub (`InteractionNode.ts`) — lives on the player pawn; holds registered
interactables and selects by `canInteract`, priority, then distance.

These pieces compose: a keyed door extends `DoorNode`, a coin subclasses `PickupNode`,
a level exit uses `TriggerZoneNode`, a custom crate implements `IInteractable` or
extends `ProximityInteractableNode`.

## Footguns

- Locked doors hide the prompt — `DoorNode.canInteract()` returns `false` when locked, so `getCurrentPrompt()` shows nothing. Override `canInteract()` to return `true` in range, validate keys in `beginInteract()`, and return a locked message from `getInteractionPrompt()`.
- Pickup filter — default `canPickup` allows any `Pawn`. Override for player-only or inventory checks.
- Trigger filter — default `TriggerFilter.All`. Use `PlayerOnly` / `PawnsOnly` / `Custom`, or NPCs and debris fire the zone.
- Pickup trigger mesh — without a trigger `PrimitiveNode` (`generateCollisionEvents` plus `isTrigger`), overlap never fires.
- `PickupSpawnerNode.spawnPickup` may be unimplemented — read the method body in `PickupNode.ts` before using the spawner. If it only logs a warning, spawn pickups yourself rather than presenting the spawner as working.

## Source index

Start with `index.ts`, then open the file for the node you need.

| File | Contents |
| --- | --- |
| `InteractionNode.ts` | Player-side interactable selection and prompts |
| `IInteractable.ts` | Interactable interface and type guard |
| `ProximityInteractableNode.ts` | Proximity detection, registration, base for custom interactables |
| `DoorNode.ts` | Door types, interaction modes, animation, lock state |
| `SwitchNode.ts` | Switch types and activation |
| `PickupNode.ts` | Pickup, health pickup, and spawner |
| `TriggerZoneNode.ts` | Area triggers and filters |
| `../../entities/GameplayPawn.ts`, `../../entities/DefaultCharacterPawn.ts` | InteractionNode auto-create, `interact()`/`endInteract()` action methods |
