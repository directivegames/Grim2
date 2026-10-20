# World nodes: what to set

Source paths are under `.engine/src/`. Add with `action_node(add, className: "ENGINE.<Name>")`, configure with `action_node(setProperties)`. Value formats over MCP: numbers and booleans as-is, vectors as `{ "x": 1, "y": 2, "z": 3 }`, colours as `"#rrggbb"` strings, enums as their string values. Node-reference properties (`target`, `water`) take a node id: `"<node id>"` or `{ "nodeId": "<node id>" }`, or `null` to clear. The write fails if the node is missing or of the wrong class. Leaving them empty uses the parenting defaults described below.

## Environment and light

**`SkyNode`** (`nodes/visual/SkyNode.ts`) — physical sky with clouds; can bake an environment map for image-based lighting.
- `turbidity` 2–10 (haze), `rayleigh` 0.5–3 (blue depth), `mieCoefficient` 0.003–0.01, `mieDirectionalG` 0.7–0.9 (sun halo).
- `cloudCoverage` 0–1, `cloudDensity` 0–1, `cloudScale`, `cloudSpeed`, `cloudElevation`.
- `generateEnvironmentMap: true` for outdoor scenes (lights materials from the sky).
- `skyBrightness` 0.3–0.45: the physical sky is far brighter than scene lights; this keeps it blue at a normal exposure instead of white (the node default is 1 = old look). The dome and the captured environment map share this scale, so the sky lights the scene exactly as bright as it looks (`game/EnvironmentPresets.ts`, `addSky`).
- `environmentMapHdr: true` captures the sky in HDR so water and metals reflect a blue sky, not a white one. The capture is physically lit, so pair it with `environmentMapIntensity: 1` (the presets use 1, and 0.9 for the overcast plain). Do not turn it down to 0.3–0.6: that darkens every material. Lower it only for a deliberately dim or smoky world.
- The sun position follows the first `DirectionalLightNode` with `drivesSky: true`.

**`DirectionalLightNode`** (`nodes/lights/DirectionalLightNode.ts`) — the sun. Rotate it (or place it and look at the origin) to set the sun angle.
- `drivesSky: true`, `castShadow: true`, `intensity` 2–3.5 by day, 0.2–0.4 for moonlight, warm `color` at golden hour (`#ffc995`).
- Large worlds: `useCsmShadows: true`, `csmMaxFar` 400–800.

**`HemisphereLightNode`** (`nodes/lights/HemisphereLightNode.ts`) — soft sky/ground fill. `color` (sky), `groundColor`, `intensity` 0.3–0.6 by day (presets: 0.3 valley, 0.4 tropical, 0.6 overcast; 0.15 at night).

**`FogNode`** (`nodes/visual/FogNode.ts`) — depth and scale.
- `fogMode`: `linear` (`fogNear`, `fogFar`), `exponential` (`fogDensity` about 0.0003–0.0012 for 600–1400 m terrains — 0.00035 for 640 m islands, 0.0011 for a 900 x 1400 valley — and 0.01–0.03 for night streets), `exponentialHeight` (WebGPU only; `fogHeight`, `fogHeightFalloff`).
- Match `fogColor` to the horizon colour of the sky.

**`SceneEnvironmentNode`** (`nodes/visual/SceneEnvironmentNode.ts`) — HDR panorama or procedural gradient background and environment. Use for night or stylised skies when `SkyNode` does not fit.

**`TimeOfDayNode`** (`nodes/visual/TimeOfDayNode.ts`) — one per scene; drives the existing sun, sky, hemisphere, fog and environment from a clock (it owns no mesh).
- `time` 0–24 h (6 sunrise, 12 noon, 18 sunset, 22 night); set it over MCP with `setProperties { time }` or `setTime(h)` in code. `dayLengthMinutes` (0 = still; 10–20 for a visible cycle in play), `playing` (pause), `latitude` (40 → 50° noon sun), `northOffset` (north is −Z, the sun rises at +X).
- Peaks it scales down through dusk and night: `sunIntensity` 3, `skyBrightness` 0.3, `hemisphereIntensity` 0.35, `environmentIntensity` 0.35, `moonIntensity` 0.4 (soft blue shadowless moonlight), `sunShadows` (shadows off below the horizon), `driveFog`.
- Warning: `environmentIntensity` defaults to 0.35 and is written to `SkyNode.environmentMapIntensity`, while the presets use 1. Adding a `TimeOfDayNode` to a preset scene therefore darkens it. Raise `environmentIntensity` to 1 (and check `hemisphereIntensity` against the preset's 0.3–0.6) before judging the capture.
- Night lamps: tag lights (or a lamp node with lights inside) `night-light` (`nightLightTag`); they switch on below `nightLightElevation` (4°) and off 2° above it.
- Optional HDRIs (`hdriDay` / `hdriDusk` / `hdriNight`, cut on swap) need a `SceneEnvironmentNode`; shipped CC0 ones: `@engine/assets/textures/skybox/qwantani_dusk_2_puresky_2k.hdr`, `@engine/assets/textures/skybox/satara_night_no_lamps_2k.hdr`. Empty = the procedural sky, which gets a twilight/night gradient.
- `previewInEditor` (default off) applies it while editing; play always applies it. Deterministic: same `time`, same frame. `getState()` reports elevation, phase, night lights and what it drove; `isNight()`, `getSunDirection()`.

**`LensFlareNode`** (`nodes/visual/LensFlareNode.ts`) — sun (or lamp) lens flare. Empty `light` = the `drivesSky` sun; or a point/spot light id.
- `elements`: `sun` (default: warm glow, coloured hexagon ghosts, ring), `anamorphic` (wide blue streak; sci-fi, night city), `subtle`. `intensity` 1 (0.4–0.7 calmer), `color` tint, `flareSize`.
- `occlusion` (on) hides it behind buildings and terrain; it fades below the horizon and when the light is off, so it follows a `TimeOfDayNode`. Best when the camera faces a low sun. Classic WebGL renderer: skipped while post-processing is on (logged).

**Post-processing** — scene-level, not a node. `action_scene(updatePostProcessing, effects: [...])` merges by effect `type`:
- `{ "type": "toneMapping", "mode": 4, "exposure": 0.5 }` — mode 4 = ACES Filmic, 6 = AgX, 7 = Neutral, 1 = Linear.
- `{ "type": "bloom", "enabled": true, "strength": 0.6, "threshold": 0.7, "radius": 0.4 }` — for emissive and neon.
- `{ "type": "colorGrading", "enabled": true, "contrast": 1.05, "saturation": 1.1, "temperature": 0.1 }` (WebGPU).
- `{ "type": "ao", "enabled": true }` for contact shadows in built-up scenes.
- `{ "type": "lens", "enabled": true, "vignette": 0.3, "grain": 0.1, "chromaticAberration": 0.15 }` and `{ "type": "antiAliasing", "mode": "smaa" }` — see `look-and-exposure.md`.

## Landform

**`TerrainMeshNode`** (`nodes/visual/TerrainMeshNode.ts`) — heightfield with a static heightfield collider, built from the authored grid when the terrain joins the world or play starts. Prefer equal `widthSegments` and `depthSegments` (a square recipe `size`): older engines build a misaligned collider for non-square terrains.
- Size: `width`, `depth` (metres), `widthSegments`, `depthSegments` (≤ 512; about 2 m per segment is plenty), `maxHeight`.
- Noise: `noiseType` `"fbm"` (rolling), `"ridged"` (mountain ridges), `"fbmWarped"` (organic valleys; `warpAmount` 20–60); `noiseFrequency` 0.003–0.012 (world units; lower = bigger features), `octaves` 4–6, `lacunarity` 2, `gain` 0.5, `noiseSeed`. The legacy `"perlin"`/`"random"` types sample per vertex and ignore these.
- `erosion` 0–1 (default 0): hydraulic erosion that carves gullies and spurs into slopes and fills valleys with smooth fans, so noise reads as real mountains. Ground below sea level is left alone. It costs generation time (about 0.1–0.5 s at full strength on a 300 × 460 grid), so keep it at 0 for flat terrain. The `temperate-valley` recipe uses `erosion: 1`, `gain: 0.42`, `octaves: 5` and `noiseType: "ridged"` (`game/worldRecipe/builtinRecipes.ts`).
- Valleys: `shape: "valley"` carves a meandering river channel along Z between rising walls: `valleyWidth` (0.45–0.9 of half the width), `riverWidth` (m; 0 = no river), `riverDepth` (m below `seaLevel`), `riverMeander` (m sideways). Put a calm `WaterNode` (preset `river`) at world Y = terrain world Y + `seaLevel` (see Water placement below).
- Islands: `shape` `"island"` or `"archipelago"` (`islandCount`), `islandRadius` (fraction of half the smaller side, 0.8–0.95), `islandEdge` (falloff fraction, 0.5–0.7 for gentle shores), `beachWidth` (height band flattened into a beach, 1.5–3 m).
- Canyons: `shape: "canyon"` cuts a terraced gorge along Z into a flat plateau at `maxHeight`: `valleyWidth` (river-to-rim, fraction of half the width, default 0.5), `riverWidth`/`riverDepth`/`riverMeander` as for valleys, `canyonTerraces` (0–12 rock steps, default 4), `wallSteepness` (0 sloped to 1 sheer, default 0.75). A recipe spells the terraces `shapeOptions.terraces`.
- Volcano: `shape: "volcano"` is an island (`islandRadius`, `islandEdge`, `beachWidth`) with a central cone: `coneHeight` (fraction of `maxHeight`, default 0.9), `craterRadius` (fraction of the island radius, default 0.18; 0 = no crater), `craterDepth` (fraction of the cone, default 0.35). Needs an ocean.
- Basin: `shape: "basin"` is a bowl below `seaLevel` ringed by hills: `basinRadius` (fraction of half the smaller side, default 0.55), `basinDepth` (m below `seaLevel` at the centre, default 12), `beachWidth` for the shore band. Put a lake `WaterNode` at `seaLevel`.
- Coast: `shape: "coast"` is land on one side of a wavy shoreline and open sea on the other: `coastDirection` (degrees the sea lies in, 0 = +Z, default 180), `coastPosition` (shoreline offset towards the sea, −0.8 to 0.8, default 0), `cliffHeight` (m above the beach, default 25; 0 = beach coast), `beachWidth`. Needs an ocean.
- Water line: `seaLevel` (terrain-local Y, default 0; there is no "off" value). Shaping, biomes, layer rules and scatter all measure heights from it, and land sinks below it at island and archipelago edges.
- `hasSea` (default true): set `false` for inland terrain with no water at sea level. Layers then draw no beach sand, no underwater tint and no waterline band, and layer rules measure heights from 2 m below the lowest point instead of from `seaLevel` (`terrain/terrainLayers.ts`). The `overcast-plain` preset uses it. Do not use `island`, `archipelago`, `volcano` or `coast` without an ocean.
- Textured ground (preferred): `colorMode: "layers"` with `materialLayers` — usually set by a world style. Layers composite bottom first; each is `{ id, kind, color, variant?, tileSize?, triplanar?, emissive?, emissiveIntensity?, albedoTexture?, normalTexture?, rule? }`. Kinds: grass, dirt, sand, rock, cliff, snow, ash, lava, moss, gravel, pebbles, mud, basalt, sandstone, ice, crystal, forestFloor. Variants: realistic, painterly (anime), toon, flat (low-poly). Rule: `heightMin`/`heightMax` (m above sea, or fractions of the peak with `relativeHeight: true`), `heightBlend` (soft edge in the same units; default 0.6 m, or 0.04 when relative), `slopeMin`/`slopeMax` (degrees), `facingUp` (snow on tops), `concavity` (+ gullies / − ridges), `noiseAmount` (organic edges), `coverage`. Set `triplanar: true` on cliff layers. Relative-height rules are fractions of the peak, but the peak is clamped to at least 60 m (`RELATIVE_HEIGHT_MIN_PEAK` in `terrain/terrainLayers.ts`), so "top 18%" of a 20 m hill matches nothing: use absolute metres on low terrain.
- Layer textures: `realistic` layers use CC0 photo scans (`photoSet` `auto` picks by kind, a set id, or `none` for the procedural bake; `photoTint` 0–1, default 0.85, tints the scan towards the layer `color`) on the medium (512²) and high (1024²) tiers. The scans are fetched from engine assets (`terrain/bake/photoTerrainTextures.ts`). The low tier and the `painterly`, `toon` and `flat` variants stay procedural. `albedoTexture` swaps in an authored tileable texture (`@project/...`) and wins over a scan.
- `shading`: `standard`, `toon` (anime bands) or `flat` (faceted; with `lowPolyCellSize` 4–8 for big low-poly facets). `macroVariation` (default 0.35) breaks up tiling at distance; `detailFadeDistance` (default 220 m) is where texture detail has faded to flat colour, and the tier scales it (×1.6 medium, ×2.5 high, `terrain/terrainTiers.ts`). `quality` auto also sets the rendered mesh resolution: high draws the authored grid, medium about half the vertices, low a quarter (at least 64 quads a side). Heights, `getHeightAt`, collision, grass and scatter always use the authored grid, and the render resolution is never saved. After editing these from code call `refreshSurface()` (MCP edits refresh automatically). `getSurfaceInfo()` reports tier, layers and whether textures are ready.
- Legacy colour: `colorMode: "biomes"` with `biomes: [{ "maxHeight": 0.4, "color": "#c2a878" }, …]` (metres above `seaLevel`, ascending), `biomeBlend`, `slopeColor` (a `THREE.Color`) + `slopeThreshold` (rock on steep faces), `colorNoise`.
- Queries: `getHeightAt(x, z)`, `getNormalAt(x, z)`, `getSlopeAt(x, z)` in world space. Code only: MCP cannot call them (see [existing-scene.md](existing-scene.md)).
- Code that changes fields directly must call `regenerate()`; MCP/editor edits regenerate automatically.

## Water

**`WaterNode`** (`nodes/visual/WaterNode.ts`) — a water surface on the node's local XZ. The wave mesh follows the camera, so an ocean to the horizon costs the same as a pond.

**Placement.** `WaterNode` does not align itself to a terrain. Add it as a root node (not a terrain child) and set its world Y = the terrain's world Y + `seaLevel` (times the terrain's Y scale if scaled). The presets keep terrain Y 0 and `seaLevel` 0, so water sits at Y 0; move the terrain and the water must move too. `ScatterNode` converts `seaLevel` through the terrain's world matrix (`nodes/visual/scatter/scatterOnSurface.ts`), so it follows the terrain, not the water. With `hasSea: false` use no water at sea level.

Pick a `preset` first (set it on its own, before other properties). It sets the `technique` and every look property. Match the technique to the game's art style first (plain ids for photoreal, `toon-*` for anime, cel-shaded, cartoon or low-poly games), then pick by body of water and mood. 39 presets; each carries a one-line description in the editor picker (with a thumbnail):

| Want | Realistic | Stylized | Notes |
| --- | --- | --- | --- |
| Sunny, gentle sea | `calm-ocean` | `toon-calm-ocean` | Long low swell, calm glitter path |
| Default sea | `open-ocean` | `toon-ocean` | Use when unsure |
| Storm, rough weather, pirate battle | `stormy-ocean` | `toon-stormy-ocean` | Big dark swell, whitecaps, foam lanes. Pair with an overcast sky and dim sun |
| Islands, beaches, lagoons | `tropical-ocean` | `toon-tropical-ocean` | Turquoise shallows and bright caustics over sand |
| Glass-clear shallows (seabed visible) | `crystal-shallows` | | Caustics and coloured fringes; best at `high`/`ultra` |
| Open sea far from land | `deep-ocean` | | Dark sapphire, long swell, little foam |
| Cold, polar sea | `arctic-ocean` | | Slate-teal, choppy, white caps; overcast sky |
| Docks, canals, dirty water | `murky-harbour` | | Low clarity, small chop |
| Lake | `calm-lake`, `mirror-lake` (glassy), `alpine-lake` (very clear), `glacial-lake` (milky turquoise, opaque) | `toon-lake` | Planar mirror on high tier |
| Pond / swamp | `pond`, `swamp` (tea-dark bog) | `toon-pond`, `toon-swamp` | Small, still |
| River / stream | `river`, `muddy-river` (silty brown), `stream` (shallow, fast, clear) | `toon-river`, `toon-stream` | Flow along `flowDirection` |
| Hot spring | `hot-spring` | | Milky sky-blue mineral pool |
| Swimming pool | `clear-pool` | `toon-pool` | Hard edge against the pool walls |
| Background or mobile-only water | `simple-pool`, `simple-pond` | | Cheapest: no reflections |
| Lava | `lava` (textured crust, glowing cracks; use bloom) | `toon-lava` | `liquid` technique |
| Slime, toxic, tar, gold, paint, potion | `slime`, `toxic`, `tar` (black glossy), `molten-gold` (metal), `paint`, `arcane` (violet, sparkles) | | `liquid` technique |

Sea presets (all `*-ocean` ids and `crystal-shallows`) switch `shape` to `infinite`. Old preset ids still load as their new names.

Then adjust **at most these** (all in the Water category):
- `waterColor` (deep/body colour), `shallowColor` (realistic: the tint light takes on through `clarity` metres — keep blue ≥ green > red for clear water; stylized/simple: the shallow band colour).
- `clarity` — how far you see into the water in metres: 1–2 murky, 4–6 lake, 9–15 clear sea.
- `waveHeight` (swell height; 0 = flat and cheapest), `windSpeed` (m/s: how rough the wind sea on top is — 0–1 glassy, 2–4 lake, 5–8 breezy sea, 10–14 whitecaps, 18–25 storm; presets set it), `flowDirection` (wind/current heading, 0–360 degrees), `foamAmount`.
- `underwater` (default on): the camera can dive — Snell's window from below, absorption fog, caustics and light shafts. Turn off for puddles and films.
- `quality`: leave `auto` (`low` on most phones and low-end devices, `medium` on integrated GPUs, `high` on capable GPUs; never `ultra`). `low` (4 Gerstner waves, ripple normal map) has no refraction (alpha blend), no caustics and no FFT — the cheapest; `medium` adds a three-cascade FFT wind sea (128², swell/waves/ripples from `windSpeed`), refraction, depth colour, contact foam and caustics; `high` uses 256² cascades, persistent FFT foam, chromatic caustics, light shafts and the planar mirror; `ultra` (opt-in, desktop showcase only) uses 512² cascades and a 384 grid. The FFT needs float render targets and falls back to normal-map ripples without them.
- `shape`: `square` (the `size` rectangle, default), `circle` (the ellipse inside `size` — ponds, round pools) or `infinite` (follows the camera to the horizon and fades out there; `size` is ignored). Sea presets (`calm-ocean`, `open-ocean`, `stormy-ocean`, `tropical-ocean` and their `toon-*` versions) switch to `infinite` — use that for any ocean instead of a huge `size`.
- `edgeFade` (metres, default 10): square and circle water fade out towards their edge. Pool presets set 0 for a hard rim against pool walls.

Advanced (only when a preset is close but not right): Waves (`waveLength`, `choppiness`, `current` for rivers and lava, `flowSpeed` — 0 freezes everything for deterministic captures, `shoreDamping`, `seed`), Ripples (`normalStrength` — 0 glassy, 0.2–0.4 calm lake, 0.6–1.3 sea; `normalScale`; `rippleFadeDistance` in metres; `farVariation` 0–1 — large wind-stretched rough and calm patches that break up a sea seen from far away or from above; sea presets set 0.5–1, keep it for any big water), Optics (`scatterColor`, `refraction`, `reflectivity`, `roughness`), Foam (`foam`, `foamColor`, `shoreFoamWidth` — 0 for thin films such as a wet road), Caustics (`caustics` 0–3 — the moving cell pattern on the ground, 0 = off; `causticsScale`), Reflection (`planarReflection` — high tier only, one extra render per frame, use at most one; `reflectionResolution` 0.25–0.5), Stylized (`bands` 0–8, `shoreLines` 0–8), Liquid (`emissiveColor`, `emissiveIntensity` 3–8 with bloom for lava, `crust`, `metalness` 0 = glossy clear coat to 1 = molten metal, used by `molten-gold`).

Sun: `sunSource: "auto"` follows the `drivesSky` light; the surface receives that light's shadows. Queries: `getHeightAt(x, z)`, `getNormalAt(x, z)`, `isUnderwater(point)`. Water needs the default (WebGPU) renderer; the classic `webgl` renderer shows a plain plane.

**`BuoyancyNode`** (`nodes/visual/BuoyancyNode.ts`) — add as a child of a boat, buoy or crate to float it on the nearest `WaterNode` (or set `water` to a node id): `draft`, `bobAmplitude`, `bobFrequency`, `damping`, `tiltStrength`. Kinematic by default (it moves the parent). If the parent has a dynamic physics body, `usePhysics: true` floats it with forces during play, with `linearDrag` and `angularDrag`. `previewInEditor: false` keeps the authored transform while editing.

## Dressing

**`ScatterNode`** (`nodes/visual/ScatterNode.ts`) — seeded instanced placement. Add it as a child of the terrain (empty `target` uses the parent terrain).
- `items`: `[{ "kind": "primitive", "primitive": "broadleaf", "style": "realistic", "variants": 3, "weight": 1 }]` or `{ "kind": "model", "modelUrl": "@project/assets/models/x.glb" }`. Optional `scaleRange: [min, max]`, `color`.
  - Species: `broadleaf` (`oak`), `birch`, `pine`, `snowPine`, `palm`, `deadTree`, `bush`, `fern`, `flowers`, `rock`, `cactus`, `crystal`, `mushroom`. Legacy `palm`/`pine`/`rock`/`bush`/`tree` without `style` keep the old flat look; always set `style` for new scenes.
  - `style`: `realistic` (branches, leaf cards, wind), `stylized` (anime: soft round canopies, toon), `lowpoly` (faceted). `palette` `{ leaf, leafAlt, trunk, accent: [...], snow }`, `windResponse` (0 = static), `snowCover`, `lod: "auto"` (by distance: see LOD below), `castShadow` `auto` (by quality tier) | `all` | `near` | `none`.
  - LOD (`lod: "auto"`, `lodDistances` [LOD1, billboard] in metres): on the realistic style with the WebGPU renderer and the medium or high tier, trees go full mesh → baked tree impostor (8 side views plus a top view; atlas 1024 on high, 512 on medium) with a dissolve cross-fade at the switch. The classic `webgl` renderer, the low tier, non-realistic styles (`stylized`, `lowpoly`) and baked scatters keep full → simplified mesh → crossed billboards. Bushes, ferns, flowers, rocks, crystals and mushrooms have no billboard tier. The cross-fade width (`FOLIAGE_LOD_CROSS_FADE`, 0.18) is not a settable property (`nodes/visual/ScatterNode.ts`, `foliage/foliageLod.ts`).
- `role` (`none` by default; trees, shoreTrees, shrubs, groundCover, rocks, props) lets world styles swap species; `quality` auto.
  - Far views (top-down, high orbits): raise `lodDistanceScale` (1.5–2) to keep full trees further out, `drawDistanceScale` to draw further. Lower both on phones if frame time is tight.
- `instanceCount`, `minSpacing` (metres), `heightMin`/`heightMax` (relative to sea level), `minSlope`/`maxSlope` (degrees), `avoidWater`, `waterMargin`, `alignToNormal` 0–1 (rocks 0.6, trees 0), `scaleMin`/`scaleMax`, `sinkDepth`.
- Clusters: `densityFrequency` 0.01–0.03 with `densityThreshold` 0.4–0.5.
- Area: `areaCenter` `{x, y}` (a vector2; y is world Z) with `areaRadius`, or `areaSize` (also `{x, y}`); `exclusions` keep space clear around landmarks.
- Typical layers: shore palms (`heightMin` 0.4, `heightMax` 9, `maxSlope` 26), forest (`maxSlope` 30–34, density clusters), rocks (`minSlope` 15+, `alignToNormal` 0.6).
- Placement is regenerated from the seed on load and follows terrain regeneration. To hand-edit instances, `bake` (or set `baked: true`): the instances become ordinary saved children and stop regenerating; `unbake` (`baked: false`) deletes them and goes back to procedural placement. Baking rebuilds the trees without impostors (their atlases are runtime render targets that cannot be saved), so baked scatters use crossed billboards.

**`GrassNode`** (`nodes/visual/grass/GrassNode.ts`) — GPU grass and flowers around the camera on a terrain. Child of the `TerrainMeshNode` (or set `target`); one per terrain.
- `style`: realistic, meadow (with flowers), anime, lowpoly, dry, snowy, ash, alien. Overrides (null = style; colours are `THREE.Color`, strings are accepted): `baseColor`, `tipColor`, `dryColor`, `bladeHeight` (0.3–0.8 m), `bladeWidth`, `lean`, `flowerDensity` (0–1), `flowerColors`, `snowCover`.
- Where: `heightMin` (0.5 m above sea keeps beaches bare), `heightMax`, `maxSlope` (34°), `avoidWater`, `patchFrequency`/`patchThreshold` (bare patches), `exclusions` (paths, buildings), `layerIds` (terrain layers it grows on; default grass and moss layers).
- `density` (1 = tier default), `radius` (0 = tier: 24 m phones, 45 m, 70 m), `quality` auto, `castShadows` auto, `windResponse`.
- Level of detail: blades hand over between distance rings one by one across `transitionWidth` (0.3 of a ring), so there are no visible bands. `lodProfile` (`auto`, `openWorld`, `thirdPerson`, `firstPerson`, `topDown`, `mobile`, `custom`) sets `lodBias` (reach when `radius` is 0), `nearDetail`, `transitionWidth`, `coverageCompensation` and `shadowDistance` together; editing one of them switches to `custom`. `maxInstances` caps blades (0 = tier). `autoQuality` (on, only with `quality` auto) thins density and reach to hold `targetFrameMs` (16.7), and restores full grass if thinning does not help. `debugLod` tints blades by ring.
- Cost is a few draw calls whatever the terrain size, and only cells in view are drawn. `getStats()` reports instances, `visibleInstances`, `qualityScale` and draw calls; `getGrassDensityAt(x, z)` in code.

**`WindNode`** — one per scene: `direction` (degrees, 90 = +X), `strength` (0.6 breeze, 1 fresh, 2 gale), `gustStrength`, `gustScale`, `gustSpeed`, `flutter`, `freeze` (deterministic captures). Grass and styled foliage sway with it; without one they use a light breeze.

**`ProceduralPropNode`** (`nodes/visual/props/ProceduralPropNode.ts`) — seeded, code-built props with real-world sizes, origin at the ground centre. Use it for generic props instead of primitives or generation; it saves as its recipe and rebuilds identically.
- `kind` (sizes at `size` 1):

| Kind | Size (m) | Notes / pairs with |
| --- | --- | --- |
| `crate` | 1 cube | plank frame, braces; with barrels on docks and stalls |
| `barrel` | 0.66 x 1 | staves, iron hoops |
| `fence` | `length` x 1.1 | picket or split rail (by seed); tiles along local X, a post every ~2 m |
| `lamp-post` | 3.3 tall | glowing lantern, optional point light (`light`) |
| `hut` | 3.6 x 3.8 x 3.6 | plaster and timber walls, door, shuttered windows, thatch or tile roof (by seed) |
| `lighthouse` | 3.4 x 12.5 | striped tower, gallery, glowing lantern room, optional light |
| `boat` | 1.4 x 0.8 x 3.8 | rowing boat with seats and oars (add a `BuoyancyNode` child to float it) |
| `bench` | 1.7 x 0.9 | wooden slats on cast-iron sides |
| `sign` | 2.2 tall | signpost with 1-3 painted arrow boards |
| `well` | 1.9 x 2.6 | stone ring, roof, crank, rope and bucket |
| `market-stall` | 2.6 x 2.6 x 1.8 | striped canopy, counter, produce crates |
| `tent` | 1.9 x 1.5 x 2.4 | A-frame canvas, poles, guy ropes |
| `bridge` | `length` x 1.6 | arched footbridge with railings and stone abutments; spans local X |
| `ruin-pillar` | 1.6 x 3.2 | broken fluted column, fallen drum, rubble |
| `rock-arch` | 6 x 5 | natural stone arch |
| `dock` | `length` x 1.5 x 2.2 | pier on pilings, mooring posts, ladder; deck at 1.2 m, extends along local X |

- `style`: `realistic` (CC0 PBR wood, metal, brick, plaster, thatch, stone textures), `stylized` (rounder, saturated, toon shading), `lowpoly` (faceted vertex colours, cheapest). Match the game's art style, like water and foliage.
- `seed` (layout, proportions, wear), `size` (uniform scale), `length` (fence, bridge, dock; 0 = default 4 / 6 / 8 m), `colorVariant` 0-3 (paint, fabric, stripes, metal), `light` (lamp-post, lighthouse; off on the low tier), `lod` (lighter LOD1 at a distance), `castShadow`/`receiveShadow`.
- `collision`: `auto` (box for small props, triangle mesh for hut, lighthouse, bridge, dock, well, boat, stall, tent and rock-arch; convex for the pillar), `none`, `box`, `convex`, `mesh`. Bridges and docks are walkable for navigation.
- Budgets: at most 3 materials (draw calls) per prop; realistic LOD0 600 (crate) to 5000 (lighthouse) triangles, low-poly 60-800. `getStats()` reports triangles, draw calls, materials and bounds.
- Scatter many: `ScatterNode` items accept the kinds as primitives (`{ "kind": "primitive", "primitive": "barrel" }`), instanced as their low-poly mesh.
- Rotate the node to face a prop (front is local +Z); place it on terrain with `getHeightAt`.

## Reflections, lines and batches

**`MirrorNode`** (`nodes/visual/MirrorNode.ts`) — planar mirror: wall mirrors, glossy stage floors, wet streets, puddles. One extra scene render per visible mirror (keep to 1–2 on screen; mirrors facing away cost nothing).
- `orientation`: `wall` (upright, faces local +Z, bottom edge at the origin) or `floor` (flat, 5 mm up, centred). `size` `{x, y}` metres, `shape` `rect` | `circle`.
- `tint` (white = true mirror; `#c4ccd4` wet stone, dark for asphalt), `strength` 1 solid or 0.4–0.7 blended over the floor (puddles), `roughness` 0–0.4 blur, `distortion` 0.1–0.3 animated ripple (puddles in rain).
- `resolutionScale` 0.5 (0.25 for big floors), `quality` auto: low = glossy surface without a reflection render, medium = half resolution. Classic WebGL: sharp opaque `Reflector`, roughness/distortion ignored (logged). Lines or decals within a few cm of a reflected floor can vanish in the reflection (oblique clip precision).

**`LineNode`** (`nodes/visual/LineNode.ts`) — fat lines (plain lines are always 1 px): paths, routes, lasers, trails, outlines, in-world UI strokes. Per-point `colors` are `THREE.Color[]`.
- `points` (local, ≥ 2; lift ground paths ~0.05–0.15 m), `closed`, `width` with `widthUnits` `pixels` (2–6, constant on screen) or `world` (metres, 0.05–0.3 for lasers and ribbons), `color`, `opacity`.
- `dashed`, `dashSize`, `gapSize` (metres), `dashSpeed` (m/s, marching ants); `vertexColors` + `colors` (per point, gradients).
- Code: `setPoints([[x,y,z], ...])` updates in place without a rebuild (moving targets, trails); `getLength()`.

**`BatchedMeshNode`** (`nodes/visual/BatchedMeshNode.ts`) — many distinct static props in a few draw calls (one per material; all primitives and kit props share one).
- `sources`: model paths (`@project/models/x.glb`), primitives `box` `sphere` `cylinder` `cone` `capsule` `torus` (1 m, origin at the base), or kit props `prop:<kind>[:seed]` (`prop:barrel`, `prop:crate:7`; low-poly vertex colour).
- `instances`: `[{ "source": 0, "position": [x, y, z], "rotation": [0, 90, 0], "scale": 1.2, "color": "#ffaa66" }]` (rotation in degrees; scale a number or [x, y, z]); `maxInstances` 0 = all.
- Use it for hand-placed set dressing (market clutter, ruins, a street of mixed props); use `ScatterNode` for procedural placement and `InstancedMeshNode` for thousands of one mesh. `getStats()` reports batches (draw calls), instances, triangles and missing sources. 240 kit props of 8 kinds = 1 draw call.

## Camera

**`OrbitCameraNode`** (`nodes/OrbitCameraNode.ts`) — orbits the node's own position (move the node to set the pivot) and becomes the active camera on play.
- `distance`, `minDistance`, `maxDistance`, `yaw` (degrees, wraps within ±360), `pitch` (degrees above the horizon), `minPitch`, `maxPitch`, `damping` (seconds).
- `autoRotate` (bool, default true) enables idle orbiting; `autoRotateSpeed` (degrees/s; 0 = off) sets its pace and it resumes after `idleResumeDelay` seconds without input. `inputEnabled: false` makes a pure showcase camera.
- Use its id as `cameraNodeId` in `captureScreenshot` to see the player's view in edit mode.
- Games with their own camera: set `startActive: false` or skip it.

## Quality tiers

- Leave `quality: "auto"` on terrain, water, grass and scatter. Phones get fewer terrain layers, a coarser rendered terrain mesh (shape and collision stay the same), a 24 m grass radius, earlier tree billboards and no foliage shadows. Water `auto` drops to the low tier on phones and never picks `ultra`.
- Each extra scatter variant adds draw calls (items × variants × LOD tiers: 2 with a tree impostor, 3 with billboards). Realistic trees on WebGPU medium/high tiers hand over to baked impostors; other styles and the low tier use crossed billboards. Planar mirrors (`planarReflection`) render only on the high tier and cost one extra scene render each; use at most one.
- `auto` follows the device: discrete GPUs and Apple silicon get high, integrated GPUs medium, software adapters, low-core or low-memory machines and most phones low (flagship phones on WebGPU medium). In play, a frame-time watchdog lowers `auto` one tier if frames stay over 25 ms after loading (`gameLoop.qualityWatchdog`; opt out with the `qualityWatchdog: false` loop option).
- Settings menu: `ENGINE.setQualityTierOverride('low' | 'medium' | 'high' | null)` (beats the watchdog; live nodes follow); show `ENGINE.getResolvedQualityTier().summary`.
- WebGL renderer (`rendererType: 'webgl'`): height fog falls back to exponential, water becomes a plain plane, terrain layers show vertex colours, grass is not drawn and trees do not sway (all logged). Keep the default renderer.
- Troubleshooting: `GLB ... got 'version https://git-lfs...'` means the project's assets are Git LFS pointer stubs. Run `git lfs pull` in the Genesys repo, then recopy the files into the project.
