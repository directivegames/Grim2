/**
 * No-op — cloud shadows are now applied by directly upgrading MeshStandardMaterial
 * instances to MeshStandardNodeMaterial in patchWorldMaterials().
 * The fromMaterial hook approach was removed because Three.js NodeLibrary creates
 * a fresh instance on every call with no caching, making it unreliable for patching.
 */
export {};
