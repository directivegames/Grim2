# Tuning Reference

## Grim2 defaults (overlay approach)

```ts
cloudScale:     0.0007
cloudSpeed:     0.006
shadowStrength: 0.28
windX:          1.0
windZ:          0.35   // normalized to (1.0, 0.35).normalize() internally
cloudLow:       0.28
cloudHigh:      0.82
layer2ScaleMul: 2.0
layer2SpeedMul: 0.35
layer1Weight:   0.7
layer2Weight:   0.3
```

## Parameter effects

cloudScale: controls how large the cloud patches appear in the world.
  Lower (0.0003) = massive continental cloud bands.
  Higher (0.003)  = small, busy, patchy clouds.

cloudSpeed: overall scroll rate.
  0.001 = barely moving (cinematic, dawn feel).
  0.015 = brisk wind.
  0.05  = very fast, stormy.

shadowStrength: maximum darkening.
  0.15  = faint, subtle atmospheric hint.
  0.28  = Grim default — noticeable but not oppressive.
  0.5   = heavy overcast.
  0.8+  = very dark, near black patches.

cloudLow / cloudHigh: smoothstep thresholds for edge softness.
  0.28 / 0.82 = Grim default — soft edges, large lit areas.
  0.40 / 0.70 = harder edges, more distinct cloud silhouettes.
  0.10 / 0.90 = extremely soft gradients, almost no sharp edges.

layer2ScaleMul: fine detail layer scale relative to the base.
  1.5 = subtle secondary structure.
  2.0 = Grim default.
  3.5 = very fine secondary noise (can look grainy at low resolution).

layer2SpeedMul: secondary layer animation speed relative to base.
  0.2  = very slow drifting secondary layer.
  0.35 = Grim default.
  0.8  = secondary layer moves almost as fast as primary.

windX / windZ: wind direction in world XZ. Normalized automatically.
  (1, 0)     = east wind.
  (1, 0.35)  = east-southeast (Grim default).
  (-1, -0.5) = west-northwest.
  (0, 1)     = north wind.

## Quickly compare presets

Bright midday with fast wind:
  cloudScale=0.0005, cloudSpeed=0.018, shadowStrength=0.2, cloudLow=0.3, cloudHigh=0.75

Heavy overcast, slow:
  cloudScale=0.0012, cloudSpeed=0.004, shadowStrength=0.45, cloudLow=0.2, cloudHigh=0.6

Sparse high clouds:
  cloudScale=0.0008, cloudSpeed=0.008, shadowStrength=0.18, cloudLow=0.55, cloudHigh=0.90
