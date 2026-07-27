# Shader Design

## Two-layer noise

The cloud shadow uses two samples of the same noise texture at different scales and speeds. Blending them breaks up the repetitive tiling of a single layer and produces more organic-looking cloud shapes.

```
layer1: uv = positionWorld.xz * cloudScale + windDir * time * cloudSpeed
layer2: uv = positionWorld.xz * cloudScale * layer2ScaleMul - windOrtho * time * cloudSpeed * layer2SpeedMul
```

Layer 2 scrolls in a slightly different direction (rotated wind vector) so the layers animate independently. Their blend weights default to 0.7 / 0.3.

## Smoothstep mask

The raw noise value is in [0, 1]. Running it through `smoothstep(cloudLow, cloudHigh, raw)` reshapes the distribution:

- Below `cloudLow`: fully lit (no shadow)
- Above `cloudHigh`: maximum shadow
- In between: smooth fade

Narrowing the range (e.g. `0.4`/`0.6`) produces harder-edged clouds. Widening it (`0.1`/`0.9`) makes everything soft.

## Multiplier

The final output is `1 - (softened * shadowStrength)`. This maps to:

- Clear sky → `1.0` (no darkening)
- Dense cloud → `1.0 - shadowStrength` (maximum darkening)

In the overlay approach the full `vec4(multiplier, multiplier, multiplier, 1.0)` is output as the plane's color with `MultiplyBlending`, darkening whatever is underneath.

In the material patching approach the multiplier node is chained onto the material's `colorNode`:

```ts
colorNode = materialColor.mul(cloudMultiplierNode)
```

## World-space UVs

UVs are derived from `positionWorld.xz` rather than the mesh's texture coordinates. This means:

1. The shadow pattern is independent of mesh UV layout — any geometry gets consistent coverage.
2. The plane can be moved or scaled without affecting the shadow size.
3. Multiple meshes seamlessly share the same shadow pattern with no seam artifacts at mesh boundaries.

## Why MeshBasicNodeMaterial for the overlay

`MeshStandardNodeMaterial` triggers additional deferred lighting passes in the WebGPU renderer. For a full-screen multiply overlay that only needs to output a constant color, `MeshBasicNodeMaterial` is correct and stable. Standard/Physical node materials crash in some Three.js WebGPU versions when used for overlays.
