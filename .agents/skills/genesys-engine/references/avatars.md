# Avatars

Description-driven character appearance: a look is data (`AvatarDescription`), resolved by id from an
avatar service, and composed at runtime onto an `AvatarAppearanceNode` from one or more GLTFs.

Use it when players pick a look (customisation, cosmetics, per-player skins). A character with one
fixed mesh does not need any of this — extend `CharacterPawn` and override `setupVisualNode()`.

## Minimum viable setup

```ts
@ENGINE.GameClass()
export class MyGameMode extends ENGINE.GameMode {
  public override initialize(options?: ENGINE.GameModeOptions): void {
    super.initialize({
      ...options,
      pawnFactory: async () => ENGINE.AvatarCharacterPawn.create(),
    });
  }
}
```

That is the whole thing. `AvatarCharacterPawn` is a `CharacterPawn` with `useAvatarAppearance` on, so
the spawner builds an appearance node and the pawn copies `PlayerInfo.avatarId` onto it when
possessed. `ENGINE.CharacterPawn.create({ useAvatarAppearance: true })` and
`ENGINE.GSSCharacterPawn.create({ useAvatarAppearance: true })` opt in the same way. A prefab or
scene property is applied in `postLoad`, before the replication member map freezes. Assigning
`useAvatarAppearance` after `create()` does not rebuild the visual, and `beginPlay` is too late
for `avatarId` to replicate. Set the game mode as the scene's Game Mode class in the editor
(World Settings). Which look each player gets comes from the avatar service the host installs; see
[Where looks come from](#where-looks-come-from).

Do **not** write your own avatar pawn — set the flag, or spawn `AvatarCharacterPawn`.

## Pieces

- **`ENGINE.AvatarDescription`** — resolved look: `id`, `displayName`, `bodyParts` (slot → GLTF
  path), `animConfigUrl`, `scale`, `items`, `surfaces` (resolved skins, see below),
  `animationDriver`, optional `packUrl` / `packId`.
  Build one with `ENGINE.createDefaultAvatarDescription({ ... })`. It is not a storage format: to
  keep a look, store the recipe or pack it came from.
- **`ENGINE.AvatarBodyPart`** — R15-style slots: `FullBody`, `Head`, `UpperTorso`, `LowerTorso`, and
  the limb/hand/foot slots. A mono-mesh look fills only `FullBody`.
- **`ENGINE.IAvatarService`** — read-only: `getAvatarDescription(id)`,
  `getDefaultAvatarDescription()`, `listAvatarDescriptions()`, and `loadAvatarDescription(id)`. The
  `get*` methods only read the catalogue; `loadAvatarDescription` also downloads the look's packs
  (`ENGINE.ensureAvatarPackLoaded(desc)`) and is what composition calls. Read the current service
  with `ENGINE.getAvatarService()`; install your own with `ENGINE.setAvatarService(new MyService())`.
- **`ENGINE.MockAvatarService`** — an in-memory service. Without options it holds the `avatar-base`
  look, whose packs are not in the published engine package; pass `presets` to hold your own looks.
- **`ENGINE.AvatarAppearanceNode`** — owns the composed visual.
  `applyAvatarDescription(desc)` (re)builds it; `getAppliedAvatarDescription()` returns what is
  actually on screen (null if composition failed).
- **`ENGINE.AvatarCharacterPawn`** — `CharacterPawn` with `useAvatarAppearance` already true. The
  stock mannequin shows until a look with body parts composes. `getAppearance()` returns the
  component. `defaultAvatarId` is the look used when `PlayerInfo.avatarId` is empty.
- **`ENGINE.createCharacterAvatarAppearance()`** — the same posed component, for pawns with another
  base class.

## Where looks come from

| Where the game runs | Avatar service | Default look |
| --- | --- | --- |
| Play in the Genesys editor | The editor's account-backed service | `avatar-base`, with its outfits and accessories |
| Anywhere else | `ENGINE.createStockAvatarService()` | The stock mannequin (`ENGINE.STOCK_AVATAR_ID`) |

The stock mannequin ships with the engine, so it renders wherever the game runs. A game that runs
outside the editor and wants real looks installs its own service at startup with
`ENGINE.setAvatarService(...)`.

## Choosing a look per player

The engine reads `PlayerInfo.avatarId` (a replicated string — never put the whole description there
or on `JoinParams`). The id must name one immutable look: a changed look gets a new id, never new
content under the old one, because every peer resolves the id on its own and skips an id it already
composed. Stamp it in `handleNewPlayer`, which runs before the pawn spawns, so the first compose
already uses the right look:

```ts
public override async handleNewPlayer(controller: ENGINE.PlayerController): Promise<void> {
  const info = controller.getPlayerInfo();
  if (info) {
    info.avatarId = mySavedAvatarIdFor(controller);
  }
  await super.handleNewPlayer(controller);
}
```

Resolution order: the id on the appearance node (`PlayerInfo.avatarId`, else the pawn's
`defaultAvatarId`, else the service-default sentinel) → the service's default avatar → the pawn's
`defaultAvatarId` → the stock mannequin. Each step is a fallback for
the one before, tried when that look is missing, incompatible, or fails to compose.

A client can also request a look in the join handshake as `JoinParams.avatarId`. The server puts it
through `GameMode.resolveJoinAvatarId`, which by default only accepts ids the avatar service already
knows — handshake input is unauthenticated, and the id selects content packs. Override it to source
the look from your own profile service, returning the id of the account's current look rather than
the account id itself:

```ts
public override async resolveJoinAvatarId(
  clientId: ENGINE.ClientId,
  joinParams: ENGINE.JoinParams,
): Promise<string> {
  return (await myProfileService.lookFor(joinParams.accountToken)) ?? '';
}
```

Return an empty string to leave the current value alone; a reconnecting player then keeps the look
their preserved `PlayerInfo` already holds.

To change the look at runtime, call `ENGINE.assignPlayerAvatar`. It stores the id on `PlayerInfo`
(so rejoin and the next spawn keep it) and on the pawn's `AvatarAppearanceNode`, which is the
replicated value clients compose. Server only:

```ts
const result = await ENGINE.assignPlayerAvatar(controller, newAvatarId);
```

It resolves to `'applied'`, `'skipped'` (a client, a peer that does not render, or no
`AvatarAppearanceNode`), `'superseded'` (a later call for the same pawn took over), or `'failed'`
(no candidate composed). Only `'failed'` is worth retrying.

The pawn never stores an empty id. A player with no look gets the pawn's `defaultAvatarId`, or
`ENGINE.AVATAR_ID_SERVICE_DEFAULT` (`'@default'`, meaning the service's default). Do not send
`'@default'` in `JoinParams.avatarId`; the server rejects it.

## Avatar on a different pawn base

A pawn with no `AvatarAppearanceNode` is left alone. `CharacterPawn` and `GSSCharacterPawn` build
one when `useAvatarAppearance` is true, and keep the stock mannequin visible until a look composes.
To give avatars to some other base, replace the visual:

```ts
protected override setupVisualNode(): ENGINE.SceneNode | null {
  const appearance = ENGINE.createCharacterAvatarAppearance();
  this.add(appearance);
  return appearance;
}
```

The helper carries the capsule-relative offset and yaw the mannequin uses; hardcoding your own tends
to leave the avatar floating or facing backwards.

## Animation

`AvatarDescription.animConfigUrl` decides the animation set. The spawn hook binds the pawn's
`AnimationStateMachineNode` to the composed skeleton for you. If you compose by hand, do the
bind too — the state machine auto-discovers a mesh at `beginPlay`, before the avatar exists, so it
finds nothing:

```ts
await ENGINE.bindAnimationToComposedHost(
  asm,
  appearance.getComposedHandle(),
  desc.animConfigUrl,
  desc.animationClipSources,
);
```

Or call `ENGINE.applyAvatarToPawn(pawn, desc)`, which composes and binds in one step.

Parameter contract: stock pawns declare `character-locomotion@1` via `getAvatarAnimationDriverId()`.
Every look sets `animationDriver` to the same id. Drivers are compiled into the client
(`registerAvatarAnimationDriver`) — never shipped as JS inside the pack. Ids are versioned
(`name@version`) and never replaced: registering a taken id throws, so a changed parameter set is
a new version. A pawn that returns `null` (the `Pawn` default) gets no look at all.

## Packs

One **GAVPK** pack per look: an unencrypted binary (magic, version, then an offset index and
payloads, with `manifest.json` first), loaded into memory and served through `@avatarpack:{packId}/...` refs. An
avatar service returns each look's `packUrl`; the pack bytes are all a client needs, with no
separate key.

Pack kinds: `avatar-look` (which mesh fills each body slot, plus animconfig and optional pack-local
clips / embedded items), `avatar-parts` (body meshes only, shared across looks), `avatar-animation`
(clips only, gated on the rigs they were authored for), `avatar-skin` (materials only — shirts and
other 2D clothing), and `avatar-item` (accessory or future geometric clothing only). A look can omit
pack-local clips and keep shared `@engine` animation sources. Item refs on a description may point
at a separate item pack via `packUrl` / `packId` / `itemId`.

A look slot can hold a mesh embedded in the look pack, or reference one in an `avatar-parts`
dependency — embed for a bespoke one-off avatar, reference for a body many looks share. The look
declares that dependency, and each referenced slot stores an explicit `partId`, so it stays pinned
to the exact meshes it was built with. A parts pack may ship several variants for one slot; the look
names the variant it uses.

### Shirts and other 2D clothing (skins)

A shirt is a texture on the body already loaded, not new geometry, so it ships as a material swap
rather than an item. The mesh pack declares a named **surface** (which GLB materials it covers, and
the `uvLayout` id they are unwrapped as), a skin pack ships materials for that surface per layout,
and a look pins one skin on that surface.

Surface names are lowercase and join across packs, so one pin dresses every part declaring it —
a mono-mesh `FullBody` look and a fifteen-part body take the same pin. `uvLayout` is the
compatibility gate and has no fallback: a skin that does not cover every layout the surface
resolves to fails at pack time and is skipped with a warning at runtime. Textures referenced from
a `.material.json` are embedded into the skin pack and their URLs rewritten; prefer KTX2.

Compat is fail-closed. If a look declares a driver this build/pawn cannot run, apply falls back to the service default, then optional `defaultAvatarId`, then the stock
mannequin.

## Limits

- **Meshes are never replicated — only the id is.** The server writes `AvatarAppearanceNode.avatarId`
  on the pawn. Each peer resolves that id through its own `IAvatarService` and composes in
  `onRepAvatarId` when the pawn's channel establishes or the id changes. `PlayerInfo.avatarId` is
  still replicated, for scoreboards and rejoin, and does not compose the mesh. Two consequences: a
  peer whose service disagrees renders a different look, and a player keeps the stock mannequin
  until their packs finish loading.
- **Remote players need spawner-based spawning.** A peer only composes onto pawns it actually has,
  and dynamic roots added with `world.add` do not materialize on clients. Spawn players through a
  `MultiplayerSpawner` (see the `genesys-multiplayer` skill) or remote players will not appear at
  all — with or without avatars.
- **No editor UI.** The pawn flag is code or a prefab property; there is no avatar picker in the editor.
- Headless/dedicated servers skip composition entirely.
- Composition never throws: incompatible or broken looks walk the fallback list (service default,
  then the pawn's `defaultAvatarId`, then the stock mannequin), with a warning when the mannequin is what ends
  up on screen.
