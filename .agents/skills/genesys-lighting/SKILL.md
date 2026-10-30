---
name: genesys-lighting
description: "Lights, shadows and cascades, sky and environment, fog, exposure, tone mapping, bloom, colour grading, emissive glow on standard materials, lightmaps and light probes, mood. Use for too dark, too bright, washed out, glow, neon, night, dusk, horror mood, indoor or dungeon lighting, sun, shadows missing. Not for custom shaders or node materials (use `webgpu-tsl-node-material-assets`), particle effects (use `genesys-vfx`), frame cost (use `genesys-profiler`), or a whole outdoor world with terrain, water and sky (use `genesys-world-building`)."
metadata:
  tokens: 3534
---

# Lighting

This skill covers light nodes, shadows, sky and environment, fog, emissive glow, baked light, and the post-process stack (tone mapping, bloom, grade). The rule: lights, sky and fog are editor state, so change them with MCP; the post-process stack has exactly one owner of exposure and grade.

## Use another skill when
- MCP gate, `run_script`, approvals; material or colour edits that do not persist → `genesys-mcp-orchestrator`
- Building the play space the light falls on → `genesys-level-authoring`
- An outdoor world (terrain, water, sky, sun, fog and exposure set together by a recipe or environment preset), look presets → `genesys-world-building`
- A skybox image or HDRI beyond the engine's four → `genesys-assets` (it picks the route)
- Custom shaders and the shipped node-material classes (Fresnel rim, neon pulse, dissolve) → `webgpu-tsl-node-material-assets`
- Muzzle flashes, explosions, glows that are particles → `genesys-vfx`
- A hit flash or low-health tint as a game-feel moment → `genesys-game-feel` (this skill supplies the post-process call)
- Shadow or post-process cost, phone frame budget, lights on spawned things → `genesys-profiler`
- Seeing the game's real frame (Play capture), proving the look → `genesys-verification`

## Decide

The look comes from the `GAME.md` style brief (Art direction + Palette), the one `genesys-ui` themes from: fog, grade tints, practical lights and sky tint are palette hexes, not new colours. When the user did not say, apply the mood's starting values (readability first, not engine defaults; full table in [moods.md](references/moods.md)):

- **Bright arcade** (platformer, party, puzzle, kart): directional 2–3, high sun, shadows; hemisphere fill 0.6–1.0; `SkyNode` low `turbidity`; ACESFilmic, exposure 0.4–0.6 with a `SkyNode` (1.0 without one); bloom off or 0.3–0.5; saturation 1.1–1.2; no fog.
- **Outdoor day** (open world, racing, survival): start from a `genesys-world-building` recipe or environment preset, which sets sun, sky, fill and exposure together. By hand: sun about 2–3.5 with `drivesSky: true`, standard shadows sized to the area around the player, which the player pawn carries (CSM stays off); `SkyNode` `skyBrightness` 0.3–0.45 with `generateEnvironmentMap` and `environmentMapHdr` on, or an HDRI; ACESFilmic exposure 0.4–0.6; far haze matched to the sky.
- **Dark / horror / dusk / night**: keep the sun's intensity (about 4–6) and lower it toward the horizon; hemisphere 2.5–3.5 (above the origin) **plus** ambient 1.0–1.5 in muted violet or grey; tune the existing `SkyNode` (high `turbidity`, `cloudCoverage` 0.8, no sun disc); bloom only on emissives; saturation 0.85–0.9; exponential fog **thin** (0.01–0.015), a mid colour, never near-black.
- **Space / sci-fi**: one hard "star" key 2–3, ambient ≤ 0.1 plus a coloured rim; star skybox, no `SkyNode`; bloom 0.6–1.0 on emissive trims; teal/orange grade.
- **Indoor / dungeon**: point and spot lights at the sources, shadows on 1–3 of them; ambient 0.2–0.3 plus a `LightProbeGridNode`; bake a lightmap once geometry is final; temperature +0.1.

Rules that apply to every mood:
- **Tune what exists; never delete the scene's sky or sun.** A removed sky takes the sky light and the creator's tuning with it.
- **One change, one capture.** Change one node's values, capture, and compare before the next change; several blind edits at once make a scene unreadable. An edit-mode `captureScreenshot` shows the editor viewport (saved lights, sky, fog; no grade set from code). Judge the grade and the player's view from a capture during Play (`target: "auto"` or `"play"`, `genesys-verification`).
- **Readability floor.** In a capture, the floor, the walls and an enemy-sized silhouette read at 15 m; if not, add fill (hemisphere, ambient, practicals) before any mood change. The player, enemies and pickups read at the darkest point. "Dark" games get mood from colour (sky, fog, grade, warm practicals against cool fill), not from removing light.
- **Moving the sun changes the sky.** With `drivesSky: true` the light's rotation sets the sun; once the sky is tuned, brighten through fill instead.
- One directional light is the sun; only one can drive CSM.
- Set the grade once per game. Moments (hurt flash, slow motion) change it briefly and restore it.

## Build

**Colours through MCP.** Colour properties (light `color`, hemisphere `groundColor`, `FogNode.fogColor`) take `{ r, g, b }` in linear 0–1 or a hex string (`'#4a3438'`), and save correctly. Re-query after setting one.

**Scene lights, sky, fog — MCP.** Add with `action_node(action="add", className="ENGINE.DirectionalLightNode")` (also `HemisphereLightNode`, `AmbientLightNode`, `PointLightNode`, `SpotLightNode`, `RectAreaLightNode`, `SkyNode`, `SceneEnvironmentNode`, `FogNode`, `LightProbeGridNode`, all with the `ENGINE.` prefix). Change with `action_node(action="setProperties", …)`, `action_scene(action="save")`, re-query; exact paths from `getEditableProperties`. Never patch a placed light from `beginPlay`. Aim a directional light by rotating its node.

**Shadows.** `castShadow` on the light. `DirectionalLightNode` defaults to one orthographic box (`shadowCamera*` ±50). A possessed `GameplayPawn` or `DefaultCharacterPawn` moves the light, and so the box, with the player in play, so size the box to the area around the player (not the whole world) and let far terrain go unshadowed under fog; this holds for open worlds too. With a free or cinematic camera nothing moves the light: use one cascade (`useCsmShadows: true`, `csmCascadeCount: 1`). Cascaded shadows (`useCsmShadows`) stay off unless the rule in [lights-and-shadows.md](references/lights-and-shadows.md#cascaded-shadows-default-off) applies (near and far shadows both needed, desktop or high tier, profiler headroom); then 2–3 cascades, `csmMaxFar` 150–300. Table, choosing, traps: [lights-and-shadows.md](references/lights-and-shadows.md).

### Post-process: who owns the base look

The scene stores `World.postProcessConfiguration`, but Play builds a fresh world from the scene data ([post-processing.md](references/post-processing.md#where-the-configuration-lives)). So:

- **The GameMode owns the base look in Play.** Call `world.updatePostProcessConfiguration` once in its `beginPlay`, with the numbers in `src/const.ts`. It merges by effect `id ?? type` over the scene's values.
- That call changes the Play world only: it is not saved, and the editor viewport and edit-mode captures never show it.
- MCP `action_scene(updatePostProcessing)` or `applyLookPreset` writes the scene's own post-processing in one undo step (`genesys-world-building`). Never hand-edit the scene file for it.

Each effect literal is checked against the config its `type` names, so it needs no cast, and a misspelt field fails the build (TS2353).

Source: `.engine/src/game/World.ts` (`updatePostProcessConfiguration`), `.engine/src/render/postprocessing/PostProcessConfig.ts` (`ToneMappingEffectConfig`, `BloomEffectConfig`, `ColorGradingEffectConfig`) — typechecked against 18.1.0-alpha.317
```ts
import * as THREE from 'three';
import * as ENGINE from '@gnsx/genesys.js';

// GameMode.beginPlay: the base look, once per Play session. Numbers live in src/const.ts.
world.updatePostProcessConfiguration({
  effects: [
    { type: ENGINE.PostProcessPass.ToneMapping, enabled: true, mode: THREE.ACESFilmicToneMapping, exposure: 1.0 },
    { type: ENGINE.PostProcessPass.Bloom, enabled: true, strength: 0.6, threshold: 0.9, radius: 0.5 },
    { type: ENGINE.PostProcessPass.ColorGrading, enabled: true, contrast: 1.1, saturation: 1.1 },
  ],
});
```

Grade tints are hex numbers (`0x2f8f9d`), never colour words: [post-processing.md](references/post-processing.md) → *Grade recipes*. A short moment (hurt flash) changes one effect with `world.postProcessManager.configureEffect` and restores it; that is session-only (snippet in the same file). Never build a separate fullscreen pass for bloom, exposure or grade, and leave `IGenesysRenderer.toneMapping` / `toneMappingExposure` alone: the `ToneMapping` pass owns exposure.

### Emissive glow (standard materials)

Glow is an emissive colour above the bloom threshold, never a light: `emissiveIntensity` 2–4 with bloom `threshold` 0.9–1.0 and `strength` 0.4–1.0 (WebGPU: `selectiveEmissive: true`). Routes ([emissive.md](references/emissive.md)):
- A modelled prop (the default): a `GLOW` part exported with `M_Glow` (`genesys-code-modeling`), or `emit=` in a Blender `gkit` material.
- A mesh built in code: one shared `THREE.MeshStandardMaterial` with `emissive`, created once as a module constant.
- A placed primitive or `MeshNode`: a material asset made with `action_asset(createMaterial)`; its emissive fields are set in the editor's material inspector, and an inline material set through MCP does not persist.

A room of lamps is emissive materials plus 1–3 real point lights on the key sources, never a light per lamp, pickup or projectile.

### Baked light for interiors

- **Lightmap.** Bake once the static geometry and lights are final: `action_build(action="buildLightmap", scenePath="assets/<scene>.genesys-scene")` (desktop app, scene open). It writes `<scene>.build-data.zip`, applied when the scene loads. Moving static geometry or lights makes it stale; rebake.
- **Probe grid.** `LightProbeGridNode` gives moving things the room's indirect light. Size `boundsX/Y/Z` to the rooms, keep counts low (5 × 3 × 5). Bakes are not saved: Play needs one `bakeLightProbes()` after the level loads ([lights-and-shadows.md](references/lights-and-shadows.md)).

Sky, environment, HDRI colour spaces, fog modes: [sky-and-environment.md](references/sky-and-environment.md).

## Limitations

- Grade does nothing in the WebGL path → `ColorGrading` is implemented for WebGPU only.

## Traps

- `pnpm build` fails with TS2353 `'…' does not exist in type 'BloomEffectConfig | BaseEffectConfig'` → a misspelt field, or a field of another effect → fix the name against that effect's config in `PostProcessConfig.ts`.
- The grade or exposure looks right in Play but the editor capture shows the old look → expected: the GameMode call changes the Play world only. Judge the look from an in-Play capture (`genesys-verification`).
- A grade set with `configureEffect` disappears after a level change → it was session-only → put the base look in `world.updatePostProcessConfiguration`.
- The whole level is black after a mood pass → several knobs moved at once (sun cut, dense dark fog, sky deleted, no fill) → restore the sun, thin the fog to 0.01–0.015 with a mid colour, add hemisphere plus ambient, then one change per capture.
- The sky goes dark after a lighting edit → the sun was rotated while `drivesSky` is true → restore the rotation; use fill.
- Threats vanish in the dark end → grade or exposure is crushing shadows → raise `lift` or fill light; do not recolour every material by hand to fake a grade.
- Do not enable `useCsmShadows` for large terrain or open worlds by default. Each cascade is another shadow pass and another sampler in the terrain and water shaders; a standard box around the player follows the pawn ([rule](references/lights-and-shadows.md#cascaded-shadows-default-off)).
- Shadow (CSM range, acne, shimmer, `shadowFar` warning), lightmap and probe-grid traps: [lights-and-shadows.md](references/lights-and-shadows.md#traps).
- Whole frame glows, or a lamp does not: [emissive.md](references/emissive.md#traps). Sky, environment map and fog: [sky-and-environment.md](references/sky-and-environment.md#traps).

## Done

- A capture after the last change shows the floor, the walls, an enemy-sized silhouette (at 15 m), the player and threats readable in the brightest and the darkest part of the play space. Lights, sky, fog: an editor capture is enough. Grade, exposure, bloom: an in-Play capture (`genesys-verification`).
- `query_node` shows one sun `DirectionalLightNode` with the intended intensity, rotation, `castShadow`, and `useCsmShadows` false unless the CSM rule applies; fill light and sky or environment exist; the scene is saved.
- In Play, the play area around the player gets shadows, not only the ground under the camera; far terrain may stay unshadowed under fog.
- `world.postProcessManager.getEffectConfig(...)`, read in the Play world, reports the requested exposure, bloom and grade. A darker frame is not done until the exposure value matches.
- Emissive props glow in the in-Play capture; lit walls do not.
- An indoor level with a lightmap logs `[lightmapper] Applied lightmaps … N object(s)` on load and no `Skipped` lines.

## References
- [moods.md](references/moods.md) — full starting values per mood
- [lights-and-shadows.md](references/lights-and-shadows.md) — every light class, shadow and CSM property with defaults, lightmaps, `LightProbeGridNode`, shadow traps
- [post-processing.md](references/post-processing.md) — all passes, fields, engine defaults, persistence, moment snippet, grade recipes as hex values, troubleshooting
- [emissive.md](references/emissive.md) — glow routes per source, shared emissive material snippet
- [sky-and-environment.md](references/sky-and-environment.md) — `SkyNode`, `SceneEnvironmentNode`, `FogNode`, HDRI colour space, engine skybox files
