# Game Project Setup

This reference shows a safe pattern for creating a custom game-side TSL node material shader asset that is editor-visible, serialization-safe, and resource-safe.

## Property metadata guidance (editor exposure)

- Always use explicit property metadata: `@ENGINE.property({ type, description, ... })`.
- Use `type: 'texturePath'` for texture URL fields.
- Use `type: 'number'` with `min`/`max`/`step` for numeric sliders and thresholds.
- Use `type: 'boolean'` for toggles and `type: 'color'` for tint fields.
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
      this.colorNode = TSL.vec3(1, 0, 1);
      this.needsUpdate = true;
    }
  }

  public serialize(dumper: ENGINE.IDumper): void {
    this.serializeAuthoredFields(dumper);
  }

  public static staticDeserialize(_data: unknown, loader: ENGINE.ILoader): PulseStripeNodeMaterialAsset {
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

- Import the asset module from game startup (`src/game.ts` or shared bootstrap).
- Do not maintain a separate registration-only module.
- If the module is tree-shaken away, decorators and specialization registration will not run.
- `cdo: new YourAssetClass()` runs your constructor; keep constructor logic safe outside `rebuild()`.

## 3) Build, register, and create the material asset

**With MCP (preferred when connected):**

```text
action_build(action="buildProject")
→ query_editor(operation="getNodeMaterialClasses", filter="PulseStripe")
→ run_script(mode="apply", groupUndo=true, approval={ operations: ["action_asset.createMaterial", "action_component.setProperties", "action_scene.save"] }, code=...)
  → genesys.actionAsset({ action: "createMaterial", materialClassName: "GAME.PulseStripeNodeMaterialAsset", name: "M_PulseStripe", parentPath: "assets/materials" })
  → genesys.actionComponent({ action: "setProperties", actorId: …, properties: { material: "@project/assets/materials/M_PulseStripe.material.json" } })
  → genesys.actionScene({ action: "save" })
```

Do not batch `action_build` with create/assign in one script. Use `getNodeMaterialClasses`, not `getRegisteredClasses`, to verify node material registration.

**Manual:** Asset Browser → New → Material → select **Pulse Stripe (Game)** under **Game FX**.

Do not hand-author `.material.json`. The editor serialises materials with `ENGINE.createDumper`.

## 4) Assign at runtime or in the scene

Runtime:

```typescript
const material = new PulseStripeNodeMaterialAsset();
const mesh = ENGINE.MeshComponent.create({ geometry: new THREE.SphereGeometry(1, 32, 32), material });
```

Scene/editor (MCP):

```text
action_component(action="setProperties", actorId=…, properties={ material: "@project/assets/materials/M_PulseStripe.material.json" })
→ action_scene(action="save")
```

On `MeshComponent`, the editable property path is `material` (type `materialPath`), not a top-level `materialPath` key in `setProperties`.

## What breaks if specialization is missing

- The class may still serialize as a generic serialisable object.
- On load without matching specialization, the loader may skip `rebuild()` unless you implement `postLoad()` or custom `deserialize(...)`.

## Deserialize/rebuild order (recommended)

1. Construct instance (constructor runs initial `rebuild()` with defaults).
2. Load authored fields (`loadAuthoredFields` inside `staticDeserialize`).
3. Run exactly one rebuild from final authored values.
4. Mark `needsUpdate = true` inside `rebuild()`.

## Quick validation checklist

- Material class appears in New Material dialog under the configured group.
- Authored fields are visible/editable in the property editor with correct control types.
- Editing fields updates visuals (`rebuild()` + `needsUpdate`).
- Scene save/load preserves authored values.
- `.material.json` round-trip restores the same material behaviour.
- Repeated rebuilds do not create unbounded texture/memory growth.
