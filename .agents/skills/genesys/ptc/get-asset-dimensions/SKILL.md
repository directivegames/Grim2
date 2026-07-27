---
name: get-asset-dimensions
description: Get the dimensions of a prefab or model. Use before placing an asset into the scene, to understand it's dimensions and placement requirements.
---

# Get Asset Dimensions

Use `eval-world::getAssetBounds` to list the dimensions of an asset.

## Reading the Result

`getAssetBounds` returns an AABB (axis-aligned bounding box) with `size`, `center`, `min`, and `max`. It describes *how large* an asset is but **not which way it faces**.
