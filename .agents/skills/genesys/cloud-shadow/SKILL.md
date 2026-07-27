# cloud-shadow

Animated world-space cloud shadows for WebGPU (TSL) games. A grayscale noise texture scrolls across the scene in two overlapping layers to produce drifting, softened shadow patches. Two delivery modes: an overlay plane that multiplies over everything below it, and a material patcher that injects the cloud node directly into existing scene meshes.

Requires WebGPU / Three.js WebGPU renderer. The system degrades silently on WebGL — add a capability check and skip loading if needed.

---

## Approach A — Overlay plane (recommended)

A large flat plane sits just above the ground with `MultiplyBlending`. It darkens everything it covers without touching individual materials.

### 1. Add the cloud texture

Put a tileable grayscale noise PNG in your assets:

```
assets/textures/cloudtexture.png
```

Grayscale, 512×512 or 1024×1024. High-contrast soft blobs work best. A simple Perlin or Worley noise export from any image editor is fine.

### 2. Place `CloudShadowActor` in the scene

Add `CloudShadowActor` to your scene. In code:

```ts
import { CloudShadowOverlayMaterial } from './assets/CloudShadowOverlayMaterial.js';
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

// Inside beginPlay or a setup function:
const tex = await ENGINE.resourceManager.loadTexture(
  ENGINE.AssetPath.fromString('@project/assets/textures/cloudtexture.png'),
);
if (!tex) return;

const material = new CloudShadowOverlayMaterial(tex, {
  cloudScale:     0.0007,   // lower = larger, sparser clouds
  cloudSpeed:     0.006,    // scroll rate
  shadowStrength: 0.28,     // 0 = invisible, 1 = full black
  windX: 1.0,               // normalized wind direction XZ
  windZ: 0.35,
});

const geom = new THREE.PlaneGeometry(300, 300);
const mesh = new THREE.Mesh(geom, material);
mesh.rotation.x = -Math.PI / 2;
mesh.position.y = 0.08;       // just above ground
mesh.frustumCulled = false;
mesh.renderOrder = 2;

world.scene.add(mesh);
```

Update `planeSize` so it covers the full play area. The overlay drifts seamlessly because UVs are derived from `positionWorld` (world-space), not mesh UVs.

---

## Approach B — Material patching

Upgrades existing `MeshStandardMaterial` / `MeshPhysicalMaterial` meshes to `MeshBasicNodeMaterial` with a cloud multiplier `colorNode`. Use this when you need shadows to interact with the terrain geometry correctly (e.g. they follow slopes).

```ts
import { applySimpleCloudShadow } from './assets/applySimpleCloudShadow.js';

const tex = await ENGINE.resourceManager.loadTexture(
  ENGINE.AssetPath.fromString('@project/assets/textures/cloudtexture.png'),
);
if (!tex) return;

// Patch all eligible meshes under a root object:
const patched = applySimpleCloudShadow(world.scene, {
  cloudTexture:   tex,
  cloudScale:     0.0015,
  cloudSpeed:     0.015,
  shadowStrength: 0.3,
  windX:          1.0,
  windZ:          0.35,
  forceApply:     false,  // true = patch all meshes, false = only env/terrain
  debug:          false,
});
console.log(`Cloud shadow patched ${patched} materials`);
```

Set `mesh.userData.cloudShadow = true` or `mesh.userData.environment = true` on meshes you want patched when `forceApply` is false. Meshes named with `/Slash|Blood|Smoke|Blob|VFX|Trail/i` are always skipped.

---

## Tuning parameters

`cloudScale` — world-space UV scale. Lower values = larger, sparser clouds. Default `0.0007` (overlay) / `0.0015` (patch). Range: `0.0003` – `0.003`.

`cloudSpeed` — how fast the texture scrolls. Default `0.006`. Faster feels stormy; slower feels peaceful.

`shadowStrength` — max darkening, 0–1. `0.28` is subtle. Above `0.5` starts to look harsh.

`cloudLow` / `cloudHigh` — `smoothstep` thresholds for the cloud mask. Narrowing the range (e.g. `0.4`/`0.7`) produces sharper cloud edges. Widening (e.g. `0.1`/`0.9`) produces very soft gradients.

`layer2ScaleMul` — scale of the second noise layer relative to the first. `2.0` produces fine detail on top of large forms.

`layer2SpeedMul` — speed of the second layer. `0.35` makes it drift slower, breaking up repetition.

`layer1Weight` / `layer2Weight` — blend between layers. Default `0.7` / `0.3`. Must not need to sum to 1.

See `references/tuning.md` for a visual guide to each parameter.

---

## Constraints

- Only works with WebGPU renderer. Wrap in a renderer capability check before loading.
- Do not use `MeshStandardNodeMaterial` for the overlay — it crashes during WebGPU setup in some Three.js versions. Use `MeshBasicNodeMaterial` with `MultiplyBlending` instead (as `CloudShadowOverlayMaterial` does).
- The overlay plane should have `frustumCulled = false` so it is never culled when the camera is at the edge of the scene.
- For approach B: patching is one-way. Patched materials cannot be un-patched at runtime. Apply once after scene load.
- `applySimpleCloudShadow` builds a fresh TSL node graph per material to avoid builder state conflicts. Do not share node instances across materials.
