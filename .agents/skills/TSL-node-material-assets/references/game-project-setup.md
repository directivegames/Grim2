# Game Project Setup

This reference shows the minimal pattern for creating a custom game-side TSL node material shader asset that is editor-visible and serialization-safe.

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

  constructor() {
    super();
    this.rebuild();
  }

  override rebuild(): void {
    const t = TSL.time.mul(this.speed);
    const stripes = TSL.sin(TSL.positionLocal.y.mul(this.stripeFrequency).add(t)).mul(0.5).add(0.5);
    const base = TSL.vec3(this.color.r, this.color.g, this.color.b);
    this.colorNode = base.mul(stripes.add(0.25));
  }

  public serialize(dumper: ENGINE.Dumper): void {
    this.serializeAuthoredFields(dumper);
  }

  public static staticDeserialize(data: unknown, loader: ENGINE.Loader): PulseStripeNodeMaterialAsset {
    const instance = new PulseStripeNodeMaterialAsset();
    PulseStripeNodeMaterialAsset.loadAuthoredFields(instance, loader);
    instance.rebuild();
    return instance;
  }

  public override postLoad(): void {
    // Defensive: guarantees graph rebuild even if a load path bypasses staticDeserialize.
    this.rebuild();
    this.needsUpdate = true;
  }
}
```

## 2) Register specialization in game code

Run this once during startup (module side effect is common).

```typescript
import * as ENGINE from '@gnsx/genesys.js';

import { PulseStripeNodeMaterialAsset } from './materials/PulseStripeNodeMaterialAsset';

ENGINE.registerSpecialization({
  cls: PulseStripeNodeMaterialAsset,
  serializeFn: (obj, dumper) => obj.serialize(dumper),
  staticDeserializeFn: (data, loader) => PulseStripeNodeMaterialAsset.staticDeserialize(data, loader),
  cdo: new PulseStripeNodeMaterialAsset(),
});
```

## 3) Ensure registration executes

- Import both the class module and specialization-registration module from your game startup path (`src/game.ts` or your shared bootstrap).
- If that module is tree-shaken away, class decorators and specialization registration will not run.

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

## Quick Validation Checklist

- Material class appears in New Material dialog under the configured group.
- Authored fields are visible/editable in property editor.
- Editing fields updates visuals (`rebuild()` + `needsUpdate` path).
- Scene save/load preserves authored values and restores expected look.
- `.material.json` round-trip restores the same material behavior.
