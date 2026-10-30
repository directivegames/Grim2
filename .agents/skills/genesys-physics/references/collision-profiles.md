# Collision profiles and channels

Source: `.engine/src/systems/collision/CollisionTypes.ts` (enums, `CollisionProfile`),
`.engine/src/systems/collision/CollisionConfig.ts` (default profiles, `getInstance`, `setup`, `getProfile`),
`.engine/src/physics/implementations/RapierPhysics.ts` (`getCollisionGroups`, query filters).

## The model

- **Channel** (`CollisionChannel`): what a body *is*. `WorldStatic`, `WorldDynamic`, `Pawn`, `Visibility`,
  `Camera`, `PhysicsBody`, `Vehicle`, `Destructible`, plus `CustomGameChannel1`–`8`. 16 channels maximum.
- **Mode** (`CollisionMode`): `NoCollision`, `QueryOnly` (a sensor: overlaps and events, no blocking),
  `PhysicsOnly`, `QueryAndPhysics`.
- **Response** (`CollisionResponse`) per other channel: `Block`, `Overlap`, `Ignore`. A profile starts with
  **Block for every channel**, then applies its listed responses.
- Two colliders interact only when **each** profile's responses accept the other's channel (Block or
  Overlap). One `Ignore` on either side is enough to pass through.
- A **query** with a profile filters the same two-way way. A query with **no profile has no channel filter**
  and hits every non-trigger collider.

## Default profiles

| Profile | Mode | Channel | Non-Block responses | Use |
|---|---|---|---|---|
| `NoCollision` | NoCollision | WorldStatic | — | Visual only |
| `BlockAll` (= `Default`) | QueryAndPhysics | WorldStatic | — | Level geometry, static props; `Projectile` with `useOverlapCheck: false` |
| `OverlapAll` | QueryOnly | WorldStatic | Overlap all eight base channels | Static sensors; `Projectile` with `useOverlapCheck: true` |
| `BlockAllDynamic` | QueryAndPhysics | WorldDynamic | — | Moving props, crates, doors |
| `OverlapAllDynamic` | QueryOnly | WorldDynamic | Overlap all except Visibility | Moving sensors |
| `IgnoreOnlyPawns` | QueryOnly | WorldDynamic | Ignore Pawn, Vehicle | Sensors pawns never trip |
| `Pawn` | QueryAndPhysics | Pawn | Ignore Visibility, Camera; Overlap Vehicle | Generic pawn body |
| `Character` | QueryAndPhysics | Pawn | Ignore Visibility, Camera, **Pawn**; Overlap Vehicle | `CharacterPawn` default. Characters do not block each other |
| `Destructible` | QueryAndPhysics | Destructible | — | Breakables |
| `InvisibleWall` | QueryAndPhysics | WorldStatic | — | Level bounds |
| `InvisibleWallDynamic` | QueryAndPhysics | WorldDynamic | — | Moving bounds |
| `Trigger` | QueryOnly | WorldDynamic | Overlap all except Visibility, Camera | `TriggerZoneNode` volumes |
| `Ragdoll` | QueryAndPhysics | PhysicsBody | Ignore Pawn | Loose physics parts that should not trip characters (there is no ragdoll system) |
| `Vehicle` | QueryAndPhysics | Vehicle | — | Vehicle chassis |
| `UI` | QueryOnly | WorldDynamic | Overlap all | World-space UI hit areas |
| `SpringArmCamera` | QueryOnly | Camera | Ignore Pawn | Camera boom probes; also a good "walls only" line-of-sight query |

## On nodes

Set the profile in `physicsOptions`; the enum or a name string both work there.

Source: .engine/src/physics/PhysicsTypes.ts (`NodePhysicsOptions.collisionProfile: DefaultCollisionProfile | string`)
```ts
physicsOptions: { enabled: true, motionType: ENGINE.PhysicsMotionType.Dynamic,
                  collisionProfile: ENGINE.DefaultCollisionProfile.BlockAllDynamic }
```

A `QueryOnly` profile makes the collider a sensor: it blocks nothing, always generates (trigger) events, and
queries skip it unless `includeTriggers: true`. A blocking body generates collide events only with
`generateCollisionEvents: true` on the primitive. Events need both sides to accept each other's channel
(Block or Overlap); `Ignore` silences them.

## On queries

Queries take a profile name, like node options, or a `CollisionProfile` object:

Source: .engine/src/physics/PhysicsEngine.ts (`PhysicsQueryOptions.collisionProfile`)
```ts
collisionProfile: ENGINE.DefaultCollisionProfile.SpringArmCamera
// or a looked-up object: ENGINE.CollisionConfig.getInstance().getProfile('Enemy')
```

An unknown name warns once and filters as the Default profile.

## Custom profiles

Register custom profiles once with `ENGINE.CollisionConfig.setup(config)` before any physics node is
created (module top level of `game.ts`). `setup` replaces the whole config, so pass everything in one call
(verify in Play that bodies created by the editor scene pick it up; `getInstance()` builds the defaults
lazily on first use).

Source: Composed — typechecked against 18.1.0-alpha.317 (`CollisionConfig.setup`, `CollisionConfigData`)
```ts
// game.ts, module top level, before any physics node exists.
const ignore = (channel: ENGINE.CollisionChannel) => ({ channel, response: ENGINE.CollisionResponse.Ignore });
ENGINE.CollisionConfig.setup({
  userProfiles: [{
    name: 'CharacterOnlyWall',          // stops pawns; shots, props and debris pass
    mode: ENGINE.CollisionMode.QueryAndPhysics,
    objectChannelName: ENGINE.CollisionChannel.WorldStatic,
    responses: [
      ignore(ENGINE.CollisionChannel.WorldStatic), ignore(ENGINE.CollisionChannel.WorldDynamic),
      ignore(ENGINE.CollisionChannel.PhysicsBody), ignore(ENGINE.CollisionChannel.Destructible),
      ignore(ENGINE.CollisionChannel.Visibility), ignore(ENGINE.CollisionChannel.Camera),
    ],
  }],
});
// On the wall node: physicsOptions: { enabled: true, collisionProfile: 'CharacterOnlyWall' }
```

A hitscan `raycast` with no profile (`InstantHitWeaponNode`) still hits that wall, because an
unfiltered query sees every collider. Give the weapon's query a profile, or override `performInstantHit`,
if shots must pass.

`CollisionConfigData` also takes:
- `customChannelConfigs: [{ channel: CollisionChannel.CustomGameChannel1, defaultResponse, name }]` — names a
  custom channel so profiles can use the name as `objectChannelName` or a response channel. The
  `defaultResponse` is stored but not applied: every existing profile still **Blocks** the new channel until
  a `profileOverrides` entry changes it.
- `profileOverrides: [{ profileName, responseCustomizations: [{ channel, response }] }]` — edits responses on
  the default profiles.

## Traps

- Two enemies walk through each other → both use `Character`, which ignores the Pawn channel → expected;
  spread them with steering offsets (`genesys-creatures`), not a profile change.
- A sensor never fires → one side `Ignore`s the other's channel (for example `IgnoreOnlyPawns` vs a pawn) →
  use `Trigger`, which overlaps every body channel.
- A custom profile behaves like `BlockAll` and the console says `Unknown collision profile "<name>"` → the name
  is not registered, so the body uses the Default profile → register it with `CollisionConfig.setup` before the
  node is created, or fix the name.
