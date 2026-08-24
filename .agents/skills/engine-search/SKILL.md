---
name: engine-search
description: Find which Genesys engine class does a thing when you cannot name it yet — search the engine class hierarchy by keyword to map a vague request ("make the enemy chase the player", "add a light", "spawn a projectile") onto a concrete engine class. Use before building anything custom, to check the engine does not already ship it. Once you have a class name, use the engine-reference skill to read its source.
---

# Engine Search

Search `node_modules/@gnsx/genesys.js/artifacts/class-hierarchy.xml` for candidate
classes. It lists every engine class and its inheritance chain, so a keyword match
also tells you what the class extends and what else extends it.

## Rules

1. Search the hierarchy file for keywords from the request, plus synonyms — "chase" also means follow, pursue, seek, AI, behavior; "shoot" also means projectile, weapon, hitscan, raycast.
2. Read the whole file when you need the shape of a subsystem rather than one class.
3. Feed each candidate class name to the `engine-reference` skill to read its source and confirm the fit.
4. Only write a custom class once this search has come up empty. The engine ships far more than a keyword-free guess will find.
