---
name: engine-search
description: Find which Genesys engine class does a thing when you cannot name it yet — read the engine class hierarchy to map a vague request ("make the enemy chase the player", "add a light", "spawn a projectile") onto a concrete engine class. Use before building anything custom, to check the engine does not already ship it. Once you have a class name, read its outline and then its source under `.engine/src/`.
---

# Engine Search

Read `node_modules/@gnsx/genesys.js/artifacts/class-hierarchy.xml` from start to end.
It is a map of every engine class you can import from `@gnsx/genesys.js`, in three sections:

- `<Inheritance>` nests each class inside the engine class it extends.
- `<Interfaces>` lists each interface with the classes that implement it, for example every movement mode under `IMovementMode`.
- `<Standalone>` lists classes with no engine parent or subclass, grouped by source folder.

Each `<Class>` element can also have these attributes: `extends` (a base class from outside the engine, such as `THREE.Object3D`), `mixins`, `abstract`, and `internal` (not exported — listed only because an exported class extends it, so do not import it).

## Rules

1. Read the whole hierarchy file once. Do not search it by keyword: a single matching line does not show the parent class or the interfaces.
2. Pick candidates for the request, plus synonyms — "chase" also means follow, pursue, seek, AI, behavior; "shoot" also means projectile, weapon, hitscan, raycast.
3. For each candidate, read its outline at `node_modules/@gnsx/genesys.js/artifacts/classes/<ClassName>.yaml`. It gives the source path (plus `sourceName` when the class is exported under a different name, such as `CSGUtils` exported as `CSG`), base class, interfaces, whether scenes and prefabs can store the class (`serializable`), and every member signature with its source line.
4. Confirm the fit in `.engine/src/` — the outline `path` is relative to `.engine/`. Read only the members you need. Engine files can exceed 50 KB, so do not read them whole.
5. Only write a custom class once this search has come up empty. The engine ships far more than a keyword-free guess will find.
