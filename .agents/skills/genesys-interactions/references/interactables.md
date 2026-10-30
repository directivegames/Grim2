# Interactables

Source: `.engine/src/nodes/gameplay/`. Start with `index.ts`, then open the file for the node you need.

## How the pieces compose

- **Player side.** `GameplayPawn.ts` and `DefaultCharacterPawn.ts` live in `.engine/src/entities/` (a sibling of `nodes/gameplay/`, not nested under it). They auto-create an `InteractionNode` in `beginPlay` and expose `interact()` / `endInteract()` for a `PlayerController` to call. Both implement `IInteractPawn` (`interact`, `endInteract`, `getInteractionNode`), checked with `isInteractPawn(pawn)`. Base `Pawn`, `MovementPawn`, and `CharacterPawn` do not. `DefaultPlayerController` maps `E` to `interact()` on press and `endInteract()` on release.
- **Interactable contract** (`IInteractable.ts`): `beginInteract(player)`, optional `endInteract(player)` (hold-to-interact), `canInteract(player)`, `getInteractionPrompt()`, `getInteractionPriority()`, `getWorldPosition()`. `isInteractable(obj)` is the type guard. Anything can implement it; the built-ins use the proximity base. Player parameters are `SceneNode`.
- **Proximity base** (`ProximityInteractableNode.ts`): abstract. Detects players in range, registers itself with the player's `InteractionNode`, and supports key-press or automatic proximity activation. Extend it for custom levers, NPCs, chests, and terminals.
- **Hub** (`InteractionNode.ts`): lives on the player pawn. Holds registered interactables (as `WeakRef`s) and selects by `canInteract`, then priority (higher first), then distance (closer first).

These compose: a keyed door extends `DoorNode`, a coin subclasses `PickupNode`, a level exit uses `TriggerZoneNode`, and a custom crate implements `IInteractable` or extends `ProximityInteractableNode`. Repeated pickups or doors that share an authored hierarchy should be Prefabs (`genesys-prefabs`), not copy-pasted node trees.

## A GSS hero that interacts

The short version is in [SKILL.md → Player side](../SKILL.md#player-side). `GameplayPawn` and `DefaultCharacterPawn` auto-create an `InteractionNode` in `beginPlay` and expose `interact()` / `endInteract()`. `DefaultPlayerController` calls them on `E`. No code needed. Base `Pawn`, `MovementPawn`, `CharacterPawn` and `GSSCharacterPawn` do not do this. Interactables register only with a pawn that passes `isInteractPawn` (`interact`, `endInteract`, `getInteractionNode`), and `GSSPlayerController` has no E key. A GSS hero needs both halves:

Source: .engine/src/entities/DefaultCharacterPawn.ts, .engine/src/entities/PawnActions.ts, .engine/src/gameplay-sim/entities/GSSPlayerController.ts
```ts
@ENGINE.GameClass()
export class InteractingGSSHero extends ENGINE.GSSCharacterPawn implements ENGINE.IInteractPawn {
  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    if (!this.getNode(ENGINE.InteractionNode)) this.add(ENGINE.InteractionNode.create({}));
    return true;
  }
  public interact(): boolean { return this.getInteractionNode()?.beginInteract() ?? false; }
  public endInteract(): void { this.getInteractionNode()?.endInteract(); }
  public getInteractionNode(): ENGINE.InteractionNode | null { return this.getNode(ENGINE.InteractionNode); }
}

@ENGINE.GameClass()
export class InteractingGSSController extends ENGINE.GSSPlayerController {
  public override handleKeyDown(e: KeyboardEvent): boolean {
    const pawn = this.getPawn();
    if (e.code === 'KeyE' && ENGINE.isInteractPawn(pawn)) { pawn.interact(); return true; }
    return super.handleKeyDown(e);
  }
  public override handleKeyUp(e: KeyboardEvent): boolean {
    const pawn = this.getPawn();
    if (e.code === 'KeyE' && ENGINE.isInteractPawn(pawn)) { pawn.endInteract(); return true; }
    return super.handleKeyUp(e);
  }
}
```
Online, the interact runs on the client for the prompt; the state change (door open) goes to the server (`genesys-multiplayer`).

## `InteractionNode`

| Method | Does |
|---|---|
| `beginInteract()` | Cleans dead refs, selects the best target, and calls its `beginInteract(player)` if `canInteract`. Returns whether it started. |
| `endInteract()` | Calls `endInteract(player)` on the current target, if it has one. |
| `register(i)` / `unregister(i)` | Called by interactables as players enter and leave range. |
| `getCurrentPrompt()` | Prompt of the best available target, or `''`. Poll it for the HUD. |
| `hasAvailableInteractable()` | Any target with `canInteract` true. |
| `getCurrentInteractable()`, `getRegisteredInteractables()` | Inspection. |

## `ProximityInteractableNode`

Options: `proximityRange` (default `2.0`, min 0.5), `useKeyPressInteraction` (default `true`; `false` = automatic on proximity, no registration with the hub).

Detection:
- If the root already has a `CollisionShapeNode`, it binds that shape's `onOverlapWith` / `onStopOverlappingWith`.
- Otherwise it creates a transient root with a `CollisionShapeNode` box trigger (`Static`, `Trigger` profile, collision events) scaled `proximityRange × 2` wide, `2.5` tall, `proximityRange × 2` deep, positioned by `calculateTriggerPosition()` (root position + 1.25 up; override to move it).
- A "player" is any root where `isPlayerControlled()` is true (`isPlayerPawn`, overridable).

Hooks to override: `onPlayerEntered(player)`, `onPlayerLeft(player)`, `onFirstPlayerEntered()`, `onLastPlayerLeft()`. Delegates: `onPlayerEnteredRange`, `onPlayerLeftRange`. Queries: `hasPlayersInRange()`, `getPlayerCountInRange()`, `getPlayersInRange()`, `isPlayerInRange(player)`.

Abstract methods you implement: `beginInteract`, `canInteract`, `getInteractionPrompt`, `getInteractionPriority`.

## `DoorNode`

| Option | Default | Notes |
|---|---|---|
| `doorType` | `DoorType.Hinged` | `Hinged` (Y rotation), `Sliding` (along `slideDirection`), `Garage` (rotate and lift, basic), `Double` (placeholder, uses hinged), `Custom` (you animate from delegates) |
| `interactionType` | `DoorInteractionType.Proximity` | `Proximity` auto-opens on first player in range and closes when the last leaves. `KeyPress` needs E. `Remote` is reserved. |
| `animationDuration` | `1.0` s | |
| `maxOpenAngle` | `90`° | Hinged |
| `slideDistance` | `2.0` | Sliding |
| `slideDirection` | `(1, 0, 0)` local | Sliding |
| `startLocked` | `false` | |

Methods: `open()` (fires `onDoorLocked` instead if locked; can reverse a closing animation), `close()`, `toggle()`, `lock()`, `unlock()`, `isOpen()`, `isLocked()`, `isAnimating()`, `getState()` (`DoorState`: `Closed`, `Opening`, `Open`, `Closing`, `Locked`).

Delegates: `onDoorStartOpening`, `onDoorStartClosing`, `onDoorOpened`, `onDoorClosed`, `onDoorLocked`, `onDoorUnlocked`, `onInteractionAttempt`.

Interaction: `canInteract` = in range **and** `KeyPress` mode, locked or not, so a locked door shows `'Locked'` (otherwise `'Open Door'`). Priority `100`. On a locked door, the interact key raises `onInteractionAttempt` and `onDoorLocked`, and the door stays shut.

Mesh: the door animates the first `ModelMeshNode` under its root (waiting for the model to load). It scores child meshes by name (`door`, `panel`, `leaf`) and tall shape to find the panel. It animates the `ModelMeshNode`'s transform relative to its initial pose. The panel's pivot is the model's origin, so author hinge doors with the origin on the hinge edge. The proximity trigger is centered on the panel's bounding box.

**Keyed door pattern**: on `onInteractionAttempt`, if the door is locked and the player has the key, `unlock()` then `open()`; play the rattle sound on `onDoorLocked`. For a custom prompt (`'Locked — needs Red Key'`), subclass `DoorNode` and override `getInteractionPrompt()`.

## `SwitchNode`

| Option | Default | Notes |
|---|---|---|
| `switchType` | `SwitchType.Toggle` | `Toggle` (on/off by E), `Proximity` (on while a player is in range; no key press), `Button` (fires `onPressed` every press, no state) |
| `initialState` | `SwitchState.Off` | |
| `proximityRange`, `useKeyPressInteraction` | from the base | `useKeyPressInteraction` is set from the type (`false` only for `Proximity`) |

Methods: `activate()`, `deactivate()`, `toggle()`, `isActive()`, `getState()`, `getSwitchType()`, `enableInteraction()`, `disableInteraction()`, `isInteractionEnabled()`.

Delegates: `onActivated`, `onDeactivated`, `onPressed` (Button), `onInteractionAttempt`.

Prompts: Toggle `'Press E to Turn On'` / `'Press E to Turn Off'`, Button `'Press E to Activate'`, Proximity `''`. Priority `80` (below doors). Override `getInteractionPrompt()` when the game uses a different key or touch (`genesys-touch-controls`).

**Wiring**: switches do not know their targets. Connect them in a `GAME` subclass, or in the GameMode after the level loads, by finding nodes by name: `lever.onActivated.add(() => door.open())`. Puzzle logic (all three plates down → gate opens) lives in one small controller node that listens to each switch.

## Custom interactables

Extend `ProximityInteractableNode`:

Source: .engine/src/nodes/gameplay/ProximityInteractableNode.ts, SwitchNode.ts
```ts
@ENGINE.GameClass()
export class Chest extends ENGINE.ProximityInteractableNode {
  public readonly onOpened = new ENGINE.Delegate<[ENGINE.SceneNode]>();
  private opened = false;

  public beginInteract(player: ENGINE.SceneNode): boolean {
    if (!this.canInteract(player)) return false;
    this.opened = true;
    this.onOpened.invoke(player);                      // play lid tween, sound, loot
    return true;
  }
  public canInteract(player: ENGINE.SceneNode): boolean {
    return !this.opened && this.isPlayerInRange(player);
  }
  public getInteractionPrompt(): string { return 'Open chest'; }
  public getInteractionPriority(): number { return 60; }
}
```

 Priorities: doors 100, switches 80, so pick 50–90 for chests, terminals, and NPCs, and above 100 only for something that must win (a revive prompt). For hold-to-interact (charge a terminal, revive), implement `endInteract(player)` and track hold time on game time; show progress on a meter (`genesys-ui`).

NPC talk: a `ProximityInteractableNode` on the NPC root with prompt `'Talk'`. `beginInteract` opens the dialogue UI and returns true. Dialogue text from players or the network goes through text setters only.

## Multiplayer

Interaction state (door open, switch on, pickup taken) must change on the authority and replicate. The proximity and prompt logic runs per client for the local player. See `genesys-multiplayer`.

## Traps

- Locked door shows no prompt → its `interactionType` is `Proximity`, which opens by itself and never prompts → use `KeyPress` for doors that lock.
- A `KeyPress` door never opens on E → default `interactionType` is `Proximity` (auto-open), and `canInteract` is true only for `KeyPress` → set `interactionType: ENGINE.DoorInteractionType.KeyPress`.
- Door does not move → no `ModelMeshNode` under the door root (it warns "No GLTF mesh component found") → the door panel must be a `ModelMeshNode`; or use `DoorType.Custom` and animate from `onDoorStartOpening` / `onDoorStartClosing`.
