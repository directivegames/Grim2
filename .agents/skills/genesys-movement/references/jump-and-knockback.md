# Jump feel, knockback and launch

Owner for variable jump height, jump buffer, fast fall, coyote time, knockback and launch pads on both stacks. Other skills point here.

## Jump numbers

Gravity is `physicsEngine.getOptions().gravity.y` (−9.81) × `simulatedGravityScale` (5 in the default character-controller options) = −49.05 m/s². Both stacks add gravity before moving (semi-implicit), so the real apex is about `jumpSpeed × dt / 2` lower than the formula (0.1 m at 60 fps for 12 m/s).

| Quantity | Formula | Default (`jumpSpeed` 12) |
|---|---|---|
| Apex | jumpSpeed² / 98.1 | 1.47 m (≈ 1.4 m at 60 fps) |
| Time to apex | jumpSpeed / 49.05 | 0.24 s |
| Airtime, flat ground | jumpSpeed / 24.5 | 0.49 s |
| Speed for a wanted apex | √(98.1 × apex) | 1 m → 9.9, 1.5 m → 12.1, 2 m → 14.0, 3 m → 17.2 |

Classic only: `jump(strength)` sets `verticalVelocity = jumpSpeed × strength × jumpStrengthModifier`. `jumpStrengthModifier` (on `BasePawnMovementNode`, default 1) suits jump pads and power-ups; apex scales with the square (1.5 → 2.25× height). GSS has no modifier; change the mode's `jumpSpeed`, or launch with an effect (below).

Typical platformer: apex 1.5–2.5 m, `maxMidAirJumps` 1, air acceleration lambda 8–12, jump cut 0.4, coyote 100–120 ms, buffer 100–150 ms, fall gravity ×1.5–1.8.

## Classic stack: `PlatformerMovementNode`

`BasePawnMovementNode.stopJump()` is empty and `CharacterMovementNode` does not override it, so releasing Space changes nothing until you add it. `DefaultPlayerController` already calls `jump()` on press and `stopJump()` on release (keyboard Space, gamepad face-bottom, and through `setJumpEdges` on a predicted client). Coyote time exists (`getGrounded()` stays true `coyoteTimeMs` after leaving the ground).

Source: .engine/src/nodes/movement/CharacterMovementNode.ts, BasePawnMovementNode.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
/** Platformer jump on the classic stack: variable height, buffer, fast fall, longer coyote. */
@ENGINE.GameClass()
export class PlatformerMovementNode extends ENGINE.CharacterMovementNode {
  public jumpCut = 0.4;        // release while rising: keep 40 % of jumpSpeed
  public bufferSeconds = 0.12; // a press this early before landing still jumps
  public fallGravity = 1.6;    // gravity multiplier while falling
  protected override coyoteTimeMs = 120;
  private bufferLeft = 0;

  public override jump(strength = 1): void {
    if (!this.canJump()) { this.bufferLeft = this.bufferSeconds; return; }
    this.bufferLeft = 0;
    super.jump(strength);
  }
  public override stopJump(): void { // the base class leaves this empty
    const cap = this.jumpSpeed * this.jumpStrengthModifier * this.jumpCut;
    if (this.verticalVelocity > cap) this.verticalVelocity = cap;
  }
  protected override performMovementStep(dt: number, immediateBodySync = false): void {
    if (this.verticalVelocity < 0 && this.characterControllerOptions) {
      const g = this.getPhysicsEngine()?.getOptions()?.gravity.y ?? -9.81;
      this.verticalVelocity += g * this.characterControllerOptions.simulatedGravityScale * (this.fallGravity - 1) * Math.min(dt, 0.2);
    }
    super.performMovementStep(dt, immediateBodySync);
    if (this.bufferLeft > 0 && this.isGrounded) { this.bufferLeft = 0; super.jump(); } // landed in the window
    else this.bufferLeft = Math.max(0, this.bufferLeft - dt);
  }
}

@ENGINE.GameClass()
export class PlatformerHero extends ENGINE.DefaultCharacterPawn {
  protected override createMovementNode(): ENGINE.BasePawnMovementNode {
    return PlatformerMovementNode.create({ name: 'MovementNode', jumpSpeed: 16, maxMidAirJumps: 1,
      midAirAccelerationLambda: 10, midAirDecelerationLambda: 4 });
  }
}
```

For a side-scroller, extend `DirectionalCharacterMovementNode` the same way. Feel numbers are tuned by eye: verify in Play.

## GSS stack: feel modes

GSS derives the jump edge from input tags; there is no coyote field and no `stopJump`. Subclass the two character modes and re-register them under the same ids. All state lives in custom data so correction replay reproduces it. The stock modes already mix an effect's Y onto the jump or the current vertical speed inside `generateMove`, so a launch works without these subclasses. The pair only remembers a launch so the variable-height cut leaves it alone. `tick` reads `move.velocity.y` and then adds gravity; it does not read `ctx.getVelocityY()` for that speed, so a feel change belongs on the desired move before `super.tick`.

Source: .engine/src/gameplay-sim/modes/GSSWalkingMode.ts, GSSFallingMode.ts, GSSMoveMix.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
const AIR = 'feel.air', JUMPED = 'feel.jumped', BUFFER = 'feel.buffer', LAUNCHED = 'feel.launched';
const JUMP = ENGINE.GSSTags.InputJump;
export const FEEL = { coyote: 0.1, buffer: 0.12, cut: 0.4, fallGravity: 1.6 };

export class FeelWalkingMode extends ENGINE.GSSWalkingMode {
  public override generateMove(ctx: ENGINE.GSSMovementContext, proposals: readonly ENGINE.GSSProposedMove[]): ENGINE.GSSDesiredMove {
    const move = super.generateMove(ctx, []);                 // input, and jumpSpeed when Jump was just pressed
    if (ENGINE.gssGetFloat(ctx.custom, BUFFER) > 0) move.velocity.y = this.jumpSpeed; // press arrived just before landing
    return ENGINE.mixProposedMoves(move, proposals);          // a launch still mixes onto that jump
  }
  public override tick(ctx: ENGINE.GSSMovementSimContext, move: ENGINE.GSSDesiredMove, dt: number): void {
    const buffered = ENGINE.gssGetFloat(ctx.custom, BUFFER) > 0;
    const seed = super.generateMove(ctx, []);
    if (buffered) seed.velocity.y = this.jumpSpeed;
    const launched = move.velocity.y > 0 && move.velocity.y !== seed.velocity.y; // an effect changed Y
    super.tick(ctx, move, dt);
    ENGINE.gssSetFloat(ctx.custom, AIR, 0);
    ENGINE.gssSetBool(ctx.custom, JUMPED, buffered || ctx.newInputTags.has(JUMP) || launched);
    ENGINE.gssSetFloat(ctx.custom, BUFFER, 0);
    ENGINE.gssSetBool(ctx.custom, LAUNCHED, launched);
  }
}

export class FeelFallingMode extends ENGINE.GSSFallingMode {
  public override generateMove(ctx: ENGINE.GSSMovementContext, proposals: readonly ENGINE.GSSProposedMove[]): ENGINE.GSSDesiredMove {
    const move = super.generateMove(ctx, []);
    const pressed = ctx.newInputTags.has(JUMP);
    const coyote = pressed && ENGINE.gssGetFloat(ctx.custom, AIR) <= FEEL.coyote && !ENGINE.gssGetBool(ctx.custom, JUMPED);
    if (coyote) move.velocity.y = this.jumpSpeed;
    const launched = ENGINE.gssGetBool(ctx.custom, LAUNCHED);
    if (move.velocity.y > 0 && !launched && !ctx.inputTags.has(JUMP)) {
      move.velocity.y = Math.min(move.velocity.y, this.jumpSpeed * FEEL.cut); // variable height, before effects mix
    }
    return ENGINE.mixProposedMoves(move, proposals);
  }
  public override tick(ctx: ENGINE.GSSMovementSimContext, move: ENGINE.GSSDesiredMove, dt: number): void {
    const air = ENGINE.gssGetFloat(ctx.custom, AIR) + dt;
    const usedBefore = ENGINE.gssGetInt(ctx.custom, ENGINE.JUMPS_USED_KEY);
    const pressed = ctx.newInputTags.has(JUMP);
    const coyote = pressed && ENGINE.gssGetFloat(ctx.custom, AIR) <= FEEL.coyote && !ENGINE.gssGetBool(ctx.custom, JUMPED);
    const seed = super.generateMove(ctx, []);
    if (coyote) seed.velocity.y = this.jumpSpeed;
    if (seed.velocity.y > 0 && !ENGINE.gssGetBool(ctx.custom, LAUNCHED) && !ctx.inputTags.has(JUMP)) {
      seed.velocity.y = Math.min(seed.velocity.y, this.jumpSpeed * FEEL.cut);
    }
    const launched = move.velocity.y > 0 && move.velocity.y !== seed.velocity.y;
    if (move.velocity.y < 0) { // fast fall: super.tick still adds the base gravity
      const g = ctx.target.getPhysicsEngine()?.getOptions()?.gravity.y ?? -9.81;
      move.velocity.y += g * this.characterControllerOptions.simulatedGravityScale * (FEEL.fallGravity - 1) * Math.min(dt, 0.2);
    }
    let buffer = Math.max(0, ENGINE.gssGetFloat(ctx.custom, BUFFER) - dt);
    if (pressed && !coyote && usedBefore >= this.maxMidAirJumps) buffer = FEEL.buffer;
    super.tick(ctx, move, dt);
    if (coyote) { ENGINE.gssSetInt(ctx.custom, ENGINE.JUMPS_USED_KEY, usedBefore); ENGINE.gssSetBool(ctx.custom, JUMPED, true); }
    ENGINE.gssSetFloat(ctx.custom, AIR, air);
    ENGINE.gssSetFloat(ctx.custom, BUFFER, buffer);
    if (launched) ENGINE.gssSetBool(ctx.custom, LAUNCHED, true);
  }
}
```

Register in the pawn, after `super.createGSSNode()`:

Source: .engine/src/gameplay-sim/entities/GSSCharacterPawn.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
@ENGINE.GameClass()
export class PlatformHero extends ENGINE.GSSCharacterPawn {
  protected override createGSSNode(): ENGINE.GSSNode {
    const sim = super.createGSSNode();
    sim.addMovementMode(new FeelWalkingMode({ jumpSpeed: 16 }));                                            // replaces 'walking'
    sim.addMovementMode(new FeelFallingMode({ jumpSpeed: 16, maxMidAirJumps: 1, accelerationLambda: 10 })); // replaces 'falling'
    return sim;
  }
}
```

How it works: the stock walking mode jumps on the press edge and the falling mode jumps only while `jumpsUsed < maxMidAirJumps`. Both resolve that, and any effect Y, inside `generateMove`. The feel overrides change the seed first (buffer, coyote, variable-height cut), then call `mixProposedMoves`, so a launch still replaces or adds to the jump. `super.tick` adds gravity to `move.velocity.y`. The falling subclass restores `JUMPS_USED_KEY` after a coyote jump so it does not spend the double jump. Verify in Play, including one correction under latency for online games.

## Knockback and launch, classic

`LinearVelocity`, impulses and `applyForce` do nothing to a kinematic character (`KinematicPositionBased` capsule). Set the movement node's velocities instead. They are root-local (`forward` along −Z of the root, `right` along +X), so project the world push. Held input re-targets velocity with lambda 100 on the ground, so mute the lambdas for ~0.2 s; a small upward pop puts the pawn in the air, where the push carries.

Source: .engine/src/nodes/movement/CharacterMovementNode.ts (`setVelocities`, `performMovementStep`), .engine/src/systems/TimerSystem.ts (composed — typechecked against 18.1.0-alpha.317)
```ts
const muted = new WeakMap<ENGINE.CharacterMovementNode, number[]>(); // original lambdas while muted

/** Knock a classic character (player or NpcMovementNode enemy) along a world direction. */
export function knockback(pawn: ENGINE.MovementPawn, worldDir: THREE.Vector3, speed = 10, up = 6, muteSeconds = 0.2): void {
  const mn = pawn.movementNode;
  const world = pawn.getWorld();
  if (!(mn instanceof ENGINE.CharacterMovementNode) || !world) return;
  const q = pawn.getWorldQuaternion(new THREE.Quaternion());
  const push = worldDir.clone().setY(0).normalize().multiplyScalar(speed);
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  mn.setVelocities(push.dot(fwd), push.dot(right), up); // up > 0 leaves the ground
  if (!muted.has(mn)) {
    muted.set(mn, [mn.accelerationLambda, mn.decelerationLambda, mn.midAirAccelerationLambda, mn.midAirDecelerationLambda]);
    mn.accelerationLambda = mn.decelerationLambda = mn.midAirAccelerationLambda = mn.midAirDecelerationLambda = 0;
    world.timerSystem.setTimeout(() => {
      const saved = muted.get(mn);
      if (saved) [mn.accelerationLambda, mn.decelerationLambda, mn.midAirAccelerationLambda, mn.midAirDecelerationLambda] = saved;
      muted.delete(mn);
    }, muteSeconds);
  }
}
// Jump pad / launch: mn.setVelocities(0, 0, 25), or pawn.jump(1.5) while grounded.
```

Numbers: hit 8–12 m/s with a 4–6 m/s pop; heavy blow 15 m/s with 8; jump pad 20–25 m/s up (apex 4–6 m). `NpcMovementNode` sets its mid-air lambdas to 100/10, which is why the mute matters most on enemies; its brain keeps steering while muted, but the zero lambdas hold the push. Hitstop and shake around the hit: `genesys-game-feel`. Online classic pawns: apply on the authority and let the correction reach the owner (verify in Play with two clients).

## Knockback and launch, GSS

Game code reaches a sim through `queueEvent`. An ability turns the event into an effect, and the effect proposes an additive horizontal push that fades over 200 ms plus a one-tick vertical launch. Walking and falling mix that Y onto the jump or the current vertical speed. The feel modes above are not required for the launch; they only keep the variable-height cut off a rising launch.

Source: .engine/src/gameplay-sim/GSSNode.ts (`queueEvent`), GSSEvent.ts, effects/GSSDashEffect.ts, types.ts (`GSSMoveMixMode`) (composed — typechecked against 18.1.0-alpha.317)
```ts
export class KnockbackEvent implements ENGINE.GSSEventPayload {
  constructor(public readonly velocity: THREE.Vector3) {} // world m/s; y > 0 launches
  public clone(): KnockbackEvent { return new KnockbackEvent(this.velocity.clone()); }
}

export class KnockbackAbility implements ENGINE.IGSSAbility {
  public readonly id = 'ability.Knockback';
  public shouldRun(_d: ENGINE.GSSTagSetView, _p: ENGINE.GSSTagSetView, _r: ENGINE.GSSTagSetView,
    _o: ENGINE.GSSTagSetView, events: ENGINE.GSSEventView): boolean { return events.has('knockback'); }
  public execute(ctx: ENGINE.GSSAbilityContext): void {
    const e = ctx.events.get<KnockbackEvent>('knockback');
    if (e) { ENGINE.gssSetVector3(ctx.custom, 'knockback.v', e.velocity); ctx.effects.apply('effect.Knockback'); }
    ctx.end();
  }
}

export class KnockbackEffect implements ENGINE.IGSSEffect {
  public readonly id = 'effect.Knockback';
  public readonly durationMs = 200;
  public proposeMove(ctx: ENGINE.GSSEffectContext): ENGINE.GSSProposedMove {
    const v = ENGINE.gssGetVector3(ctx.custom, 'knockback.v');
    const fade = Math.max(0, 1 - ctx.elapsed / this.durationMs); // horizontal push fades out
    const launchY = ctx.elapsed === 0 ? v.y : 0;                 // vertical only on the first tick
    return { velocity: new THREE.Vector3(v.x * fade, launchY, v.z * fade),
      mixMode: ENGINE.GSSMoveMixMode.Additive, mixY: ENGINE.GSSMoveMixMode.Override };
  }
}
// Register in createGSSNode(): sim.addAbility(new KnockbackAbility()); sim.addEffect(new KnockbackEffect());
// Hit code: target.getGSSNode().queueEvent('knockback', new KnockbackEvent(dir.multiplyScalar(10).setY(6)));
```

The proposed velocity is the target the mode damps toward, so on the ground (lambda 10 without input, 100 with it) the push reads as a shove, and in the air (5 / 0.5) it carries. An ability on the attacker's own sim can apply the effect directly with `ctx.world.applyEffect(target, 'effect.Knockback')`; the direction then has to travel as a `GSSEffectPayload`, a replicated net class, so the event route above is simpler for game code. `queueEvent` is ignored on simulated proxies; in an online game call it where the hit is decided (server) and let the correction reach the owner (verify in Play with two clients). A GSS actor with no modes discards proposed movement: register `GSSIdleMode`.
