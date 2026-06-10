# Game Project Setup

This reference shows a safe pattern for creating a custom game-side TSL node material shader asset that is editor-visible, serialization-safe, and resource-safe.

## Property Metadata Guidance (Editor Exposure)

- Always use explicit property metadata for editor-authored fields: `@ENGINE.property({ type, description, ... })`.
- Use `type: 'texturePath'` for texture URL fields.
- Use `type: 'number'` with `min`/`max`/`step` for numeric sliders and thresholds.
- Use `type: 'boolean'` for toggle-style settings and `type: 'color'` for tint fields.
- Always include a concise `description` so editor UI communicates intent clearly.

## 1) Define the material asset class and register specialization

Keep the class and `ENGINE.registerSpecialization(...)` in the same module. Execute registration once via a module side effect at the bottom of the file.

```typescript
import * as ENGINE from '@gnsx/genesys.js';
import * as TSL from 'three/tsl';
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';

@ENGINE.GameClass({
  isNodeMaterialAsset: true,
  nodeMaterialDisplayName: 'Pulse Stripe (Game)',
  nodeMaterialGroup: 'Game FX',
})
export class PulseStripeNodeMaterialAsset extends ENGINE.NodeMaterialAsset(MeshStandardNodeMaterial) {
  @ENGINE.property({ type: 'color', description: 'Main stripe tint' })
  override color = new THREE.Color(0.1, 0.9, 1.0);

  @ENGINE.property({ type: 'number', min: 0.1, max: 20, step: 0.1, description: 'Stripe frequency' })
  stripeFrequency = 6.0;

  @ENGINE.property({ type: 'number', min: 0.0, max: 10, step: 0.1, description: 'Animation speed' })
  speed = 1.25;

  @ENGINE.property({ type: 'texturePath', description: 'Optional stripe mask texture URL' })
  maskTexturePath = '';

  private _maskTexture: ENGINE.UrlTexture | null = null;
  private _disposed = false;

  constructor() {
    super();
    this.rebuild();
  }

  private _syncMaskTexture(): THREE.Texture | null {
    const url = this.coerceTexturePath(this.maskTexturePath);
    this.maskTexturePath = url;

    if (!url) {
      this._maskTexture?.dispose();
      this._maskTexture = null;
      return null;
    }

    if (!this._maskTexture) {
      this._maskTexture = new ENGINE.UrlTexture({
        url,
        wrapS: THREE.RepeatWrapping,
        wrapT: THREE.RepeatWrapping,
        colorSpace: THREE.NoColorSpace,
      });
    } else if (this._maskTexture.url !== url) {
      this._maskTexture.url = url;
    }

    this._maskTexture.needsUpdate = true;
    return this._maskTexture;
  }

  override rebuild(): void {
    // Never resurrect GPU resources on a disposed material (deferred editor callbacks).
    if (this._disposed) return;
    try {
      this.applyCommonMaterialState();
      const safeSpeed = this.clampFiniteNumber(this.speed, 0, 10, 1.25);
      const safeFrequency = this.clampFiniteNumber(this.stripeFrequency, 0.1, 20, 6.0);
      this.speed = safeSpeed;
      this.stripeFrequency = safeFrequency;

      const maskTex = this._syncMaskTexture();
      const stripes = TSL.sin(TSL.positionLocal.y.mul(safeFrequency).add(TSL.time.mul(safeSpeed)))
        .mul(0.5)
        .add(0.5);
      const base = TSL.color(this.color);
      const mask = maskTex ? TSL.texture(maskTex, TSL.uv()).x : TSL.float(1);
      this.colorNode = base.mul(stripes.add(0.25)).mul(mask);
      this.needsUpdate = true;
    } catch (error) {
      console.error('[PulseStripeNodeMaterialAsset] rebuild failed', error);
      // Safe fallback output to avoid runtime shader crashes.
      this.colorNode = TSL.vec3(1, 0, 1);
      this.needsUpdate = true;
    }
  }

  public serialize(dumper: ENGINE.IDumper): void {
    this.serializeAuthoredFields(dumper);
  }

  public static staticDeserialize(data: unknown, loader: ENGINE.ILoader): PulseStripeNodeMaterialAsset {
    const instance = new PulseStripeNodeMaterialAsset();
    PulseStripeNodeMaterialAsset.loadAuthoredFields(instance, loader);
    instance.rebuild();
    return instance;
  }

  public override dispose(): void {
    this._disposed = true;
    this._maskTexture?.dispose();
    this._maskTexture = null;
    super.dispose();
  }
}

ENGINE.registerSpecialization({
  cls: PulseStripeNodeMaterialAsset,
  serializeFn: (obj, dumper) => obj.serialize(dumper),
  staticDeserializeFn: (data, loader) => PulseStripeNodeMaterialAsset.staticDeserialize(data, loader),
  cdo: new PulseStripeNodeMaterialAsset(),
});
```

## 2) Ensure module import executes

- Import the asset module from your game startup path (`src/game.ts` or shared bootstrap).
- Avoid maintaining a separate registration-only module for this material.
- If that module is tree-shaken away, class decorators and specialization registration will not run.
- `cdo: new YourAssetClass()` runs your constructor; keep constructor logic safe and side-effect free outside `rebuild()`.

## 3) Assign at runtime

Use it as a normal material:

```typescript
const material = new PulseStripeNodeMaterialAsset();
const mesh = ENGINE.MeshComponent.create({ geometry: new THREE.SphereGeometry(1, 32, 32), material });
```

## What breaks if specialization is missing

- The class may still serialize through `serialize(...)` as a serializable object instance.
- On load, without matching specialization, the loader can fall back to constructor + property population path.
- In that fallback path, your graph may not be rebuilt unless you call `rebuild()` in `postLoad()` or implement custom `deserialize(...)`.

## Deserialize/Rebuild Order (Recommended)

1. Construct instance (`new YourAssetClass()` — constructor runs an initial `rebuild()` with defaults).
2. Load authored fields (`loadAuthoredFields` inside `staticDeserialize`).
3. Run exactly one rebuild from final authored values.
4. Mark `needsUpdate = true` inside `rebuild()`.
5. Optionally implement `postLoad()` only when you need a safety net for non-specialized load paths.

## Naming and TSL Conventions

- Prefix `toVar(...)` names (`pom*`, `stripe*`, etc.) to avoid graph collisions.
- Avoid local variable shadowing of authored property names in `rebuild()`.
- Clamp/sanitize values that affect loops or expensive branches.

## Quick Validation Checklist

- Material class appears in New Material dialog under the configured group.
- Authored fields are visible/editable in property editor.
- Authored fields use correct editor control types and show description help text.
- Editing fields updates visuals (`rebuild()` + `needsUpdate` path).
- Scene save/load preserves authored values and restores expected look.
- `.material.json` round-trip restores the same material behavior.
- Repeated rebuilds do not create unbounded texture/memory growth.
