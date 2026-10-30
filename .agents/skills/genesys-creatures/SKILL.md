---
name: genesys-creatures
description: "Enemies, NPCs, bosses: the baseline every enemy must meet, pattern movers vs behavior-tree walkers, hit and death reactions without clips, attack telegraphs, procedural motion for unrigged bodies, spawning, waves, difficulty ramps, per-enemy cost. Use for enemies, monsters, zombies, mobs, hordes, guards, turrets, spawners, waves, bosses. Not for damage math or weapons (use `genesys-combat`) or behavior tree node APIs (use `behavior-tree`)."
metadata:
  tokens: 3210
---

# Creatures

An enemy is a body the player can hit, plus a brain, plus a way to move. This skill owns the enemy baseline, the choice of brain, how an enemy reads (reactions, telegraphs, motion), and spawns, waves and ramps. The rule: **every enemy meets the full baseline**, so the player can hit it, read it, kill it, and be threatened by it.

## Use another skill when
- Health, damage, i-frames, enemy weapons, hit detection, `EnemyHealth` → `genesys-combat`
- Behavior tree nodes, blackboard, custom actions → `behavior-tree`
- Navmesh bake, path queries, wander points → `genesys-navigation`
- NPC locomotion tuning (`NpcMovementNode`, `AIController`, GSS), knockback on hit → `genesys-movement`
- Hit flash, hitstop, shake, wave pacing, telegraph timing, fairness → `genesys-game-feel`
- Death burst, hit sparks, telegraph particles → `genesys-vfx`; telegraph glow → `genesys-lighting`; growls and hurt sounds → `genesys-audio`
- Enemy model and route → `genesys-assets`; building it and its procedural motion → `genesys-code-modeling`
- A mannequin-rigged enemy with skeletal clips, when the creator asks for Blender → `genesys-blender-modeling` (`references/rigged-characters.md`); other animation nodes → `genesys-engine` (Find an engine class)
- `isRoot`, transforms, facing conventions → `genesys-engine`; talk-to NPC prompts → `genesys-interactions`
- Online enemies (server authority, replicated spawns) → `genesys-multiplayer`
- Wave counter, boss bar, overhead health bars → `genesys-ui`

## The baseline

Ship all six before calling an enemy done.

1. **Collider on a root.** Traces, overlaps, and projectiles must find it (`genesys-physics`). Use the pawn capsule, or a physics-enabled primitive on the root. Damage and pickups resolve through `getRoot()`: pawns are roots already; a code-built enemy class that is not a pawn sets `this.isRoot = true` in its constructor (`genesys-engine`).
2. **Health.** An `EnemyHealth` (`CharacterStatsNode` subclass) on the root, with `healthRegen: 0` (`genesys-combat`).
3. **Facing.** The enemy faces its target or its path, and the mesh's visual forward matches. Wrap the model in a visual child and give it a yaw correction per model (0, π, or ±π/2), found by looking at it from the front in Play (10 s per type). Never negative scale.
4. **Hit reaction** in the same frame as the damage: VFX plus sound (`genesys-vfx`, `genesys-audio`), and a hit flash or scale pop 1.0 → 1.15 → 1.0 over ~120 ms for anything with more than 1 HP (`genesys-game-feel`).
5. **Death** is a moment, then the body stops mattering: a death clip if the model has one, else the tip-over/shrink beat below, with VFX plus sound. Animation first, particles second. `EnemyHealth` then disables the collider, stops the brain and movement, and removes it after 0.5 s.
6. **Authority** (online games): damage, death, AI, and spawns run on the server. Clients play reactions (`genesys-multiplayer`).

Plus the threat: at least one attack that can hurt the player, telegraphed 0.3–0.8 s before it lands (wind-up below).

## Decide

Pick the brain from how the enemy must move, not from the genre name.

| Enemy moves... | Brain | Body | Examples |
|---|---|---|---|
| In a fixed pattern across an open space | **Pattern mover**: code in `tickPrePhysics`, `PathMovementNode`, or `TweenMovementNode` | Root primitive (`isRoot`) with a collider; physics kinematic or none | Shmup waves, bullet-hell turrets, platformer patrols between two points, racing obstacles |
| Straight at the player in an open arena | **Seeker**: steer toward the player each tick, no navmesh | Root primitive or `CharacterPawn` with `NpcMovementNode` and `setTargetActor` (straight line when no navmesh) | Arena survival hordes, twin-stick chasers |
| Through a level with walls | **Behavior-tree walker**: `BehaviorTreeNode` + `NpcMovementNode` + navmesh | `CharacterPawn` subclass whose `createMovementNode` returns `NpcMovementNode` | Shooter grunts, stealth guards, zombies in buildings |
| Through the air | Behavior tree with aerial actions + `AerialMovementNode` | Root with `AerialMovementNode` | Drones, birds, flying enemies |
| Not at all | Turret logic in tick, or a tree with no move actions | Static root | Towers, cannons, spawners |
| Alongside or near the player, friendly | Pattern or tree; an interact prompt if they talk | Any of the above, without health unless killable | Villagers, shopkeepers, companions |

Defaults:
- A bullet hell, shmup, or "dodge enemies" game uses pattern movers. Skip navmesh and behavior trees. A repeating shot pattern is not a behavior tree.
- A level with walls uses walkers on a navmesh. Never hand-sample positions to walk a level.
- The classic stack (`NpcMovementNode` + behavior tree) is the default walker, even beside a GSS player in single-player; all built-in ground tree actions require `NpcMovementNode`. A GSS pawn with `AIController` (and custom tree actions) only when GSS players bump, shoot or dash through them online, or the game needs prediction (`genesys-movement`).
- Walker speed: set `maxSpeed` (omit it and the speed is the player's 5 m/s). Grunt 3–4, runner 5–6, tank 2; the player should outrun the basic enemy by 20–40%.
- Reactions on the engine mannequin: it ships **Idle, Walk, Run, RunBackward, StrafeLeft, StrafeRight, Jump** only — no attack, hit, or death clips. Hit = flash or scale pop + VFX; death = tip-over/shrink tween + VFX; attack = procedural wind-up. Custom clips come from `genesys-blender-modeling`.
- An attacking enemy keeps moving or turning; one that freezes in place to attack feels like a board-game piece. A rigged enemy with an attack clip plays it on the upper-body layer (`AnimationStateMachineNode` `layer` + `mask` config) while the legs walk.
- Spawn by class (`Enemy.create`) for code-built enemies, and by prefab (`ENGINE.spawnAsync`) for editor-authored ones.
- Waves: 5 for a first slice; count +25%, HP +10%, speed +5% (cap 1.5×) per wave; 2–3 s breather; alive cap 12–20 walkers or 40–80 pattern movers ([spawning-and-waves](references/spawning-and-waves.md#difficulty-ramp-defaults)).
- Boss: 3 phases at 100/66/33% HP, each adding or speeding up one attack, with a 1 s invulnerable tell between ([brains](references/brains.md#bosses)).

## Build

### Behavior-tree walker

A `CharacterPawn` subclass whose `createMovementNode()` returns `NpcMovementNode.create({ maxSpeed: 4, lookRightSpeed: 8, stopDistance: 1.5, … })`, plus `EnemyHealth` (`genesys-combat`) and a `BehaviorTreeNode` (`behavior-tree`) added in `initialize`. The first tree is `Selector[ melee in range → chase until in range → wander while unseen ]`, reading `PlayerActor`, `PlayerPosition` and `DistanceToPlayer` from the blackboard. Its Follow uses `continueAfterReached: false` (or the enemy chases forever and never attacks). The `Grunt` class and more starter trees: [brains](references/brains.md#worked-example-a-grunt).

### Pattern mover

A root primitive (`this.isRoot = true` in the constructor) moved on `dt` in `tickPrePhysics`, with a kinematic body (`KinematicPositionBased`, `BlockAll`) and a collider child (`contributeToParentCollider: true`) so moving the transform moves the collider, plus `EnemyHealth`. Fixed routes use `PathMovementNode` (`PingPong`) or `TweenMovementNode` (`genesys-interactions`). Despawn pattern movers that leave the play bounds. The `SineDiver` example: [brains](references/brains.md#worked-example-a-sine-diver).

### Reading the body: telegraph, motion, death beat

Animate the **visual child**, never the root (the root carries the collider and the movement). Numbers for an unrigged or clip-less body:

| Moment | Default |
|---|---|
| Gait bob | `0.05 · |sin(t · stride)|` m on Y while moving; quadrupeds add a roll of ±0.06 rad |
| Idle sway | ±0.02 rad low-frequency roll (two summed sines) when still |
| Attack wind-up (telegraph) | 0.3–0.8 s: stretch scale Z +8% and ramp an emissive tint (`genesys-lighting`); strike at the end |
| Hit | Flash or scale pop 1.0 → 1.15 → 1.0 over ~120 ms (`genesys-game-feel`) + hit VFX |
| Death | Tip over 90° and shrink to 50% over 0.4 s + burst VFX, inside `EnemyHealth.removeAfterSeconds` (0.5 s) |

The `animateBody` and `playDeathBeat` helpers: [brains](references/brains.md) → *Animation*.

### Spawning

By class for code-built enemies (`Grunt.create({ position })`, then `world.add`), by prefab for editor-authored ones (`await ENGINE.spawnAsync('@project/assets/prefabs/grunt.prefab.json', { position })`, then `world.add`). Count kills on `getNode(ENGINE.CharacterStatsNode)?.onDeath`. Spawn points are empty marker nodes placed with MCP (`genesys-level-authoring`), or a ring 8–15 units from the player outside the camera view. Never spawn inside the player's collider, or in view without a telegraph (portal flash, dust, sound). Snippet, wave structure and ramp math: [spawning-and-waves](references/spawning-and-waves.md).

## Limitations

- The mannequin has no Attack, Hit or Death clips: [brains](references/brains.md#limitations).

## Traps

- Shots pass through the enemy → no collider, or it is on a child that is not physics-enabled → physics-enabled root or capsule (`query_node`).
- Hits register on nothing, or damage goes to a parent group → a code-built enemy root without `isRoot`, so `getRoot()` climbs past it → `this.isRoot = true` in the constructor.
- Tree actions log "No NpcMovementNode found" and the enemy stands still → walker on a GSS pawn or plain primitive → `NpcMovementNode` from `createMovementNode`, or custom actions for `AIController`.
- The enemy chases forever and never attacks → the starter tree's Follow returns Running forever → `continueAfterReached: false` (`behavior-tree`).
- Walker runs straight into walls → no navmesh, so `NpcMovementNode` falls back to straight lines → bake one (`genesys-navigation`) and check `canUseNavigationServer()`.
- Enemy slides sideways or moonwalks → the mesh forward does not match the movement facing → yaw-correct the visual child by π (or π/2); confirm in Play from the front.
- One hit flashes every enemy → they share one material → per-instance clone or scale pop (`genesys-game-feel`).
- The body pops out with no reaction → default `handleDeath` destroyed the root on the same frame → `EnemyHealth` (`genesys-combat`).
- The dead enemy keeps attacking for one beat → tree still running → `EnemyHealth` stops it.
- Bullet-hell enemy built as a behavior-tree walker → wrong brain → pattern mover.
- Pile-ups, a hand-rolled `tick` brain, idle clip while moving: [brains](references/brains.md#traps). A wave that never ends, frame drops at wave 6+: [spawning-and-waves](references/spawning-and-waves.md#traps).

## Done

- `query_node` on each enemy type: physics enabled on the collider, an `EnemyHealth` (or other `CharacterStatsNode`) with `healthRegen` 0, and a brain node (or pattern code) present.
- In Play, face each enemy type in turn. It faces you, its attack is telegraphed for 0.3–0.8 s, it keeps moving or turning while attacking, and it reaches you and hurts you within 10 s of seeing you.
- Shoot or hit each type. Damage lands only where the body is, with VFX plus sound and a flash or pop in the same frame.
- Kill each type. Its death beat plays, it stops blocking and acting, and it is removed within 0.5 s. The kill counts.
- Play through two waves. The second is visibly harder, the breather happens, and the counter in the HUD matches.
- With the alive cap reached, frame time stays at the target (`genesys-profiler`).
- Boss (if any): each phase change is visible and audible, and the boss bar tracks HP.
- The enemy model reads as the creature from the gameplay camera. A capsule, box, or cone is labeled **blockout** until a real mesh replaces it.

## References
- [brains](references/brains.md) — pattern movers, seekers, BT walkers (classic and GSS), starter trees, aerial, turrets, friendly NPCs, bosses, animation and procedural motion
- [spawning-and-waves](references/spawning-and-waves.md) — spawn APIs, spawn points, wave state, ramp tables, alive caps, multiplayer spawning
