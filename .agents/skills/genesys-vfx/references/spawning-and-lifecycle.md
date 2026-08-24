# Spawning Patterns and Lifecycle

Three ways to get particles on screen, in increasing order of how much you own/manage yourself.

## 1. Fire-and-forget: `world.globalParticleManager.spawnVFX(...)`

Best for one-shot effects that don't need a durable handle: hit sparks, muzzle flashes, small explosions, footstep puffs.

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
(Adapted from `InstantHitWeaponNode.playHitEffect` in `.engine/src/nodes/gameplay/InstantHitWeaponNode.ts`.)

What happens internally (`.engine/src/entities/GlobalParticleManager.ts`):
1. `spawnVFX` wraps your settings into a `VFXDefinition` (validated — see the schema reference) and calls `spawnVFXFromDefinition`.
2. For each particle system, `getOrCreateVFXParticles(name, settings)` looks up `name` in an internal registry; if it already exists (same name from an earlier call), the existing `InstancedMesh` is reused instead of creating a new one.
3. For each emitter, a `VFXEmitterCore` is created, positioned/rotated/scaled from `options`, added as a child of the manager, and started (`emitter.startEmitting(true)`).
4. The manager records `{ emitter, attachTime: world.getGameTime(), lifetime }` in an internal list and ticks every attached emitter's `update()` each frame in `tickPrePhysics`.
5. Once `currentTime - attachTime >= lifetime`, the emitter is dropped from the list and `removeFromParent()`'d. `lifetime` is `duration + particlesLifetime[1]` for non-looping emitters, or `Infinity` when `loop: true`.

Consequence: step 5 never fires for a looping emitter. There is no `despawnVFX(handle)` / `stopVFX(name)` API — the only broad hammer is `cleanupAllVFX()`, which the manager calls on its own `endPlay()` (i.e. world teardown) and which removes *every* attached fire-and-forget VFX in the world, not just yours. Do not build a looping effect this way if anything needs to turn it off before the world ends.

`spawnVFXFromDefinition(definition, options)` and `spawnVFXFromPath(vfxPath, options)` follow the same lifecycle; use them when you already have a `VFXDefinition` instance or a `.vfx.json` asset path instead of inline settings.

In `NetRuntime.isDedicatedServer()` (headless) mode, all three spawn methods no-op / return `[]` immediately — VFX is presentation-only and is skipped server-side.

## 2. Owned node, attached to a moving parent

Best for anything that should track a moving object for its whole lifetime and might need to be stopped early: weapon muzzle flash while firing, a jetpack trail, a status-effect aura on a character.

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

Best for a standalone effect placed in the world independent of any other node: an ambient torch flame, a portal shimmer, a magic circle.

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
- For anything with `loop: true`, always use pattern 2 or 3 (an owned `VFXNode`) so you have a handle to call `stopEmitting()` + `destroy()` on. Destroying/removing the parent node the `VFXNode` is attached to (pattern 2) tears the child down along with it through normal `SceneNode` teardown — you don't need to remove the `VFXNode` separately in that case.
- `VFXNode.endPlay()` calls `stopEmitting()` and resets internal ready/pending state, but does not itself dispose the shared particle systems (`InstancedMesh`es) it used — those are pooled per-name on `GlobalParticleManager` and are only disposed when the manager itself ends play (i.e. world teardown via `cleanupVFXParticles()`). This is intentional pooling, not a leak: the same name is expected to be reused by future emitters.
- Before calling `startEmitting()` on a freshly created `VFXNode`, you can `await vfxNode.waitUntilReady()` (or check `getIsReady()`) if you need emission to start precisely rather than relying on `autoStart`/queued pending-start behavior.
