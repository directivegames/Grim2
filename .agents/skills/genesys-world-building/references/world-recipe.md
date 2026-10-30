# World recipes: `applyWorld`

A world recipe is the only catalogue of outdoor worlds (landform, water, style, vegetation, sky, camera, look). `listWorldRecipes` returns each one with `group`: `environment-preset` (the original four layouts) or `landform` (everything else). `applyWorld` builds any of them into ordinary nodes: `SkyNode`, a "Sun" `DirectionalLightNode`, "Sky Fill", `FogNode`, `WaterNode`, `TerrainMeshNode` with `ScatterNode` children, `OrbitCameraNode`, plus ACES tone mapping. Nothing recipe-specific is saved, so edit them afterwards with `action_node(setProperties)`. One call is one undo step, and the scene is saved after it. 

`applyWorld` defaults to full dressing: the recipe's style and its default landmarks. Plain dressing skips both unless you pass a style. `applyEnvironmentPreset` is that plain build for the `environment-preset` group only (`tropical-ocean`, `temperate-valley`, `night-street`, `overcast-plain`). Prefer `applyWorld` for every world, including those four. Pass `landmarks: []` and `style: null` on the recipe when you want the plain look from `applyWorld`.

## Calls

```text
action_scene({ action: "listWorldRecipes" })                        // ids, labels, shape, water role
action_scene({ action: "applyWorld", world: { ... }, dryRun: true })  // resolved recipe + warnings, changes nothing
action_scene({ action: "applyWorld", world: "desert-canyon", seed: 7 })
action_scene({ action: "applyWorld", world: { extends: "tropical-ocean", sky: { timeOfDay: "dusk" } } })
action_scene({ action: "auditWorld" })                              // read-only wiring check
```

`landform.shape` is required whenever `landform` is given (a dry run fails without it). The quickest custom start is `{ extends: "<id>", ... }`, which inherits a valid landform, water and style. **Style changes go through `applyWorld`**: set `style` in the recipe and re-apply with `applyWorld` (default `replace: "world"`). Do not follow `applyWorld` with `applyWorldStyle`: it re-dresses everything, ignores what the recipe spelled out and replaces water presets by role (the `volcanic` style turns an ocean into lava and replaces the atmosphere). The terrain can show plain height-band colours until the style's layers load; judge colour only from a later capture.

**The `world` argument** is a built-in id string, or one object with these top-level keys, all optional: `id`, `label`, `description`, `tags`, `extends`, `seed`, `landform`, `water`, `style`, `styleOverrides`, `vegetation`, `sky`, `camera`, `look`, `structures`, `landmarks`. Any other key is an `unknown field` error. `id` is free-form metadata (letters, digits and dashes); a recipe passed to `applyWorld` needs no registration and the id does nothing unless another recipe extends a registered one.

Always dry-run a custom recipe first: an invalid one returns `path: message Fix: ...` lines and changes nothing. Applied results carry `world.createdNodes`, `removedNodeIds`, `focusNodeId` (frame and capture it) and `warnings`. `seed` overrides the recipe seed; the same seed gives the same world. Built-in ids are whatever `listWorldRecipes` returns. The `environment-preset` group is `tropical-ocean`, `temperate-valley`, `night-street` and `overcast-plain`. The `landform` group includes `desert-canyon`, `volcanic-island`, `lake-basin`, `coastal-cliffs` and `arctic-coast`.

In game code `applyWorld` returns a Promise and builds in small steps so the page stays responsive:

```ts
const result = await ENGINE.applyWorld(world, 'tropical-ocean', { seed: 7, signal });
if (!result.ok && result.cancelled) return; // a newer apply on this world, the abort signal or a destroyed world stopped it
```

`signal` is an `AbortSignal`. The built world is the same on every device: terrain spacing, segments and erosion come from the recipe, so heights, collision and placement match everywhere (multiplayer included). Weaker devices draw the terrain mesh coarser by themselves (see `quality` on `TerrainMeshNode` in [nodes.md](nodes.md)); there is no build-time quality option. The build shows as a loading task ("Building the world…") in `world.getLoadingProgress()`, and eroded terrain then generates its heights on a worker (see [loading.md](loading.md)).

## Fields (all optional except `landform` + `water.role`)

| Field | Range | Default and derivation |
|---|---|---|
| `id`, `label`, `description`, `tags` | letters, digits, dashes | metadata |
| `extends` | recipe id | start from that recipe (see Extends) |
| `seed` | integer 0 to 2^31-1 | 1; terrain and every scatter get their own sub-seed |
| `landform` | `null` = no terrain | required unless `structures` is set |
| `landform.shape` | flat, hills, island, archipelago, valley, canyon, volcano, basin, coast | required |
| `landform.size` | 100-4000 m, or `[w, d]` | by shape (table below) |
| `landform.relief` | 1-400 m | peak height above the water level (terrain `maxHeight`); by shape |
| `landform.noise` | `type` fbm / ridged / fbmWarped, `frequency` (per metre, max 1), `octaves` 1-8, `gain` 0.1-0.9, `lacunarity` 1.2-3.5, `warp` 0-200 m | by shape; frequency = features / smaller side |
| `landform.erosion` | 0-1 | by shape; costs 0.1-0.5 s at 1 |
| `landform.detail` | low / medium / high | vertex spacing low 4 m, medium 3 m (default), high 2 m; at most 512 segments a side (a warning only when you set `detail`). The same on every device; the medium and low render tiers draw a mesh with about half and a quarter of the vertices |
| `landform.shapeOptions` | see Shapes | `SHAPE_OPTION_DEFAULTS` per shape |
| `landform.biomes` | 1-12 `{ maxHeight, color }` | derived bands (beach and sea-floor bands only with water); a style replaces them with textured layers |
| `landform.terrain` | raw `TerrainMeshNode` options, applied last | escape hatch; unknown keys and `shape` error, `seaLevel`/`hasSea` are ignored (set water instead) |
| `water.role` | ocean, lake, river, none | required with a landform; see Water |
| `water` `name`, `level` (-50 to 200 m), `preset`, `size` (m or `[x, z]`), `reflections`, `overrides` | | level 0; preset by role; `overrides` = raw `WaterNode` options |
| `style` | world style id, inline style or `null` | shape default: volcano `volcanic`, canyon `desert`, ocean + island/archipelago `realistic-tropical`, else `realistic-temperate`; `null` = keep biome colours |
| `styleOverrides` | partial style | merged over the style last, e.g. `{ grass: { enabled: false } }`; also changes what the style does to water or atmosphere |
| `vegetation` | up to 12 layers | by shape (see Vegetation) when omitted; an array replaces, `[]` = none |
| `sky` | see Sky | afternoon, haze 0.3 |
| `camera` | `mode` orbit / none, `view`, `pivot`, `distance`, `pitch`, `yaw`, `maxDistance` | `overview`; `none` adds no camera |
| `look` | `preset`, `exposure` 0.05-4, `bloom` `{ strength, threshold, radius }` | exposure by time of day; bloom only when given (0.6, 0.7, 0.4); `preset` is applied after the style and keeps the exposure |
| `structures` | `[{ kind: "neon-street", wet }]` (max 4) | only `neon-street`; then no landform is needed |
| `landmarks` | up to 8 `{ kind, count 1-8, scale 0.25-6, placement, name }`; `placement` focal / shore / summit / scattered / floating | omitted = defaults by shape and water role (see Landmarks); `null` or `[]` = none; needs a landform |

**What you spell out wins.** Precedence: an explicit recipe value, then the style, then the derived default. The style dresses everything the recipe leaves out. A `water.preset` you set is kept; without one, the style's water map applies (`volcanic` and `alien` turn the water into lava or toxic). Explicit `sky.physical`, `sky.sun.color`, `sky.fog.color`, `sky.environmentIntensity` and `sky.fill.sky` / `sky.fill.ground` are kept instead of the style's atmosphere (`volcanic`, `alpine-snow`, `desert`, `alien`, `arctic`); a recipe with only `timeOfDay` still gets the style's atmosphere tint on its sky, sun, fog and fill. So set `water.preset` or the sky fields directly; no workaround is needed. `styleOverrides` apply last, on top of everything: use them for the grass, foliage and look parts, or to change what the style does. `style: null` skips the style.

## Water role: one switch for four settings

| Role | Terrain `seaLevel` / `hasSea` | Water node | Scatter `avoidWater` | Shapes |
|---|---|---|---|---|
| `ocean` | `water.level` (0) / true | `calm-ocean`; size left to the preset (infinite), or 3x the terrain when that is over 2000 m; Y = level | on | island, archipelago, volcano, coast (error otherwise) |
| `lake` | level / true | `calm-lake`, size = terrain, planar mirror on, Y = level | on | `basin` always holds a lake; other shapes warn (water only shows where ground dips below the level) |
| `river` | level / true | `river`, size = terrain, planar mirror on, Y = level | on | valley, canyon (error otherwise); needs `riverWidth` above 0 |
| `none` | 0 / false (no beach sand, underwater tint or waterline band) | none | off | flat, hills, valley, canyon, basin (island, archipelago, volcano, coast error: they would show a pit) |

On valley and canyon with a role other than `river`, `riverWidth` is set to 0 (a dry channel) unless you set it.

## Shapes

| Shape | Size / relief | Default shapeOptions (meaning) | Use |
|---|---|---|---|
| `flat` | 600 / 4 | none | plains, arenas |
| `hills` | 700 / 16 | none | meadows, overcast baseline |
| `island` | 640 / 24 | `islandRadius` 0.8 (fraction of half the smaller side), `islandEdge` 0.5 (coast fall-off, fraction of radius), `beachWidth` 2.5 m | one island, ocean |
| `archipelago` | 640 / 18 | `islandCount` 5, `islandRadius` 0.95, `islandEdge` 0.7, `beachWidth` 3 | several islands |
| `valley` | 900x1400 / 120 | `valleyWidth` 0.85 (river-to-wall, fraction of half the width), `riverWidth` 22 m, `riverDepth` 2.5 m, `riverMeander` 70 m | forest valley, river |
| `canyon` | 900x1400 / 90 | `valleyWidth` 0.5, `riverWidth` 18, `riverDepth` 3, `riverMeander` 90, `terraces` 4 (0-12 rock steps), `wallSteepness` 0.75 (0 sloped, 1 sheer) | plateau cut by a terraced gorge along Z |
| `volcano` | 900 / 140 | `islandRadius` 0.72, `islandEdge` 0.45, `beachWidth` 3, `coneHeight` 0.9 (fraction of relief), `craterRadius` 0.18 (fraction of island radius), `craterDepth` 0.35 (fraction of cone) | volcanic island in a sea |
| `basin` | 800 / 70 | `basinRadius` 0.55 (fraction of half the smaller side), `basinDepth` 12 m below the level | lake in a bowl of hills |
| `coast` | 1000 / 50 | `coastDirection` 180 (compass degrees the sea lies in, 0 = +Z), `coastPosition` 0 (-0.8..0.8 shoreline offset), `cliffHeight` 25 m (0 = beach coast), `beachWidth` 1.5 | headland, sea cliffs |

**Relief guidance** (a rule of thumb, not an engine rule; consistent with the defaults above): gentle 10-20 m (`hills` 16, `flat` 4), rolling 25-50 m (`island` 24, `coast` 50), mountainous 80+ m (`canyon` 90, `valley` 120, `volcano` 140). Noise features across the smaller side = `frequency` x that side, so 2 is near-flat, 3-4 reads as rolling, 5-6 is busy (island 5, archipelago 6.4). For rolling hills use `hills` with `relief: 30-40` and `frequency` about 3.5 / smaller side (0.005 on 700 m); more relief with the same frequency makes steeper, not more, hills.

Default noise: fbm for flat, hills, island, archipelago, coast; ridged for valley, canyon, volcano, basin. Default erosion: flat 0, hills 0.3, island 0.3, archipelago 0.2, valley 0.8, canyon 0.5, volcano 0.6, basin 0.6, coast 0.4. Ranges (the dry run rejects anything outside): islandCount 1-64 (integer), islandRadius 0.05-2, islandEdge 0.01-1, **beachWidth 0-20 m** (the beach's height band, not its width on the ground; widen a beach with low `relief` and `coastPosition` instead), valleyWidth 0.05-1, riverWidth 0-200, riverDepth 0-30, riverMeander 0-400, terraces 0-12 (integer), wallSteepness, coneHeight, craterRadius, craterDepth 0-1, basinRadius 0.1-1, basinDepth 0-80, coastDirection 0-360, coastPosition -0.8-0.8, cliffHeight 0-200.

## Vegetation

Each layer is a `ScatterNode` child of the terrain: `{ role, species?, density?, count?, height?, slope?, spacing?, clustering?, scale?, alignToNormal?, overrides? }`. `height` is metres above the water level (or fractions of relief with `relative: true`, then both 0-1). `count` wins over `density`; `density` is a word or instances per hectare; count = round(per hectare x land area / 10000), land area = width x depth x the land fraction.

| Role | Species | sparse / normal / dense per ha | Defaults |
|---|---|---|---|
| `trees` | pine, broadleaf | 4 / 12 / 24 | spacing 3.5, slope 0-32, clustering 0.4, min height 1.5 with water |
| `shoreTrees` | palm | 1.5 / 4 / 8 | spacing 4, height 0.4 to relief/2 (max 9); with no water becomes `trees` |
| `shrubs` | bush | 4 / 10 / 20 | spacing 3, clustering 0.3 |
| `groundCover` | fern, flowers | 8 / 20 / 40 | spacing 1.5 |
| `rocks` | rock | 0.6 / 1.5 / 3 | spacing 5, slope 8-60, aligned to the normal |
| `props` | rock | 0.5 / 1 / 2 | spacing 4 |

A layer mixes all its species by weight: a string is weight 1, or use `{ primitive, weight, color }`, so `groundCover` with `['fern','flowers']` scatters both. Suitable species by role (`inferFoliageRole` and `FOLIAGE_SPECIES_SETS`):

| Role | Species that suit it |
|---|---|
| `trees` | pine, broadleaf, oak, birch, tree, snowPine, deadTree, cactus |
| `shoreTrees` | palm (sets also use broadleaf, birch, snowPine, deadTree, mushroom) |
| `shrubs` | bush, fern, mushroom, crystal |
| `groundCover` | flowers, fern, crystal, mushroom |
| `rocks`, `props` | rock |

**A style can replace your species.** Every built-in style with foliage sets a `foliage.speciesSet` (`realistic-temperate` and `autumn-forest` temperate, `realistic-tropical` tropical, `desert` arid, `volcanic`, `alpine-snow`, `alien`, and so on). `ScatterNode.applyFoliageStyle` then swaps each non-rock item for the set's species for that layer's role, cycling through the set (weights and colours of the items stay). So `trees: ['pine']` under `realistic-tropical` becomes palms, and `autumn-forest` turns `trees` into broadleaf, pine and birch. Roles missing from the set (`props`) and `rock` keep theirs. To keep your species, switch the swap off and keep the style's look: `styleOverrides: { foliage: { speciesSet: null } }` (foliage keys merge shallowly, so the style and palette stay; `foliage: null` would drop the foliage styling altogether). Check with a capture or `dryRun`: the dry run shows your species, not the swapped ones.

Species: palm, pine, rock, bush, tree, broadleaf, oak, birch, deadTree, fern, flowers, cactus, crystal, mushroom, snowPine (a string or `{ primitive, weight, color, scaleRange, style }`). Land fraction: flat 1, hills 1, island 0.3, archipelago 0.2, valley 0.85, canyon 0.8, volcano 0.3, basin 0.75, coast 0.5. Omitted `vegetation` gives 2-3 layers by shape (island: shoreTrees, shrubs, rocks at normal; valley: dense trees; canyon: dense rocks). Budgets (warnings, not errors): 6000 instances per scatter, 15000 in total.

## Sky, time of day, haze, camera

`sky`: `timeOfDay` (name or hour 0-24), `sunAzimuth`, `clouds` 0-1, `haze` 0-1, `tint` (colour), `mist` 0-1, `kind` physical / gradient, plus overrides `sun { elevation, azimuth, color, intensity, shadowDistance, cascades, drivesSky }`, `physical`, `gradient`, `environmentIntensity` (default 1, HDR capture), `fill`, `fog { mode, color, density, near, far, height, falloff }`. An hour picks the nearest named profile for colours; the sun follows the clock (peak 72 degrees at 12:30, day 5:30-20:00, else night).

Sky sub-fields and ranges (colours are CSS strings such as `"#rrggbb"`):

| Field | Keys and ranges |
|---|---|
| `sun` | `name`, `elevation` -10 to 90, `azimuth` 0-360, `color`, `intensity` 0-20, `shadowDistance` 50-4000 m, `cascades` bool (default false; leave it off, also for large terrain: `genesys-lighting` → *Cascaded shadows: default off*), `drivesSky` bool |
| `physical` | `turbidity` 0-20, `rayleigh` 0-4, `mieCoefficient` 0-0.1, `mieDirectionalG` 0-1, `cloudCoverage` 0-1, `cloudDensity` 0-1, `brightness` 0-4 |
| `gradient` | `bottom`, `middle`, `top` colours, `intensity` 0-4 |
| `fill` | `sky`, `ground` colours, `intensity` 0-4 |
| `fog` | `mode` exponential / linear / height / none, `color`, `density` 0-0.2, `near` 0 or more, `far` 1 or more; height fog: `height` (world Y where `density` applies), `falloff` 0-2 |
| `tint` | one colour: a tinted gradient sky (see Coloured skies) |
| `mist` | 0-1: low ground mist (see Mist) |
| `environmentIntensity` | 0-4 (physical sky env map; for a gradient sky the gradient `intensity` wins) |

**Coloured skies (violet, alien, stylised): `sky.tint`.** The physical sky is a scattering model and cannot be tinted freely, so `sky.tint: "#7a4fd0"` switches to a procedural gradient sky built from that colour (bottom lighter, middle the tint, top darker; env intensity 1) and tints the fog (55%), sky fill (60%) and sun (35%) towards it. No manual gradient, fog or fill is needed. Pair it with the `alien` style for terrain, water and foliage: `{ extends: "overcast-plain", style: "alien", sky: { tint: "#7a4fd0" } }`. Spelled-out `sky.gradient`, `sky.fog.color`, `sky.fill` and `sky.sun.color` still win over the tint. The manual option stays: `sky.kind: "gradient"` with `sky.gradient: { bottom, middle, top, intensity }` (no sun disc or clouds; unset colours default to a grey-blue day gradient) plus matching `fog.color` and `fill`.

**Mist: `sky.mist` 0-1.** Low height fog, dense at the water or valley floor and thinning fast with height: fog `mode: "height"`, `density` 0.004 + 0.03 x mist, `height` water level + 1 m, `falloff` 0.25 - 0.17 x mist, colour = the fog colour lightened 25%. Use it for misty dawns, lakes and valleys (`{ extends: "lake-basin", sky: { timeOfDay: "dawn", mist: 0.6 } }`). Height fog draws on WebGPU only; other renderers fall back to uniform exponential fog. You can also set `sky.fog: { mode: "height", height, falloff, density }` directly; an explicit fog field beats the mist-derived one.

**Overcast.** Heavy `clouds` (about 0.6 and up, full effect by about 0.95) now does the grey day for you: the physical dome moves towards turbidity 14, rayleigh 0.6 and brightness 0.38, the fog towards grey, the sun loses up to 45% of its intensity and the fill gains up to 60%. Just set `clouds: 0.85`; do not lower the sun by hand. `overcast-plain` is the reference (turbidity 14, coverage 0.75, sun 1.9, fill 0.6).

**Low sun.** Dawn, dusk and golden hour carry a higher sun, more fill and more exposure by default (they used to crush to black), so no manual exposure or fill bump is needed. An hour between 5.5 and 20 keeps the sun at least 6 degrees up.

| Time | Hour | Sun elevation | Sun intensity | Fill intensity | Exposure | Clouds |
|---|---|---|---|---|---|---|
| dawn | 6.5 | 9 | 2.9 | 0.6 | 0.8 | 0.3 |
| morning | 9 | 28 | 3 | 0.4 | 0.5 | 0.3 |
| noon | 12.5 | 68 | 3.4 | 0.4 | 0.45 | 0.25 |
| afternoon | 15.5 | 34 | 3.2 | 0.4 | 0.5 | 0.35 |
| golden-hour | 18 | 14 | 3.4 | 0.42 | 0.5 | 0.3 |
| dusk | 19.5 | 7 | 2.8 | 0.6 | 0.95 | 0.35 |
| night | 23 | 40 (moon, `drivesSky` off, gradient sky, env 0.35) | 0.25 | 0.15 | 0.9 | 0.2 |

Sun azimuth 140 (night 200). Heavy clouds scale the sun and fill as above. Shadow distance = extent x 0.8, 150-1200 m. **Camera views** (extent = larger side): `overview` distance 0.6 x extent, pitch 22, yaw 35; `hero` distance 0.35 x extent, pitch 13, yaw 25, pivot nudged towards +Z; `ground` distance max(15, 0.12 x extent), pitch 6, yaw 20. Pivot height is the water level plus 0.15 / 0.25 / 0.1 x relief.

## Landmarks

`landmarks: [{ kind, count, scale, placement, name }]` adds focal props so the world has something to look at. Each is a `ProceduralPropNode` child of the terrain (seeded, deterministic), placed at a composition point and turned to face the camera: `focal` (rule of thirds around the look point, on flat dry ground), `shore` (beach or low cliff, the nearest suitable ground to the camera but not under it; docks and boats reach into the water, boats moor beside a dock), `summit` (high flat ground), `floating` (offshore on open water; the prop gets a `BuoyancyNode` child so it bobs) or `scattered` (at least 25 m apart, favouring the camera's side). A bridge on `focal` spans the water channel at its lowest point. A landmark that finds no spot is skipped. An unknown `kind` is an error, and landmarks need a landform. Per-kind defaults: `placement` shore for lighthouse, dock and boat, scattered for ruin-pillar, else focal; `scale` 1.75 for lighthouse and rock-arch, else 1.

Kinds: crate, barrel, fence, lamp-post, hut, lighthouse, boat, bench, sign, well, market-stall, tent, bridge, ruin-pillar, rock-arch, dock.

Omitted `landmarks` gives these defaults (`defaultLandmarks`); `null` or `[]` gives none:

| Shape (water role) | Default landmarks |
|---|---|
| island with water | lighthouse, dock, boat (all shore) |
| island, no water | hut, well (focal) |
| archipelago | lighthouse, 2 boats (shore) |
| coast | lighthouse (shore) |
| valley, river | bridge, hut (focal) |
| canyon | rock-arch (focal), 3 ruin-pillars (scattered) |
| volcano | 2 ruin-pillars (summit) |
| basin, lake | dock (shore), hut (focal), boat (shore) |
| hills, flat | hut, well, fence (focal) |

Full `applyWorld` places those defaults when `landmarks` is omitted. Plain dressing, including `applyEnvironmentPreset` on the four environment-preset ids, places none. To get that look from `applyWorld`, pass `landmarks: []` (and `style: null` when you also want no art style). Replace the defaults by restating the array, for example `landmarks: [{ kind: "hut", scale: 1.5 }, { kind: "market-stall", count: 3, placement: "scattered" }]`. **Set-dressing tip:** give every world a focal landmark; a scene with no hero prop reads as empty terrain.

## Extends

`{ extends: "<id>", ...changes }` deep-merges over a built-in (or registered) recipe; arrays (`vegetation`, `structures`, `biomes`, `tags`) replace. A child change drops the parent's values that were derived for the old choice:

- `sky.timeOfDay` differs: the parent's whole `sky` (sun, physical sky, fog, fill) and `look.exposure` are dropped, keeping only its sun azimuth and haze, so a dusk child gets a dusk sun, sky, fog and exposure.
- `sky.haze` or `sky.clouds`: the parent's `sky.physical` and `sky.fog`. `sky.sunAzimuth`: the parent's `sun.azimuth`.
- `landform.shape` differs: the landform resets to the new shape, and the parent's `vegetation` and `camera` are dropped. `landform.size` or `relief`: the parent's `camera` (and, for size, its raw segment counts). `water.role` differs: the water resets to `{ role }`.
- Objects deep-merge at any depth, so `{ landform: { shapeOptions: { terraces: 2 } } }` keeps the parent's other shape options; arrays replace whole. A built-in's own values beat the shape defaults table: `desert-canyon` has `terraces` 5, `wallSteepness` 0.8 and `riverWidth` 14, where the canyon defaults are 4, 0.75 and 18. Run `dryRun` to see what you inherit.
- The child's id, label and tags name the result; `world: "<id>"` as a string keeps the built-in's. Chains are at most 8 deep.

## Replace modes (`replace`)

| Mode | Removes first (root nodes only) |
|---|---|
| `world` (default) | sky, environment, directional/ambient/hemisphere lights, fog, any `MeshNode` named exactly `Ground`, terrains and water, and orbit cameras when the recipe has a camera |
| `environment` | the sky, environment, light, fog and `Ground` set only (keeps terrain, water and camera) |
| `none` | nothing (the new nodes are added alongside) |

Everything else stays, **at its old position**: `applyWorld` never moves existing nodes onto the new ground, and it does not remove floors or oceans under other names (`Mesh_Floor`, a mesh ocean). A gameplay floor named `Ground` is removed. Scenes with gameplay: [existing-scene.md](existing-scene.md). Post-processing is replaced by ACES at the resolved exposure (plus bloom when set).

## Validation messages

An invalid recipe returns `path: message Fix: ...` lines from the dry run; apply the `Fix:` text. Warnings (budgets, a hidden lake, a night lit only by moonlight) do not block the apply.

## `auditWorld` codes

Read-only; `ok` is false when any error exists. Run it after `applyWorld` and after any hand edit to terrain, water or scatter.

| Severity | Code | Meaning |
|---|---|---|
| error | `water-level-mismatch` | water Y differs from the terrain sea level by over 0.25 m |
| error | `sea-without-water` | `hasSea` with no water over an island or archipelago (a warning for other shapes) |
| error | `scatter-without-terrain`, `grass-without-terrain` | no terrain parent or target |
| error | `multiple-suns` | more than one light with `drivesSky` |
| warning | `water-on-dry-terrain`, `water-under-terrain` | `hasSea` off under water; water parented to the terrain |
| warning | `sea-shape-not-ocean` | an island, archipelago, volcano or coast shape sits in a lake, river or liquid preset (a lava sea for `lava`) |
| warning | `ocean-too-small`, `terrain-segments`, `no-fog` | ocean under 2x the terrain; over 512 segments; terrain over 500 m with no fog |
| warning | `scatter-budget`, `scatter-total-budget` | over 6000 / 15000 instances |
| warning | `sky-without-sun`, `no-sky`, `dim-environment`, `time-of-day-dims-environment` | missing sun or sky; HDR environment intensity under 0.5 |
| info | `no-camera` | no orbit or active camera |

## Worked examples

**(a) Shortest.** One island under an afternoon sun: 640 m island, ocean 3x the terrain would be needed only above 2000 m, so the preset's infinite ocean, `realistic-tropical` style, about 31 palms, 123 shrubs and 18 rocks, overview camera.

```json
{ "landform": { "shape": "island" }, "water": { "role": "ocean" } }
```

**(b) Extend a built-in.** Anime dusk islands: `sky.timeOfDay` changes, so the dusk sun, sky, fog and exposure re-derive; the anime style swaps the water to `toon-ocean`.

```json
{ "extends": "tropical-ocean", "seed": 12, "sky": { "timeOfDay": "dusk" }, "style": "stylized-anime" }
```

**(c) Custom alpine lake.** The explicit `water.preset` keeps `glacial-lake` over the alpine style's `alpine-lake`. The golden-hour sky names only a time of day, so the alpine style still tints its sun and fill; spell out `sky.sun.color` or `sky.fill` to keep exact colours.

```json
{ "seed": 21, "label": "Alpine lake",
  "landform": { "shape": "basin", "size": 1200, "relief": 160, "erosion": 0.7, "shapeOptions": { "basinRadius": 0.5, "basinDepth": 25 } },
  "water": { "role": "lake", "preset": "glacial-lake" },
  "style": "alpine-snow",
  "vegetation": [ { "role": "trees", "species": ["snowPine"], "density": "normal", "height": { "min": 3, "max": 70 } }, { "role": "rocks", "density": "dense" } ],
  "sky": { "timeOfDay": "golden-hour", "haze": 0.2 }, "camera": { "view": "hero" } }
```

**(d) Violet dawn with mist and landmarks.** `tint` gives the violet sky, `mist` the low fog on the lake, and the listed landmarks replace the default dock, hut and boat.

```json
{ "extends": "lake-basin", "seed": 5, "style": "alien",
  "sky": { "timeOfDay": "dawn", "tint": "#7a4fd0", "mist": 0.6 },
  "landmarks": [ { "kind": "lighthouse", "placement": "shore" }, { "kind": "boat", "placement": "shore" } ] }
```

## When to hand-build instead

Fall back to [compose-checklist.md](compose-checklist.md) when the world needs more than one terrain, a river on a shape other than valley or canyon, authored heights or a heightmap, structures other than `neon-street`, water that is not at one height, or nodes the game already owns (see [existing-scene.md](existing-scene.md)). Hand-built worlds are the ones that break sea level, water height and `avoidWater` apart: run `auditWorld` and fix every error before capturing. Check first with a dry run: if the only blocker is one field, use `landform.terrain`, `water.overrides` or `vegetation[].overrides` instead of leaving the recipe.
