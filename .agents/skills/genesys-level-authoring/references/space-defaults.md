# Space defaults by game type

Starting values when the user did not specify. Units are metres; the engine's default character is about 1.8 m tall (`GSSCharacterPawn`). These are design defaults, not engine values. Tune them in Play.

| Game type | Footprint | Key dimensions | Spawn | Camera handoff (`genesys-camera`) | Bound | Dressing priority |
|---|---|---|---|---|---|---|
| Top-down / twin-stick arena | 40–60 m square or circle | Cover 1–2 m tall so the camera sees over it | Centre, facing "up" the screen | Top-down, 20–30 m high | Code clamp to the floor rect; visible edge (rim, glow line, low wall) | Floor texture and edge first, then 4–8 cover props |
| Third-person action | 30–50 m | Walls 3–4 m, 2 height levels via ramps ≤ 30°, ledges 1–2 m | Edge, facing the centre | Spring arm 4–6 m | Collider walls | Walls and landmarks |
| First-person shooter | Rooms 8–15 m, corridors 3–4 m wide | Ceilings 3–4 m, doors 1.2 × 2.2 m, cover 1.2 m | Corner room, facing the first sightline | First person | Collider walls and ceilings | Doorframes, cover, lights |
| 3D platformer | 80–200 m course | Platforms 2–6 m, gaps 2–4 m (jump-tested), steps ≤ 0.4 m, 6–12 checkpoints | First platform, facing the course | Third person or fixed chase | Kill volume 5–10 m below the lowest platform; checkpoints | Platforms readable by colour and silhouette |
| Side-scroller | 100–300 m along X | Ground lane 4–8 m deep, platforms 1–3 m above | Left end, facing +X | Side camera, depth locked | Code clamp on Z; kill volume below; goal trigger at the end | Background parallax props behind the lane |
| Racing | Loop 400–1200 m (`SplineMeshNode`, `closed`, `trimesh`) | Road 10–14 m, run-off 5 m, banked corners | Start grid on the straight | Chase camera | Barriers on corners; off-track trigger resets after 2–3 s | Barriers (instanced), start/finish arch, roadside landmarks |
| Survival / open area | 150–300 m of terrain (`genesys-world-building` recipe) | Landmarks every 40–60 m, resource clusters | Near a landmark with shelter | Third person | Cliffs, water, invisible colliders at the rim | Trees, rocks, foliage from `@engine/assets/models/demo/`, instanced (`InstancedModelMeshNode`) |
| Puzzle / single room | 10–20 m | Every interactive within view, 2–3 m spacing | Doorway, facing the puzzle | Fixed or third person | Collider walls | Interactives contrast with walls |
| Sports field | e.g. 40 × 20 m pitch | Goals at the ends, sidelines marked | Own half | Broadcast or follow cam | Collider walls or clamp per player | Line markings, goals, stands as backdrop |
| Space / flight | 200–1000 m volume | Obstacles 5–50 m | Centre | Chase | Soft clamp or turn-back zone | Skybox first (`genesys-lighting`), then large silhouettes |

## Proportions that read well

- Doors and corridors 1.5× the character width or wider; third-person cameras need even more room.
- Jumps: measure the pawn's real jump in Play before spacing gaps. A gap the default jump cannot clear is a bug.
- Landmarks: one tall, unique silhouette per area so the player can orient.
- Colour: walkable surfaces one value range, hazards a saturated contrasting colour, interactives a third.

## Spawn and checkpoints

- One spawn point per player, on the floor, ≥ 2 m from props, facing into the play.
- Checkpoints at the start of each new challenge; respawn takes ≤ 1 s.
- Store spawn transforms as scene nodes (a named `SceneNode` or a spawner) placed with MCP, not as numbers in code.
