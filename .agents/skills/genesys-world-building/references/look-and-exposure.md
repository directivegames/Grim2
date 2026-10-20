# Look and exposure

## Tone mapping

- Outdoor and most stylised scenes: ACES Filmic (`mode: 4`). AgX (`6`) keeps saturated colours from clipping to white; Neutral (`7`) for product-like looks. Avoid Linear for lit 3D scenes; it clips highlights.
- Exposure with a `SkyNode` sky and a sun at intensity ~3: 0.4–0.6. Night scenes with emissive neon: 0.8–1.0. Change exposure before changing every light.
- Set it with `action_scene(updatePostProcessing, effects: [{ "type": "toneMapping", "mode": 4, "exposure": 0.5 }])`. Presets already do this.

## Sky lighting and fill

The sky capture is physically lit, and the dome and the capture share `skyBrightness`, so the sky lights the scene as bright as it looks (`game/EnvironmentPresets.ts`, `addSky`). The presets all use `generateEnvironmentMap: true`, `environmentMapHdr: true` and `environmentMapIntensity: 1` (0.9 for the overcast plain), with `skyBrightness` 0.3–0.45.

| Preset | Exposure | `skyBrightness` | Sun | Hemisphere fill |
|--------|----------|-----------------|-----|-----------------|
| `tropical-ocean` | 0.5 | 0.3 | 3.2 | 0.4 |
| `temperate-valley` | 0.4 | 0.45 | 3.4 | 0.3 |
| `overcast-plain` | 0.55 | 0.35 | 1.9 | 0.6 |
| `night-street` | 0.9 | n/a (no `SkyNode`) | 0.25 moon | 0.15 |

- Do not set `environmentMapIntensity` to 0.3–0.6 to "tame" HDR; that dims every material. Fix a bright sky with `skyBrightness` or exposure.
- Hemisphere fill is 0.3–0.6 by day. Raise it (not the sun) when slopes in shadow crush to black.
- Adding a `TimeOfDayNode` to a preset scene darkens it: see the warning under `TimeOfDayNode` in [nodes.md](nodes.md).

## Look presets

`action_scene({ action: "applyLookPreset", lookPresetId: "<id>" })` writes a complete post-processing look in one undo step: `natural` (clean ACES reset), `cinematic-warm`, `cool-crisp`, `stylised-bright`, `noir`, `retro`, `neon-night`. `exposure: "auto"` (default) keeps the scene's exposure when it already uses a filmic curve; `"preset"` uses the look's value, or pass a number. Apply it after the environment, then fine-tune with `updatePostProcessing`.

## Lens effect

`{ "type": "lens", "enabled": true, ... }` adds camera-lens imperfections after colour grading (`render/postprocessing/effects/LensEffect.ts`): `vignette` 0–1 (0.2–0.4 cinematic), `vignetteSmoothness` 0.5, `grain` 0–1 (0.05–0.2; mid-tones only), `grainAnimated` (false freezes it for deterministic captures), `chromaticAberration` 0–1 (0.1–0.4 subtle fringing), `distortion` 0–0.3 barrel (WebGPU only). All zero builds no pass. Off by default; look presets own it: `cinematic-warm` (vignette 0.35, grain 0.15), `noir` (strong vignette, grain), `retro` (fringing; the retro pass keeps its own vignette), `neon-night` (fringing, light vignette); `natural`, `cool-crisp` and `stylised-bright` turn it off. Apply a look first, then nudge with `updatePostProcessing`.

## Anti-aliasing

`{ "type": "antiAliasing", "mode": "fxaa" | "smaa" | "traa" }` (`render/postprocessing/effects/AntiAliasingEffect.ts`). `fxaa` (default, old scenes) is cheap and a little soft; `smaa` keeps edges and text sharper — a good default for new scenes with thin geometry, signs or UI in the world; `traa` is temporal: the smoothest on foliage, fences and wires, but it jitters the camera, softens fast motion and can ghost on water, VFX particles and wind-animated grass, and it averages animated film grain away. The classic WebGL renderer always uses SMAA. Screenshots taken through the post pipeline converge after a few frames with TRAA.

## Reading capture metrics

| Metric | Healthy outdoor day | If not |
|--------|---------------------|--------|
| `luminance.mean` | 0.35–0.6 | Low: raise exposure or fill light. High: lower exposure |
| `clippedWhitePct` | < 3% | Lower exposure or sun intensity; check bloom threshold |
| `clippedBlackPct` | < 10% | Raise hemisphere fill or environment map intensity |
| `colourfulness` | > 25 | Add a complementary accent (warm landmark against cool water) |
| `edgeDensity` | > 0.03 | Add detail: scatter, landmarks, terrain octaves |
| `skyFraction` | 0.2–0.5 for landscapes | Lower the camera pitch or move closer |

Night scenes legitimately have low mean luminance; judge them by whether the light sources and their reflections read.

## Colour

- Pick a palette of 3–5 colours in the brief and keep materials, fog and light inside it.
- Match fog colour to the sky at the horizon; mismatched fog reads as a grey wall.
- Warm key light (sun) against cool fill (hemisphere sky colour) gives depth for free.
- One saturated accent colour per scene draws the eye to the hero element.

## Composition

- Hero element on a third, horizon off-centre, foreground interest (rocks, trees) in ground views.
- Scale cues: a hut, boat or person-sized prop next to large landforms.
- Leave the camera's auto-rotate on for showcase scenes; it hides static-looking water and adds life.
