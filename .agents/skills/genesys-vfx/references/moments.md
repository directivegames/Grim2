# Moments and starting numbers

The short version is in [SKILL.md → The moment gate](../SKILL.md#the-moment-gate). One row per moment: what the player reads, the default build, and starting numbers to tune from.

| Moment | What the player reads | Default build | Starting numbers |
|---|---|---|---|
| Travel | The projectile or swing moving | Visible mesh, or a child `VFXNode` (owned, looping) on the mover | Trail `spawnMode: 'time'`, `loop: true`, lifetime 0.2–0.4 s |
| Muzzle / cast | The shot leaving | One-shot `spawnVFX` at the barrel or hand | Burst 6–12 particles, lifetime 0.05–0.1 s, `speed` 2–5 |
| Impact | The hit landing | One-shot `spawnVFX` at the hit point, on enemies and on walls | Burst 10–20, lifetime 0.1–0.25 s, `speed` 3–8, additive |
| Death | The enemy or player is gone | Animation first, then a one-shot `spawnVFX` at the body | Burst 80–150, lifetime 0.4–1.0 s, `speed` 4–8, gravity -5 |
| Pickup | The thing was collected | One-shot sparkle at the pickup | Burst 20–40, lifetime 0.3–0.6 s, upward `direction` |
| Recovery / lingering | Fire, smoke, a debuff, an aura | Owned `VFXNode` the owner stops and destroys | `loop: true`; stop on state end |
| Ambient (torch, portal) | Mood, a landmark | `VFXNode` with a project definition (`vfxPath`), placed with MCP or added by the prop's class | `autoStart: true`; pool sized for every instance |
