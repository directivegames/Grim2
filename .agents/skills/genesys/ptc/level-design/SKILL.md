---
name: level-design
description: Build level geometry using ready-made art assets.
---

# Level Design

Assets located in the project can be listed using `list-assets`. If required, you can install an asset pack first using `install-asset-pack`.

Once you've figured out which assets to use, you can query their dimensions using `get-asset-dimensions`.

Then, use `eval-world` to place your actors into the scene.

- Simple objects: Use `GLTFMeshComponent`
- Many similar objects: Use `InstancedGltfMeshComponent`
- Ground plane: Use `MeshComponent`
- Lighting: Use e.g., `SpotLightComponent`, `PointLightComponent`, etc.
- Whiteboxing: Use `CSGCubeComponent`, `CSGCylinderComponent`, etc.

## Workflow

1. Call `get-asset-dimensions` and read the bounds.
2. Identify the dominant axes of the asset (longest horizontal = X or Z; tall = Y dominant).
3. Determine which surface each asset will form (wall, floor, ceiling) and which world axis it should run along.
4. Apply the rotation from the tables in the **Coordinate System** section — no test placement needed.
5. Set the Y position using the **Y Offset** rule so the asset sits correctly on the ground or at ceiling height.
6. Use `InstancedGltfMeshComponent` for bulk tiled surfaces.

## Reference Sizes

- A room: 20x20
- Small level: 50x50
- Large level: 200x200

## Coordinate System

The engine uses the **Three.js coordinate system**: +X right, +Y up, +Z toward the viewer (-Z is forward).

### Walls

Compare the asset's longest horizontal axis to the world axis you want the wall to run along:

| Asset runs along | Wall should run along | Y rotation needed |
|---|---|---|
| X | X (front/back wall) | none (`0`) |
| X | Z (side wall) | 90° (`Math.PI / 2`) |
| Z | Z (side wall) | none (`0`) |
| Z | X (front/back wall) | 90° (`Math.PI / 2`) |

Stack tiles vertically by incrementing **Y** by the asset's height. Keep X/Z fixed for a clean column.

### Floors & Ceilings

Floor tiles typically lie flat. If the asset's natural orientation is already flat (longest axes are X and Z, short axis is Y), no rotation is needed. If the asset stands upright (tall on Y), tip it flat with an X rotation:

| Asset orientation | Use as floor | X rotation needed |
|---|---|---|
| Flat (X/Z dominant) | Floor | none (`0`) |
| Upright (Y dominant) | Floor | 90° (`Math.PI / 2`) |
| Flat (X/Z dominant) | Ceiling | none (`0`) — raise Y to ceiling height |

Tile floors on the **X/Z plane** by stepping X and Z by the asset's width/depth. Y stays constant (floor height).

### Positioning Summary

| Surface | Tile along | Increment axis | Fixed axis |
|---|---|---|---|
| Front/back wall | X | X | Y (for stacking), Z fixed |
| Side wall | Z | Z | Y (for stacking), X fixed |
| Floor | X and Z | X, Z | Y fixed |
| Ceiling | X and Z | X, Z | Y fixed (at ceiling height) |

### Y Offset (sitting on the ground)

Place an object so it sits on the ground by setting its Y position to **half its own height** (i.e. `bounds.y / 2`). For a floor tile with no thickness this is `0`; for a wall segment it is `wallHeight / 2`.