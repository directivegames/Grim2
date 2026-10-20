# Built-in recipes: target look, knobs, fixes

Field reference and precedence ("what you spell out wins"): [world-recipe.md](world-recipe.md). Default landmarks per shape: [world-recipe.md#landmarks](world-recipe.md#landmarks).

## Same steps for every recipe

```text
action_scene({ action: "applyWorld", world: { extends: "<id>", seed: 7, ...changes }, dryRun: true })
action_scene({ action: "applyWorld", world: { extends: "<id>", seed: 7, ...changes } })
action_scene({ action: "auditWorld" })
action_editor({ action: "captureScreenshot", focusNodeIds: ["<focusNodeId>"], views: ["overview", "hero", "ground"] })
```

Change at least two things so the result is not the stock recipe (seed, shape options, time of day, style, landmarks). The result lists `world.createdNodes` and `focusNodeId` (the terrain). Fine edits afterwards go on the nodes with `action_node(setProperties)`. Changing `relief` or `size` re-derives the camera; set `camera` to pin it. `vegetation`, `landmarks` and `structures` are arrays: restating one replaces it. Then follow Done means in SKILL.md.

## `tropical-ocean` — ocean and islands

Look: bright tropical day, teal water with sun glints to the horizon, four islands with pale beaches, green interiors, palms on the shore, camera slowly circling. Archipelago 640 m, relief 18, `realistic-tropical`, `tropical-ocean` water, fixed counts (140 palms, 220 bushes, 90 rocks). For a new scene, `action_scene(create, template: "tropical")` does the same.

- Islands: `shapeOptions.islandCount` (2–6), `islandRadius`, `relief` (10 flat atolls, 25 peaks; `noise: { type: "ridged" }` for craggy peaks).
- Water mood: `water.preset` `tropical-ocean`, `crystal-shallows` (seabed visible), `calm-ocean`, `open-ocean`, `deep-ocean`, `stormy-ocean` / `arctic-ocean` (pair with an overcast sky), `toon-tropical-ocean` for stylised games. Then at most `waterColor`, `shallowColor`, `clarity` (lagoon 10–15), `waveHeight` (0.6 calm, 3+ rough).
- A styled world compiles more shaders, so the sea can appear a second or two after the islands: capture once the water has loaded.
- Fixes: islands too small → lower Orbit Camera `distance` or raise `islandRadius`; washed out → `look.exposure` 0.4–0.5; empty beaches → restate `vegetation` with denser `shoreTrees`.

## `temperate-valley` — forest valley

Look: a valley between mountains, dense conifers on the slopes, rock on steep faces, a calm river, warm golden-hour sun with haze. Valley 900 × 1400, relief 120, ridged noise, `erosion: 1`, `realistic-temperate`, river with a planar mirror on the high tier, exposure 0.4.

- Floor and walls: `shapeOptions.valleyWidth` (0.45 gorge, 0.9 broad), `relief` (60–150), `noise.frequency` (0.003 broad, 0.006 busy), `noise.gain` (0.42; higher is craggier).
- River: `riverWidth`, `riverDepth`, `riverMeander` (0 straight); flow speed is the River node's `current`. Dry valley: `water: { role: "none" }`.
- Forest: restate `vegetation`, e.g. `{ role: "trees", species: ["pine"], density: "dense", height: { min: 1.5, max: 70 } }`; `clustering` makes clearings. Snowline: the style's terrain layer rules (or `alpine-snow`).
- Light: `sky.timeOfDay` (`morning`, `dusk`), `sky.mist` 0.4–0.7 for valley-floor mist.
- Fixes: `crushed_blacks` on shadowed slopes → raise Sky Fill `intensity` or exposure.

## `desert-canyon` — desert canyon

Look: a terraced sandstone gorge cut into a plateau, a thin river, scrub, cactus and boulders, hard light with warm haze. Canyon 900 × 1400, relief 90, `terraces` 5, `wallSteepness` 0.8, `riverWidth` 14, `desert` style, noon, `hero` camera.

- Walls: `shapeOptions.terraces` (0 smooth, 3–5 strata, up to 12) and `wallSteepness` (0 sloped, 1 sheer). Gorge: `valleyWidth` (0.3 narrow, 0.7 broad), `relief` 60–150. Dry canyon: `water: { role: "none" }`.
- The desert style's river preset is `river`; `muddy-river` reads near-black in gorge shade.
- Light: `golden-hour` or `dawn` rakes the walls and shows the terraces; `noon` flattens them.
- Fixes: walls look smooth → raise `terraces` and `wallSteepness`; washed out → lower `look.exposure`; empty floor → denser shrubs.

## `volcanic-island` — volcanic island

Look: a lone cone with a crater out of the sea, basalt and ash slopes, sparse palms and rock at the base, hazy golden-hour sky. Volcano 900 m, relief 140, `volcanic` style, **`open-ocean` water** (a sea, not lava), exposure 1.15, environment intensity 0.9, `overview` camera.

- Lava sea: `water: { preset: "lava" }` in the recipe, re-applied with `applyWorld`. Never `applyWorldStyle("volcanic")` afterwards.
- Cone: `relief` (80 shield, 180 tall), `shapeOptions.coneHeight`, `craterRadius` (0 = plain peak), `craterDepth`; island: `islandRadius` (0.5–0.85), `islandEdge`, `beachWidth`.
- Mood: `sky.timeOfDay` `golden-hour`, `dusk` or `night` (raise `sky.sun.intensity` to 0.6–1); `sky.haze` 0.3 clear to 0.8 smoky.
- Fixes: cone too flat → raise `relief` and `coneHeight`; crater not visible → raise `craterRadius`; murky → raise `look.exposure` or the sun.

## `lake-basin` — lake basin

Look: a mirror-calm lake in a bowl of forested hills, pebbly shore, pines and birches, clear morning light. Basin 800 m, relief 70, `alpine-lake` water (planar mirror on the high tier), `realistic-temperate`, `hero` camera.

- Lake: `shapeOptions.basinRadius` (0.3 pond, 0.7 wide), `basinDepth`; preset `mirror-lake` or `glacial-lake`.
- Hills: `relief` (40 gentle, 120 mountain walls), `erosion`. Mood: `golden-hour`, `dusk`, `sky.mist` 0.4–0.7.
- Fixes: "no ground is below the lake level" → `shape: "basin"` or raise `water.level`; lake too small → raise `basinRadius`; empty shore → lower the shrub `height.min`.

## `coastal-cliffs` and `arctic-coast` — coasts

Coastal cliffs: a grassy headland ending in sheer cliffs above a narrow beach, open ocean, soft cloudy afternoon. Coast 1000 m, relief 50, `cliffHeight` 30, `coastPosition` 0.15, `open-ocean`, `realistic-temperate`, clouds 0.6. Arctic coast: snow, pack ice, gravel and dark rock over a slate sea, snow pines, pale overcast. Coast 1000 m, relief 60, `cliffHeight` 14, `coastPosition` 0.2, `arctic-ocean`, `arctic` style, clouds 0.5.

- Shore: `shapeOptions.cliffHeight` (0 = beach coast or flat ice shelf), `beachWidth`, `coastDirection` (degrees the sea lies in, 0 = +Z, both recipes use 180), `coastPosition` (−0.8 to 0.8; higher gives more land).
- Weather: `sky.clouds` 0.6–0.9 (the dome, fog, sun and fill follow; do not lower the sun by hand), `sky.mist` for sea mist or sea smoke, `water.preset` `stormy-ocean`.
- `style: "arctic"` on any landform dresses it in snow and ice.
- Fixes: cliffs read as a slope → raise `cliffHeight`, lower `beachWidth`; sea out of frame → change `coastDirection` or `camera.yaw`; overexposed snow → lower `look.exposure` or raise `sky.clouds`.

## `night-street` — rainy night street

Look: dark blue night, wet reflective road, facades with lit windows, neon signs that bloom, fog swallowing the distance. No landform: a `neon-street` structure (road, buildings, neon, lamps, seven point lights as ordinary children of Street), a Moon light (`drivesSky` off), ACES exposure 0.9 and bloom; a Rain Film `WaterNode` mirrors the street on high-tier devices. `seed` changes the building layout.

- Mood: `look.preset` `neon-night` or `noir`, `look.bloom`; or edit the Neon boxes' `emissive` and their light `color`.
- Dry street: `structures: [{ kind: "neon-street", wet: false }]`.
- Keep new lights to a handful (point lights cost per pixel on mobile). Rain: a looping `VFXNode`.
- An outdoor landform at night is a different recipe: `sky.timeOfDay: "night"` with `sky.sun.intensity` 0.6–1.
- Expect `exposure_low`; fine if neon and windows read. `single_hue` → add a second neon hue; `low_detail` → facade variation.

## Styles on top of a recipe

| Prompt | `world` |
| --- | --- |
| Anime / Ghibli islands | `{ extends: "tropical-ocean", style: "stylized-anime" }` |
| Low-poly valley | `{ extends: "temperate-valley", style: "low-poly" }` |
| Volcano with a lava sea | `{ extends: "volcanic-island", water: { preset: "lava" } }` |
| Polar coast | `"arctic-coast"` |
| Snowy mountains | `{ extends: "temperate-valley", style: "alpine-snow" }` |
| Alien planet | `{ extends: "overcast-plain", style: "alien", sky: { tint: "#7a4fd0" } }` |
| Autumn forest | `{ extends: "temperate-valley", style: "autumn-forest" }` |

Make a styled world specific with terrain `materialLayers[i].color`, GrassNode `tipColor` / `baseColor`, scatter `items[i].palette`, and a `WindNode` (`strength` 0.6–1; `gustStrength` 1 for storms).

| Finding in a `ground` / `hero` capture | Fix |
| --- | --- |
| Ground repeats at mid distance | Raise `macroVariation` (0.4–0.5) or layer `tileSize` |
| Ground blurry up close | Raise `detailFadeDistance` |
| Grass on the beach / on cliffs / bald | GrassNode `heightMin` 1–1.5 / `maxSlope` 28 / `patchThreshold` 0.1 |
| Too many draw calls on phones | Scatter `variants: 2`, fewer items, GrassNode `density: 0.7` |
| Trees all the same | `variants: 3`, or mix two species |
