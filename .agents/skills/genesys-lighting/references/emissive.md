# Emissive glow on standard materials

The short rule is in [SKILL.md → Emissive glow](../SKILL.md#emissive-glow-standard-materials). Glow is an emissive colour above the bloom threshold, never a light. Bloom (order 20) runs before tone mapping (order 30), on HDR values, so a surface blooms when its brightness passes `threshold`. Pair `emissiveIntensity` 2–4 with bloom `threshold` 0.9–1.0 and `strength` 0.4–1.0; lit surfaces stay below the threshold, emissive trims pass it. On WebGPU, `selectiveEmissive: true` blooms emissive materials only.

## Routes

| What glows | Route |
|---|---|
| A modelled prop (lamp, crystal, screen, eyes) — the default | A `GLOW` part on the code model, exported with the `M_Glow` material (`genesys-code-modeling`). For a Blender GLB: `gkit` `mat(name, colour, emit='#ffa040', emit_strength=3)` in the step script (`genesys-blender-modeling`); the GLB carries the emissive. Strength above 1 rides on the glTF `KHR_materials_emissive_strength` extension; verify in Play that it glows. |
| A mesh built in code (projectile, pickup, spawned prop) | One shared `THREE.MeshStandardMaterial` with `emissive` + `emissiveIntensity`, created once as a module constant (below) |
| A placed primitive or `MeshNode` | A material asset: `action_asset(action="createMaterial", materialClassName="ENGINE.MeshStandardNodeMaterialAsset", name="M_Glow_Lamp")` inside `run_script`, assign `material: "@project/assets/materials/M_Glow_Lamp.material.json"`, save, re-query. Its `emissive` and `emissiveIntensity` fields are set in the editor's material inspector; no MCP operation edits material-asset fields, so ask the creator or use one of the routes above. An inline material object set through MCP reads back fine and does not persist (`genesys-mcp-orchestrator`). |

Source: `.engine/src/nodes/visual/MeshNode.ts` (`material`), `.engine/src/nodes/gameplay/ShotgunNode.ts` (emissive projectile material) — typechecked against 18.1.0-alpha.317
```ts
// Module constants: one geometry and one material shared by every lamp.
const LAMP_GEO = new THREE.SphereGeometry(0.2, 16, 8);
const LAMP_GLOW = new THREE.MeshStandardMaterial({ color: 0x2a1a08, emissive: 0xffa040, emissiveIntensity: 3 });
export function makeLamp(): ENGINE.MeshNode {
  return ENGINE.MeshNode.create({ geometry: LAMP_GEO, material: LAMP_GLOW });
}
```

Several lamps glowing in one room: emissive materials plus 1–3 real point lights on the key sources. A light per lamp, per pickup, or per projectile is the per-spawn cost `genesys-profiler` forbids.

## Traps

- Whole frame glows → bloom `threshold` below 1 with the default `strength` 2.0 → raise threshold to ≥ 0.9 and strength to ≤ 1, or use `selectiveEmissive` on WebGPU.
- An emissive lamp does not glow → bloom is off, or `emissiveIntensity` × colour stays under `threshold` → enable bloom, raise `emissiveIntensity` to 2–4.
