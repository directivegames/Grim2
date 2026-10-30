# Sky, environment, and fog

All three are scene nodes in `.engine/src/nodes/visual/`. Place them with MCP (`action_node(action="add", className="ENGINE.SkyNode")`, likewise `ENGINE.SceneEnvironmentNode`, `ENGINE.FogNode`), set properties, `action_scene(action="save")`, re-query. Both `SkyNode` and `SceneEnvironmentNode` implement `ISceneEnvironmentSource`; the root `GenesysScene` aggregates environment sources each frame.

## Pick one

| Need | Node |
|---|---|
| Daylight sky that follows the sun light | `SkyNode` with a `DirectionalLightNode` that has `drivesSky: true` |
| A painted, photographed, or generated panorama (HDRI, equirect PNG/JPG) | `SceneEnvironmentNode`, `sourceType: Textured`, `textureUrl` |
| A cheap stylised gradient (arcade, night, space-dark) | `SceneEnvironmentNode`, `sourceType: Procedural` |
| Distance haze or horror murk | `FogNode` |

## `SkyNode`

Source: `.engine/src/nodes/visual/SkyNode.ts`

Procedural atmospheric sky (Three.js `Sky` on WebGL, `SkyMesh` on WebGPU). The node scales its internal dome mesh to 10000, so leave the node itself at scale 1.

| Property | Default | Range |
|---|---|---|
| `turbidity` | 2 | 0–20 (haze) |
| `rayleigh` | 1 | 0–4 (sky colour intensity) |
| `mieCoefficient` | 0.005 | 0–0.1 |
| `mieDirectionalG` | 0.8 | 0–1 |
| `sunPosition` | (0, 1, 0) | Ignored when a light with `drivesSky` exists |
| `cloudScale` | 0.0002 | |
| `cloudSpeed` | 0.0001 | |
| `cloudCoverage` | 0.4 | 0–1 (0 = no clouds) |
| `cloudDensity` | 0.4 | 0–1 |
| `cloudElevation` | 0.5 | 0 horizon – 1 overhead |
| `showSunDisc` | true | Disable when generating an environment map |
| `skyBrightness` | 1 | Shared by the dome and its environment capture; 0.3–0.45 keeps the sky blue at exposure 0.4–0.6 (1 is the old white look) |
| `generateEnvironmentMap` | false | Generate an env map from the sky and apply it to the scene |
| `environmentMapHdr` | false | HDR capture; pair it with `environmentMapIntensity` 1 and fix a bright sky with `skyBrightness` or exposure, not a lower intensity |
| `environmentMapIntensity` | 1.0 | 0–10 |

## `SceneEnvironmentNode`

Source: `.engine/src/nodes/visual/SceneEnvironmentNode.ts`

| Property | Default | Notes |
|---|---|---|
| `sourceType` | `Textured` | `EnvironmentSourceType.Textured` or `Procedural` |
| `textureUrl` | `''` | `@project/assets/...` or `@engine/assets/...` panorama |
| `backgroundIntensity` | 1.0 | |
| `backgroundBlurriness` | 0.0 | 0–1 |
| `backgroundRotation` | (0,0,0) | Euler |
| `envMapIntensity` | 1.0 | Reflections and image-based light |
| `envMapRotation` | (0,0,0) | |
| `width` / `height` | 2048 / 1024 | Procedural only |
| `bottomColor` / `middleColor` / `topColor` | `#E6F3FF` / `#4A90E2` / `#0F1B3C` | Procedural only |

Colour space follows the file extension (`panoramaColorSpaceForPath`): PNG, JPG, and WebP are sRGB; HDR and EXR stay linear. The environment applies at `beginPlay` and never ticks.

Engine panoramas in `@engine/assets/textures/skybox/`: `citrus_orchard_road_puresky_2k.hdr`, `qwantani_dusk_2_puresky_2k.hdr`, `satara_night_no_lamps_2k.hdr`, `venice_sunset_4k.hdr`. Any other panorama is an asset row: `genesys-assets` picks the route (a project file, a Blender equirect still when Blender is on, or Scenario only when the project's art routes name it), lands it under `assets/`, and the path goes into `textureUrl`.

## `FogNode`

Source: `.engine/src/nodes/visual/FogNode.ts`

| Property | Default | Notes |
|---|---|---|
| `fogMode` | `linear` | `FogMode.Linear`, `Exponential`, `ExponentialHeight` (WebGPU node renderer only) |
| `fogColor` | (0.5, 0.5, 0.5) | Match the sky or background at the horizon |
| `fogNear` / `fogFar` | 0.1 / 50 | Linear only |
| `fogDensity` | 0.04 | Exponential coefficient, or height-fog density at `fogHeight` |
| `fogHeight` | 0 | World Y where height-fog density equals `fogDensity` |
| `fogHeightFalloff` | 0.2 | Smaller keeps fog thicker higher up |

Fog applies at `beginPlay` and never ticks. The accessors apply to the active fog immediately.

## Traps

- Fog colour does not match the sky → the horizon shows a band. Sample the sky colour at the horizon for `fogColor`.
- Linear fog `fogFar` 50 swallows a racing track → raise `fogFar` to the view distance or use exponential at 0.002–0.01.
- Generated PNG skybox looks washed out → it is sRGB and correct; lower `backgroundIntensity` instead of re-saving as HDR.
