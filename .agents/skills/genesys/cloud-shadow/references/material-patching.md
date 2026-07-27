# Material Patching Reference

## When to use approach B instead of the overlay

The overlay plane (approach A) sits at a fixed Y and multiplies over everything uniformly. On steep terrain or walls the shadow looks the same as on flat ground — it does not follow the surface geometry.

The material patching approach (approach B) injects the cloud multiplier directly into each mesh's `colorNode`. Because the multiplier uses `positionWorld` (the fragment's world position), the shadow pattern follows the surface, flowing up cliffs and around slopes correctly.

## What `applySimpleCloudShadow` does

1. Traverses `root` (usually `world.scene`).
2. For each `Mesh` (skipping `SkinnedMesh`): checks if the mesh name or `userData` indicates it's an environment mesh, or if `forceApply` is set.
3. For each eligible material slot: if already a NodeMaterial, sets `colorNode = materialColor.mul(cloudMultiplier)`. Otherwise upgrades the material to `MeshBasicNodeMaterial`, copies properties from the original, and sets `colorNode`.
4. Each material gets its own fresh TSL node graph (not shared) to avoid builder conflicts.
5. Returns the number of materials newly patched.

## Opt-in mesh selection

By default (when `forceApply = false`) only meshes matching these name patterns are patched:

```
terrain, ground, environment, cliff, rock, road, building, wall, floor
```

Or meshes with:
```ts
mesh.userData.environment = true
mesh.userData.cloudShadow = true
```

Set `forceApply = true` to patch all eligible meshes regardless of name.

## Skipped materials (always)

- `SkinnedMesh` (would break skinning).
- Materials with `AdditiveBlending` or `SubtractiveBlending`.
- Materials whose names match `/Slash|Blood|Smoke|Blob|VFX|Trail|Summon|Ripple|GrassSway|Grass/i`.
- Materials already patched (tracked via `userData.__cloudShadowSimple`).

## Timing

Call `applySimpleCloudShadow` after the scene and all actors have loaded and their meshes are in the scene graph. Calling it too early will miss late-loading GLTF actors.

If actors spawn after initial load, call `applySimpleCloudShadow(actor.rootComponent, options)` on each new actor's root when it enters play.

## Limitations

- Patching is one-way. The original material is discarded. There is no un-patch path at runtime.
- `MeshBasicNodeMaterial` does not receive dynamic lighting — it only uses baked vertex colors and the texture. If your environment materials rely on runtime point lights or directional lights, switch to approach A (overlay) instead, which does not change material types.
- Does not support skinned meshes. For animated characters, use the overlay or skip them.
