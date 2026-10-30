# Routing

The short rule is in [SKILL.md → Routing](../SKILL.md#routing). Read the owning skill before the first file or editor mutation in its area. On a whole build, the **always** rows are mandatory, so read them up front. Record the skills you read in `GAME.md` **Lanes**.

| Area | Skill | Whole build |
|---|---|---|
| GameMode, `main()`, screen flow, build order, bundle proof | `genesys-game-boot` | always |
| Core API, asset paths, "engine already has it" | `genesys-engine` | always |
| Editor MCP | `genesys-mcp-orchestrator` | always (when connected) |
| HUD, menus, every widget, which screens exist | `genesys-ui` | always |
| Feel, impact layering, pacing, difficulty | `genesys-game-feel` | always |
| Evidence and playtest | `genesys-verification` | always |
| `TECH.md`, engine mapping, contracts, work packages | `genesys-tech-design` | when code workers, a multi-session build or a handoff are planned |
| Pawn locomotion, input direction, knockback, jump feel | `genesys-movement` | if the player moves |
| Camera layout, pointer lock | `genesys-camera` | always |
| Weapons, projectiles, damage, health | `genesys-combat` | if anything takes damage |
| Enemies, NPCs, waves, bosses | `genesys-creatures` | if there is opposition |
| Behavior trees / navmesh | `behavior-tree` / `genesys-navigation` | walkers in a level |
| Pickups, doors, triggers, moving platforms | `genesys-interactions` | if present |
| Vehicles | `genesys-vehicles` | if driving |
| Physics queries, joints, impulses | `genesys-physics` | if needed |
| Particles and effects | `genesys-vfx` | always |
| Sound and music | `genesys-audio` | always |
| Play space | `genesys-level-authoring`, `genesys-polybuilder`, `genesys-prefabs` | always |
| Outdoor world: terrain, islands, water, sky, vegetation | `genesys-world-building` | when the game has outdoor ground or water |
| Lights, shadows, grading | `genesys-lighting` | always |
| Asset routes, Assets table, search, wiring, asset check | `genesys-assets` (first asset of a session: its `references/first-asset-card.md`) | always |
| Models built in code: hero, creatures, props, pickups, vehicles, environment pieces | `genesys-code-modeling` | always, unless every model is reused |
| Models built in Blender | `genesys-blender-modeling` | only when the creator asks for Blender |
| Scenario generation | `genesys-generated-assets` | when the art routes include Scenario |
| Phone play, touch buttons, tappable pause | `genesys-touch-controls` | whenever a touch recipe fits the genre |
| Multiplayer | `genesys-multiplayer` | when online |
| Store | `monetization-store` | when selling items |
| Performance | `genesys-profiler` | on hitching, a phone pass, or hundreds of repeated props |
| Custom shaders | `webgpu-tsl-node-material-assets` | when asked |
| Parallel workers, briefs, critic | `genesys-subagents` | always on a whole build |
| Class lookup | `genesys-engine` (Find an engine class) | any unknown class |
| Editor UI how-to | `genesys-editor-manual` | when asked |

A subsystem with no row in this table still gets a line: write `Lane: none — <why>` in `GAME.md` before you touch it.
