/**
 * Example smoke steps (genesys-verification template). Copy to src/debug/smoke-steps.ts and adapt:
 * drop steps the game does not have, add one per extra verb, keep the ids in GAME.md / TECH.md's
 * verification plan. Every mechanic step asserts a SUSTAINED outcome, not the first frame.
 *
 * Flow: title → start → move (sustained) → screen-right → jump → look axes → main action (first hit
 * time and distance, sound) → volley (frame time) → enemy reaches and damages the player → pause (P)
 * frozen → resume → forced fail → result → retry reset → no console errors.
 *
 * Filtered re-checks (arm '1:S09,S10'): S02 and S16 are `always`, so the run still reaches Playing and
 * ends on the console check. A step that needs an earlier one goes in the list with it: S13 needs
 * S12, S15 needs S14.
 */
import * as THREE from 'three';

import type * as ENGINE from '@gnsx/genesys.js';

import {
  AudioMeter, cameraAxes, cameraYawPitch, capture, captureLuma, clickByText, holdKey, mouseOnCanvas,
  shotLog, smokeLog, tapKey, textOverflow, uiOverlaps, v3, yawDelta,
} from './smoke-test.js';

import type { SmokeStep, SmokeTestNode } from './smoke-test.js';

/** What the steps read from the game. The GameMode implements it with closures over its own state. */
export interface SmokeTarget {
  stateName(): string;              // 'Title' | 'Playing' | 'Paused' | 'Result'
  pawn(): ENGINE.Pawn | null;
  health(): number;
  maxHealth(): number;
  score(): number;
  enemies(): ENGINE.SceneNode[];
  projectileCount(): number;
  /** Kill the player through the game's own damage path (not by setting state). */
  killPlayer(): void;
  /** Optional: drive look input. Synthetic mousemove only turns DefaultPlayerController while pointer-locked. */
  look?(dx: number, dy: number): void;
  /** True for a rigged hero: capture idle / run / jump frames for the per-state animation check. */
  rigged?: boolean;
}

const all = (r: Array<true | string>): true | string => r.find(x => x !== true) ?? true;

export function buildSmokeSteps(world: ENGINE.World, node: SmokeTestNode, g: SmokeTarget): SmokeStep[] {
  const start = new THREE.Vector3();
  const fwd = new THREE.Vector3();
  const right = new THREE.Vector3();
  const frozen: THREE.Vector3[] = [];
  const meter = new AudioMeter(world);
  let best = 0, slip = 0, lowY = 0, peakY = 0, health0 = 0, enemies0 = 0, shots = 0, actionT = 0;
  let firing = false;
  let luma: number | null | undefined;
  let view = { yaw: 0, pitch: 0 };
  const pos = (): THREE.Vector3 => g.pawn()?.getWorldPosition(new THREE.Vector3()) ?? new THREE.Vector3();
  const fire = (down: boolean): void => { mouseOnCanvas(world, down ? 'mousedown' : 'mouseup'); }; // or key('Space', down)

  const steps: SmokeStep[] = [
    { id: 'S01', name: 'title frames the hero', wait: 2, check: () => {
      capture(world, 's01-title');
      if (g.stateName() !== 'Title') return `state ${g.stateName()}`;
      if (!g.pawn()) return 'no pawn on the title';
      return world.getActiveCamera() ? all([uiOverlaps(world), textOverflow(world)]) : 'no active camera';
    } },
    { id: 'S02', name: 'start → playing', always: true, act: () => { const r = clickByText(world, 'start'); if (r !== true) smokeLog(`click: ${r}`); },
      wait: 2, until: () => g.stateName() === 'Playing', check: () => {
        capture(world, 's02-hud');
        enemies0 = g.enemies().length;
        return g.stateName() === 'Playing' ? all([uiOverlaps(world), textOverflow(world)]) : `state ${g.stateName()}`;
      } },
    { id: 'S03', name: 'frame readable (luma)', act: () => { luma = undefined; void captureLuma(world).then(v => { luma = v; }); },
      wait: 2, until: () => luma !== undefined, check: () => {
        if (luma === undefined || luma === null) { smokeLog('S03 luma unknown (no frame)'); return true; }
        smokeLog(`S03 luma ${luma.toFixed(3)}`);
        return luma >= 0.08 ? true : `centre-weighted luma ${luma.toFixed(3)} < 0.08`;
      } },
    { id: 'S04', name: 'forward held 4 s keeps moving', act: () => {
      start.copy(pos()); fwd.copy(cameraAxes(world).fwd); best = 0; slip = 0; lowY = start.y;
      if (g.rigged) capture(world, 's04-anim-idle');
      holdKey('KeyW', 4);
    }, during: (_dt, t) => {
      const p = pos(), along = p.clone().sub(start).dot(fwd);
      best = Math.max(best, along); slip = Math.max(slip, best - along); lowY = Math.min(lowY, p.y);
      if (g.rigged && t > 2 && t < 2.05) capture(world, 's04-anim-run');
    }, wait: 4.2, check: () => {
      smokeLog(`S04 forward ${best.toFixed(1)} m, worst slip ${slip.toFixed(2)} m, end ${v3(pos())}`);
      if (best < 3) return `only ${best.toFixed(1)} m in 4 s`;
      if (slip > 0.5) return `slid back ${slip.toFixed(1)} m while held`;
      return lowY > start.y - 2 ? true : `fell to y ${lowY.toFixed(1)}`;
    } },
    // Follow camera: world motion along camera right. Fixed camera: toScreen(world, p).x grows instead.
    { id: 'S05', name: 'right moves screen-right', act: () => { start.copy(pos()); right.copy(cameraAxes(world).right); holdKey('KeyD', 1); },
      wait: 1.2, check: () => { const d = pos().sub(start).dot(right); return d > 0.5 ? true : `moved ${d.toFixed(2)} m along camera right`; } },
    { id: 'S06', name: 'jump rises and lands', act: () => { start.copy(pos()); peakY = start.y; tapKey('Space'); },
      during: () => { const y = pos().y; if (y > peakY + 0.01) { peakY = y; if (g.rigged) capture(world, 's06-anim-jump'); } },
      wait: 1.5, check: () => {
        const rise = peakY - start.y, landed = Math.abs(pos().y - start.y) < 0.3;
        return rise >= 0.5 && landed ? true : `rise ${rise.toFixed(2)} m, landed ${landed}`;
      } },
  ];

  if (g.look) {
    const look = g.look.bind(g);
    steps.push(
      { id: 'S07', name: 'look right turns right (yaw)', act: () => { view = cameraYawPitch(world) ?? view; look(200, 0); }, wait: 0.5,
        check: () => { const d = yawDelta(view.yaw, cameraYawPitch(world)?.yaw ?? view.yaw); return d > 2 ? true : `yaw changed ${d.toFixed(1)}°`; } },
      { id: 'S08', name: 'look up pitches up', act: () => { view = cameraYawPitch(world) ?? view; look(0, -120); }, wait: 0.5,
        check: () => { const d = (cameraYawPitch(world)?.pitch ?? view.pitch) - view.pitch; return d > 2 ? true : `pitch changed ${d.toFixed(1)}° (inverted?)`; } },
    );
  }

  steps.push(
    { id: 'S09', name: 'main action: first hit is far and sounds', act: () => {
      shotLog.length = 0; meter.start(); fire(true); firing = true; actionT = 0;
    }, during: (_dt, t) => { actionT = t; meter.sample(); if (firing && t > 0.05) { fire(false); firing = false; } },
    wait: 2, until: () => shotLog.length > 0 && actionT >= 0.5, check: () => {
      if (firing) { fire(false); firing = false; }
      const sound = meter.stop();
      smokeLog(`S09 sound ${sound}`);
      const s = shotLog[0];
      if (!s) return 'no hit logged in 2 s (missed everything, or the projectile never calls noteShotHit)';
      smokeLog(`S09 first hit ${s.hit} at ${s.metres.toFixed(1)} m after ${s.seconds.toFixed(2)} s`);
      if (s.metres < 2) return `hit ${s.hit} ${s.metres.toFixed(1)} m from the muzzle: explodes in the hand`;
      if (/floor|ground|terrain/i.test(s.hit) && s.seconds < 0.6) return `first hit is the ${s.hit} after ${s.seconds.toFixed(2)} s: aim drops`;
      return sound === 'silent' ? 'no sound after the main action' : true;
    } },
    { id: 'S10', name: 'volley of 40: no frame over 2x median', act: () => { shots = 0; node.frames.start(); },
      during: () => { if (shots < 80) { fire(shots % 2 === 0); shots++; } }, wait: 5, until: () => shots >= 80,
      check: () => {
        fire(false);
        const f = node.frames.stop();
        smokeLog(`S10 volley ${f.frames} frames, median ${f.medianMs.toFixed(1)} ms, max ${f.maxMs.toFixed(1)} ms`);
        return f.maxMs <= 2 * f.medianMs ? true : `max ${f.maxMs.toFixed(1)} ms > 2x median (genesys-profiler: Never pay per spawn)`;
      } },
    // Drop when nothing attacks the player.
    { id: 'S11', name: 'enemy reaches and damages the player', act: () => { health0 = g.health(); },
      wait: 20, until: () => g.health() < health0, check: () =>
        g.health() < health0 ? true : `no damage in 20 s (${g.enemies().length} enemies alive)` },
    { id: 'S12', name: 'pause (P) freezes gameplay', act: () => {
      tapKey('KeyP');
      frozen.length = 0;
      for (const n of [g.pawn(), ...g.enemies()]) if (n) frozen.push(n.getWorldPosition(new THREE.Vector3()));
    }, wait: 0.6, check: () => {
      capture(world, 's12-pause');
      if (g.stateName() !== 'Paused') return `state ${g.stateName()}`;
      const now = [g.pawn(), ...g.enemies()].filter((n): n is ENGINE.SceneNode => !!n).map(n => n.getWorldPosition(new THREE.Vector3()));
      const moved = now.some((p, i) => frozen[i] !== undefined && p.distanceTo(frozen[i]) > 0.01);
      return moved ? 'something moved while paused' : uiOverlaps(world);
    } },
    { id: 'S13', name: 'resume', act: () => { const r = clickByText(world, 'resume'); if (r !== true) smokeLog(`click: ${r}`); },
      wait: 1, until: () => g.stateName() === 'Playing', check: () => g.stateName() === 'Playing' ? true : `state ${g.stateName()}` },
    { id: 'S14', name: 'forced fail → result', act: () => g.killPlayer(), wait: 3, until: () => g.stateName() === 'Result',
      check: () => {
        capture(world, 's14-result');
        return g.stateName() === 'Result' ? all([uiOverlaps(world), textOverflow(world)]) : `state ${g.stateName()}`;
      } },
    { id: 'S15', name: 'retry resets the run', act: () => { const r = clickByText(world, 'retry'); if (r !== true) smokeLog(`click: ${r}`); },
      wait: 1.5, check: () => {
        if (g.stateName() !== 'Playing') return `state ${g.stateName()}`;
        if (g.health() !== g.maxHealth()) return `health ${g.health()}/${g.maxHealth()}`;
        if (g.score() !== 0) return `score ${g.score()}`;
        if (g.projectileCount() !== 0) return `${g.projectileCount()} projectiles left over`;
        return g.enemies().length <= enemies0 ? true : `${g.enemies().length} enemies (start had ${enemies0})`;
      } },
    { id: 'S16', name: 'no console errors', always: true, wait: 0.1, check: () =>
      node.errors.count === 0 ? true : `${node.errors.count} errors, first: ${node.errors.first}` },
  );
  return steps;
}
