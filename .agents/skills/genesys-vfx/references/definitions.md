# Definitions and API map

The short version is in [SKILL.md → Definitions you own](../SKILL.md#definitions-you-own-ambient-and-looping-effects). This file holds the definition routes, the validator, a minimal working definition, pool sizing, particle textures, the full `VFXNode` / `GlobalParticleManager` API, and definition and API traps. Every field: [vfx-definition-schema](vfx-definition-schema.md).

## Definition routes

The engine ships no ready effect files, and the demo's `@engine/assets/dev/vfx/*.json` paths are not in the package. An owned effect needs a definition from one of three places:

| Route | When | How |
|---|---|---|
| Hand-written JSON file | Placed effects (torches, portals), anything a scene or prefab references | Plain `{ version: 1, name, particles, emitters }` in `assets/vfx/<name>.vfx.json`, referenced by `vfxPath`. `VFXNode` loads plain JSON with `VFXDefinition.fromJSON` (`VFXNode.loadVFXDefinition`); `spawnVFXFromPath` loads it too, with a console warning that it is legacy JSON. Opening and saving it in the editor's VFX Editor migrates it to the serialized format. |
| Built-in preset | A quick effect with no file | Set `VFXNode.preset` to one of 21 code-defined ids (`explosion`, `hit-sparks-small`, `muzzle-flash`, `fire`, `smoke`, `rain`, `snow`, `fireflies`, …; list in `vfx/presets/presetTypes.ts`). Reads `'none'` when unset; `vfxPath` is used instead, and `vfxDefinition` overrides both. |
| Inline definition | Code-only effects on spawned things | `ENGINE.VFXNode.create({ vfxDefinition: ENGINE.VFXDefinition.fromJSON(DEF) })` or `globalParticleManager.spawnVFXFromDefinition(def, options)`. Never serialized: gone from a saved scene or prefab. |
| Editor-authored | The creator tunes a look by hand | Asset Browser → New VFX, Inspector VFX Editor (UI only, no MCP operation edits a definition) |

Check every hand-written file before Play with the engine's validator: `node .agents/skills/genesys-vfx/scripts/vfx-check.mjs assets/vfx/torch-fire.vfx.json` (run from the game project). It prints `OK`, or the exact `fromJSON` error, and warns when the particle pool is smaller than the live particles of one instance.

A minimal working definition (a torch flame; the JSON file has the same shape):

Source: `.engine/src/vfx/types.ts` (`VFXDefinitionJSON`, `VFXDefinition.fromJSON`), `.engine/src/vfx/VFXNode.ts` (`vfxDefinition`), `.engine/src/entities/GlobalParticleManager.ts` (`spawnVFXFromDefinition`) — typechecked against 18.1.0-alpha.317; the JSON form passes `vfx-check.mjs`
```ts
const TORCH_FIRE: ENGINE.VFXDefinitionJSON = {
  version: 1,
  name: 'torchFire',
  particles: [{ nbParticles: 64, intensity: 3, renderMode: 'billboard', appearance: 'circular', blendingMode: 'additive',
    fadeAlpha: [0.1, 0.6], fadeSize: [0.1, 0.7], easeFunction: 'easeOutQuad', gravity: [0, 1.5, 0] }],
  emitters: [{ loop: true, spawnMode: 'time', duration: 1, nbParticles: 60, particlesLifetime: [0.4, 0.8],
    startPositionMin: [-0.05, 0, -0.05], startPositionMax: [0.05, 0.05, 0.05],
    directionMin: [-0.2, 1, -0.2], directionMax: [0.2, 1, 0.2], size: [0.08, 0.18], speed: [0.3, 0.8],
    colorStart: ['#ffd27a', '#ffb347'], colorEnd: ['#ff5a1f', '#7a1f0a'] }],
};
// Owned, code-only (never serialized): a child of the torch, stopped with the torch.
const fire = ENGINE.VFXNode.create({ vfxDefinition: ENGINE.VFXDefinition.fromJSON(TORCH_FIRE), autoStart: true,
  position: new THREE.Vector3(0, 0.75, 0) });
torch.add(fire);
```

Every instance with the same definition `name` shares one particle pool (`<name>_particles_<i>`). One torch keeps about 48 particles alive (60 per s × 0.8 s); ten torches need `nbParticles` ≥ 480 on that system, or the pool wraps and flames flicker.

Particle textures: none ship. `appearance: 'circular'` (soft dot) and `'square'` cover sparks, embers, dust, and magic. A smoke puff or flame flipbook (`alphaMapPath`, `spriteSheetColumns` / `Rows`) is an asset row in `genesys-assets`: a project file, or a Blender still on transparent black when Blender is on.

## API map

- `VFXNode` — a `SceneNode` (no collision). Properties: `vfxPath` (serialized definition path), `preset` (built-in id), `autoStart` (default `true`); option `vfxDefinition` (inline, code-only, never serialized, overrides `vfxPath`). Methods: `startEmitting(reset = true)`, `stopEmitting()`, `emitAtPosition(position, reset = false)` (burst emitters only), `getVFXEmitters()`, `getVFXEmitter(i)`, `getVFXDefinition()`, `getIsReady()`, `waitUntilReady()`, `waitForLoad()`, `isLoading()`.
- `world.globalParticleManager` — `spawnVFX(name, particles, emitters, { position?, rotation?, scale? })` (single or arrays), `spawnVFXFromDefinition(definition, options)`, `spawnVFXFromPath(vfxPath, options)`. All return `Promise<VFXEmitter[]>` and no-op on a dedicated server. `getAttachedVFX()` lists live fire-and-forget emitters. `despawnVFX(emitters)` stops and disposes the emitters one spawn returned (a looping spawn ends only this way); particles already emitted finish their lifetime. `cleanupAllVFX()` clears every one in the world.
- One-shot vs looping is the emitter's `loop` (default `false`) and `spawnMode` (`'time'` spreads over `duration`; `'burst'` emits `nbParticles` at once, and with `loop` re-bursts each `duration`).
- Sub-emitters, plane collision, `VFXCollisionPlaneNode`, colour ramps, clip keys, emitted lights: [vfx-definition-schema](vfx-definition-schema.md).

## Traps

- `Failed to load VFX definition from …` or a spawn throws on a hand-built object → `VFXDefinition.fromJSON` validates strictly: ranges are exactly `[min, max]`, vectors exactly length 3, arrays non-empty. Run `vfx-check.mjs` on the file.
- Console warns `Loaded legacy VFX JSON from …` → a hand-written file loaded through `spawnVFXFromPath`. It works; open and save it in the VFX Editor to migrate, or ignore it.
- `startEmitting()` in `initialize` seems ignored → emitters are built in `beginPlay` after textures load; the call is queued. `await node.waitUntilReady()` for precise timing.
- `emitAtPosition` does nothing → the emitter uses `spawnMode: 'time'`. It works only with `'burst'`.
- Particles pop out at screen edges → not culling; `frustumCulled` is forced `false`. Check lifetime and direction instead.
