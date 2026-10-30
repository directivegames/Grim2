# Post-processing

The post stack is `world.postProcessManager` (`.engine/src/render/PostProcessManager.ts`). Effect ids, fields, and authoring defaults are in `.engine/src/render/postprocessing/PostProcessConfig.ts`. The engine's own guide is `.engine/src/render/postprocessing/POSTPROCESSING.md`. Use the `ENGINE` namespace (`ENGINE.PostProcessPass.<Name>`; the same object is also exported as `ENGINE.PostProcessEffectType`).

## Where the configuration lives

| Layer | API | Lifetime |
|---|---|---|
| World (saved with the scene) | `world.postProcessConfiguration`, `world.setPostProcessConfiguration(config)`, `world.updatePostProcessConfiguration(config)` | Serialized by `World.serialize` (`dumpValue('postProcessConfiguration', …)`). Replayed by `World.bindPostProcessManager` on entering Play or edit mode. `update…` merges per effect key (`id ?? type`). |
| Live manager | `world.postProcessManager.configureEffect(type, partial)`, `configure({ effects })`, `enablePasses(...)`, `disablePasses(...)` | Session only. `replaceConfiguration` resets every effect to `DefaultPostprocessEffectConfigs` and re-applies the world config on bind and level transition. |

`world.postProcessManager` throws when no game loop is attached. Calls before the pipeline exists are buffered into a pending config.

Base look → the GameMode calls `world.updatePostProcessConfiguration` once in `beginPlay`. Moments (hurt flash, slow-mo desaturation, death fade) → live manager, then restore.

**Play runs on its own world.** Entering Play builds a fresh `World` from the scene data (`GameLoop.loadLevelData` / `coldLoadLevelFromPath`); the editor's world is parked meanwhile (`World.isLiveSessionWorld`). What the GameMode sets lives in that Play world only: it is not written to the scene and never shows in the editor viewport or `captureScreenshot`. A configuration stored in the scene (for example one the creator set in the editor) loads first; the GameMode's `update…` merges over it per effect, so it keeps the fields the code does not name. Check the live values from code running in Play (`getEffectConfig`), and the look from an in-Play capture (`genesys-verification`).

## Passes and render order

| `PostProcessPass` | Order | Fields | Engine authoring default |
|---|---|---|---|
| `AO` (SSAO on WebGL, GTAO on WebGPU) | 10 | `bias`, `resolutionScale`; SSAO: `ssaoStrength`, `ssaoRadius`, `ssaoSamples`, `fade`, `luminanceInfluence`, …; GTAO: `gtaoStrength`, `gtaoRadius`, `gtaoSamples`, `gtaoMaxScreenRadius`, `thickness` | off; GTAO strength 1.0, radius 0.25, samples 16 |
| `Bloom` | 20 | `strength`, `threshold`, `smoothing`, `radius`, `mipmapBlur` (WebGL), `levels` (WebGL), `selectiveEmissive` (WebGPU), `ignoreBackground` | off; strength 2.0, threshold 1.0, smoothing 0.2, radius 0.85, ignoreBackground true |
| `ToneMapping` | 30 | `mode` (`THREE.ToneMapping`), `exposure`, `skipNonToneMappedMaterials` (WebGPU); WebGL auto-exposure: `resolution`, `whitePoint`, `middleGrey`, `minLuminance`, `averageLuminance`, `adaptationRate` | **on**; `LinearToneMapping`, exposure 0.3 |
| `ColorGrading` (WebGPU only) | 35 | `exposure`, `contrast`, `saturation`, `hueShift` (degrees), `temperature`, `tint`, `lift`, `gamma`, `gain`, `liftTint`, `gammaTint`, `gainTint`, `shadowsTint`/`Strength`, `midtonesTint`/`Strength`, `highlightsTint`/`Strength` | off; neutral (1.0 multipliers, 0 offsets, white tints) |
| `Lens` | 38 | `vignette`, `vignetteSmoothness`, `grain`, `grainAnimated`, `chromaticAberration`, `distortion` | off |
| `ObjectOutline` | 40 | `edgeStrength`, `edgeThickness`, `visibleEdgeColor`, `hiddenEdgeColor`, … | off |
| `Retro` | 45 | `colorDepthSteps`, `scanlineIntensity`, `scanlineDensity`, `scanlineSpeed`, `vignetteIntensity`, `bleeding`, `curvature`, `affineDistortion` | off |
| `Pixelation` | 54 | `pixelSize`, `normalEdgeStrength`, `depthEdgeStrength` | off; pixelSize 6 |
| `DepthOfField` | 55 | `focusDistance`, `focalLength`, `bokehScale`, `farOnly` | off |
| `SSR` | 59 | `quality`, `blurQuality`, `maxDistance`, `opacity`, `thickness`, `resolutionScale` | off |
| `AntiAliasing` | 72 | `mode` (`fxaa`, `smaa`, `traa`; WebGPU), `preset` (`ENGINE.AntiAliasingPreset.LOW/MEDIUM/HIGH/ULTRA`; WebGL runs SMAA for every mode) | **on**, `fxaa`, HIGH |

Tone-mapping modes: `THREE.NoToneMapping`, `LinearToneMapping`, `ReinhardToneMapping`, `CineonToneMapping`, `ACESFilmicToneMapping` (the engine guide's recommendation), `AgXToneMapping`, `NeutralToneMapping`.

The renderer starts at `NoToneMapping`, exposure 1.0 (`Renderer.ts`, `GenesysWebGPURenderer.ts`). The `ToneMapping` pass writes `renderer.toneMappingExposure` from its `exposure`. `IGenesysRenderer.toneMapping` / `toneMappingExposure` exist, but the pass is the one owner of exposure.

`ColorGrading.exposure` is a second multiplier after tone mapping. Use `ToneMapping.exposure` for brightness and leave the grade's `exposure` at 1.0 unless a moment needs a flash.

## Snippets

`configureEffect` takes a loose partial, so plain literals typecheck there. `updatePostProcessConfiguration` / `setPostProcessConfiguration` take `PostProcessConfiguration` (`effects: PostProcessEffectConfig[]`): each literal is checked against the config its `type` names, so no cast is needed. A const declared apart from the call takes its config type as an annotation.

Source: `.engine/src/render/postprocessing/POSTPROCESSING.md` (Quick Start), `.engine/src/render/PostProcessManager.ts` (`configureEffect`) — typechecked against 18.1.0-alpha.317
```ts
world.postProcessManager.configureEffect(ENGINE.PostProcessPass.Bloom, {
  enabled: true, strength: 1.0, threshold: 1.0, radius: 0.85, smoothing: 0.2,
  selectiveEmissive: false, ignoreBackground: true,
});
world.postProcessManager.configureEffect(ENGINE.PostProcessPass.ToneMapping, {
  enabled: true, mode: THREE.ACESFilmicToneMapping, exposure: 1.0,
});
```

Source: `.engine/src/render/PostProcessManager.ts` — typechecked against 18.1.0-alpha.317
```ts
const pm = world.postProcessManager;
pm.isPassEnabled(ENGINE.PostProcessPass.Bloom);
pm.getPostProcessingEnabled();
pm.getAllConfigurations();
pm.disablePasses(ENGINE.PostProcessPass.AO, ENGINE.PostProcessPass.SSR);
```

A moment (hurt flash, slow-mo desaturation): change one effect on the live manager and restore it afterwards. `configureEffect` is session-only, so a level change drops it.

Source: `.engine/src/render/PostProcessManager.ts` (`configureEffect`, `getEffectConfig`) — typechecked against 18.1.0-alpha.317
```ts
const pm = world.postProcessManager;
const before = pm.getEffectConfig(ENGINE.PostProcessPass.ColorGrading);
pm.configureEffect(ENGINE.PostProcessPass.ColorGrading, { enabled: true, saturation: 0.2, exposure: 1.3 });
setTimeout(() => { if (before) pm.configureEffect(ENGINE.PostProcessPass.ColorGrading, { ...before }); }, 120);
```

## Grade recipes (ColorGrading, WebGPU)

Tint fields (`liftTint`, `gammaTint`, `gainTint`, `shadowsTint`, `midtonesTint`, `highlightsTint`) are hex **numbers** (`0x2f8f9d`); each zone tint has a `…Strength` blend (0–1). Take tint hexes from the `GAME.md` palette when it has a fitting colour; the values below are starting points.

| Look | Values |
|---|---|
| Punchy arcade | `contrast` 1.05, `saturation` 1.15 |
| Warm sunset | `temperature` 0.15, `gain` 1.05, `highlightsTint` `0xffa05a`, `highlightsStrength` 0.2 |
| Cold horror | `temperature` -0.1, `saturation` 0.85, `contrast` 1.1, `lift` 0.02 so blacks stay readable, `shadowsTint` `0x3a4a6b`, `shadowsStrength` 0.15 |
| Teal/orange sci-fi | `contrast` 1.1, `shadowsTint` `0x2f8f9d`, `shadowsStrength` 0.2, `highlightsTint` `0xffa25a`, `highlightsStrength` 0.15 |
| Toxic / swamp | `saturation` 0.9, `midtonesTint` `0x8fbf5a`, `midtonesStrength` 0.12, `contrast` 1.05 |
| Night blue | `temperature` -0.15, `saturation` 0.8, `gain` 0.95, `shadowsTint` `0x1d2a4f`, `shadowsStrength` 0.25, `lift` 0.03 |
| Hurt flash (moment) | `saturation` 0.3, `exposure` 1.2 for 80–150 ms, then restore |

Source: `.engine/src/render/postprocessing/PostProcessConfig.ts` (`ColorGradingEffectConfig`) — typechecked against 18.1.0-alpha.317
```ts
const TEAL_ORANGE: ENGINE.ColorGradingEffectConfig = { type: ENGINE.PostProcessPass.ColorGrading, enabled: true, contrast: 1.1,
  shadowsTint: 0x2f8f9d, shadowsStrength: 0.2, highlightsTint: 0xffa25a, highlightsStrength: 0.15 };
world.updatePostProcessConfiguration({ effects: [TEAL_ORANGE] });
```

## Troubleshooting (from the engine guide)

- Effect not rendering: `isPassEnabled(type)`, `getPostProcessingEnabled()`, `getAllEffects()`, then the console.
- Config not applying: some changes need a pipeline rebuild (enabled state, MRT needs such as `selectiveEmissive`).
- Performance: lower `resolutionScale` on AO, reduce AO samples, disable passes on low-end devices (measure with `genesys-profiler`).
- Custom effects: `registerEffect` / `registerEffectClass` and the "Creating Custom Effects" section of `POSTPROCESSING.md`. Use the built-in passes for bloom, exposure, and grade.
