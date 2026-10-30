# Shipped node-material classes

The short version is in [SKILL.md → Decide](../SKILL.md#decide-use-a-shipped-class-first). This file lists every shipped class with its authored fields and defaults.

All live in `.engine/src/runtime/materials/nodeMaterialAssets/`; the registry name is `ENGINE.<Class>`. Authored fields are listed with defaults.

| Want | Class (`ENGINE.…`) | Authored fields |
|---|---|---|
| Hologram, force field, ghost edge glow | `FresnelRimNodeMaterialAsset` | `rimColor` (0, 0.5, 1), `baseColor`, `emissiveIntensity` 0.6, `roughness` 0.2, `metalness` 0.8 |
| Burn / dissolve with glowing edge, looping or a one-shot fade | `DissolveNodeMaterialAsset` | `color`, `edgeColor` (1, 0.5, 0), `speed` 0.4, `loop` true, `progress` 0 (0 solid, 1 gone; used when `loop` is off, and `setProgress(t)` changes it without a rebuild), `roughness` |
| Pulsing neon stripes (sci-fi trims, pads) | `NeonPulseNodeMaterialAsset` | `color` (near black), `neonColor` (0, 1, 0.5), `stripeFrequency` 10, `stripeSpeed` 3 |
| Swaying grass, flags, water wobble | `VertexWaveNodeMaterialAsset` | `frequency` 4, `amplitude` 0.15, `speed` 2, `roughness`, `metalness` |
| Textured ground or walls with no UVs (blockout grids, terrain) | `DynamicUVNodeMaterialAsset` | `mapPath`, `scale` 1, `color`, `roughness` 0.8, `metalness` (engine `M_Floor` / `M_Wall` use it) |
| Procedural world-space stripes for terrain-like shading | `WorldTriplanarNodeMaterialAsset` | `colorDark`, `colorLight`, `scale` 2, `roughness` |
| Vertical two-colour gradient (sky domes, stylised props) | `ColorGradientNodeMaterialAsset` | `colorBottom`, `colorTop` (unlit) |
| Heat haze, magic shimmer | `HeatDistortionNodeMaterialAsset` | `colorCool`, `colorHot`, `speed` 1.5, `waveFrequency` 8, `waveAmplitude` 0.07 |
| Soap bubble, beetle shell, oil sheen | `IridescenceNodeMaterialAsset` | `color`, `roughness` 0.05, `metalness` 1, `iridescenceIOR` 1.8 |
| Wax, skin, jelly, leaves lit from behind | `SSSNodeMaterialAsset` | `color`, `roughness`, `thicknessDistortion`, `thicknessAmbient`, `thicknessAttenuation`, `thicknessPower`, `thicknessScale` |
| Glass, ice, crystal | `TransmissionNodeMaterialAsset` | `color`, `transmission` 1, `roughness` 0, `thickness`, `specularIntensity`, `envMapIntensity` |
| Layered depth illusion on flat panels | `ParallaxUVNodeMaterialAsset` | `uvScale` 3, `parallaxScale` 0.5, `colorGain` 5, texture URLs (engine parallax set) |
| Toon / cel shading | `MeshToonNodeMaterialAsset` | `color`, `gradientMapPath` (engine toon ramps in `@engine/assets/textures/`), `mapPath` |
| Baked-looking stylised lighting | `MeshMatcapNodeMaterialAsset` | `color`, `matcapPath` (`@engine/assets/textures/matcaps/`), `mapPath` |
| Plain PBR / unlit / classic shading | `MeshStandardNodeMaterialAsset`, `MeshPhysicalNodeMaterialAsset`, `MeshBasicNodeMaterialAsset`, `MeshLambertNodeMaterialAsset`, `MeshPhongNodeMaterialAsset` | `color`, `metalness`, `roughness`, `emissive`, map paths… |
| Debug normals; point clouds; billboards | `MeshNormalNodeMaterialAsset`, `PointsNodeMaterialAsset`, `SpriteNodeMaterialAsset` | — |

Write a custom class ([SKILL.md → Custom class](../SKILL.md#custom-class)) when the effect needs a graph none of these has, or a field driven from gameplay that no shipped class has.
