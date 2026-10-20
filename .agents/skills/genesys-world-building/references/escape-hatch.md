# Escape hatch: wrapping a three.js object as a node

Use this only when no engine node covers the feature (check `genesys-world-building` and `engine-search` first). Already wrapped: `SkyNode` (Sky / SkyMesh, clouds, environment map), `WaterNode` (own TSL water, planar mirror), `TerrainMeshNode`, `ScatterNode` and foliage, `GrassNode`, `ProceduralPropNode` (crates, barrels, huts, lighthouses... see `nodes.md`), `MirrorNode` (planar mirrors and puddles), `LensFlareNode` (Lensflare / LensflareMesh), `TimeOfDayNode`, `LineNode` (Line2 fat lines), `BatchedMeshNode` (BatchedMesh), cascaded shadows on `DirectionalLightNode`, and the post-processing stack (bloom, AO, SSR, depth of field, FXAA / SMAA / TRAA, lens vignette / grain / chromatic aberration, retro, outline, colour grading). The mirror skeleton below only illustrates the pattern: for a real mirror use `ENGINE.MirrorNode`. Engine noise is `ENGINE.Noise` (seeded); do not use the addon `ImprovedNoise` / `SimplexNoise`.

## Rules

- Extend `ENGINE.ThreeObjectNode` (`.engine/src/nodes/visual/ThreeObjectNode.ts`) and decorate the class with `@ENGINE.GameClass()`. It owns the lifecycle so you do not hand-roll it.
- Configuration lives in `@ENGINE.property()` fields. Implement `buildObject(ctx)` to return the three.js object built **only** from those fields. The base adds it as a transient child (never saved), so a reload rebuilds it.
- Editor and MCP `setProperties` edits rebuild automatically (coalesced to one rebuild on the next tick). Code that changes a property at runtime calls `this.markDirty()` (or does it from a setter). List properties that only need a per-frame update in `liveProperties` to skip the rebuild.
- Per-frame work goes in `updateObject(object, dt, ctx)`; it runs in edit and play mode.
- Geometry, materials and their textures are disposed for you on rebuild and teardown. Release anything the scene-graph walk cannot see (render targets, `Reflector.dispose()`, event listeners) in `disposeObject(object)`.
- Branch on `ctx.isWebGPU` (WebGPURenderer, TSL works; true on the default renderer) vs the classic WebGL renderer. For an unsupported path call `this.warnOnce(key, message)` and return a fallback; never throw.
- Errors are contained: a throwing `buildObject` is logged with the class and node name and shows a small magenta wireframe box until the next property change; a throwing `updateObject` is paused until the next rebuild. Seeing magenta in a capture means read the console.
- `ctx.tier` is the resolved quality tier (`low` / `medium` / `high`): skip expensive extras on `low`.
- Place and configure the node with MCP like any other node.

Never: `world.scene.add(new THREE.Mesh(...))`, patching editor-placed nodes in `beginPlay` to persist visuals, or a second renderer or render loop.

## Skeleton

```ts
import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { color, reflector } from 'three/tsl';
import { MeshStandardNodeMaterial } from 'three/webgpu';

/** A planar mirror puddle: TSL reflector on WebGPU, the Reflector addon on classic WebGL. */
@ENGINE.GameClass()
export class PuddleMirror extends ENGINE.ThreeObjectNode {
  @ENGINE.property({ type: 'number', min: 0.5, max: 50, description: 'Width and depth in metres' })
  public size: number = 4;

  @ENGINE.property({ type: 'color' })
  public tint: THREE.Color = new THREE.Color('#8899aa');

  @ENGINE.property({ type: 'number', min: 0.125, max: 1 })
  public resolution: number = 0.5;

  protected buildObject(ctx: ENGINE.ThreeBuildContext): THREE.Object3D {
    const geometry = new THREE.PlaneGeometry(this.size, this.size);
    if (ctx.isWebGPU) {
      const mirror = reflector({ resolutionScale: ctx.tier === 'low' ? this.resolution / 2 : this.resolution });
      const material = new MeshStandardNodeMaterial({ roughness: 0.05, metalness: 0 });
      material.colorNode = mirror.rgb.mul(color(this.tint));
      const mesh = new THREE.Mesh(geometry, material);
      mesh.rotation.x = -Math.PI / 2;
      mirror.target.rotateX(-Math.PI / 2);
      mesh.add(mirror.target);
      mesh.userData.mirror = mirror;
      return mesh;
    }
    const mesh = new Reflector(geometry, { color: this.tint, textureWidth: 512, textureHeight: 512 });
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  protected override disposeObject(object: THREE.Object3D): void {
    // Render targets are invisible to the subtree walk.
    if (object instanceof Reflector) object.dispose();
    (object.userData.mirror as { dispose?: () => void } | undefined)?.dispose?.();
  }
}
```

Per-frame animation (`updateObject`) and runtime edits:

```ts
protected override liveProperties: readonly string[] = ['spinSpeed'];
protected override updateObject(object: THREE.Object3D, dt: number): void {
  object.rotation.y += this.spinSpeed * dt;
}
public setSize(size: number): void {
  this.size = size;
  this.markDirty(); // rebuilds on the next tick
}
```

Read the addon's source before using it (constructor options, what it allocates, how it is disposed). After adding the class: `pnpm build`, `action_build(buildProject)`, `query_editor(getRegisteredClasses, filter: "PuddleMirror")`, then place it with `action_node(add, className: "GAME.PuddleMirror")` and verify with a capture.

