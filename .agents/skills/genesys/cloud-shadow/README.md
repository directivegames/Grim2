# cloud-shadow — Rationale

## Why world-space UVs

Standard mesh UV coordinates break the cloud shadow in two ways: the shadow would be stuck to the mesh surface (not moving independently), and seams between adjacent meshes would produce visible discontinuities in the shadow pattern. Using `positionWorld.xz` as the UV input makes the shadow exist in world space — it flows continuously across the entire scene regardless of how the geometry is UV-mapped.

## Why two layers

A single scrolling noise layer produces obvious periodic repetition at large scale. The second layer samples the same texture at a different scale (2×) and a slightly different scroll direction (rotated wind vector at 0.35× speed). The two layers drift relative to each other over time, breaking the repetition cycle into something that never obviously repeats on the timescales of a game session.

## Why MultiplyBlending for the overlay

Multiply blending is `output = overlay × background`. At `overlay = 1.0` the background is unchanged. At `overlay = 0.72` (shadowStrength 0.28) the background is darkened by 28%. This naturally preserves the hue and contrast of the scene underneath — the shadow is just less light, not a colour tint. Additive or alpha-composite blending would change the colour balance.

## Why MeshBasicNodeMaterial not MeshStandardNodeMaterial

The overlay plane only needs to output a constant grey value — it does not need PBR lighting. `MeshStandardNodeMaterial` adds deferred lighting passes that are wasted on a full-screen overlay and can crash in some Three.js WebGPU versions during material setup. `MeshBasicNodeMaterial` is stable, fast, and correct for this use case.

## Overlay vs material patching

The overlay approach (approach A) is simpler: one mesh, one material, no scene traversal. It works for any scene geometry including skinned meshes. The downside is that shadows do not follow slopes.

Material patching (approach B) produces geographically accurate shadows on terrain but requires traversal, modifies materials permanently, and does not work with `MeshStandardNodeMaterial` environments that rely on runtime lighting.

For most isometric games the overlay is sufficient and preferred.

## Combining with the TSL-node-material-assets skill

The TSL-node-material-assets skill provides the foundation for writing TSL node material classes in Genesys. `CloudShadowOverlayMaterial` follows the same pattern: a class extending a Three.js WebGPU material, with uniforms defined at construction time and a node graph built in the constructor. Reference that skill when extending or customising the cloud shadow shader further.
