# Find an engine class

The short procedure is in [SKILL.md → Find an engine class](../SKILL.md#find-an-engine-class). This file holds the full table of engine classes with source paths, what the API digest contains, the commands, and the synonym list.

## Engine already has it (with paths)

Paths are under `.engine/src/`.

| Game need | Engine class (path) | Owner |
|---|---|---|
| Walk, jump, fall | `CharacterMovementNode` (`nodes/movement/CharacterMovementNode.ts`), `GSSCharacterPawn` + `GSSNode` (`gameplay-sim/`) | `genesys-movement` |
| Fly, plane, spectator, NPC locomotion | `AerialMovementNode`, `AirplaneMovementNode`, `SpectatorMovementNode`, `NpcMovementNode`, `PathMovementNode` (`nodes/movement/`) | `genesys-movement` |
| RTS camera pan and zoom (not a top-down hero) | `TopDownMovementNode` (`nodes/movement/TopDownMovementNode.ts`) | `genesys-camera` |
| Car | `VehicleMovementNode` (`nodes/movement/VehicleMovementNode.ts`) | `genesys-vehicles` |
| Third-person camera boom | `SpringArmNode` (`nodes/movement/SpringArmNode.ts`); `CharacterPawn` builds it | `genesys-camera` |
| Cutscene / spectator camera | `ViewTargetCameraNode` (`nodes/ViewTargetCameraNode.ts`), `world.pushViewTargetCamera()` | `genesys-camera` |
| Gun that fires bullets | `ProjectileWeaponNode`, `ShotgunNode`, `InstantHitWeaponNode` (`nodes/gameplay/`) | `genesys-combat` |
| Bullet / thrown object | `Projectile` (`entities/Projectile.ts`) | `genesys-combat` |
| Health, damage, regen, death | `CharacterStatsNode` (`nodes/CharacterStatsNode.ts`): `takeDamage`, `heal`, `revive`, `getIsDead` | `genesys-combat` |
| Fire / interact on the pawn | `GameplayPawn`, `DefaultCharacterPawn` (`entities/`) | `genesys-combat` |
| Particles | `VFXNode` (`vfx/VFXNode.ts`), `world.globalParticleManager.spawnVFX()` (`entities/GlobalParticleManager.ts`) | `genesys-vfx` |
| Sound, music, 3D audio | `SoundNode` (`nodes/audio/SoundNode.ts`) | `genesys-audio` |
| Enemy brain | `BehaviorTreeNode` (`npc/behavior-tree/BehaviorTreeNode.ts`), `AIController` (`entities/AIController.ts`) | `behavior-tree`, `genesys-creatures` |
| Pathfinding | `RecastNavigationServer` (`navigation/RecastNavigationServer.ts`), `INavigationServer.calculatePath` (`navigation/NavigationServer.ts`) | `genesys-navigation` |
| Moving platform, door panel, lift | `TweenMovementNode` (`nodes/movement/TweenMovementNode.ts`), `world.tweenManager` | `genesys-interactions` |
| Pickup, health pack, respawning pickup | `PickupNode`, `HealthPickupNode`, `PickupSpawnerNode` (`nodes/gameplay/PickupNode.ts`) | `genesys-interactions` |
| Door, switch, press-to-use | `DoorNode`, `SwitchNode`, `ProximityInteractableNode`, `InteractionNode` (`nodes/gameplay/`) | `genesys-interactions` |
| Trigger volume | `TriggerZoneNode` (`nodes/gameplay/TriggerZoneNode.ts`) | `genesys-interactions` |
| Follow a target | `FollowNode` (`nodes/FollowNode.ts`) | `genesys-camera`, `genesys-creatures` |
| HUD, bars, counters, crosshair, menus | `BaseUIComponent` widgets: `StatBar`, `ProgressBar`, `NumberDisplay`, `Crosshair`, `Button`, `CenterMessage`, `AmmoCounter`, `Minimap` … (`ui/components/`) | `genesys-ui` |
| Timers | `world.timerSystem` (`systems/TimerSystem.ts`) | `genesys-engine` |
| Events between modules | `Delegate`, `SinglecastDelegate` (`utils/Delegate.ts`) | `genesys-engine` ([contracts](contracts.md)) |
| Pause one node's tick | `setTickEnabled`, `setTickInterval` (`nodes/SceneNode.ts`) | `genesys-engine`; hitstop → `genesys-game-feel` |

## The API digest

The engine package ships a compact API digest in `node_modules/@gnsx/genesys.js/artifacts/`. It is generated from the source, so it matches the installed engine.

- `classes/<ClassName>.md`: one file per exported class. Each holds the class JSDoc (what it does, `@gotcha` pitfalls, `@see` related classes), the source path under `src/` and whether it is serializable, the `extends` clause, and every public and protected member signature with its source line range. Editor-visible properties are marked `/** @property */`.
- `class-hierarchy.xml`: every class nested inside the engine class it extends, plus interfaces with their implementers and standalone classes grouped by source folder. Use it to see what a class extends and what else extends the same base.

A class file is a few KB. Its source file in `.engine/src/` can exceed 50 KB.

## Commands

Run every command from the game project root.

```bash
grep -il -E "follow|chase|pursu" node_modules/@gnsx/genesys.js/artifacts/classes/*.md
grep -il -E "projectile|bullet|weapon|hitscan" node_modules/@gnsx/genesys.js/artifacts/classes/*.md
grep -n -B2 -A6 'name="BaseWeaponNode"' node_modules/@gnsx/genesys.js/artifacts/class-hierarchy.xml
grep -rn -i -E "class [A-Za-z]*(Follow|Chase)" .engine/src
```

When the digest has nothing: the demos are `.engine/demos/examples/` for whole games and `node_modules/@gnsx/genesys.js/demos/*.ts` for single features (`chase-game.ts`, `fps.ts`, `shooting.ts`, `door.ts`, `behavior-tree.ts`). System docs are in `node_modules/@gnsx/genesys.js/docs/` (`RPC_DECORATORS.md`, `serialization.md`, `loading-and-readiness.md`, `gotcha-bugs.md`, `multiplayer/`, `ui/safe-ui-patterns.md`).

## Synonyms

One keyword rarely finds the class. Also search:

| Need | Synonyms |
|---|---|
| chase, hunt | follow, pursu, target, seek, AI, behavior |
| shoot, gun | projectile, weapon, hitscan, instant, fire |
| hurt, HP | damage, health, stats, revive |
| collect, coin | pickup, collect, spawner |
| open, use, button | interact, door, switch, proximity |
| zone, area | trigger, overlap, volume |
| move a prop | tween, path, platform |
| camera follow | spring, arm, view target, follow |
| walk to | navigation, path, navmesh, npc |
| effect, explosion | vfx, particle, emitter |
