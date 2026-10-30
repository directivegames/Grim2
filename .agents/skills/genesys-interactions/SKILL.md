---
name: genesys-interactions
description: "Pickups, coins, health packs, keys, doors, switches, press-E interact prompts, triggers, hazards, checkpoints, moving platforms and lifts, tweened props. Use when the player collects, opens, uses, or steps on something, a prop moves, E does nothing, a pickup is not collected, or the player slides off a platform. Not for damage and health math (use `genesys-combat`), pickup pop and magnet feel (use `genesys-game-feel`), or race checkpoints and laps (use `genesys-vehicles`)."
metadata:
  tokens: 3124
---

# Interactions

This skill owns everything the player collects, uses, opens, triggers, or rides. The engine already ships the parts: `PickupNode`, `DoorNode`, `SwitchNode`, `TriggerZoneNode`, `ProximityInteractableNode`, `InteractionNode`, and three motion tools (`TweenMovementNode`, `world.tweenManager`, `PathMovementNode`). The rule: **extend these classes; do not hand-roll distance checks, key listeners, or lerp loops for them.**

Engine source: `.engine/src/nodes/gameplay/`, `.engine/src/nodes/movement/` (`TweenMovementNode`, `PathMovementNode`), `.engine/src/systems/TweenManager.ts`.

## Use another skill when
- Walk, jump, dash, or a control moving the wrong way → `genesys-movement`
- Particle sparkle on a pickup, burst on collect → `genesys-vfx`
- Collect, open, and switch sounds → `genesys-audio`
- The prompt label, score counter, key icons on the HUD → `genesys-ui`
- Health math behind a health pack, hazard damage → `genesys-combat`
- Placing many identical pickups or doors → `genesys-prefabs`, `genesys-level-authoring`
- Dynamic bodies pushed by forces, joints, hinges → `genesys-physics`
- Making a collect or open feel good (pop, bob, magnet, hitstop) → `genesys-game-feel`
- Shared pickups or doors online → `genesys-multiplayer`
- Race gates, laps, ordered checkpoints → `genesys-vehicles`
- Why gameplay roots need `isRoot`, `Delegate` events → `genesys-engine`

## Decide

| The player... | Use | Default settings |
|---|---|---|
| walks over a coin, gem, or ring | `PickupNode` subclass + a trigger primitive on the same root | Destroy on collect, sound, VFX pop, score +1 |
| walks over a health pack | `HealthPickupNode` with the engine model `@engine/assets/models/PickupActors/SM_Pickup_Health.glb` (or spawn `@engine/assets/prefabs/actors/demo_health_pickup.prefab.json`, `healAmount` 50) | `healAmount` 25; only pawns with `CharacterStatsNode` collect |
| presses E at a door | `DoorNode` with `interactionType: KeyPress` | `Hinged`, 1.0 s, 90° |
| walks up to an automatic door | `DoorNode` (default `interactionType: Proximity`) | Opens on enter, closes when the last player leaves |
| presses E at a lever, button, terminal | `SwitchNode` (`Toggle` or `Button`) | Wire `onActivated` / `onPressed` to the target |
| steps on a pressure plate | `SwitchNode` with `switchType: Proximity` | On while inside |
| presses E at a chest, NPC, or anything custom | `ProximityInteractableNode` subclass | `proximityRange` 2.0, priority 50–90 |
| enters an area (checkpoint, exit, hazard, cutscene) | `TriggerZoneNode` with `filter: PlayerOnly` | Box, scale 2 |
| rides a moving platform or lift | `PathMovementNode` + `PlatformCarryNode` (Build) on a kinematic root | `PingPong`, 2–4 m/s |
| sees a prop move once or loop (bob, spin, slide) | `TweenMovementNode` (placed via MCP) | `Cubic.InOut`, seconds |
| triggers a motion from code | `world.tweenManager.createTween(obj)` | milliseconds |

Every interaction the player must notice gets two channels: sound plus VFX or a UI change (`genesys-game-feel`). A pickup that vanishes silently is a defect.

## Build

### Player side

`GameplayPawn` and `DefaultCharacterPawn` auto-create an `InteractionNode` and expose `interact()` / `endInteract()`; `DefaultPlayerController` calls them on `E`. No code needed. Base `Pawn`, `MovementPawn`, `CharacterPawn` and `GSSCharacterPawn` do not: interactables register only with a pawn that passes `isInteractPawn`, and `GSSPlayerController` has no E key. A GSS hero needs a pawn that adds the `InteractionNode` and implements `IInteractPawn`, plus a controller that calls it on E ([interactables](references/interactables.md#a-gss-hero-that-interacts)). Online, the prompt runs on the client and the state change goes to the server (`genesys-multiplayer`).

`InteractionNode` picks among registered interactables by `canInteract`, then highest `getInteractionPriority()`, then nearest. For the HUD prompt, poll `pawn.getInteractionNode()?.getCurrentPrompt()` every 0.1 s and show it with a text setter (`genesys-ui`). An empty string means hide.

### Pickups

Source: .engine/demos/examples/side-scroller-advanced/pickups.ts (trimmed; root added — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class Coin extends ENGINE.PickupNode {
  public static readonly collected = new ENGINE.Delegate<[number]>();

  protected override canPickup(actor: ENGINE.SceneNode): boolean {
    return actor.isPlayerControlled();                 // default allows any Pawn
  }
  protected override onPickupInternal(collector: ENGINE.SceneNode): void {
    Coin.collected.invoke(1);                          // GameMode adds score
    super.onPickupInternal(collector);                 // plays sound, destroys root
  }
}

// Root: an isRoot node holding a trigger mesh + the Coin node.
const root = ENGINE.SceneNode.create({ isRoot: true, position });  // without isRoot nothing collects it
const mesh = ENGINE.ModelMeshNode.create({
  modelUrl: '@engine/assets/models/SM_Torus.glb', // blockout; swap for the real collectible
  physicsOptions: {
    enabled: true, motionType: ENGINE.PhysicsMotionType.Static,
    generateCollisionEvents: true, collisionProfile: ENGINE.DefaultCollisionProfile.Trigger,
  },
});
root.add(mesh, Coin.create({ sound: { pickupSoundUrl: '@engine/assets/sounds/pickup.mp3', volume: 0.6 } }));
world.add(root);
```

**`isRoot` rule.** `PickupNode` destroys `getRoot()` and reads the collector's `getRoot()`; `getRoot()` walks up to the nearest node with `isRoot` and returns `null` if there is none. A code-built pickup, door or hazard without an `isRoot` ancestor never collects and never despawns. Built-in pawns are roots already. A class that is always a placeable sets `this.isRoot = true` in its constructor (the side-scroller demo's `CoinPickupNode`); one-offs pass `isRoot: true` to `create` (`genesys-engine`).

`PickupNode` finds the first `PrimitiveNode` under its root that has `generateCollisionEvents` and a trigger collider (a `QueryOnly` profile such as `Trigger`). It looks on the next tick and again when each `ModelMeshNode` finishes loading. It then listens to `onOverlapWith`. `onPickup(pickupRoot, collector)` fires before `onPickupInternal`.

### Doors, switches, custom interactables

A custom interactable (chest, terminal, NPC) extends `ProximityInteractableNode`: override `beginInteract`, `canInteract` (in range and not used up), `getInteractionPrompt` and `getInteractionPriority` (50–90; doors 100, switches 80). Example: [interactables](references/interactables.md#custom-interactables).

`DoorNode` animates the first `ModelMeshNode` under its root with its own tween group on game time. Wire a switch to a door: `lever.onActivated.add(() => door.open())`, `lever.onDeactivated.add(() => door.close())`. Options, prompts, priorities, and the locked-door pattern are in [interactables](references/interactables.md).

### Triggers

Source: .engine/src/nodes/gameplay/TriggerZoneNode.ts
```ts
const exit = ENGINE.TriggerZoneNode.create({
  position: new THREE.Vector3(0, 1, -40),
  scale: new THREE.Vector3(4, 3, 1),
  filter: ENGINE.TriggerFilter.PlayerOnly,
});
exit.onActorEntered.add((actor) => gameMode.finishLevel());
world.add(exit);
```

Place level triggers with MCP when they belong to the level (`genesys-mcp-orchestrator`), and bind their delegates from the GameMode by name or from a `GAME` subclass.

### Tweened props and moving platforms

Two tween APIs share `world.tweenManager`, plus a path mover ([tweened-props](references/tweened-props.md)):
- **Placed prop** move, rotate or scale → `ENGINE.TweenMovementNode`, placed with MCP; `duration` in **seconds**. Create it in code only for runtime-spawned props, and never drive one transform from two sources.
- **From gameplay code** → `world.tweenManager.createTween(obj).to(target, ms).start(world.tweenManager.getCurrentTime())`: **milliseconds**, on the manager's game clock. The manager untracks the tween when it completes or stops, also when you set your own `.onComplete` / `.onStop`.
- **Platform or lift** → `ENGINE.PathMovementNode` (`path` curve, `speed` u/s, `PingPong`) on a kinematic root.

Source: .engine/src/nodes/movement/TweenMovementNode.ts (header comment and `startTween`), .engine/src/systems/TweenManager.ts
```ts
const lid = { angle: 0 };
world.tweenManager.createTween(lid)
  .to({ angle: -Math.PI / 2 }, 400)                 // milliseconds
  .easing((k: number) => 1 - (1 - k) * (1 - k))     // ease-out; see reference for TWEEN.Easing
  .onUpdate(() => lidNode.rotation.set(lid.angle, 0, 0))
  .start(world.tweenManager.getCurrentTime());      // manager clock; lint requires the argument
```

**Riders are not carried.** The character controller has no platform logic, so a standing player stays put while the platform slides away. Add a `PlatformCarryNode` under the platform root that moves each grounded classic pawn standing on it by the platform's frame delta ([tweened-props](references/tweened-props.md#riding-a-moving-platform)); GSS riders are carried through the sim (`genesys-movement`).

## Limitations

- Player stays behind while the platform moves away → the character controller does not inherit platform motion → `PlatformCarryNode` (*Tweened props*).

## Traps

- A `KeyPress` door never opens on E → default `interactionType` is `Proximity` (auto-open), and `canInteract` is true only for `KeyPress` → set `interactionType: ENGINE.DoorInteractionType.KeyPress`.
- NPCs or debris collect pickups, or fire a zone → default `canPickup` allows any `Pawn`, default `TriggerFilter.All` → override `canPickup`; `filter: PlayerOnly`.
- Code-built pickup never collects, or the player can't collect it → no `isRoot` ancestor, so `getRoot()` is `null` → `create({ isRoot: true })` on the holder (Pickups, above).
- Pickup never collects → no trigger primitive (`generateCollisionEvents` plus a trigger profile) under the pickup root → add one; check with `query_node`.
- Prompt text from a player name or chat injected HTML → set through `innerHTML` → text setters only (`genesys-ui` Safe UI).
- Locked door with no prompt, door that never moves: [interactables](references/interactables.md#traps). Trigger filters, `onActorStay`, the health pack prefab: [pickups-and-triggers](references/pickups-and-triggers.md#traps). Tweens piling up, late, popping, sinking platforms, the `TWEEN` import: [tweened-props](references/tweened-props.md#traps).

## Done

- `query_node` on each interactable root: the gameplay node is present, and pickups and triggers have a physics primitive with collision events and a trigger profile.
- In Play: walk into each pickup. It disappears with sound plus VFX, and the counter changes. An NPC walking through does not collect it.
- Stand at each door, switch, or custom interactable. The prompt appears in range, disappears out of range, and E does the thing. A locked door says it is locked.
- Each trigger fires once on enter for the player only, and the level reacts (checkpoint saved, exit reached, hazard hurts).
- Every tweened prop visibly starts and finishes its motion. Stand still on each moving platform for 5 s: the player rides it without jitter, sliding, or falling off (verify in Play).
- Retry resets pickups, doors, and switches to their start state.

## References
- [interactables](references/interactables.md) — the GSS hero that interacts, `InteractionNode`, `ProximityInteractableNode` (chest example), `DoorNode`, `SwitchNode`: options, delegates, prompts, priorities, patterns, door traps
- [pickups-and-triggers](references/pickups-and-triggers.md) — `PickupNode`, `HealthPickupNode`, `PickupSpawnerNode`, `TriggerZoneNode`, respawning pickups, checkpoints, hazards, level exits
- [tweened-props](references/tweened-props.md) — `TweenMovementNode` options and easing names, `TweenManager` API, `PathMovementNode`, `PlatformCarryNode`, physics rules, tween limitations and traps
