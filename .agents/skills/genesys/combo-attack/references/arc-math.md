# Arc Math Reference

## Coordinate systems

The combo uses two angle systems and it is important not to mix them.

World aim angle (`aimAngle`): measured from the +Z axis, clockwise. `atan2(dx, dz)` where `dx`/`dz` are from the player to the target. This is what the mouse cursor or player facing yaw produces.

Orbit angle: used internally for weapon positioning. `cos(angle)` maps to the +X axis, `sin(angle)` maps to the +Z axis. Angle 0 = weapon is to the right of the player (+X).

Conversion:
```
orbitCenter = π/2 - aimAngle
```

At `aimAngle = 0` (aiming +Z, forward), `orbitCenter = π/2` (weapon starts to the right).

## Weapon positioning from orbit angle

Given an orbit angle, the handle position around the player is:

```ts
const handleX = playerPos.x + Math.cos(orbitAngle) * HANDLE_OFFSET;
const handleZ = playerPos.z + Math.sin(orbitAngle) * HANDLE_OFFSET;
const handleY = playerPos.y + WEAPON_HEIGHT;
```

The blade tip extends further:

```ts
const tipX = playerPos.x + Math.cos(orbitAngle) * (HANDLE_OFFSET + BLADE_REACH);
const tipZ = playerPos.z + Math.sin(orbitAngle) * (HANDLE_OFFSET + BLADE_REACH);
```

## Arc definitions per combo index

```
Index 0 (right → left):  startAngle = orbitCenter + π/2,  endAngle = orbitCenter - π/2
Index 1 (left → right):  startAngle = orbitCenter - π/2,  endAngle = orbitCenter + π/2
Index 2 (full 360°):     startAngle = currentAngle,        endAngle = currentAngle + 2π
```

## Weapon rotation from orbit angle

To face the blade along the arc tangent, rotate the weapon mesh around the Y axis. The `BLADE_ANGLE_OFFSET` (π/2) aligns the blade's local forward axis with the tangent:

```ts
weaponQuaternion.setFromAxisAngle(Y_AXIS, -orbitAngle + BLADE_ANGLE_OFFSET);
// premultiply by the weapon's base quaternion from its scene placement
weaponQuaternion.premultiply(baseQuat);
```

## Pitch during swing

For a sense of inertia, apply a small forward pitch at the midpoint of the swing:

```ts
const bladePitch = Math.sin(progress * Math.PI) * BLADE_PITCH_MAX; // e.g. BLADE_PITCH_MAX = 0.28 rad
pitchQuat.setFromAxisAngle(PITCH_AXIS, bladePitch);
weaponQuaternion.multiply(pitchQuat);
```

The pitch peaks at 50% swing progress and returns to zero at 0% and 100%.
