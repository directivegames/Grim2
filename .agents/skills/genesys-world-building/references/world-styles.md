# World styles

A world style is one art direction applied to a whole outdoor scene in one undo step. It writes:

- terrain layers and shading
- the GrassNode
- tree and plant species and look
- water presets by role
- the look preset and fog tint

Everything it writes is an ordinary property, so tune any part afterwards with `action_node(setProperties)`.

## Built-in styles

| `worldStyleId` | Use for | Terrain | Grass | Trees | Water | Look |
| --- | --- | --- | --- | --- | --- | --- |
| `realistic-temperate` | Photoreal forests, meadows, mountains | temperate | realistic | broadleaf, pine, birch (realistic) | calm-lake, river | natural |
| `realistic-tropical` | Photoreal beaches and islands | tropical | meadow | palm, fern | tropical-ocean | natural |
| `stylized-anime` | Anime, Ghibli, cel-shaded, cartoon | painterly + toon | anime + flowers | round canopies (stylized) | toon-ocean, toon-lake | stylised-bright |
| `low-poly` | Low-poly, casual, minimal | flat facets | lowpoly | faceted | toon-ocean | stylised-bright |
| `volcanic` | Volcano, hell, lava | basalt, ash, glowing lava | ash | dead trees | lava | cinematic-warm |
| `alpine-snow` | Winter, snowy mountains | snow on tops, scree | snowy | snow pines | alpine-lake | cool-crisp |
| `arctic` | Polar coast, glaciers, deep winter | snow, pack ice, gravel, rock | snowy | snow pines | arctic-ocean | cool-crisp |
| `desert` | Desert, canyon, western | sand, sandstone | dry | cactus, dead trees | pond | cinematic-warm |
| `alien` | Alien planet, sci-fi, fantasy glow | violet moss, glowing crystals | alien | mushrooms, crystals | toxic | neon-night |
| `autumn-forest` | Autumn, fall | leaf litter | dry gold | autumn broadleaf | calm-lake | cinematic-warm |

Pick the style from the game's art direction, not from the terrain. Photoreal only when the game is photoreal. Anime, toon, cartoon or cel-shaded games use `stylized-anime`. Mobile casual games are usually `low-poly` or `stylized-anime`.

## Calls

```json
{ "tool": "action_scene", "action": "applyEnvironmentPreset", "presetId": "tropical-ocean", "worldStyleId": "stylized-anime", "seed": 3 }
```

```json
{ "tool": "action_scene", "action": "applyWorldStyle", "worldStyleId": "volcanic" }
```

`applyWorldStyle` is for hand-built scenes. After `applyWorld`, change `style` in the recipe and re-apply instead (see Rules in SKILL.md).

Only some parts (keep the current water and look):

```json
{ "tool": "action_scene", "action": "applyWorldStyle", "worldStyleId": "alpine-snow", "parts": ["terrain", "grass", "foliage"] }
```

Small changes on top of a style:

```json
{ "tool": "action_scene", "action": "applyWorldStyle", "worldStyleId": "realistic-temperate", "styleOverrides": { "grass": { "enabled": true, "style": "meadow" }, "foliage": { "style": "autumn", "speciesSet": "temperate" } } }
```

`action_scene(listWorldStyles)` lists every registered style.

## Custom styles (inline)

A custom style is a whole object that usually `extends` a built-in:

```json
{
  "tool": "action_scene", "action": "applyWorldStyle",
  "worldStyle": {
    "id": "candy-land", "label": "Candy land", "description": "Pastel toon world", "extends": "stylized-anime",
    "terrain": { "layers": [
      { "id": "base", "kind": "sand", "color": "#f7d6e0", "variant": "painterly" },
      { "id": "grass", "kind": "grass", "color": "#9be3c4", "variant": "painterly", "rule": { "heightMin": 1, "slopeMax": 32, "noiseAmount": 0.3 } },
      { "id": "rock", "kind": "cliff", "color": "#c9b6e4", "variant": "painterly", "triplanar": true, "rule": { "slopeMin": 36 } }
    ], "shading": "toon" },
    "grass": { "enabled": true, "style": "anime", "overrides": { "tipColor": "#c8f7e1", "flowerColors": ["#ff9ec7", "#fff3a3", "#a3d8ff"] } },
    "foliage": { "style": "stylized", "speciesSet": "fantasy", "palette": { "leaf": "#ff9ec7", "leafAlt": "#ffc6dd", "trunk": "#a07a6a" } },
    "water": { "all": "toon-pond" }
  }
}
```

Field reference:

- **`terrain.layers`** is a preset id or a layer array. Presets: `temperate`, `tropical`, `anime`, `toon`, `lowpoly`, `volcanic`, `alpine`, `arctic`, `desert`, `alien`, `autumn`. The layer fields are in [nodes.md](nodes.md).
- **`terrain.shading`** is `standard`, `toon` or `flat`.
- **`terrain.lowPolyCellSize`** is in metres.
- **`terrain.macroVariation`** (0–1) is large-scale brightness variation that hides tiling; **`terrain.detailFadeDistance`** (≥ 10 m) is where texture detail has faded to flat colour (the quality tier scales it).
- **`grass.style`** is one of: realistic, meadow, anime, lowpoly, dry, snowy, ash, alien. Set `enabled: false` to remove grass.
- **`foliage.style`** is one of: realistic, stylized, lowpoly, autumn, snowy, scorched, arid, alien.
- **`foliage.speciesSet`** swaps species per scatter role. Sets: temperate, boreal, alpine, tropical, arid, volcanic, alien, fantasy.
- **`water`** sets a water preset per role: `ocean`, `lake`, `river`, `pond`, or `all`. Any of the 39 water presets works (art style first: plain ids for photoreal, `toon-*` for stylized; list in [nodes.md](nodes.md)). Roles only decide which node a preset is applied to; new presets map like `crystal-shallows`/`deep-ocean`/`arctic-ocean`/`toon-stormy-ocean` to `ocean`, `glacial-lake` to `lake`, `muddy-river` to `river`, and `swamp`/`hot-spring`/`tar`/`molten-gold`/`arcane` to `pond`.
- **`look`** is a look preset id.
- **`atmosphere`** (all optional):
  - `fogColor` tints the fog.
  - `sky` is `{ turbidity (0–20), rayleigh (0–4), mieCoefficient (0–0.1), mieDirectionalG (0–1), cloudCoverage (0–1) }`, written to the `SkyNode`: hazy orange volcanic, crisp alpine blue, deep alien violet.
  - `sunColor` is the colour of the sky-driving sun.
  - `environmentIntensity` (0–10) is the sky's environment-map intensity (ambient light and reflections). The presets use 1; lower it only for dark, smoky worlds.
  - `fillSky` and `fillGround` are the hemisphere fill colours.
- **`parts`** (call argument, not a style field) limits `applyWorldStyle` to some of `terrain`, `foliage`, `grass`, `water`, `look`, `atmosphere`.

Schema: `WorldStyleSchema` in `.engine/src/game/WorldStyles.ts`.

Unknown ids are rejected with the list of valid ones.

In game code, `ENGINE.registerWorldStyle(style)` registers a style for reuse.

## Authored terrain textures (optional)

Realistic layers already use CC0 photo scans on the medium and high tiers (`photoSet` and `photoTint` on a layer; the low tier and the stylised variants stay procedural, see [nodes.md](nodes.md)). For a specific material (for example a signature cobblestone or a hand-painted grass), there are two steps:

1. Generate a seamless, tileable texture once. With the Scenario tools, use a tileable texture model at 1024². Keep it under 350 KB as WebP.
2. Save it to `@project/textures/...` and set it on the layer: `{ "id": "grass", "kind": "grass", "color": "#6a9a3a", "albedoTexture": "@project/textures/grass.webp" }`.

The layer keeps its rule and blending. Phones allow 1 authored layer, medium 2, high 4. Any more fall back to the baked texture.

## Checking the result

Capture `ground` and `hero` (Done means in SKILL.md). The style is right when the ground shows texture near the camera, no pattern repeats at mid distance, the grass edge melts into the ground and the trees match the art direction. Common fixes: the styles table in [recipes.md](recipes.md#styles-on-top-of-a-recipe).
