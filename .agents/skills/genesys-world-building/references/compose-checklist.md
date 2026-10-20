# Compose an outdoor world from scratch

Try a recipe first: `action_scene applyWorld` with a built-in id or a short recipe builds the same nodes with sea level, water height and `avoidWater` already consistent ([world-recipe.md](world-recipe.md)). Use this checklist when you hand-wire nodes instead, for example when the world needs more than one terrain, authored heights or water that is not at one height. The properties are in [nodes.md](nodes.md).

## Checklist

1. **Terrain root.** Add a `TerrainMeshNode` as a root node at the origin. Choose the shape (`island`, `archipelago`, `valley`, `canyon`, `volcano`, `basin`, `coast` or `none`), then set `seaLevel` and `hasSea` by the water role:
   - ocean, lake or river: `hasSea: true`, and `seaLevel` at the waterline height (default 0);
   - no water: `hasSea: false` (no beach sand, underwater tint or waterline band);
   - `island`, `archipelago`, `volcano` and `coast` need an ocean, because their edges sink below `seaLevel`;
   - `basin` needs a lake: its bowl sits below `seaLevel`, so it always holds one;
   - `valley` and `canyon` take a river (`riverWidth` above 0), or no water at all (`riverWidth: 0`, `hasSea: false`).
   - Keep segments ≤ 512 per side (about 2 m per segment). Use `erosion` 0.5–1 only for mountains: it costs 0.1–0.5 s per regenerate.
2. **Water as a root.** Add a `WaterNode` as a root node, not a terrain child, at the Y given under Placement in [nodes.md](nodes.md). Pick the preset by role (see the table in nodes.md):
   - ocean: a sea preset, which uses `shape: "infinite"` so `size` is ignored; if you override to `square`, make `size` at least 3 times the terrain;
   - lake or river: a lake or river preset with `size` matching the terrain (the valley preset uses 900 x 1400 for a 900 x 1400 terrain).
3. **Scatter and grass as children of the terrain.** Add `ScatterNode` and `GrassNode` as children of the `TerrainMeshNode`.
   - Heights are in metres relative to sea level (`heightMin`, `heightMax`). Set `avoidWater` only when there is water.
   - Stay inside budget: keep a world within 6000 instances per layer and 15000 in total (`auditWorld` warns above that); the presets use 90–2600 per layer (140 palms, 220 bushes, 2600 pines). `GrassNode` is capped per tier at 40k, 110k and 320k blades (`nodes/visual/grass/grassTiers.ts`); one per terrain.
4. **Sky and sun.** Add a `SkyNode` with `generateEnvironmentMap: true`, `environmentMapHdr: true`, `environmentMapIntensity: 1` and `skyBrightness` 0.3–0.45. Add exactly one `DirectionalLightNode` with `drivesSky: true` and `castShadow: true` (intensity 2–3.5 by day).
5. **Fill and fog.** Add a `HemisphereLightNode` with `intensity` 0.3–0.6, then a `FogNode` scaled to the terrain: exponential `fogDensity` about 0.0003–0.0012 for terrains of 600–1400 m (0.00035 for 640 m islands, 0.0011 for a 900 x 1400 valley). Match `fogColor` to the horizon.
6. **Camera.** Add an `OrbitCameraNode` (or keep the game's camera) framing the hero from 0.3–0.6 of the terrain size.
7. **Look and exposure.** ACES tone mapping at exposure 0.4–0.6 by day, 0.8–1.0 at night ([look-and-exposure.md](look-and-exposure.md)). Then optionally a world style for the ground, grass and trees ([world-styles.md](world-styles.md)).
8. **Audit.** Run `action_scene(auditWorld)` and fix every error before capturing.
9. **Capture and check.** As in Done means in SKILL.md.

## Common mistakes

| Mistake | Fix |
|---------|-----|
| Water parented under the terrain | Make it a root node |
| Water left at Y 0 after the terrain was moved | Move the water with it (Placement in nodes.md) |
| `island`, `archipelago`, `volcano` or `coast` shape with no ocean | Add the ocean, or use `shape: "none"` with `hasSea: false` |
| `basin` shape with no lake | Add the lake at `seaLevel`, or the bowl shows as a dry pit |
| `hasSea: true` on an inland map | Beach sand and a waterline band appear around nothing: set `hasSea: false` |
| `relativeHeight: true` layer rules on low hills | The peak is clamped to at least 60 m, so "top 18%" of a 20 m hill gets nothing: use absolute metres |
| `TimeOfDayNode` added to a preset scene | It darkens the scene: see the `TimeOfDayNode` warning in [nodes.md](nodes.md) |
| `environmentMapIntensity` 0.3–0.6 with HDR | Leave it at 1 and lower `skyBrightness` or exposure |
| Two suns (two lights with `drivesSky`) | Keep one; make any moon `drivesSky: false` |
| `ScatterNode` or `GrassNode` not under the terrain | Parent them to the `TerrainMeshNode`, or set `target` |
| Grass as a scatter of tufts | Use one `GrassNode` per terrain |
