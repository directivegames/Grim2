# High-volume projectiles

## Where `Projectile` stops

Each `Projectile` is a scene root with a dynamic physics body (CCD on), a child `MeshNode` with its own draw call, collision events, and per-tick range checks. It is created on fire and destroyed on hit or expiry. The engine ships no node pool, and `Projectile` sets its velocity only in `beginPlay`, so it is not built to be recycled.

That is fine for shooters, twin-sticks, and tower defense, where tens and up to a few hundred are live. It is the wrong tool for a bullet hell with hundreds to thousands of live bullets.

Starting threshold: stay on `Projectile` while the live count stays under about **150**. Switch to the instanced field when the design needs more, or when the profiler (`genesys-profiler`) shows physics or draw cost growing with bullet count. The 150 figure is a starting point, not a measured engine limit. Confirm it with a capture on the target device.

Do not write a `Projectile` pool. Recycling physics roots fights the engine (velocity is set once, owner ignore pairs are set once, lifespan is a countdown to `destroy`). If volume is the problem, change lanes.

## Caps on the `Projectile` lane

- Lifetime: always set `range` (distance) and `projectileLifespan` (seconds).
- Rate: `fireInterval` on the weapon is the cap per shooter. For enemies, the `ShootAction` `shootCooldown` (default 1.5 s) is the cap.
- Count: track live projectiles per shooter with `onProjectileFired` and the projectile's destroy. Skip firing at the cap (`canFire()` override).
- Size: radius 0.05–0.2. The default sphere is radius 0.5, which reads as a cannonball.

## The instanced bullet field

One `InstancedMeshNode` draws every bullet in one call. Bullet state lives in plain arrays. Movement and hit tests run in one `tickPrePhysics`. Instance slots are the "pool". `removeInstance` swaps the last instance into the freed slot, so mirror that swap in your array.

Source: .engine/src/nodes/visual/InstancedMeshNode.ts, BaseInstancedMeshNode.ts (`addInstance`, `updateInstance`, `removeInstance`)
```ts
@ENGINE.GameClass()
export class BulletField extends ENGINE.SceneNode {
  public maxBullets = 800;          // hard cap
  public lifetime = 4;              // seconds
  private mesh!: ENGINE.InstancedMeshNode;
  private bullets: { pos: THREE.Vector3; vel: THREE.Vector3; age: number }[] = [];

  public override beginPlay(): boolean {
    if (!super.beginPlay()) return false;
    this.mesh = ENGINE.InstancedMeshNode.create({
      geometry: new THREE.SphereGeometry(0.15),
      material: new THREE.MeshBasicMaterial({ color: 0xff4060 }),
      maxInstances: this.maxBullets, isWorldSpace: true,
      physicsOptions: { enabled: false },
    });
    this.add(this.mesh);
    return true;
  }

  public spawn(pos: THREE.Vector3, vel: THREE.Vector3): void {
    if (this.bullets.length >= this.maxBullets) return;
    this.bullets.push({ pos: pos.clone(), vel: vel.clone(), age: 0 });
    this.mesh.addInstance({ position: pos }, true);
  }

  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      b.age += dt;
      b.pos.addScaledVector(b.vel, dt);
      if (b.age > this.lifetime || this.hitsSomething(b)) { this.removeAt(i); continue; }
      this.mesh.updateInstance(i, { position: b.pos }, true);
    }
  }

  private removeAt(i: number): void {
    this.mesh.removeInstance(i);                         // engine swaps last → i
    this.bullets[i] = this.bullets[this.bullets.length - 1];
    this.bullets.pop();
  }

  private hitsSomething(_b: { pos: THREE.Vector3 }): boolean { return false; } // see below
}
```

Notes:
- `setInstanceTransforms` replaces every instance and logs to the console on each call. Use `addInstance`, `updateInstance`, `updateInstances`, and `removeInstance` per frame.
- `addInstance` returns `-1` and warns once the buffer is full. The `maxBullets` check above prevents that.
- Keep enemy bullets and player bullets in two fields. They test against different targets.
- Use an unlit, emissive, or additive material so bullets read against any background. Size and color contrast matter more than polygon count (`genesys-game-feel`).

## Hit tests in the field

- **Enemy bullets vs the player** (one target): a radius test against the player's hitbox center is correct here. Use a hitbox radius at 30–50% of the visual so grazes feel fair. Then call the player's `takeDamage`; i-frames absorb the rest.
- **Player bullets vs enemies** (few targets): test against each live enemy's radius from the GameMode's enemy list. With more than about 30 targets, or targets with odd shapes, use `physics.raycast` from the previous to the new position (`maxDistance` = step length) and damage `hit.hitNode?.getRoot()`.
- **Walls**: a bullet field in an open arena can skip wall tests and expire by lifetime or bounds. In a walled level, use the raycast segment test.

## Patterns

Shot patterns are spawn calls on a timer: a ring (N bullets at `2π·k/N`), a spread (±15–30° fan), a spiral (ring offset by a rotating angle each volley), or an aimed burst (direction to the player plus small jitter). Drive volleys from `world.timerSystem.setInterval` or a tick accumulator on game time so pause stops them. Telegraph each volley 0.3–0.6 s before it fires (flash, sound, wind-up).
