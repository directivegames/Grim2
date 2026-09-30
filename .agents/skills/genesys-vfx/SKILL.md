---
name: genesys-vfx
description: VFX, particle effects, particles, explosion, trail effect, hit effect, magic effect, muzzle flash, visual effects system — VFXNode, GlobalParticleManager.spawnVFX, and VFX JSON definitions for one-shot and looping GPU particle emitters. Use when implementing explosions, hit sparks, trails, fire, smoke, magic, or other particle-based effects.
---

# VFX / Particles

Engine particle system lives in `.engine/src/vfx/` and `.engine/src/entities/GlobalParticleManager.ts`. Read source for full field lists — this skill maps what exists and flags non-obvious pitfalls.

## What's available

`VFXNode` (`.engine/src/vfx/VFXNode.ts`) — a `SceneNode` (not a `PrimitiveNode`; no collision shape) that owns one or more particle emitters loaded from a VFX definition. Key properties: `vfxPath` (project path to a `.vfx.json` resource, editor-authored and serialized), `vfxDefinition` (inline `VFXDefinition` passed at `.create()` time — code-only, never serialized, overrides `vfxPath` when set), `autoStart` (default `true`). Methods: `startEmitting(reset = true)`, `stopEmitting()`, `emitAtPosition(position, reset = false)`, `getVFXEmitters()` / `getVFXEmitter(index)`, `getVFXDefinition()`, `getIsReady()`, `waitUntilReady()`.

Editor authoring — VFX definitions (particles + emitters JSON) are created and tuned via the Asset Browser's New VFX / Inspector VFX Editor UI, not via MCP scripting (VFX editing is UI-only). Reference example definitions ship at `@engine/assets/dev/vfx/` (e.g. `explosion-burst.json`, `fire-example.json`, `smoke-alpha.json`, `sparkles-stretch.json`) — useful starting points to copy, not a curated "preset" API.

`GlobalParticleManager` (`.engine/src/entities/GlobalParticleManager.ts`) — a transient, always-present root reachable as `world.globalParticleManager`. Provides fire-and-forget spawning that needs no node of your own:
- `spawnVFX(name, particlesSettings, emitterSettings, options?)` — inline particle/emitter settings (single or arrays), builds a `VFXDefinition` under the hood.
- `spawnVFXFromDefinition(definition, options?)` — from an existing `VFXDefinition`.
- `spawnVFXFromPath(vfxPath, options?)` — loads a `.vfx.json` resource by path.

All three accept `options: { position?, rotation?, scale? }` and return the created `VFXEmitterCore[]`. Each `name` is a shared particle-system key — reusing the same `name` reuses the same pooled `InstancedMesh` (see Footguns).

Attaching to a moving node — add a `VFXNode` as a child of any placeable so it inherits the parent's transform every frame: `weaponMuzzle.add(ENGINE.VFXNode.create({ vfxPath, autoStart: true }))`. No `isRoot` needed; it moves with its parent like any child node.

Attaching at a fixed world position — either place a standalone `VFXNode` as its own root: `ENGINE.VFXNode.create({ isRoot: true, position, vfxPath })` then `world.add(vfxNode)`; or use `world.globalParticleManager.spawnVFX(...)` with `options.position` for a one-off that needs no persistent node at all.

One-shot vs looping — set via the emitter's `loop` field (`VFXEmitterSettings.loop`, default `false`) and `spawnMode` (`'time'` spreads emission across `duration` and keeps going when `loop` is true; `'burst'` emits `nbParticles` immediately, and with `loop: true` fires another burst each `duration`). `VFXNode.emitAtPosition()` only works with `spawnMode: 'burst'` emitters.

Sub-emitters — `VFXEmitterSettings.subEmitters` bursts another emitter in the same definition at predicted plane collision or particle death (`on: 'collision' | 'death'`, `emitterIndex`). Collision links accept `planes: 'all' | 'emitter' | 'extra'` (default `'all'`): `'all'` fires at the first impact, `'emitter'` only the particle-system floor, `'extra'` only `VFXCollisionPlaneNode` rectangles. CPU uses the same ballistic impact as GPU plane collision, including extra rectangles baked at spawn, so rain-kill + splash works without a CPU particle sim. Use `'emitter'` for a ripple that should stay on the ground while the splash still hits a car. The target emitter does not emit on the clip; size its particle pool for concurrent splashes, not one burst. Do not point two emitters at each other (cycles are rejected on load).

Place extra collision rectangles with `VFXCollisionPlaneNode` (local XY is the rectangle, `+Z` is the collide-from side). Parent them under a `VFXNode` for local effects, or set `collision.extraPlaneGroup` so emitters also hit world planes that share that group (weather hitting cars/roofs). `spawnVFX` has no VFXNode parent, so extras only apply when a group matches. Planes are static for each particle’s life.

## Footguns

- Looping `spawnVFX()` never self-cleans. `GlobalParticleManager` tracks each `spawnVFX`/`spawnVFXFromDefinition` call's emitter with a computed lifetime (`duration + particlesLifetime[1]`, or `Infinity` when `loop: true`) and only calls `removeFromParent()` once elapsed time passes that lifetime. A looping emitter's lifetime is `Infinity`, so it is never auto-removed — it ticks forever. There is no public per-handle despawn API; `cleanupAllVFX()` (called internally on world end) clears everything indiscriminately. For any looping/persistent effect (fire, trails, auras) that must stop early, own a `VFXNode` yourself and call `stopEmitting()` then destroy/remove the node — don't use fire-and-forget `spawnVFX` for it.
- Particle count is a fixed, shared pool, not a spawn budget. `nbParticles` in `VFXParticlesSettings` sizes one `InstancedMesh`'s ring buffer; `getOrCreateVFXParticles` reuses the mesh for any call using the same generated name (`${definitionName}_particles_${index}`). Emitting beyond capacity silently overwrites (wraps) the oldest particles rather than growing. Size `nbParticles` for worst-case *concurrent* particles for that system, not lifetime total — and give visually distinct systems distinct names so they don't share (and stomp) one pool.
- Inline `vfxDefinition` doesn't round-trip. `VFXNodeOptions.vfxDefinition` is for code-constructed effects only; it is never serialized, so it won't survive save/load or prefab instancing. Use `vfxPath` (editor-authored `.vfx.json`) for anything that needs to persist.
- `VFXDefinition.fromJSON` validates strictly. It throws if `particles` or `emitters` arrays are empty, or if numeric ranges aren't exactly `[min, max]` / vector fields aren't exactly length 3 — a hand-built JSON/inline settings object with a missing or malformed field throws at load/spawn time, not silently.
- Emitters created lazily. `VFXNode` only builds its `VFXEmitterCore`s once the node has a `world` (in `beginPlay`) and once particle textures/geometry finish loading (`getIsReady()` / `waitUntilReady()`); calling `startEmitting()` earlier just queues a pending auto-start instead of erroring.

## Source index

Start with `.engine/src/vfx/index.ts`, then open the file you need.

| File | Contents |
| --- | --- |
| `vfx/VFXNode.ts` | Node wrapper: load definition, create emitters in `beginPlay`, start/stop/emit-at-position API |
| `vfx/VFXCollisionPlaneNode.ts` | Placeable extra collision rectangle + world registry + nearest-K gather |
| `vfx/types.ts` | `VFXParticlesSettings`, `VFXEmitterSettings`, `VFXDefinition` (JSON schema + validation), `EaseFunction` list |
| `vfx/colorRamp.ts` | Lifetime colour stops: resolve/migrate from `colorStart`/`colorEnd`, sample, pack GPU uniforms |
| `vfx/clipTime.ts` | Clip-time start/stop/bursts and preview clip duration (independent of `emitter.loop`) |
| `vfx/clipKeyframes.ts` | Clip-time rate/size/speed/light/colour keys: sample, integrate, and last-key clip length |
| `vfx/emitterLight.ts` | Clip-gated point-light weight for `emitLight` emitters |
| `vfx/planeCollision.ts` | GPU plane collision: emitter-local plane baked to world at spawn, analytic impact time, kill/bounce, WebGL/WebGPU helpers |
| `vfx/subEmitters.ts` | On-collision / on-death sub-emitter prediction from the same ballistic arc the GPU plane uses |
| `vfx/easings.ts` | TSL implementations of every `EaseFunction`, selected by `easeFunction` |
| `vfx/core/VFXEmitterCore.ts` | Spawn-pattern logic: timed vs burst emission, position/rotation/direction/color randomization per particle |
| `vfx/core/VFXParticlesShared.ts` | Shared instanced-mesh particle buffer (WebGL/WebGPU base), pooling/ring-buffer `emit()` |
| `entities/GlobalParticleManager.ts` | `world.globalParticleManager`: `spawnVFX`/`spawnVFXFromDefinition`/`spawnVFXFromPath`, attached-VFX lifetime tracking and cleanup |

Deeper field-by-field settings reference: [references/vfx-definition-schema.md](references/vfx-definition-schema.md). Node lifecycle and spawn-pattern walkthroughs with more code: [references/spawning-and-lifecycle.md](references/spawning-and-lifecycle.md).

## Example

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

@ENGINE.GameClass()
export class ExplosiveBarrelNode extends ENGINE.PrimitiveNode {
  constructor() {
    super();
    this.isRoot = true;
  }

  public detonate(): void {
    const world = this.getWorld();
    if (!world) return;

    // Fire-and-forget burst at this barrel's position — no node to clean up.
    void world.globalParticleManager.spawnVFX(
      'barrelExplosion',
      {
        nbParticles: 300,
        renderMode: 'billboard',
        appearance: 'circular',
        blendingMode: 'additive',
        easeFunction: 'easeOutCubic',
        fadeAlpha: [0.8, 0],
        fadeSize: [0.5, 0.1],
        gravity: [0, -5, 0],
      },
      {
        loop: false,
        spawnMode: 'burst',
        duration: 0.1,
        nbParticles: 120,
        particlesLifetime: [0.4, 1.0],
        directionMin: [-1, 0.2, -1],
        directionMax: [1, 2, 1],
        size: [0.15, 0.3],
        speed: [4, 8],
        colorStart: ['#ffaa00', '#ff6600'],
        colorEnd: ['#ff0000', '#660000'],
      },
      { position: this.getWorldPosition(new THREE.Vector3()) }
    );

    this.destroy();
  }
}
```

For a looping effect owned by a node (e.g. a torch flame that must stop on demand), attach a `VFXNode` instead:

```typescript
const flame = ENGINE.VFXNode.create({ vfxPath: '@project/assets/vfx/torch-flame.vfx.json', autoStart: true });
torchNode.add(flame);
// later, to stop for good:
flame.stopEmitting();
flame.destroy();
```

## Related skills

- `genesys-audio` — pair VFX with explosion/impact/loop sound cues.
