# VFX Definition Schema

Source of truth: `.engine/src/vfx/types.ts`. A `VFXDefinition` (and the `.vfx.json` files it serializes to/from) is `{ version, name, particles: VFXParticlesSettings[], emitters: VFXEmitterSettings[] }`. Every field below is optional in the JSON/settings object — defaults are applied by `normalizeVFXParticlesSettings` (particles) or the `VFXEmitterCore` constructor (emitters).

`VFXEmitterSettings.particlesIndex` links an emitter to one entry in the `particles` array (default `0`). Multiple emitters can share one particle system, or each can have its own — this is how a single VFX definition combines e.g. a burst of sparks (one particle system) with a lingering smoke puff (another).

## `VFXParticlesSettings` (one GPU particle system / `InstancedMesh`)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | `string` | *(unset)* | Editor display name. Does not affect GPU pool identity (`${definition.name}_particles_${index}`). |
| `nbParticles` | `number` | `1000` | Fixed pool size for this system's `InstancedMesh`. Not a spawn budget — see Footguns in SKILL.md. |
| `intensity` | `number` | `1` | Brightness multiplier. |
| `renderMode` | `'stretchBillboard' \| 'billboard' \| 'zBillboard' \| 'mesh'` | `'mesh'` in `VFXParticlesShared` normalization; `GlobalParticleManager.spawnVFX` defaults to `'billboard'` | `stretchBillboard` stretches along velocity; `zBillboard` faces the camera on XZ only (no pitch); `mesh` renders `geometryPath` (or a default cube via `GlobalParticleManager` when `renderMode: 'mesh'` and no `geometryPath`). |
| `stretchScale` | `number` | `1.0` | Stretch factor, `stretchBillboard` only. |
| `sortingOffset` | `number` | `0` | `InstancedMesh.renderOrder`. Draw order is per particle system, not per emitter — use two particle entries to layer smoke behind fire. |
| `fadeSize` | `[number, number]` | `[0.1, 0.9]` | Size fade-in/out range, as a fraction of particle lifetime. |
| `fadeAlpha` | `[number, number]` | `[0, 1.0]` | Opacity fade-in/out range. |
| `gravity` | `[number, number, number]` | `[0, 0, 0]` | Constant force applied to all particles in this system. |
| `collision` | `{ mode, planeY, planeNormal, restitution, restitutionVariance, friction, killOnCollide, maxBounces, maxExtraPlanes, extraPlaneGroup }` | `{ mode: 'none' }` | GPU plane collision. `mode`: `'none'` \| `'plane'` (`'world'` is reserved and ignored). Authored in **emitter space** and baked to world at spawn, so several instances of the same effect can sit at different heights. The plane is `dot(planeNormal, pLocal) = planeY`; `planeNormal` (default `[0, 1, 0]`, normalized at runtime) tilts it and `planeY` is the offset along that normal from the emitter — a floor under the VFX node for the default up normal. Extra finite rectangles (`maxExtraPlanes`, default 4, cap 4) are gathered at spawn from descendant `VFXCollisionPlaneNode`s plus world planes whose `group` matches `extraPlaneGroup` (empty = children only). Kill hides at the analytic impact; bounce uses ballistic segments with `restitution`, reflected along the normal. `restitutionVariance` (0–1) randomizes bounce per particle down to `(1 - variance)` of `restitution`. `friction` (0–1) removes that fraction of the speed along the plane at each impact; `1` stops a resting particle dead instead of letting it skate off. After `maxBounces` (0–8), kill or slide on the plane. A bounce needs both `restitution > 0` and `maxBounces > 0` — either at `0` ends the particle on first contact. Particles spawned behind the **emitter** plane are killed, or rest on it when `killOnCollide` is off (this does not apply to extra rectangles). With `mode: 'plane'` the arc uses physical time, so `easeFunction` no longer reshapes travel (it still drives fades). |
| `appearance` | `'square' \| 'circular'` | `'square'` | Alpha-mask shape when no `alphaMapPath` is given. Normalized internally to `AppearanceMode`. |
| `easeFunction` | `EaseFunction` (see list below) | `'easeLinear'` | Drives fade/size curves; evaluated on GPU in `easings.ts`. |
| `blendingMode` | `'normal' \| 'additive' \| 'subtractive' \| 'multiply' \| 'premultiplied'` | `'additive'` | Normalized to a `THREE.Blending` constant. `premultiplied` uses One / OneMinusSrcAlpha and multiplies RGB by alpha in the fragment shader. Additive suits glowing/fire/spark effects; normal suits smoke/dust. |
| `unlit` | `boolean` | `true` | Particles are always unlit (no scene lights). Kept as an explicit authoring flag. |
| `fog` | `boolean` | `true` | Apply scene fog. Turn off if unlit sprites still look “lit” by atmosphere. |
| `alphaMapPath` | `string` | `''` | Project/engine asset path to an alpha texture. |
| `spriteSheetColumns` / `spriteSheetRows` | `number` | `1` | Flipbook grid. `1×1` disables animation. |
| `spriteSheetMode` | `'lifetime' \| 'fps'` | `'lifetime'` | Lifetime plays the sheet across the particle life; FPS advances at `spriteSheetFps`. |
| `spriteSheetStartFrame` / `spriteSheetEndFrame` | `number` | `0` / `-1` | Inclusive frame range. `-1` end means the last cell. Random start hashes within this range. |
| `geometryPath` | `string` | `''` | Project/engine asset path to a model whose first mesh's geometry is used per-particle (`renderMode: 'mesh'`). GLTF materials are discarded — particles stay unlit. |
| `shadingHooks` | `ShadingHooks` | `{}` | Raw GLSL/TSL injection points (`customUniforms`, `customVaryings`, `vertexBeforeMain`, `vertexBeforeOutput`, `fragmentBeforeMain`, `fragmentBeforeOutput`) for advanced custom shading. Changing these forces material recreation via `updateSettings`. |
| `side` | `THREE.Side` | `THREE.FrontSide` | Not a `@property()` field on `VFXParticlesSettings` (no decorator) — set from code, not editor-serializable. |
| `depthTest` | `boolean` | `true` | |

Note: `frustumCulled` is intentionally always forced `false` on VFX meshes by `GlobalParticleManager` — particles routinely travel outside the emitter's own bounds, so per-mesh frustum culling would pop them out incorrectly. Any `frustumCulled` field on settings is ignored.

## `VFXEmitterSettings` (one spawn pattern)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `name` | `string` | *(unset)* | Editor display name. Emitters still bind by `particlesIndex`, not by this name. |
| `particlesIndex` | `number` | `0` | Index into the definition's `particles` array. |
| `loop` | `boolean` | `false` | Continuous emission in placed / in-game VFX. For `spawnMode: 'time'`, particles keep spawning past `duration`. For `spawnMode: 'burst'`, a new burst fires each `duration` after `delay`. The VFX editor preview ignores this and uses Auto-Replay on the clip instead. See looping footgun in SKILL.md when combined with `spawnVFX`. |
| `duration` | `number` | `1` | Emission window length in seconds (`endTime - delay` when `endTime` is set). |
| `delay` | `number` | `0` | Clip-time start in seconds. |
| `endTime` | `number` | `delay + duration` | Clip-time stop. When omitted, stop is `delay + duration`. The editor writes both `duration` and `endTime`. |
| `bursts` | `number[]` | `[]` | Extra burst times in clip seconds. Each fires `nbParticles` once (scaled by `clipRate` at that time). Separate from `spawnMode: 'burst'` at `delay`. |
| `clipRate` | `{ t: number, value: number }[]` | `[]` | Clip-time multiplier of `nbParticles` (`t` in seconds). Empty or before the first key = 1. Time mode integrates the curve so preview scrub catch-up stays correct; burst samples at fire time. |
| `clipSize` | `{ t: number, value: number }[]` | `[]` | Clip-time size multiplier, sampled on CPU at emit. Empty or before the first key = 1. |
| `clipSpeed` | `{ t: number, value: number }[]` | `[]` | Clip-time speed multiplier, sampled on CPU at emit. Empty or before the first key = 1. |
| `clipLight` | `{ t: number, value: number }[]` | `[]` | Clip-time light-intensity multiplier, sampled every frame. Empty or before the first key = 1. |
| `clipColor` | `{ t: number, color: string }[]` | `[]` | Clip-time spawn colour (`t` in seconds). Empty = `colorStart` / `colorRamp`. Sampled on CPU at emit; a lifetime ramp still runs from that colour toward later stops. |
| `nbParticles` | `number` | `1000` | Particles emitted per cycle (independent of the particle system's own `nbParticles` pool size). |
| `spawnMode` | `'time' \| 'burst'` | `'time'` | `'time'` spreads `nbParticles` (× `clipRate`) across `duration`; `'burst'` emits `nbParticles` × `clipRate` at `delay` as soon as delay elapses (or on demand via `emitAtPosition`/`emitAtPos`). |
| `particlesLifetime` | `[number, number]` | `[0.1, 1]` | Per-particle lifetime range (seconds), randomized per spawn. |
| `startPositionMin` / `startPositionMax` | `[number, number, number]` | `[-1,-1,-1]` / `[1,1,1]` | Random local offset from the emitter's world transform. |
| `startRotationMin` / `startRotationMax` | `[number, number, number]` | `[0,0,0]` | Initial rotation (radians), added to the emitter's world rotation. |
| `rotationSpeedMin` / `rotationSpeedMax` | `[number, number, number]` | `[0,0,0]` | Angular velocity range. |
| `directionMin` / `directionMax` | `[number, number, number]` | `[0,0,0]` | Random per-particle direction vector; rotated into world space when `useLocalDirection`/`localDirection` is set. |
| `size` | `[number, number]` | `[0.1, 1]` | Uniform scale range (applied to all 3 axes). |
| `speed` | `[number, number]` | `[5, 20]` | Scalar speed multiplied by `direction`. |
| `colorStart` | `string[]` | `['white', 'skyblue']` | One entry chosen at random per particle when `colorRamp` is absent. Any `THREE.Color`-parsable string (hex, named color). |
| `colorEnd` | `string[]` | `[]` | Random per particle; falls back to the same `colorStart` value when empty (no color shift). |
| `colorRamp` | `{ t: number, color: string }[]` | migrated from the first `colorStart`/`colorEnd` | Colour over particle lifetime (at least two stops, `t` in 0..1). GPU samples up to 8 stops. Emitters that share a particle system share the first matching ramp — use separate particle systems for different ramps. |
| `useLocalDirection` | `boolean` | inherited from constructor's `localDirection` arg (`false` via `GlobalParticleManager`/`VFXNode`) | Rotates `directionMin`/`directionMax` by the emitter's world rotation instead of treating them as world-space. |
| `emitLight` | `boolean` | `false` | Attaches a child `THREE.PointLight` (no shadows) at the emitter. Lights the surrounding scene, not unlit particles. Preview intensity follows the clip window; in-game `loop` keeps the light on after `delay`. |
| `lightColor` | `string` | `'#ffffff'` | Point light colour (`THREE.Color`-parsable). |
| `lightIntensity` | `number` | `8` | Point light intensity (candela). |
| `lightDistance` | `number` | `10` | Distance at which intensity falls to 0. `0` means infinite. |
| `lightDecay` | `number` | `2` | How quickly intensity falls with distance. |
| `subEmitters` | `{ on, planes?, emitterIndex, count?, inherit? }[]` | `[]` | Event bursts of another emitter in this definition. `on`: `'collision'` (plane impact within lifetime) or `'death'` (kill time, or lifetime end). `planes` (collision only, default `'all'`): `'all'` uses the first impact, `'emitter'` only the particle-system floor, `'extra'` only `VFXCollisionPlaneNode` rectangles. `emitterIndex` is the target in `emitters` (no cycles, not self). `count` overrides the target's `nbParticles`. `inherit.position` (default true) spawns at the predicted point; `inherit.direction` / `inherit.color` copy parent velocity and colour. Targets of a sub-emitter link do not emit on the clip — they only fire from these events. Rain splash: rain emitter + plane kill, splash emitter as the collision target (`planes: 'all'`). A ground ripple can use `planes: 'emitter'` so it does not spawn on a car/roof. Collision prediction uses the same extra rectangles baked at spawn, so `'all'` / `'extra'` splashes land on a car/roof instead of the floor under it. |

## Easing functions (`EaseFunction`)

Full list (`easeFunctionList` in `types.ts`, GPU-evaluated in `easings.ts`): `easeLinear`; Power1–4 (`easeIn/Out/InOutPowerN`); `easeIn/Out/InOutQuad`; `Cubic`; `Quart`; `Quint`; `Sine`; `Expo`; `Circ`; `Elastic`; `Back`; `Bounce`. Pick `easeOut*` for effects that should "pop" then settle (explosions, hit sparks); `easeIn*` for anticipation/wind-up; `easeInOut*` for smooth ambient loops.

## Validation

`VFXDefinition.fromJSON` (used whenever a `.vfx.json` is loaded, and by `GlobalParticleManager.spawnVFX`/`spawnVFXFromDefinition` internally) throws — not warns — when:
- `name` is missing/not a string
- `particles` or `emitters` arrays are missing or empty
- any `nbParticles` (particles or emitters) is not a positive integer
- `fadeSize`/`fadeAlpha`/`particlesLifetime`/`size`/`speed` aren't exactly length-2 arrays
- `gravity` or any `startPosition*`/`startRotation*`/`rotationSpeed*`/`direction*` field isn't exactly length-3
- `collision` is present and `mode` is not `"none"` / `"plane"` / `"world"`, `planeNormal` is not an array of exactly 3 numbers, `restitution` is negative, `restitutionVariance` or `friction` falls outside `0..1`, `killOnCollide` is not a boolean, or `maxBounces` is not a non-negative integer
- an emitter's `particlesIndex` is out of range for the `particles` array
- `colorRamp` is present but has fewer than two stops, or a stop's `t` is outside `[0, 1]`
- `endTime` is present and negative, or `bursts` is not an array of non-negative numbers
- `clipRate` / `clipSize` / `clipSpeed` / `clipLight` is present and a key's `t` or `value` is negative
- `clipColor` is present and a key's `t` is negative or `color` is not a string
- `emitLight` is present and not a boolean, `lightColor` is not a string, or `lightIntensity` / `lightDistance` / `lightDecay` is present and negative
- `subEmitters` is present and not an array, a link's `on` is not `"collision"` / `"death"`, `planes` is present and not `"all"` / `"emitter"` / `"extra"`, `emitterIndex` is missing or out of range / self, `count` is not a positive integer, `inherit` fields are not booleans, or the links form a cycle

Build settings objects with the exact tuple lengths above, even when values are constant (e.g. `startPositionMin: [0, 0, 0]`, not `[0]`).
