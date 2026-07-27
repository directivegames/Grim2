# Hit Detection Pattern

## Per-frame hit check inside onSwingProgress

The combo calls `onSwingProgress` every frame. Your hit detection code goes there. Use a radius sphere around the blade tip position.

```ts
onSwingProgress(comboIndex, orbitAngle, progress) {
  player.rootComponent.getWorldPosition(playerPos);

  const tipX = playerPos.x + Math.cos(orbitAngle) * (HANDLE_OFFSET + BLADE_REACH);
  const tipZ = playerPos.z + Math.sin(orbitAngle) * (HANDLE_OFFSET + BLADE_REACH);
  tipPos.set(tipX, playerPos.y + WEAPON_HEIGHT, tipZ);

  for (const enemy of spatialQuery(tipPos, HIT_RADIUS)) {
    if (!this._hitThisSwing.has(enemy)) {
      this._hitThisSwing.add(enemy);
      enemy.takeDamage(damage);
    }
  }
},
```

## Per-swing hit set

Track which enemies were hit this swing to avoid multi-hitting a single enemy per arc:

```ts
private _hitThisSwing = new Set<ENGINE.Actor>();

onSwingStart() {
  this._hitThisSwing.clear();
},
```

## Per-enemy cooldown map

For longer swings (combo index 2 — full 360°), a simple Set is not enough because the arc passes the same enemy twice. Use a cooldown timestamp map instead:

```ts
private _hitCooldowns = new Map<ENGINE.Actor, number>();

// Inside onSwingProgress:
const now = world.getGameTime();
const last = this._hitCooldowns.get(enemy) ?? -Infinity;
if (now - last > HIT_COOLDOWN) {
  this._hitCooldowns.set(enemy, now);
  enemy.takeDamage(damage);
}

// Clean up stale entries in a cleanup pass each frame:
for (const [actor, time] of this._hitCooldowns) {
  if (now - time > HIT_COOLDOWN * 2) {
    this._hitCooldowns.delete(actor);
  }
}
```

A `HIT_COOLDOWN` of 0.4 seconds prevents the full-circle from double-hitting the same enemy on a single pass.

## Spatial query

The combo does not provide a spatial query — wire your own. A common pattern is a spatial hash updated each frame with all live enemy positions:

```ts
function spatialQuery(center: THREE.Vector3, radius: number): Enemy[] {
  return allEnemies.filter(e => {
    const dx = e.position.x - center.x;
    const dz = e.position.z - center.z;
    return dx * dx + dz * dz <= radius * radius;
  });
}
```

For large enemy counts (50+), use a grid-based spatial hash (see the `crowd-enemy-steering` skill for a similar pattern).
