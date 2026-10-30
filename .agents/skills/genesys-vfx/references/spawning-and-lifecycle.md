# Spawning Patterns and Lifecycle

Three ways to get particles on screen, in increasing order of how much you own/manage yourself.

## 1. Fire-and-forget: `world.globalParticleManager.spawnVFX(...)`

Best for one-shot effects that don't need a durable handle: hit sparks, muzzle flashes, small explosions, footstep puffs.

Source: adapted from `InstantHitWeaponNode.playHitEffect` in `.engine/src/nodes/gameplay/InstantHitWeaponNode.ts` — typechecked against 18.1.0-alpha.317
```typescript
const world = this.getWorld();
if (!world) return;

void world.globalParticleManager.spawnVFX(
  'hitSparks', // shared particle-system name — see pooling note below
  {
    nbParticles: 100,
    intensity: 5,
    renderMode: 'billboard',
    appearance: 'circular',
    fadeAlpha: [0.8, 0],
    fadeSize: [0.3, 0.05],
    blendingMode: 'additive',
    easeFunction: 'easeOutQuad',
    gravity: [0, -5, 0],
  },
  {
    loop: false,
    duration: 0.02,
    nbParticles: 15,
    spawnMode: 'burst',
    particlesLifetime: [0.1, 0.25],
    directionMin: [-0.8, -0.5, -0.8],
    directionMax: [0.8, 1, 0.8],
    size: [0.05, 0.12],
    speed: [3, 8],
    colorStart: ['#ffdd00', '#ffaa00'],
    colorEnd: ['#ff6600', '#ff0000'],
  },
  { position: hitLocation }
);
```

What happens internally (`.engine/src/entities/GlobalParticleManager.ts`):
1. `spawnVFX` wraps your settings into a `VFXDefinition` (validated — see the schema reference) and calls `spawnVFXFromDefinition`.
2. For each particle system, `getOrCreateVFXParticles(name, settings)` looks up `name` in an internal registry; if it already exists (same name from an earlier call), the existing `InstancedMesh` is reused instead of creating a new one.
3. For each emitter, a `VFXEmitterCore` is created, positioned/rotated/scaled from `options`, added as a child of the manager, and started (`emitter.startEmitting(true)`).
4. The manager records `{ emitter, attachTime: world.getGameTime(), lifetime }` in an internal list and ticks every attached emitter's `update()` each frame in `tickPrePhysics`.
5. Once `currentTime - attachTime >= lifetime`, the emitter is dropped from the list and `removeFromParent()`'d. `lifetime` is the definition clip length (`delay` / `endTime` / bursts / particle lifetime, plus sub-emitter child lifetimes) for non-looping emitters, or `Infinity` when any clip-emitting emitter in the definition has `loop: true` (the lifetime is shared by every emitter of that spawn, so one looping emitter keeps the whole spawn alive). Sub-emitter splash targets share that same lifetime so they are not removed while rain is still falling.

Consequence: step 5 never fires for a looping emitter. Keep the array the spawn call returns and pass it to `world.globalParticleManager.despawnVFX(emitters)` to stop that effect; particles already emitted finish their lifetime. Without it the effect runs until `cleanupAllVFX()`, which the manager calls on its own `endPlay()` (world teardown) and which removes *every* attached fire-and-forget VFX in the world, not just yours.

`spawnVFXFromDefinition(definition, options)` and `spawnVFXFromPath(vfxPath, options)` follow the same lifecycle; use them when you already have a `VFXDefinition` instance or a `.vfx.json` asset path instead of inline settings.

In `NetRuntime.isDedicatedServer()` (headless) mode, all three spawn methods no-op / return `[]` immediately — VFX is presentation-only and is skipped server-side.

## 2. Owned node, attached to a moving parent

Best for anything that should track a moving object for its whole lifetime and might need to be stopped early: weapon muzzle flash while firing, a jetpack trail, a status-effect aura on a character.

Source: `.engine/src/vfx/VFXNode.ts` — typechecked against 18.1.0-alpha.317
```typescript
const trail = ENGINE.VFXNode.create({
  vfxPath: '@project/assets/vfx/jetpack-trail.vfx.json',
  autoStart: true,
});
this.add(trail); // `this` is some moving SceneNode/PrimitiveNode — trail inherits its transform

// later, e.g. when the jetpack turns off:
trail.stopEmitting();
// and when the effect is no longer needed at all:
trail.destroy();
```

No `isRoot` is needed or wanted here — `trail` is a plain child node, added the same way you'd add a `MeshNode` or any other child. Its emitters are ticked from `VFXNode.tickPrePhysics`, which reads `world.getGameTime()` (or a local free-running clock in editor preview) and calls `emitter.update(elapsedTime, deltaTime)` for each of its `VFXEmitterCore`s.

## 3. Owned node, fixed world position

Best for a standalone effect placed in the world independent of any other node: an ambient torch flame, a portal shimmer, a magic circle. A placed prop's effect is better added through MCP or by the prop's class (SKILL.md → *Placing effects in the scene*); this pattern is for effects code creates at runtime.

Source: `.engine/src/vfx/VFXNode.ts` — typechecked against 18.1.0-alpha.317
```typescript
const flame = ENGINE.VFXNode.create({
  isRoot: true,
  position: torchTopPosition,
  vfxPath: '@project/assets/vfx/torch-flame.vfx.json',
  autoStart: true,
});
world.add(flame);
```

## Cleanup checklist (avoid leaking VFX nodes)

- Prefer pattern 1 (`spawnVFX`) for genuinely one-shot, non-looping effects — the manager cleans them up for you based on `duration`/`particlesLifetime`.
- For anything with `loop: true`, prefer pattern 2 or 3 (an owned `VFXNode`) so the effect follows its owner and you have a handle to call `stopEmitting()` + `destroy()` on. A looping `spawnVFX` needs `despawnVFX(emitters)` with the array it returned. Destroying/removing the parent node the `VFXNode` is attached to (pattern 2) tears the child down along with it through normal `SceneNode` teardown — you don't need to remove the `VFXNode` separately in that case.
- `VFXNode.endPlay()` calls `stopEmitting()` and resets internal ready/pending state, but does not itself dispose the shared particle systems (`InstancedMesh`es) it used — those are pooled per-name on `GlobalParticleManager` and are only disposed when the manager itself ends play (i.e. world teardown via `cleanupVFXParticles()`). This is intentional pooling, not a leak: the same name is expected to be reused by future emitters.
- Before calling `startEmitting()` on a freshly created `VFXNode`, you can `await vfxNode.waitUntilReady()` (or check `getIsReady()`) if you need emission to start precisely rather than relying on `autoStart`/queued pending-start behavior.

## Sub-emitters and extra collision rectangles

`VFXEmitterSettings.subEmitters` bursts another emitter of the same definition at a predicted plane collision or at particle death (`on: 'collision' | 'death'`, `emitterIndex`). Collision links accept `planes: 'all' | 'emitter' | 'extra'` (default `'all'`): `'all'` fires at the first impact, `'emitter'` only on the particle-system floor, `'extra'` only on `VFXCollisionPlaneNode` rectangles. The CPU prediction uses the same ballistic impact as the GPU plane collision, including extra rectangles baked at spawn, so rain-kill + splash works without a CPU particle sim. Use `'emitter'` for a ripple that should stay on the ground while the splash still hits a car. The target emitter does not emit on the clip; size its particle pool for concurrent splashes, not one burst. Two emitters pointing at each other are rejected on load (cycle).

Place extra collision rectangles with `VFXCollisionPlaneNode` (local XY is the rectangle, `+Z` is the collide-from side). Parent them under a `VFXNode` for local effects, or set `collision.extraPlaneGroup` so emitters also hit world planes in that group (weather hitting cars and roofs). `spawnVFX` has no `VFXNode` parent, so extra rectangles apply to it only when a group matches. Planes are static for each particle's life.

## Example definitions

A minimal hand-written definition (torch flame) and the definition routes (JSON file, preset, inline, editor) are in [definitions](definitions.md#definition-routes). Validate any hand-written file with `scripts/vfx-check.mjs`.

The engine demo `node_modules/@gnsx/genesys.js/demos/vfx-wawa.ts` shows `VFXNode` with `vfxPath`, inline `spawnVFX` (mesh particles, bursts), and `spawnVFXFromPath`. It references `@engine/assets/dev/vfx/fire-example.json`, `smoke-alpha.json`, and `sparkles-stretch.json`, but the installed package ships no `assets/dev/` folder. Copy settings from the demo source, not from those paths. The demo enables bloom with `world.postProcessManager.enablePasses(ENGINE.PostProcessPass.Bloom)` (`genesys-lighting`).

## Source index

Start with `.engine/src/vfx/index.ts`, then open the file you need.

| File | Contents |
| --- | --- |
| `vfx/VFXNode.ts` | Node wrapper: load definition, create emitters in `beginPlay`, start/stop/emit-at-position API |
| `vfx/VFXCollisionPlaneNode.ts` | Placeable extra collision rectangle + world registry + nearest-K gather |
| `vfx/types.ts` | `VFXParticlesSettings`, `VFXEmitterSettings`, `VFXDefinition` (JSON schema + validation), `EaseFunction` list |
| `vfx/colorRamp.ts` | Lifetime colour stops: resolve/migrate from `colorStart`/`colorEnd`, sample, pack GPU uniforms |
| `vfx/clipTime.ts` | Clip-time start/stop/bursts and preview clip duration (independent of `emitter.loop`) |
| `vfx/clipKeyframes.ts` | Clip-time rate/size/speed/light/colour keys: sample, integrate, last-key clip length |
| `vfx/emitterLight.ts` | Clip-gated point-light weight for `emitLight` emitters |
| `vfx/planeCollision.ts` | GPU plane collision: emitter-local plane baked to world at spawn, analytic impact time, kill/bounce |
| `vfx/subEmitters.ts` | On-collision / on-death sub-emitter prediction from the same ballistic arc the GPU plane uses |
| `vfx/easings.ts` | TSL implementations of every `EaseFunction` |
| `vfx/core/VFXEmitterCore.ts` | Spawn-pattern logic: timed vs burst emission, per-particle randomization |
| `vfx/core/VFXParticlesShared.ts` | Shared instanced-mesh particle buffer (WebGL/WebGPU base), pooling/ring-buffer `emit()` |
| `entities/GlobalParticleManager.ts` | `world.globalParticleManager`: `spawnVFX` / `spawnVFXFromDefinition` / `spawnVFXFromPath`, attached-VFX lifetime tracking and cleanup |

