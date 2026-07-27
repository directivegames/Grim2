# WebGPU TSL Node Material Assets — Background

Reference material for the `webgpu-tsl-node-material-assets` skill. This file holds the rationale and conceptual context for building custom WebGPU TSL material assets in Genesys.

## Why Node Material Assets exist

Genesys uses the Three.js WebGPU renderer for high-fidelity graphics. `NodeMaterialAsset` is a mixin that bridges Three.js `NodeMaterial` classes with the Genesys serialization and property system. By extending this mixin, you create materials that are:
- **Serializable**: They can be saved to `.material.json` files or embedded in scene files.
- **Editable**: They automatically generate property panels in the Genesys editor based on `@property` decorators.
- **Dynamic**: The `rebuild()` method allows the material to update its TSL graph whenever a property changes.

## Class vs material asset

The TypeScript class defines behaviour, TSL graph wiring, and editor property metadata. The `.material.json` asset stores a serialized instance with authored field values. After adding or changing a class, rebuild the project so the editor registry loads it, then create a material asset from the registered class.

## The dual-nature of node materials

Unlike traditional WebGL materials that require a separate runtime counterpart for serialization, WebGPU node materials serve as their own runtime representation. The asset class IS the runtime material.

## Authoring vs runtime

- **Authored fields**: Decorated with `@property`. These are the knobs in the property editor (colour, roughness, speed, texture paths).
- **TSL graph**: `rebuild()` wires authored field values into the node graph (`colorNode`, `opacityNode`, `positionNode`, etc.).

## Best practices

- **Performance**: `rebuild()` should be efficient. Avoid re-allocating textures or heavy objects when parameters are unchanged.
- **Reliability**: Always provide fallback values or graphs for invalid input or compilation errors.
- **Registration**: Use `@GameClass` with `isNodeMaterialAsset: true` so the editor lists the type in New Material and serializes it correctly.
