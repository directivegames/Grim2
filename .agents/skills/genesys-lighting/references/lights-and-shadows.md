# Lights and shadows

All light classes live in `.engine/src/nodes/lights/` and are exported on the `ENGINE` namespace. Every one extends `LightNode`, which wraps a Three.js light. Place and edit them with MCP (`action_node(action="add", …)` / `action_node(action="setProperties", …)`, then `action_scene(action="save")` and a re-query). Construct one in code only for a long-lived runtime object, created once (a headlamp on the player pawn). Never put a light on a spawned or short-lived node (muzzle flash, projectile, pickup, explosion): each one recompiles shaders on spawn and destroy (`genesys-profiler` → *Never pay per spawn*). Glow comes from emissive materials plus bloom (SKILL.md → *Emissive glow*).

## Light classes

| Class | Extra options (beyond `LightNodeOptions`) | Use for |
|---|---|---|
| `DirectionalLightNode` | `useCsmShadows`, `shadowCamera{Left,Right,Top,Bottom}`, `csmCascadeCount`, `csmLightMargin`, `csmMaxFar`, `csmMode`, `csmFade`, `drivesSky` | The sun or a star key light. One per scene drives CSM. |
| `HemisphereLightNode` | `groundColor`; inherited `color` is the sky colour | Outdoor fill, cheap and soft |
| `AmbientLightNode` | none | Flat fill; keep low |
| `PointLightNode` | `distance`, `decay` (default 2) | Torches, lamps, pickups, explosions |
| `SpotLightNode` | `distance`, `decay`, `angle`, `penumbra` | Flashlights, stage lights |
| `RectAreaLightNode` | `width`, `height` | Windows, screens, neon panels |
| `LightProbeGridNode` | `cubeMapSize` (default 16), `boundsX/Y/Z` (50 / 20 / 50), `countX/Y/Z` (5 / 3 / 5), `probeSize`, `visualizationMode` (`none`, `sh`, `cubemap`), `includeSceneEnvironmentInBake` (false) | Baked spherical-harmonic indirect light for interiors (see *Baked light* below) |

## `LightNodeOptions` (every light)

Source: `.engine/src/nodes/lights/LightNode.ts`

| Field | Default | Notes |
|---|---|---|
| `color` | Three.js default | |
| `intensity` | Three.js default | |
| `castShadow` | off | Set on the light; required for CSM |
| `shadowMapSize` | 2048 | "Higher resolution for better quality" |
| `shadowBias` | 0 | Auto-adjusted conservative negative bias |
| `shadowNormalBias` | 0 | Auto-adjusted conservative normal bias |
| `shadowNear` | 0.1 | For CSM, applies per cascade |
| `shadowFar` | 100 | For CSM, separate from `csmMaxFar` and should be larger than it |
| `shadowRadius` | 3 | PCF softness |

The renderer enables shadow maps with `THREE.PCFShadowMap` (`.engine/src/render/Renderer.ts`, `GenesysWebGPURenderer.ts`). The shadow-map type is `IGenesysRenderer.shadowMap` (`.engine/src/render/IGenesysRenderer.ts`). Change it only after reading `Renderer.ts`. Do not construct a shadow renderer in game code.

## Directional light direction

`LightNode.updateMatrixWorld` places the Three.js target along the node's direction at `shadowFar × 0.5`. Aim the light by rotating the node (or `lookAt` in code for a runtime light). Moving the node moves the centre of the non-CSM shadow box.

**The standard box follows the player in play.** A possessed `GameplayPawn` or `DefaultCharacterPawn` moves the world's first directional light onto itself every tick (`enableDirectionalLightFollowing`, on by default), keeping its direction, so the box travels with the player. It does not follow in the editor viewport (no controller), with free, fly, cinematic or spectator cameras, or with pawns of other classes; with several possessed pawns the last to tick wins (turn the property off on the extras).

## Shadows on `DirectionalLightNode`

Source: `.engine/src/nodes/lights/DirectionalLightNode.ts`, `.engine/src/render/CsmManager.ts`

| Property | Default | Applies when |
|---|---|---|
| `useCsmShadows` | false | Turns cascades on. Keep it false unless *Cascaded shadows: default off* (below) applies. Only one directional light can drive CSM at a time. |
| `shadowCameraLeft` / `Right` / `Top` / `Bottom` | −50 / 50 / 50 / −50 | Only while `useCsmShadows` is false (single orthographic frustum) |
| `csmCascadeCount` | 4 (rounded, min 1) | CSM on |
| `csmMaxFar` | 1000 | CSM on. Maximum camera distance covered. Should be smaller than `shadowFar`. |
| `csmMode` | `practical` | `practical`, `uniform`, `logarithmic` |
| `csmLightMargin` | 100 | Extra margin when fitting cascade bounds |
| `csmFade` | false | Blend between cascades and near the cutoff |
| `drivesSky` | false | `SkyNode` uses this light's direction for the sun disc and scattering |

`CsmManager` only drives a light that is in the world, has `useCsmShadows`, is not hidden (`visible` on and not `selfHidden`), and has `castShadow`. Cascade fields stored while `useCsmShadows` is false do not switch the light to CSM.

When CSM is on and `shadowFar < csmMaxFar`, the engine warns and raises `shadowFar` to `csmMaxFar × 2`.

### Cascaded shadows: default off

**Standard shadows are the default, also for open worlds and large terrain.** Leave `useCsmShadows` false. Size `shadowCameraLeft` / `Right` / `Top` / `Bottom` to the area around the player that needs shadows (about 40–120 m across; smaller is sharper) and set `shadowFar` to cover it; a possessed pawn carries the box with the player (above). Distant terrain can stay unshadowed: fog, AO and the sky fill carry it.

**Nothing moves the light** (a free, fly, cinematic or spectator camera, or a custom pawn without light following): use one cascade, `useCsmShadows: true` with `csmCascadeCount: 1`, `csmMaxFar` 60–150 and `shadowMapSize` 1024–2048. It is a box that follows the camera for about the cost of a standard shadow. Set `csmCascadeCount` in the same call: the default is 4.

Enable more than one cascade only when **all** of these hold:
- Crisp shadows are needed near **and** far at the same time, for example flight or racing under a low sun, where long shadows read across the view.
- The target is desktop or the high quality tier.
- A `genesys-profiler` report shows frame headroom with CSM on.

Minimal CSM setup when it applies: `csmCascadeCount` 2–3, `csmMaxFar` 150–300, `shadowMapSize` 1024–2048, `shadowFar` > `csmMaxFar`. Turn `csmFade` on only if cascade seams show. Never keep the defaults (4 cascades, `csmMaxFar` 1000, 2048 maps).

| Cost | Standard | CSM |
|---|---|---|
| Shadow passes per frame | 1 | one per cascade |
| Shadow-map texels | `shadowMapSize`² | cascades × `shadowMapSize`² (defaults: 4 × 2048² ≈ 16.8 M) |
| Shader samplers | 1 | one extra per cascade in the terrain and water shaders |

**Mobile.** Never author CSM for a phone-first game. The engine gates CSM by quality tier: the low tier (most phones) ignores it and uses the standard box, so fit `shadowCamera*` anyway; the medium tier caps it at 2 cascades and 1024 maps; the high tier runs it as authored. Authored CSM therefore still costs medium-tier devices.

### Choosing

| Space | Setting |
|---|---|
| Arena or room that fits in 100 × 100 m | Standard shadow, adjust `shadowCamera*` to the arena plus a few metres |
| Long view (open world, large terrain, racing, flight) with a player pawn | Standard shadow sized to the area around the player (the pawn moves it); far terrain unshadowed under fog. More cascades only under *Cascaded shadows: default off* |
| Free, fly or cinematic camera, nothing moves the light | One cascade: `useCsmShadows: true`, `csmCascadeCount: 1`, `csmMaxFar` 60–150 |
| Top-down or fixed camera | Standard shadow; the box can be tight around the visible area |
| Phone target | Standard shadows only; measure under `genesys-profiler` |

## Troubleshooting order

1. `castShadow` on the light and on the meshes that should cast (`castShadow: true` in node options).
2. Far end missing → expected with standard shadows: widen `shadowCamera*` / `shadowFar` a little, or let fog cover it. With CSM on (*Cascaded shadows: default off* applies), `csmMaxFar` is short of the space.
3. Acne → raise `shadowBias` magnitude slightly; peter-panning → lower it; curved surfaces → `shadowNormalBias`.
4. Change one property, then re-query the light. Do not add a clipmap class or a second cascade implementation.

## Baked light: lightmaps and probe grids

Indoor and dungeon spaces read better with baked indirect light than with more real lights.

### Lightmaps

Source: `.engine/src/lightmapper/` (`applySceneLightmaps.ts`, `lightmapApply.ts`, `lightmapBuildData.ts`, `paths.ts`)

- Bake with `action_build(action="buildLightmap", scenePath=…)` (`scenePath` is required; desktop app with the scene open), or the title-bar Build Lightmap button by hand.
- The bake writes `<scene>.build-data.zip` beside the `.genesys-scene` (`BUILD_DATA_ZIP_EXT`). When a scene loads, the engine looks for that zip and applies it to matching `MeshNode` / `ModelMeshNode`s (`tryApplyLightmapsToWorld`). No zip is not an error.
- Console on load: `[lightmapper] Applied lightmaps for <scene>: N object(s) updated`, and one `[lightmapper] Skipped <id> — <reason>` warning per entry that did not apply (`no matching MeshNode/ModelMeshNode in scene`, `mesh material does not support light maps`).
- Bake last: after the static geometry, materials and lights are final. Moving or replacing a baked mesh, or changing the lights, makes the bake stale; rebake.
- Baked light suits static geometry only. Moving things (the hero, enemies, pickups) get indirect light from a probe grid.

### `LightProbeGridNode`

Source: `.engine/src/nodes/lights/LightProbeGridNode.ts`

- A grid of spherical-harmonic probes over `boundsX × boundsY × boundsZ` metres, `countX × countY × countZ` probes. Only the node's world position counts; rotation and scale are ignored.
- **Bakes are not saved and do not run on their own.** `bakeLightProbes()` builds the grid and bakes it; the inspector's Bake Light Probes button calls it in the editor. `endPlay` disposes the grid. In Play, call it once after the level is loaded (verify in Play that characters pick up the room's light):

Source: `.engine/src/nodes/lights/LightProbeGridNode.ts` (`bakeLightProbes`) — typechecked against 18.1.0-alpha.317
```ts
// GameMode.beginPlay, after the level is loaded: probe grids hold no data until baked.
world.traverse((o) => { if (o instanceof ENGINE.LightProbeGridNode) void o.bakeLightProbes(); });
```

- `onBakeStatus` (a `Delegate`) reports `baking` / `complete` / `error` with a message such as `Light probes baked in 0.40s`.
- Keep counts low: every probe renders a cubemap (`cubeMapSize`, default 16) during the bake. One grid per building or dungeon floor, bounds a metre past the walls.
- `includeSceneEnvironmentInBake: true` adds the sky / IBL to the bake (rooms open to the sky). Leave it off for closed interiors.
- `visualizationMode: 'sh'` shows the probes while tuning; set it back to `'none'`.

## Traps

- Far shadows missing or blurry → the standard box is smaller than the view → widen `shadowCamera*` and `shadowFar` a little (a larger box is blurrier), or let fog and AO cover far terrain. Do not switch to CSM unless *Cascaded shadows: default off* applies; with CSM already on, set `csmMaxFar` to the play-space depth (≤ 300) and re-query the light.
- Cascade numbers set but nothing changes → `castShadow` is off or the light is hidden (`visible` off or `selfHidden`); `CsmManager` skips the light (`.engine/src/render/CsmManager.ts`).
- Shadows only near the origin → nothing moves the light: the player is not a possessed `GameplayPawn` / `DefaultCharacterPawn`, `enableDirectionalLightFollowing` is off, or the view is a free camera → turn following on, or use one cascade (*Cascaded shadows: default off*). Do not widen the box to the whole world: it gets blurry. In the editor viewport the box stays where the light is placed; check in play.
- Cascade settings ignored on a phone → expected: the low quality tier skips CSM and the medium tier caps it at 2 cascades and 1024 maps. Fit `shadowCamera*` for those devices.
- Shadow acne or peter-panning → adjust `shadowBias` / `shadowNormalBias` in small steps (0.0005 / 0.02), one property at a time.
- Shadows shimmer while the camera moves → compare `csmMode`, `csmCascadeCount`, `csmMaxFar` against the world size; change one and re-query. Do not add a second shadow system or a clipmap class.
- Console warns `shadowFar … is less than csmMaxFar` → the engine raised `shadowFar` to `2 × csmMaxFar`; set `shadowFar` > `csmMaxFar` yourself.
- Console logs `[lightmapper] Skipped <id> — mesh material does not support light maps` or `no matching MeshNode/ModelMeshNode in scene` → the mesh changed since the bake, or its material has no light-map slot → rebake after geometry edits.
- Indoor characters stay flat-lit beside a probe grid → the grid never baked in Play → bake it once after the level loads (*`LightProbeGridNode`*).
