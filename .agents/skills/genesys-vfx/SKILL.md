---
name: genesys-vfx
description: "Particles and effects: VFXNode, spawnVFX, definitions (hand-written JSON or inline), lifecycle and leaks, and which moments get effects (muzzle, trail, impact, death, pickup, ambient). Use for explosions, sparks, trails, fire, smoke, magic, dust, torches, portals, rain, auras, juice that is particles. Not for bloom or emissive glow (use `genesys-lighting`), screen shake or hitstop (use `genesys-game-feel`), or floating damage numbers (use `genesys-ui`)."
metadata:
  tokens: 3277
---

# VFX

This skill owns the particle API (`VFXNode`, `GlobalParticleManager`, `VFXDefinition`), effect definitions, and the decision of which moments get an effect. The one rule: a one-shot effect uses fire-and-forget `spawnVFX`; anything that loops or must stop early is an owned `VFXNode`, because a looping `spawnVFX` runs until something passes its emitters to `despawnVFX`.

## Use another skill when
- How strong a hit should feel, hitstop, screen shake, the two-channel rule → `genesys-game-feel`
- The sound that plays with the effect → `genesys-audio`
- Camera kick or a short cut to a view target → `genesys-camera`
- Projectiles, damage, death logic that triggers the effect → `genesys-combat`
- Enemy hit reaction paired with impact → `genesys-creatures`
- Floating damage numbers → `genesys-ui`
- Bloom, exposure, emissive glow on meshes → `genesys-lighting`
- A particle texture or flipbook (smoke puff, flame sheet) → `genesys-assets`; the engine ships none
- Who plays the effect online → `genesys-multiplayer`
- Too many particles costing frames, a light on an effect → `genesys-profiler`

## Decide

### The moment gate

List the moments from the game's rules (shoot, hit, kill, pickup, jump, land, take damage, die, win), then mark each one in a line in `GAME.md`:
- **effect earns it** — the player must notice it, so it gets an effect (and a sound);
- **already covered** — another channel carries it (the enemy's death animation, a UI pop);
- **deliberately bare** — quiet on purpose (footsteps in a stealth game).

"Not decided" is not a fourth state. Then run the **inverse check**: every effect in the game names the player action or game event that causes it. An effect with no cause is noise; cut it. Ambient effects (torch, portal, waterfall) are the one exception, and each still marks a place the player should read.

**Shape gate.** The effect looks like the thing it is. A cube, a sphere, or a flat-coloured primitive standing in for fire, smoke, or an explosion is a placeholder, even if the code calls it final. Fire is additive, rising, warm-to-dark particles; smoke is normal-blended, slow, grey, growing.

Default builds per moment (starting numbers in [moments](references/moments.md)):
- **Travel** (projectile, swing): a visible mesh, or an owned looping child `VFXNode` trail on the mover.
- **Muzzle / cast, impact, death, pickup**: a one-shot `spawnVFX` at the barrel, hit point (on enemies and walls), body (after the death animation) or pickup.
- **Recovery / lingering** (fire, smoke, debuff, aura): an owned `VFXNode` the owner stops and destroys when the state ends.
- **Ambient** (torch, portal): a `VFXNode` with a project definition (`vfxPath`), placed with MCP or added by the prop's class, pool sized for every instance.

- **A game whose pitch is shooting** (shooter, bullet hell, "flashy fire"): the player's shot owes travel, muzzle, impact, and a sound. A muzzle flash alone does not meet it. Enemy shots use the same travel and impact channels.
- **Two channels.** A moment the player must not miss pairs the particle with a sound from the same call site (`genesys-audio`). A camera reaction (shake, hitstop) is added only when `genesys-game-feel` calls for it, from its recipe; never write a camera-shake class here.
- **Bloom off test.** The effect still reads without bloom. Bloom is not the silhouette; size and colour contrast are.
- **Caps.** At most about 32 live fire-and-forget emitters; past that, drop the new spawn. Pool size `nbParticles` = worst-case concurrent particles for that system, not lifetime total.
- **No lights on effects.** `emitLight` adds a `THREE.PointLight` per emitter. Never set it on anything spawned (muzzle, impact, explosion, pickup): each light recompiles shaders on spawn and on removal (`genesys-profiler` → *Never pay per spawn*). It is acceptable only on a few placed, long-lived ambient effects (a campfire), and even there an emissive mesh plus bloom is cheaper.

## Build

### One-shot at a point (impact, muzzle, death, pickup)

Source: adapted from `InstantHitWeaponNode.playHitEffect` in `.engine/src/nodes/gameplay/InstantHitWeaponNode.ts`; cap uses `getAttachedVFX` in `.engine/src/entities/GlobalParticleManager.ts` — typechecked against 18.1.0-alpha.317
```ts
const HIT_PARTICLES: ENGINE.VFXParticlesSettings = {
  nbParticles: 100, intensity: 5, renderMode: 'billboard', appearance: 'circular',
  fadeAlpha: [0.8, 0], fadeSize: [0.3, 0.05], blendingMode: 'additive',
  easeFunction: 'easeOutQuad', gravity: [0, -5, 0],
};
const HIT_EMITTER: ENGINE.VFXEmitterSettings = {
  loop: false, spawnMode: 'burst', duration: 0.02, nbParticles: 15,
  particlesLifetime: [0.1, 0.25], directionMin: [-0.8, -0.5, -0.8], directionMax: [0.8, 1, 0.8],
  size: [0.05, 0.12], speed: [3, 8], colorStart: ['#ffdd00', '#ffaa00'], colorEnd: ['#ff6600', '#ff0000'],
};
const MAX_LIVE_VFX = 32;

export function spawnHitSparks(world: ENGINE.World, at: THREE.Vector3): void {
  const gpm = world.globalParticleManager;
  if (gpm.getAttachedVFX().length >= MAX_LIVE_VFX) return; // drop, never queue
  void gpm.spawnVFX('hitSparks', HIT_PARTICLES, HIT_EMITTER, { position: at });
}
```

Keep settings as module constants and reuse the same `name`, so every call shares one pooled `InstancedMesh`. Give visually different systems different names. `ENGINE.VFXParticlesSettings` and `ENGINE.VFXEmitterSettings` are exported classes with all-optional fields (`.engine/src/vfx/types.ts`); every field is in [vfx-definition-schema](references/vfx-definition-schema.md). Spawn each kind once during the title warm-up so its shader is compiled before play (`genesys-profiler`).

### Owned effect (trail, fire, aura)

Source: `.engine/src/vfx/VFXNode.ts` — typechecked against 18.1.0-alpha.317
```ts
const trail = ENGINE.VFXNode.create({ vfxPath: '@project/assets/vfx/trail.vfx.json', autoStart: true });
projectile.add(trail);   // child: follows the parent every frame, no isRoot
// when the effect ends:
trail.stopEmitting();
trail.destroy();         // or destroy the parent; children tear down with it
```

Fixed spot in the world: `ENGINE.VFXNode.create({ isRoot: true, position, vfxPath })`, then `world.add(node)`.

### Definitions you own (ambient and looping effects)

The engine ships no ready effect files (the demo's `@engine/assets/dev/vfx/*.json` paths are not in the package). An owned effect's definition comes from one of four routes ([definitions](references/definitions.md)):
- **Hand-written JSON** `assets/vfx/<name>.vfx.json` (`{ version: 1, name, particles, emitters }`), referenced by `vfxPath`: the route for placed effects and anything a scene or prefab references.
- **Built-in preset**: `VFXNode.preset` set to one of 21 code-defined ids (`explosion`, `muzzle-flash`, `fire`, `smoke`, `rain`, …).
- **Inline** `vfxDefinition: ENGINE.VFXDefinition.fromJSON(DEF)`: code-only, never serialized.
- **Editor-authored** in the VFX Editor (UI only; no MCP operation edits a definition).

Check every hand-written file before Play: `node .agents/skills/genesys-vfx/scripts/vfx-check.mjs assets/vfx/torch-fire.vfx.json` (from the game project) prints `OK` or the exact `fromJSON` error, and warns when the pool is too small. Every instance with the same definition `name` shares one pool: ten torches at ~48 live particles each need `nbParticles` ≥ 480. No particle textures ship; `appearance: 'circular'` or `'square'` covers sparks, embers, dust and magic, and a flipbook is an asset row (`genesys-assets`). A working torch-flame definition: [definitions](references/definitions.md#definition-routes).

### API map

- `VFXNode`: `vfxPath`, `preset`, `autoStart` (default `true`), option `vfxDefinition`; `startEmitting()`, `stopEmitting()`, `emitAtPosition()` (burst emitters only), `waitUntilReady()`.
- `world.globalParticleManager`: `spawnVFX`, `spawnVFXFromDefinition`, `spawnVFXFromPath` (all no-op on a dedicated server), `getAttachedVFX()` (live fire-and-forget emitters), `cleanupAllVFX()`.
- One-shot vs looping is the emitter's `loop` (default `false`) and `spawnMode` (`'time'` spreads over `duration`; `'burst'` emits at once). Full API: [definitions](references/definitions.md#api-map); sub-emitters, collision planes, colour ramps, clip keys: [vfx-definition-schema](references/vfx-definition-schema.md).

### Placing effects in the scene

A persistent `VFXNode` that belongs to a placed prop is editor state: add it through MCP (`action_node(action="add", className="ENGINE.VFXNode")`, set `vfxPath` to the file's literal `@project/assets/vfx/...` path, `action_scene(action="save")`, re-query; `genesys-mcp-orchestrator`), or give the prop's class the child `VFXNode` so every instance carries it. Spawn one-shots from gameplay code at the event.

### Multiplayer

The server decides the hit happened. Every client plays travel and impact locally. The call everyone must see is a multicast RPC (`genesys-multiplayer`). `spawnVFX` returns `[]` on a dedicated server, so calling it there is harmless but useless.

## Traps
- Fire, trail, or aura from `spawnVFX` with `loop: true` never stops → its lifetime is `Infinity` and nothing despawned it → keep the emitters `spawnVFX` returns and call `world.globalParticleManager.despawnVFX(emitters)` when the state ends, or use an owned `VFXNode` and `stopEmitting()` + `destroy()`.
- Bursts flicker or old particles vanish mid-flight → the shared pool (`nbParticles` on the particle system) wrapped. Raise it to worst-case concurrent across every instance with that name, or split systems by `name`.
- Two different effects look the same or stomp each other → same `name` means same pool. Name each system.
- Inline `vfxDefinition` gone after save or in a prefab → it is never serialized. Use a JSON file and `vfxPath`.
- A hitch on every impact or muzzle flash → the effect has `emitLight`, or makes a new material or effect name per spawn. Remove the light, use emissive particles and one name per effect kind (`genesys-profiler` → *Never pay per spawn*).
- A hitch on the first impact only → the effect's shader compiled on first use. Spawn it once during the title warm-up (`genesys-profiler`).
- Frame drops during big fights → a new spawn on every bullet with no cap. Cap live emitters and reuse names.
- Effect invisible without bloom → raise `size`, `intensity`, and colour contrast; do not rely on bloom.
- A glowing primitive or a coloured cube marks the fire or explosion → placeholder. Build the particle effect.
- Definition and API traps (`fromJSON` errors, legacy JSON warning, `startEmitting` in `initialize`, `emitAtPosition` on a time emitter, edge popping): [definitions](references/definitions.md#traps).

## Done
- Every moment on the `GAME.md` list is marked earns it / already covered / deliberately bare, and every effect in the game names its cause.
- Each "earns it" moment fires its effect in Play, at the right position, in the same call that plays its sound.
- Shooting at a wall and at an enemy both show an impact.
- Every hand-written definition passes `vfx-check.mjs` with no pool warning for the number of instances placed.
- After 60 s of heavy play, `world.globalParticleManager.getAttachedVFX().length` stays under the cap and drops back when fighting stops. Read it from code running in Play (the smoke test logs it, `genesys-verification`); `run_script` has no `window` or engine world, so it cannot read this.
- Every looping effect stops when its owner's state ends (fire put out, pickup taken, enemy dead).
- No spawned effect uses `emitLight` (`grep -rn "emitLight" src/ assets/vfx/`).
- An in-Play capture with bloom off still shows the impact and death bursts (`genesys-verification`).

## References
- [moments](references/moments.md) — the moment table with default builds and starting numbers
- [definitions](references/definitions.md) — definition routes, torch-flame definition, pool sizing, textures, full API map, definition traps
- [spawning-and-lifecycle](references/spawning-and-lifecycle.md) — the three spawn patterns, internal lifecycle, cleanup checklist, source index
- [vfx-definition-schema](references/vfx-definition-schema.md) — every particle and emitter field, defaults, easing list, validation rules
- `scripts/vfx-check.mjs` — validate hand-written definition files with the engine validator, with a pool-size check
