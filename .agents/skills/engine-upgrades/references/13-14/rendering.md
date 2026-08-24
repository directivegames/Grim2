# 13 → 14 — Rendering and post-processing

Open this file only if the project sets `material.mrtNode` on a custom material.
Nothing else in the rendering surface changed between 13 and 14, and no
post-process configuration option was renamed or removed.

## 1. `material.mrtNode` AO overrides are no longer supported

Ambient occlusion skips transparent surfaces. In 13 a material opted out of AO by
overriding the scene pass's normal render target itself, writing `0` into the alpha
channel that AO reads as its validity marker:

```ts
// Before (13) — no longer supported
material.mrtNode = mrt({ normal: vec4(packNormalToRGB(vec3(0, 0, 1)), 0) });

// After (14) — the scene pass writes the marker; mark the material transparent instead
material.transparent = true;
```

In 14 the scene pass derives that alpha from `material.transparent` (opaque → `1`,
transparent → `0`), so materials no longer participate in writing it. Remove any
`material.mrtNode` assignment. The engine's own particle materials set this in 13
— if the pattern was copied from there, it needs deleting.

Leaving it in place is not merely redundant. A material that sets `mrtNode` becomes
the sole fragment output on any render pass whose MRT has no `normal` slot, which
produces an empty output struct and an invalid WebGPU shader at draw time. There is
no compile error and no lint warning; it fails when that pass runs.

Search for `\.mrtNode` to find call sites.

## Consequences with no migration step

These need no code change, but explain rendering differences after the upgrade:

- AO now skips every material with `transparent: true`, not only particles. Glass,
  decals, and alpha-blended surfaces that received AO in 13 no longer do. Note that
  glTF materials authored with `alphaMode: "BLEND"` import as `transparent: true`
  even at full opacity, so a visually solid surface can lose AO this way.
- Alpha-tested cutouts are unaffected. Foliage and similar materials using
  `alphaTest` with `transparent: false` stay in the opaque queue and still receive AO.
- There is no per-material override. `material.transparent` is the only signal
  feeding AO validity, and `AOEffectConfig` exposes no per-material control, so a
  transparent-flagged material cannot opt back in.

Reference implementations: `render/postprocessing/pipelines/WebGPUPipeline.ts`,
`render/postprocessing/effects/AOEffect.ts`, and `vfx/core/VFXParticlesWebGPU.ts`
in `.engine/src/`.
