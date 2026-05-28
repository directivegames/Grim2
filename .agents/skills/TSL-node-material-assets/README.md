# TSL Node Material Assets — Background

Reference material for the `TSL-node-material-assets` skill. This file holds the rationale and conceptual context for building custom WebGPU TSL material assets in Genesys.

## Why Node Material Assets exist

Genesys uses the Three.js WebGPU renderer for high-fidelity graphics. `NodeMaterialAsset` is a mixin that bridges Three.js `NodeMaterial` classes with the Genesys serialization and property system. By extending this mixin, you create materials that are:
- **Serializable**: They can be saved to `.material.json` files or embedded in scene files.
- **Editable**: They automatically generate property panels in the Genesys editor based on `@property` decorators.
- **Dynamic**: The `rebuild()` method allows the material to update its TSL graph whenever a property changes.

## The Dual-Nature of Node Materials

Unlike traditional WebGL materials that require a separate "runtime" counterpart for serialization, WebGPU node materials serve as their own runtime representation. The asset class IS the runtime material.

## Authoring vs Runtime

- **Authored Fields**: These are decorated with `@property`. They represent the "knobs" the user sees in the editor (e.g., color, roughness, speed).
- **TSL Graph**: The `rebuild()` method takes the current values of authored fields and wires them into the TSL node graph (e.g., assigning to `colorNode`, `opacityNode`, `positionNode`).

## Best Practices

- **Performance**: `rebuild()` should be efficient. Avoid re-allocating textures or heavy objects if the underlying parameters haven't changed.
- **Reliability**: Always provide fallback values or graphs in case of invalid input or compilation errors.
- **Registration**: Use `@GameClass` with `isNodeMaterialAsset: true` to ensure the editor knows how to create and display your material.
