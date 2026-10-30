# Combat defaults by genre

The short version is in [SKILL.md → Decide](../SKILL.md#decide). Use these when the user did not say.

| Genre | Player attack | Hit detection | Receiver | Death / fail |
|---|---|---|---|---|
| Shooter (FPS / TPS) | `InstantHitWeaponNode` for rifles, `ProjectileWeaponNode` for slow or visible shots; weapon parented to the pawn camera | Hitscan: `raycast` from the camera (built in). Projectile: physics collision events (built in) | `CharacterStatsNode` on every damageable root | Enemy: `EnemyHealth` death beat, then remove. Player: result screen |
| Melee brawler | Code-driven swing: `overlapShape` sphere in front of the attacker during 80–150 ms active frames | One overlap query per swing; dedupe roots per swing | `CharacterStatsNode` subclass with 0.3–0.5 s i-frames | Knockdown reaction, then remove |
| Platformer stomp | Overlap box under the feet while falling | `overlapShape` per tick when vertical velocity < 0 | `CharacterStatsNode` (1 HP enemies) | Enemy squash and remove; player loses a life and respawns |
| Tower defense | Tower root with a weapon node; call `tryFireAtTarget(enemyPos)` | Target pick: closest enemy in range (`overlapShape` sphere or the GameMode's enemy list). Hit: hitscan or projectile | `CharacterStatsNode` on creeps; base HP in the GameMode | Creep reaching the goal (`TriggerZoneNode`) costs base HP; 0 ends the run |
| Top-down twin-stick | `ProjectileWeaponNode` on the pawn; `tryFireAtTarget(aimPoint)` each tick while fire is held | Projectile collision events; switch to the instanced lane past roughly 150 live bullets | `CharacterStatsNode` subclass with 0.5–1.0 s i-frames | Lives or one HP bar; 0 opens the result |
| Bullet hell / shmup | Instanced bullet field (see `references/high-volume-projectiles.md`) | Segment or radius test against the few hittable targets | Player hitbox radius 30–50% of the visual | One hit costs a life; 1–2 s i-frames with blink |
