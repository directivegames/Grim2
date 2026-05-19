# Advanced Fog Card System

This folder implements a fog card using Three.js TSL.

The current implementation loads one fog-card mesh, assigns a transparent `MeshBasicNodeMaterial`, and exposes the main Unreal-style controls as editor properties on `FogSystemComponent`.

## Inputs

Default assets:

- `@project/assets/models/SM_FogCard_01.glb`
- `@project/assets/textures/Fog/T_smoothCloudsNoise_02_D.PNG`
- `@project/assets/textures/Fog/T_mountainFog_06_mask.PNG`
- `@project/assets/textures/System/Flowmaps/T_Flowmap_01_Directional.PNG`
- `@project/assets/textures/System/T_borderMask.PNG`

## Shader

`FogCardMaterial` builds the material graph with:

- base color noise, tint, contrast, and emissive-style intensity
- opacity mask
- dual-phase flowmap animation with crossfade
- camera-near fade
- view-angle fade
- optional border mask
- optional world-space wind noise

Depth/geometry fade and normal-map lighting are intentionally deferred until the renderer path is verified for this project.
