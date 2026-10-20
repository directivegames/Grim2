# Apply a world to a scene that already has gameplay

Use this when the scene already holds gameplay or authored props (player start, checkpoints, docks, pickups) and the user wants realistic terrain, water or sky around them. `applyWorld` keeps those nodes but **does not move them**. A new landform rises around them, so props at the old floor height end up inside the terrain.

## Facts to work from

- `replace: "world"` removes only root sky, environment, directional / ambient / hemisphere lights, fog, `TerrainMeshNode`, `WaterNode`, orbit cameras (when the recipe brings one), and any root `MeshNode` named exactly `Ground`. A gameplay floor named `Ground` is deleted. `Mesh_Floor`, plane stand-ins and mesh-based oceans are **not** removed.
- MCP has no terrain-height query and no snap-to-ground operation. `TerrainMeshNode.getHeightAt(x, z)` exists in engine code only; `query_node`, `action_node` and `run_script` cannot call it.
- A constant Y lift is not placement: the terrain height varies across the footprint.
- The editor's **End** key (Drop To Surface) casts down from just above each selected node's bottom. It cannot rescue a buried prop (the ray starts inside the terrain), and it rests the bounds' bottom on the surface, so a hovering pickup loses its clearance.
- Play mode does not expose a height API. Do not enter it to look for one.

## Steps

1. **Survey** in one `run_script(readOnly)`, not a string of `find` calls; the steps below take about six tool calls in all. It returns the XZ footprint, the Y band and the environment nodes already present (`auditWorld`'s `summary` counts terrains, waters, suns and skies). Stand-ins are flat floor meshes, mesh oceans, and any light, sky or environment node that is not a root (`applyWorld` replaces root ones only; a nested old sun gives `multiple-suns`). Everything else is gameplay.

   ```js
   const tree = await genesys.queryNode({ operation: 'getTree', limit: 500 });
   const roots = tree.nodes.filter(n => n.isWorldRoot);
   const env = /Sky|Light|Fog|Environment|Terrain|Water|OrbitCamera/;
   const gameplay = roots.filter(n => !env.test(n.className));
   const details = await genesys.queryNode({ operation: 'getDetails', componentIds: gameplay.slice(0, 200).map(n => n.id) });
   // transform.position is a string such as "(21.2, 14, 51.1)".
   const pos = details.components.map(c => c.transform.position.match(/-?[\d.]+/g).map(Number));
   const axis = i => [Math.min(...pos.map(p => p[i])), Math.max(...pos.map(p => p[i]))];
   const nested = tree.nodes.filter(n => !n.isWorldRoot && /Sky|DirectionalLight|SceneEnvironment/.test(n.className));
   return { truncated: tree.truncated, x: axis(0), y: axis(1), z: axis(2), gameplay: gameplay.length,
     envRoots: roots.filter(n => env.test(n.className)).map(n => `${n.name}:${n.className}`),
     nestedEnv: nested.map(n => n.id) };
   ```
2. **Fit the landform to the footprint.** A square `size` about 2× the longer side of the footprint (non-square terrains get a misaligned collider on older engines), low `relief` for a strip that must stay walkable (2–6 m), and `water.level` = the old water Y (for a backdrop, see step 3). For a beach strip: `shape: "coast"`, `cliffHeight: 0`, `coastDirection` towards the old water (0 = +Z, 180 = −Z; derive it, do not assume a compass name). When the user said to keep their props: `vegetation: []`, `landmarks: []`. When the game owns the camera: `camera: { mode: "none" }`. Grass stays off unless asked: `styleOverrides: { grass: { enabled: false } }`. **Dry-run.**
3. **Decide before applying.** Peaks reach about `water.level + relief` (relief is the peak height above the water level).
   - **Backdrop**, the default for a theme request ("arctic theme", "make it a desert") on a level whose gameplay stands on its own floors above the ground (a platformer): no question needed, state the assumption. Set `water.level` so `water.level + relief` is at least 5 m below the survey's lowest gameplay Y (`level` goes down to −50; lower `relief` if it cannot). Keep the old floors; delete only stand-ins (mesh ground, mesh ocean, nested old sky or sun).
   - When props must stand on the new ground, stop after the dry run and offer:
     - **a) Keep the old floors** as ground and collision; replace only sky, light, fog, water and look by hand ([compose-checklist.md](compose-checklist.md) steps 2, 4, 5 and 7: a root `WaterNode` at the old water Y in place of the mesh ocean), or
     - **b) Apply the terrain**, then list the gameplay roots that need a Y pass. Either the user places them, or the agent lifts them above the new terrain (old Y + `relief` + 1 m) and the user selects them and presses End (tell them about lost hover clearance).

   Never invent heights, and never tell the user to press End on props that may be under the new surface.
   If the request is ambiguous ("replace the scene with terrain and water" may mean wipe the level or keep it), ask that one question first.
4. **Apply in one undo step.** One `run_script(apply, groupUndo: true)` that deletes the stand-ins (`genesys.actionNode({ action: "delete", componentIds })`) and then calls `genesys.actionScene({ action: "applyWorld", world })`. Do not only set `visible: false`. If the apply returns `operation_still_running`, the deletes and the world are two undo steps; say so.
5. **Finish in one script.** One `run_script(apply, groupUndo: true)` waits for the build, applies the look, retints gameplay materials and audits:

   ```js
   const sleep = ms => new Promise(r => setTimeout(r, ms));
   let busy = await genesys.queryEditor({ operation: 'getBusyState' });
   for (let i = 0; busy.isBusy && i < 18; i++) { await sleep(2000); busy = await genesys.queryEditor({ operation: 'getBusyState' }); }
   if (busy.isBusy) return { stillBuilding: true }; // run this script again; never apply again
   await genesys.actionScene({ action: 'applyLookPreset', lookPresetId: 'cool-crisp' });
   // Retint: find by class name (not getTree), walk childIds to the meshes, set their material.
   const { audit } = await genesys.actionScene({ action: 'auditWorld' });
   return { build: busy.lastWorldBuild, errors: audit.errors, warnings: audit.warnings.map(w => w.code) };
   ```

   Fix every error. `multiple-skies` or `multiple-suns` means an old sky or sun survived: delete it.
6. **Verify once.** If `getState.viewportVisible` is false, ask the user to restore the editor window. Then, after the textures load, one `captureScreenshot` with `focusNodeIds` = the terrain (`lastWorldBuild.focusNodeId`) plus the gameplay cluster (player start, dock) and `views: ["hero", "ground"]`. Check that the terrain does not cut through the level. Re-apply only when that capture shows the landform itself is wrong, never to fix an oversized first guess you could have caught in the dry run.

Scene look still goes through MCP: never `beginPlay` scenery, never hand edits of `*.genesys-scene`.

Later: an MCP operation that samples terrain height at points, or snaps selected roots while keeping their old clearance, would make option b) automatic. It does not exist yet; do not call it.
