# VFX Definition Schema

Source of truth: `.engine/src/vfx/types.ts`. A `VFXDefinition` (and the `.vfx.json` files it serializes to/from) is `{ version, name, particles: VFXParticlesSettings[], emitters: VFXEmitterSettings[] }`. Every field below is optional in the JSON/settings object — defaults are applied by `normalizeVFXParticlesSettings` (particles) or the `VFXEmitterCore` constructor (emitters).

`VFXEmitterSettings.particlesIndex` links an emitter to one entry in the `particles` array (default `0`). Multiple emitters can share one particle system, or each can have its own — this is how a single VFX definition combines e.g. a burst of sparks (one particle system) with a lingering smoke puff (another).

## `VFXParticlesSettings` (one GPU particle system / `InstancedMesh`)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `nbParticles` | `number` | `1000` | Fixed pool size for this system's `InstancedMesh`. Not a spawn budget — see Footguns in SKILL.md. |
| `intensity` | `number` | `1` | Brightness multiplier. |
| `renderMode` | `'stretchBillboard' \| 'billboard' \| 'mesh'` | `'mesh'` in `VFXParticlesShared` normalization; `GlobalParticleManager.spawnVFX` defaults to `'billboard'` | `stretchBillboard` stretches along velocity; `mesh` renders `geometryPath` (or a default cube via `GlobalParticleManager` when `renderMode: 'mesh'` and no `geometryPath`). |
| `stretchScale` | `number` | `1.0` | Stretch factor, `stretchBillboard` only. |
| `fadeSize` | `[number, number]` | `[0.1, 0.9]` | Size fade-in/out range, as a fraction of particle lifetime. |
| `fadeAlpha` | `[number, number]` | `[0, 1.0]` | Opacity fade-in/out range. |
| `gravity` | `[number, number, number]` | `[0, 0, 0]` | Constant force applied to all particles in this system. |
| `appearance` | `'square' \| 'circular'` | `'square'` | Alpha-mask shape when no `alphaMapPath` is given. Normalized internally to `AppearanceMode`. |
| `easeFunction` | `EaseFunction` (see list below) | `'easeLinear'` | Drives fade/size curves; evaluated on GPU in `easings.ts`. |
| `blendingMode` | `'normal' \| 'additive' \| 'subtractive' \| 'multiply'` | `'additive'` | Normalized to a `THREE.Blending` constant. Additive suits glowing/fire/spark effects; normal suits smoke/dust. |
| `alphaMapPath` | `string` | `''` | Project/engine asset path to an alpha texture. |
| `geometryPath` | `string` | `''` | Project/engine asset path to a model whose first mesh's geometry is used per-particle (`renderMode: 'mesh'`). |
| `shadingHooks` | `ShadingHooks` | `{}` | Raw GLSL/TSL injection points (`customUniforms`, `customVaryings`, `vertexBeforeMain`, `vertexBeforeOutput`, `fragmentBeforeMain`, `fragmentBeforeOutput`) for advanced custom shading. Changing these forces material recreation via `updateSettings`. |
| `side` | `THREE.Side` | `THREE.FrontSide` | Not a `@property()` field on `VFXParticlesSettings` (no decorator) — set from code, not editor-serializable. |
| `depthTest` | `boolean` | `true` | |

Note: `frustumCulled` is intentionally always forced `false` on VFX meshes by `GlobalParticleManager` — particles routinely travel outside the emitter's own bounds, so per-mesh frustum culling would pop them out incorrectly. Any `frustumCulled` field on settings is ignored.

## `VFXEmitterSettings` (one spawn pattern)

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `particlesIndex` | `number` | `0` | Index into the definition's `particles` array. |
| `loop` | `boolean` | `false` | Continuous emission. See looping footgun in SKILL.md when combined with `spawnVFX`. |
| `duration` | `number` | `1` | Emission cycle length in seconds, for `spawnMode: 'time'`. |
| `nbParticles` | `number` | `1000` | Particles emitted per cycle (independent of the particle system's own `nbParticles` pool size). |
| `spawnMode` | `'time' \| 'burst'` | `'time'` | `'time'` spreads `nbParticles` linearly across `duration`; `'burst'` emits all `nbParticles` as soon as `delay` elapses (or on demand via `emitAtPosition`/`emitAtPos`). |
| `delay` | `number` | `0` | Seconds before emission starts. |
| `particlesLifetime` | `[number, number]` | `[0.1, 1]` | Per-particle lifetime range (seconds), randomized per spawn. |
| `startPositionMin` / `startPositionMax` | `[number, number, number]` | `[-1,-1,-1]` / `[1,1,1]` | Random local offset from the emitter's world transform. |
| `startRotationMin` / `startRotationMax` | `[number, number, number]` | `[0,0,0]` | Initial rotation (radians), added to the emitter's world rotation. |
| `rotationSpeedMin` / `rotationSpeedMax` | `[number, number, number]` | `[0,0,0]` | Angular velocity range. |
| `directionMin` / `directionMax` | `[number, number, number]` | `[0,0,0]` | Random per-particle direction vector; rotated into world space when `useLocalDirection`/`localDirection` is set. |
| `size` | `[number, number]` | `[0.1, 1]` | Uniform scale range (applied to all 3 axes). |
| `speed` | `[number, number]` | `[5, 20]` | Scalar speed multiplied by `direction`. |
| `colorStart` | `string[]` | `['white', 'skyblue']` | One entry chosen at random per particle. Any `THREE.Color`-parsable string (hex, named color). |
| `colorEnd` | `string[]` | `[]` | Random per particle; falls back to the same `colorStart` value when empty (no color shift). |
| `useLocalDirection` | `boolean` | inherited from constructor's `localDirection` arg (`false` via `GlobalParticleManager`/`VFXNode`) | Rotates `directionMin`/`directionMax` by the emitter's world rotation instead of treating them as world-space. |

## Easing functions (`EaseFunction`)

Full list (`easeFunctionList` in `types.ts`, GPU-evaluated in `easings.ts`): `easeLinear`; Power1–4 (`easeIn/Out/InOutPowerN`); `easeIn/Out/InOutQuad`; `Cubic`; `Quart`; `Quint`; `Sine`; `Expo`; `Circ`; `Elastic`; `Back`; `Bounce`. Pick `easeOut*` for effects that should "pop" then settle (explosions, hit sparks); `easeIn*` for anticipation/wind-up; `easeInOut*` for smooth ambient loops.

## Validation

`VFXDefinition.fromJSON` (used whenever a `.vfx.json` is loaded, and by `GlobalParticleManager.spawnVFX`/`spawnVFXFromDefinition` internally) throws — not warns — when:
- `name` is missing/not a string
- `particles` or `emitters` arrays are missing or empty
- any `nbParticles` (particles or emitters) is not a positive integer
- `fadeSize`/`fadeAlpha`/`particlesLifetime`/`size`/`speed` aren't exactly length-2 arrays
- `gravity` or any `startPosition*`/`startRotation*`/`rotationSpeed*`/`direction*` field isn't exactly length-3
- an emitter's `particlesIndex` is out of range for the `particles` array

Build settings objects with the exact tuple lengths above, even when values are constant (e.g. `startPositionMin: [0, 0, 0]`, not `[0]`).
