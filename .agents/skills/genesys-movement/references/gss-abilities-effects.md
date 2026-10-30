# GSS abilities, effects, tags and events

Owner for custom GSS abilities, effects and tags, game code talking to a sim (events, external tags), and respawn/teleport on a GSS pawn. Registration rules and the tick order are in [gss-mechanics](gss-mechanics.md).

## The split

| Piece | Decides | Lives | Writes through |
|---|---|---|---|
| `IGSSAbility` | **When**: reads input tags, sim/external tags and this tick's events in `shouldRun` | Registered once in `createGSSNode()` | `GSSAbilityContext` |
| `IGSSEffect` | **What**, for `durationMs`: attributes, movement proposal, tags | Slots in Sync (replicated, replayed) | `GSSEffectContext` |
| Movement mode | **How the body moves** | Registered once | `GSSMovementSimContext` |
| Tag | A flag: input (`input.*`), status (`gameplay.*`), attribute key (`attribute.*`) | `GSSTagRegistry` (process-wide) | `ctx.tags`, `addExternalTagId` |

`durationMs`: `null` = until removed (`ctx.end()` in the effect, or `ctx.effects.remove(handle)` from an ability); `0` = this tick only; `> 0` = timed. Every effect callback is optional: `onApplied`, `modifyAttributes(attrs, payload?)`, `onTick(ctx, dt)`, `proposeMove(ctx)`, `onRemoved`.

| Context | What it offers |
|---|---|
| `GSSAbilityContext` | `effects.apply(id, payload?)` → handle, `effects.remove(handle)`, `world.applyEffect(target, id, payload?)` / `world.removeEffect`, `world.raycast` / `sweepShape` / `overlapShape` / `beginQueries` (prediction-aware), `cooldown.start(ms)`, `cues.trigger(id, payload?)`, `movement.queueMovementMode(id, priority?)`, `events`, `attributes`, `tags`, `custom`, pose getters, `end()`, `getOwner()` |
| `GSSEffectContext` | `teleport(position, rotation)`, `end()`, `elapsed`, `duration`, `handle`, `getPayload<T>()`, `movement.queueMovementMode`, `attributes`, `tags`, `custom`, pose getters, `getOwner()` |

`GSSNode.applyEffect(handle, id, payload)` and `applyEffectToTarget` are `@internal`; game code goes through the contexts.

## The shape, using a stick-direction dash

The engine dash (`GSSDashEffect`) pushes along `ctx.getYaw()`, the control yaw. In a top-down game that yaw never changes, so every dash goes screen-up. This pair keeps the engine ids, so registering it replaces the stock dash in place, and dashes where the stick points (facing when the stick is idle).

Source: .engine/src/gameplay-sim/abilities/GSSDashAbility.ts, effects/GSSDashEffect.ts, GSSData.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
const DASH_DIR = 'dash.dir'; // custom-data key: written by the ability, read by the effect

/** Ability: decides WHEN. Same shape as GSSDashAbility. */
export class StickDashAbility implements ENGINE.IGSSAbility {
  public readonly id = 'ability.Dash';
  public cooldownTime = 600; // ms
  public shouldRun(_down: ENGINE.GSSTagSetView, pressed: ENGINE.GSSTagSetView): boolean {
    return pressed.has(ENGINE.GSSTags.InputDash); // press edge, derived by the sim
  }
  public execute(ctx: ENGINE.GSSAbilityContext, input: ENGINE.GSSInputCmd): void {
    const dir = new THREE.Vector3(input.moveInput.x, 0, input.moveInput.z); // world space, camera-relative
    if (dir.lengthSq() < 0.01) dir.set(-Math.sin(ctx.getYaw()), 0, -Math.cos(ctx.getYaw())); // no stick: facing
    ENGINE.gssSetVector3(ctx.custom, DASH_DIR, dir.normalize());
    ctx.effects.apply('effect.Dash');
    ctx.cooldown.start(this.cooldownTime);
    ctx.end(); // one-shot
  }
}

/** Effect: decides WHAT, for durationMs. Same shape as GSSDashEffect. */
export class StickDashEffect implements ENGINE.IGSSEffect {
  public readonly id = 'effect.Dash';
  public readonly durationMs = 180; // null = until removed, 0 = this tick only
  public speed = 18;
  public onApplied(ctx: ENGINE.GSSEffectContext): void { ctx.tags.add(ENGINE.GSSTags.StatusDashing); }
  public proposeMove(ctx: ENGINE.GSSEffectContext): ENGINE.GSSProposedMove {
    const dir = ENGINE.gssGetVector3(ctx.custom, DASH_DIR);
    return { velocity: dir.multiplyScalar(this.speed), mixMode: ENGINE.GSSMoveMixMode.Override, mixY: ENGINE.GSSMoveMixMode.Ignore };
  }
  public onRemoved(ctx: ENGINE.GSSEffectContext): void { ctx.tags.remove(ENGINE.GSSTags.StatusDashing); }
}

@ENGINE.GameClass()
export class Hero extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addAbility(new StickDashAbility()); // same ids → replaces the engine dash, keeps its index
    sim.addEffect(new StickDashEffect());
    return sim;
  }
}
```

Rules the shape encodes:
- `shouldRun(inputTags, newInputTags, removedInputTags, otherTags, events)` gets the currently-down tags, the press and release edges, sim + external tags, and this tick's events. Use the press edge for one-shots so a held key does not retrigger.
- `onActivate` (optional, return `false` to refuse) runs once when an inactive ability starts and its cooldown has passed; `execute(ctx, input, dt)` runs every tick it stays active; `ctx.end()` deactivates it (`onDeactivate` follows).
- The ability writes data the effect needs into `ctx.custom` (Sync, so replay sees it). Newly applied effects run `onApplied` later the same tick, then propose movement.
- `GSSMoveMixMode`: `Override` replaces the mode's seed velocity on that axis, `Additive` adds to it, `Ignore` leaves it. Walking and falling seed Y with the current vertical speed, or `jumpSpeed` on a jump, then mix every axis. `mixY: Ignore` leaves that jump and the later gravity step alone; the stock dash does this.
- Show a cooldown on a widget (`genesys-ui`); a hidden cooldown reads as a dead button.

## Custom tags and a new button

Tags are process-wide dense ids, assigned in registration order, so every peer must register the same names in the same order. Register at module load (same bundle, same order everywhere); `register` returns the existing id for a known name. The engine registers `input.Jump`, `input.Dash`, `input.Fire`, `gameplay.Grounded`, `gameplay.Falling`, `gameplay.StatusDashing`, `attribute.MoveSpeed`, `attribute.Health`, `attribute.Mana`, `attribute.Ammo` (`ENGINE.GSSTags.*`).

Source: .engine/src/gameplay-sim/GSSTagRegistry.ts, entities/GSSPlayerController.ts (`produceInputCmd`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export const INPUT_SPRINT = ENGINE.GSSTagRegistry.register('input.Sprint');

@ENGINE.GameClass()
export class SprintController extends ENGINE.GSSPlayerController {
  private sprintHeld = false;
  public override handleKeyDown(e: KeyboardEvent): boolean {
    if (e.code === 'KeyC') { this.sprintHeld = true; return true; }
    return super.handleKeyDown(e);
  }
  public override handleKeyUp(e: KeyboardEvent): boolean {
    if (e.code === 'KeyC') { this.sprintHeld = false; return true; }
    return super.handleKeyUp(e);
  }
  public override produceInputCmd(cmd: ENGINE.GSSInputCmd, dt: number): void {
    super.produceInputCmd(cmd, dt);
    if (this.sprintHeld) ENGINE.tagSetAdd(cmd.inputTagsDown, INPUT_SPRINT); // currently-down only
  }
}
```

Then an ability whose `shouldRun` returns `inputTags.has(INPUT_SPRINT)` applies a `durationMs: null` effect on activate and removes it on deactivate; the effect's `modifyAttributes(attrs)` scales `ENGINE.GSSTags.MoveSpeed`. Shift is already Dash on `GSSPlayerController`; pick a free key. Touch buttons set the same held flag (`genesys-touch-controls`).

## Game code → sim: events and external tags

| Need | Call | Lifetime |
|---|---|---|
| One-shot ("respawn", "knockback", "pickup boost") | `sim.queueEvent(id, payload?)` → abilities see `events.has(id)` / `events.get<T>(id)` next tick | One tick; never Sync, never replicated; ignored on simulated proxies; up to 16 queued |
| A state the world holds ("in water", "on ice", "stunned zone") | `sim.addExternalTagId(tagId)` / `removeExternalTagId(tagId)` (or the `*ExternalTag(name)` forms) | Until removed; modes, transitions and abilities see it in `ctx.tags` / `otherTags` |

An event payload is a plain object implementing `ENGINE.GSSEventPayload` (`clone()`). An effect payload is different: `GSSEffectPayload` is an abstract replicated net class; prefer passing data through `ctx.custom` as below.

## Respawn, checkpoint, teleport

Writing the transform of a sim-driven pawn snaps back. `GSSEffectContext.teleport(position, rotation)` warps the simulation, zeroes velocity, and the active mode gets `onTeleported` instead of `tick` (walking and falling reset the jump count). Route game code to it: event → ability → instant effect.

Source: .engine/src/gameplay-sim/GSSNode.ts (`queueEvent`, `teleportInternal`), GSSEffectContext.ts (`teleport`), GSSEvent.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
/** Event payload: plain data with clone(). */
export class RespawnEvent implements ENGINE.GSSEventPayload {
  constructor(public readonly position: THREE.Vector3, public readonly yaw = 0) {}
  public clone(): RespawnEvent { return new RespawnEvent(this.position.clone(), this.yaw); }
}

export class RespawnAbility implements ENGINE.IGSSAbility {
  public readonly id = 'ability.Respawn';
  public shouldRun(_d: ENGINE.GSSTagSetView, _p: ENGINE.GSSTagSetView, _r: ENGINE.GSSTagSetView,
    _o: ENGINE.GSSTagSetView, events: ENGINE.GSSEventView): boolean {
    return events.has('respawn');
  }
  public execute(ctx: ENGINE.GSSAbilityContext): void {
    const e = ctx.events.get<RespawnEvent>('respawn');
    if (e) {
      ENGINE.gssSetVector3(ctx.custom, 'respawn.pos', e.position);
      ENGINE.gssSetFloat(ctx.custom, 'respawn.yaw', e.yaw);
      ctx.effects.apply('effect.Respawn');
    }
    ctx.end();
  }
}

export class RespawnEffect implements ENGINE.IGSSEffect {
  public readonly id = 'effect.Respawn';
  public readonly durationMs = 0; // instant
  public onApplied(ctx: ENGINE.GSSEffectContext): void {
    const yaw = ENGINE.gssGetFloat(ctx.custom, 'respawn.yaw');
    ctx.teleport(ENGINE.gssGetVector3(ctx.custom, 'respawn.pos'), new THREE.Euler(0, yaw, 0, 'YXZ')); // zeroes velocity
  }
}

@ENGINE.GameClass()
export class Runner extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addAbility(new RespawnAbility());
    sim.addEffect(new RespawnEffect());
    return sim;
  }
  /** Call from a kill zone, checkpoint, or Retry. */
  public respawnAt(point: THREE.Vector3, yaw = 0): void {
    this.getController()?.setControlRotation(new THREE.Euler(0, yaw, 0, 'YXZ')); // walking re-reads yaw from here
    this.getGSSNode().queueEvent('respawn', new RespawnEvent(point, yaw));
  }
}
```

The kill-zone and checkpoint triggers that call `respawnAt` belong to `genesys-interactions`; the Retry flow belongs to `genesys-game-boot`. Spawn the point 0.1–0.5 m above the floor so the capsule does not start inside it. `GSSWalkingMode` sets the root yaw from `controlRotation.y` every tick, so `respawnAt` also sets the controller's control rotation; without that the teleport yaw is lost on the next tick. In an online game, queue the event on the server; the owner receives a correction (verify in Play with two clients). Classic pawns need none of this: `pawn.setWorldPosition(p)` goes through `MovementPawn.setWorldTransform` → `movementNode.setPawnWorldTransform`, which also teleports the physics body.
