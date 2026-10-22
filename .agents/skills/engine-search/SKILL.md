---
name: engine-search
description: Find which Genesys engine class does a thing when you cannot name it yet — read the engine class hierarchy to map a vague request ("make the enemy chase the player", "add a light", "spawn a projectile") onto a concrete engine class. Use before building anything custom, to check the engine does not already ship it. Once you have a class name, read its outline and then its source under `.engine/src/`.
metadata:
  tokens: 902
---

# Engine Search

Read `node_modules/@gnsx/genesys.js/artifacts/class-hierarchy.xml` from start to end.
It is a map of every engine class you can import from `@gnsx/genesys.js`, in three sections:

- `<Inheritance>` nests each class inside the engine class it extends.
- `<Interfaces>` lists each interface with the classes that implement it, for example every movement mode under `IGSSMovementMode`.
- `<Standalone>` lists classes with no engine parent or subclass, grouped by source folder.

Each `<Class>` element can also have these attributes: `extends` (a base class from outside the engine, such as `THREE.Object3D`), `mixins`, `abstract`, and `internal` (not exported — listed only because an exported class extends it, so do not import it).

## Rules

1. Read the whole hierarchy file once. Do not search it by keyword: a single matching line does not show the parent class or the interfaces.
2. Pick candidates for the request, plus synonyms — "chase" also means follow, pursue, seek, AI, behavior; "shoot" also means projectile, weapon, hitscan, raycast.
3. For each candidate, read its outline at `node_modules/@gnsx/genesys.js/artifacts/classes/<ClassName>.md`. The outline is a TypeScript class declaration in a code block. It is a summary, not source: do not import from it or copy it into the project.
   - The outline starts with the doc comment at the top of the source file, when the file has one. Read it before the members. Its opening sentence or two say what the module is for and how it works; `@gotcha` lines are class-wide behaviour the signatures do not show; `@see Name - …` names a class to use instead in the stated case.
   - The `// path:` line gives the source `path`, plus `module details: lines <first>-<last>` when the source file's doc comment has `@remarks` or `@example` sections that the outline leaves out (design, step-by-step behaviour, examples; read those lines only when the outline is not enough), `sourceName` when the class is exported under a different name (such as a class `Foo` exported as `Bar`), `serializable` when scenes and prefabs can store the class, and `internal` when the class is not exported.
   - A doc comment directly above the class is the first paragraph of the class documentation.
   - The class lists its constructor, public members, `protected` members, and `static` members. Private and `@internal` members are not listed. Inherited members are in the outline of the `extends` class.
   - Each member ends in `// line <n>` or `// lines <first>-<last>`: the lines it covers in the source file at `path`, decorators included.
   - A `/** @gotcha ... */` comment above a member is behaviour of that member the signature does not show. Read it before you call or override the member.
   - A member with a `/** @property [Category] ... */` comment is set in the editor and saved with the scene. The text says what it does.
   - A type such as `typeof Button.presets` or `Foo['bar']` means the inferred type was too long to show. Read the member's source lines.
4. Confirm the fit in `.engine/src/` — the outline `path` is relative to `.engine/`. Read only the line ranges of the members you need. Engine files can exceed 50 KB, so do not read them whole.
5. Only write a custom class once this search has come up empty. The engine ships far more than a keyword-free guess will find.
