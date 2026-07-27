---
name: whitebox-level-design
description: Build preliminary level geometry using constructive geometry. Use for prototyping level design and gameplay, before art is ready.
metadata:
    version: 1.0.0
---

# Whitebox Level Design

First understand the users design. If the user provided an image, include it in the design.

Next, ensure that Manifold is enabled. This is done inside of the BaseGameLoop like so:

```
  public override getWorldConfiguration(): ENGINE.WorldOptions {
    return {
      ...super.getWorldConfiguration(),
      useManifold: true,
    };
  }
```

CSG stands for "constructive solid geometry" and allows you to define levels using simple shapes. In our implementation, the 'root' CSG will always render, and then children of the root can modify it. For example, a cube subtracted from another cube can create a nice hollow box.

The available classes are `CSGCubeComponent`, `CSGSphereComponent`, or `CSGCylinderComponent`. The operation field of each class determines how it combines with it's parent. 

As a general rule, use as few actors/components as possible. Prefer using composition of the CSG shapes over creating a new actor.

Use the `eval-world` skill to add the requested functionality to the active scene.