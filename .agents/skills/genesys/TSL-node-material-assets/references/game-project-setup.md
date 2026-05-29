# Game Project Setup

This reference shows a safe pattern for creating a custom game-side TSL node material shader asset that is editor-visible, serialization-safe, and resource-safe.

## Property Metadata Guidance (Editor Exposure)

- Always use explicit property metadata for editor-authored fields: `@ENGINE.property({ type, description, ... })`.
- Use `type: 'texturePath'` for texture URL fields.
- Use `type: 'number'` with `min`/`max`/`step` for numeric sliders and thresholds.
- Use `type: 'boolean'` for toggle-style settings and `type: 'color'` for tint fields.
- Always include a concise `description` so editor UI communicates intent clearly.

## 1) Define the material asset class

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
  readonly [ENGINE.ISerializableObjectTag] = true as const;

  @ENGINE.property({ type: 'color', description: 'Main stripe tint' })
  override color = new THREE.Color(0.1, 0.9, 1.0);

  @ENGINE.property({ type: 'number', min: 0.1, max: 20, step: 0.1, description: 'Stripe frequency' })
  stripeFrequency = 6.0;

  @ENGINE.property({ type: 'number', min: 0.0, max: 10, step: 0.1, description: 'Animation speed' })
  speed = 1.25;

  @ENGINE.property({ type: 'string', description: 'Optional stripe mask texture URL' })
  maskTextureUrl = '';

  private _maskTexture: THREE.Texture | null = null;
  private _maskTextureUrl = '';
  private _skipNextPostLoadRebuild = false;

  constructor(opts?: { deferRebuild?: boolean }) {
    super();
    if (!opts?.deferRebuild) {
      this.rebuild();
    }
  }

  private _ensureMaskTexture(url: string): THREE.Texture | null {
    const normalizedUrl = url.trim();
    if (normalizedUrl === this._maskTextureUrl) return this._maskTexture;

    const previous = this._maskTexture;
    if (!normalizedUrl) {
      this._maskTexture = null;
      this._maskTextureUrl = '';
      previous?.dispose();
      return null;
    }

    const next = new ENGINE.UrlTexture({
      url: normalizedUrl,
      wrapS: THREE.RepeatWrapping,
      wrapT: THREE.RepeatWrapping,
    });
    next.colorSpace = THREE.NoColorSpace;

    this._maskTexture = next;
    this._maskTextureUrl = normalizedUrl;
    previous?.dispose();
    return next;
  }

  override rebuild(): void {
    try {
      const safeSpeed = Number.isFinite(this.speed) ? this.speed : 1.25;
      const safeFrequency = Number.isFinite(this.stripeFrequency) ? this.stripeFrequency : 6.0;
      const maskTex = this._ensureMaskTexture(this.maskTextureUrl);

      const t = TSL.time.mul(safeSpeed);
      const stripes = TSL.sin(TSL.positionLocal.y.mul(safeFrequency).add(t)).mul(0.5).add(0.5);
      const base = TSL.vec3(this.color.r, this.color.g, this.color.b);
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

  public serialize(dumper: ENGINE.Dumper): void {
    this.serializeAuthoredFields(dumper);
  }

  public static staticDeserialize(data: unknown, loader: ENGINE.Loader): PulseStripeNodeMaterialAsset {
    const instance = new PulseStripeNodeMaterialAsset({ deferRebuild: true });
    PulseStripeNodeMaterialAsset.loadAuthoredFields(instance, loader);
    instance.rebuild();
    instance._skipNextPostLoadRebuild = true;
    return instance;
  }

  public override postLoad(): void {
    if (this._skipNextPostLoadRebuild) {
      this._skipNextPostLoadRebuild = false;
      this.needsUpdate = true;
      return;
    }
    // Defensive safety net when load path bypasses staticDeserialize.
    this.rebuild();
    this.needsUpdate = true;
  }

  public override dispose(): void {
    this._maskTexture?.dispose();
    this._maskTexture = null;
    this._maskTextureUrl = '';
    super.dispose();
  }
}
```

## 2) Register specialization in the same module

Keep specialization registration in the same file as the material asset class, and execute it once via module side effect.

```typescript
import * as ENGINE from '@gnsx/genesys.js';

import { PulseStripeNodeMaterialAsset } from './materials/PulseStripeNodeMaterialAsset';

let isRegistered = false;

export function registerPulseStripeNodeMaterialSpecialization(): void {
  if (isRegistered) {
    return;
  }

ENGINE.registerSpecialization({
  cls: PulseStripeNodeMaterialAsset,
  serializeFn: (obj, dumper) => obj.serialize(dumper),
  staticDeserializeFn: (data, loader) => PulseStripeNodeMaterialAsset.staticDeserialize(data, loader),
  cdo: new PulseStripeNodeMaterialAsset(),
});

  isRegistered = true;
}

registerPulseStripeNodeMaterialSpecialization();
```

## 3) Ensure module import executes

- Import the asset module from your game startup path (`src/game.ts` or shared bootstrap).
- Avoid maintaining a separate registration-only module for this material.
- If that module is tree-shaken away, class decorators and specialization registration will not run.
- `cdo: new YourAssetClass()` runs your constructor; keep constructor logic safe and side-effect free outside optional rebuild.

## 4) Assign at runtime

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

1. Construct instance (optionally with deferred rebuild).
2. Load authored fields (`loadAuthoredFields`).
3. Run exactly one rebuild from final authored values.
4. Mark `needsUpdate = true`.
5. Let `postLoad()` act as a safety net for non-specialized load paths.

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
