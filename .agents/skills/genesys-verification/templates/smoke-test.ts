/**
 * In-game smoke test harness (genesys-verification template). Copy to src/debug/smoke-test.ts.
 * Genre-neutral: the game's own steps live in src/debug/smoke-steps.ts (see smoke-steps.example.ts).
 *
 * One-shot gate: the agent arms the capture receiver (scripts/capture-receiver.mjs --arm, or
 * POST /arm) right before enterPlayMode. The GameMode starts consumeSmokeFlag() first thing in
 * beginPlay; it asks GET /smoke, which answers once and disarms. The creator's own Play finds the
 * receiver unarmed (204) or not running, so it never runs the test. SMOKE_FORCE is the compile-time fallback.
 *
 * Step filter: arm with '1:S09,S16' (or 'net:60000:N01') and this Play runs only those steps plus the
 * steps marked `always` (the one that reaches Playing). A re-check of one fix replays seconds, not the tour.
 *
 * Every line is console.error with a [SMOKE] prefix: query_diagnostics(getConsole) returns errors
 * only. Lines and frames are also POSTed to the capture receiver (scripts/capture-receiver.mjs),
 * which writes .scratch/play/<name>.jpg and .scratch/play/smoke.log.
 *
 * This node is required verification, not test code: it ships in src/ and does nothing unless gated on.
 */
import * as THREE from 'three';

import * as ENGINE from '@gnsx/genesys.js';

/** Compile-time fallback. Keep false in every delivered build. */
export const SMOKE_FORCE = false;
export const CAPTURE_URL = 'http://127.0.0.1:8765';

let smokeActive = false;
let smokeOnly: string[] | null = null;

export type SmokeMode = '1' | 'net';

/**
 * Start once at the top of GameMode.beginPlay; await it before mounting the node. Asks the receiver
 * GET /smoke with a 1.5 s timeout: 200 "1" or "net", optionally ":S09,S16" → run in that mode (with
 * that step filter, read by SmokeTestNode.setSteps); 204, an error, or no receiver → null (do not
 * run). Never throws.
 */
export async function consumeSmokeFlag(timeoutMs = 1500): Promise<SmokeMode | null> {
  let mode: SmokeMode | null = SMOKE_FORCE ? '1' : null;
  if (!mode) {
    const ctl = new AbortController();
    const timer = window.setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${CAPTURE_URL}/smoke`, { signal: ctl.signal, cache: 'no-store' });
      const body = res.status === 200 ? (await res.text()).trim() : '';
      const [head, ids] = body.split(':');
      if (head === '1' || head === 'net') mode = head;
      smokeOnly = mode && ids ? ids.split(',').map(id => id.trim().toUpperCase()).filter(Boolean) : null;
    } catch { /* receiver not running: the creator's own Play */ }
    window.clearTimeout(timer);
  }
  smokeActive = mode !== null;
  return mode;
}

export function isSmokeActive(): boolean { return smokeActive; }

/** Step ids this Play was armed for, or null for the full run. */
export function smokeStepFilter(): string[] | null { return smokeOnly; }

// ---------------------------------------------------------------- log and capture

function post(path: string, body: string): void {
  void fetch(`${CAPTURE_URL}/${path}`, { method: 'POST', body }).catch(() => undefined);
}

export function smokeLog(line: string): void {
  console.error(`[SMOKE] ${line}`);
  post('log', JSON.stringify({ line: `[SMOKE] ${line}` }));
}

export function canvasOf(world: ENGINE.World | null): HTMLCanvasElement | null {
  return world?.gameContainer?.querySelector('canvas') ?? null;
}

function afterFrames(n: number): Promise<void> {
  return new Promise(resolve => {
    const step = (left: number): void => { if (left <= 0) resolve(); else requestAnimationFrame(() => step(left - 1)); };
    step(n);
  });
}

/** Grabs the game canvas two frames from now. The canvas holds the 3D view only; DOM widgets are not in it. */
export async function grabFrame(world: ENGINE.World | null, quality = 0.8): Promise<string | null> {
  const canvas = canvasOf(world);
  if (!canvas) return null;
  await afterFrames(2);
  try { return canvas.toDataURL('image/jpeg', quality); } catch { return null; }
}

/** Saves .scratch/play/<name>.jpg through the receiver. Best-effort; never throws. */
export function capture(world: ENGINE.World | null, name: string): void {
  void grabFrame(world).then(url => { if (url) post(name, url); });
}

/**
 * Centre-weighted mean luma (0..1) of the next frame: 4×4 tiles, the 4 centre tiles count double.
 * A dark-phase frame under 0.08 is unreadable. null = no canvas or no pixels (unknown, not a pass).
 */
export async function captureLuma(world: ENGINE.World | null): Promise<number | null> {
  const url = await grabFrame(world, 0.7);
  if (!url) return null;
  const img = new Image();
  const loaded = await new Promise<boolean>(resolve => { img.onload = () => resolve(true); img.onerror = () => resolve(false); img.src = url; });
  if (!loaded) return null;
  const w = 64, h = 36, c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (!g) return null;
  g.drawImage(img, 0, 0, w, h);
  const d = g.getImageData(0, 0, w, h).data;
  let sum = 0, weight = 0;
  for (let ty = 0; ty < 4; ty++) for (let tx = 0; tx < 4; tx++) {
    let tile = 0;
    for (let y = ty * 9; y < ty * 9 + 9; y++) for (let x = tx * 16; x < tx * 16 + 16; x++) {
      const i = (y * w + x) * 4;
      tile += (0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]) / 255;
    }
    const wt = tx > 0 && tx < 3 && ty > 0 && ty < 3 ? 2 : 1;
    sum += wt * tile / 144; weight += wt;
  }
  return sum / weight;
}

// ---------------------------------------------------------------- synthetic input
// InputManager listens for keys on window and for mouse events on the renderer element, so these
// take the same path as a player's input (.engine/src/systems/InputManager.ts). A key that is
// already down is ignored until its keyup, so a hold is one keydown and one keyup.

export function key(code: string, down: boolean): void {
  window.dispatchEvent(new KeyboardEvent(down ? 'keydown' : 'keyup', { code, key: code, bubbles: true }));
}

export function tapKey(code: string): void { key(code, true); key(code, false); }

const held = new Map<string, number>();

/** Holds a key for `seconds` of wall time. Assert on the sustained result, not on the first frame. */
export function holdKey(code: string, seconds: number): void {
  const prev = held.get(code);
  if (prev !== undefined) window.clearTimeout(prev);
  key(code, true);
  held.set(code, window.setTimeout(() => { key(code, false); held.delete(code); }, seconds * 1000));
}

export function releaseHeldKeys(): void {
  for (const [code, timer] of held) { window.clearTimeout(timer); key(code, false); }
  held.clear();
}

/** Mouse event on the renderer canvas, at the canvas centre unless x/y (client px) are given. */
export function mouseOnCanvas(world: ENGINE.World | null, type: 'mousedown' | 'mouseup' | 'mousemove' | 'click',
  opts: { button?: number; x?: number; y?: number; movementX?: number; movementY?: number } = {}): boolean {
  const canvas = canvasOf(world);
  if (!canvas) return false;
  const r = canvas.getBoundingClientRect();
  canvas.dispatchEvent(new MouseEvent(type, {
    clientX: opts.x ?? r.left + r.width / 2, clientY: opts.y ?? r.top + r.height / 2,
    button: opts.button ?? 0, movementX: opts.movementX ?? 0, movementY: opts.movementY ?? 0, bubbles: true,
  }));
  return true;
}

export function isVisible(el: Element): boolean {
  if (el.getClientRects().length === 0) return false;
  const s = getComputedStyle(el);
  return s.visibility !== 'hidden' && Number(s.opacity) > 0;
}

/**
 * Clicks a visible button whose text contains `text`. Engine Button listens for 'click' only
 * (.engine/src/ui/components/Button.ts), so mousedown/mouseup never press it. Fails when another
 * element (a hidden screen, title art, a full-screen panel) covers the button's centre.
 */
export function clickByText(world: ENGINE.World | null, text: string): true | string {
  const root = world?.gameContainer;
  if (!root) return 'no game container';
  const want = text.toLowerCase();
  const all = Array.from(root.querySelectorAll<HTMLElement>('button, [role="button"]')).filter(isVisible);
  const label = (b: HTMLElement): string => (b.textContent ?? '').trim().toLowerCase();
  const btn = all.find(b => label(b) === want) ?? all.find(b => label(b).includes(want));
  if (!btn) return `button "${text}" not visible`;
  if (btn instanceof HTMLButtonElement && btn.disabled) return `button "${text}" disabled`;
  const r = btn.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (hit && !btn.contains(hit)) return `button "${text}" covered by ${hit.className || hit.tagName}`;
  btn.click();
  return true;
}

// ---------------------------------------------------------------- UI checks

function labelOf(el: HTMLElement): string {
  const t = (el.textContent ?? '').trim().replace(/\s+/g, ' ').slice(0, 18);
  return t || el.className.toString().split(' ')[0] || el.tagName;
}

/**
 * Visible HUD pieces whose boxes overlap by more than 2 px. Engine widget roots are the template root
 * inside each '.ui-layout' container (ui-card, ui-button, ui-progress-bar, ...); custom HUD pieces carry
 * `data-hud-item` (genesys-ui → custom-hud). Pass `ignore` for deliberate stacking (an icon inside a
 * card, a crosshair over the centre).
 */
export function uiOverlaps(world: ENGINE.World | null, ignore?: (el: HTMLElement) => boolean): true | string {
  const root = world?.gameContainer;
  if (!root) return 'no game container';
  const boxes = Array.from(root.querySelectorAll<HTMLElement>('.ui-layout > :not(script), [data-hud-item]'))
    .filter(e => isVisible(e) && !(ignore?.(e) ?? false))
    .map(e => ({ e, r: e.getBoundingClientRect() }))
    .filter(b => b.r.width > 0 && b.r.height > 0);
  const hits: string[] = [];
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j];
    if (a.e.contains(b.e) || b.e.contains(a.e)) continue;
    const ox = Math.min(a.r.right, b.r.right) - Math.max(a.r.left, b.r.left);
    const oy = Math.min(a.r.bottom, b.r.bottom) - Math.max(a.r.top, b.r.top);
    if (ox > 2 && oy > 2) hits.push(`${labelOf(a.e)} × ${labelOf(b.e)}`);
  }
  return hits.length ? `overlaps: ${hits.join(' | ')}` : true;
}

/** Visible text wider than its box (scrollWidth > clientWidth) in engine widgets and the custom HUD (`[data-hud]`). */
export function textOverflow(world: ENGINE.World | null): true | string {
  const root = world?.gameContainer;
  if (!root) return 'no game container';
  const bad = Array.from(root.querySelectorAll<HTMLElement>('.ui-layout *, [data-hud] *'))
    .filter(e => isVisible(e) && e.clientWidth > 0
      && Array.from(e.childNodes).some(n => n.nodeType === Node.TEXT_NODE && (n.textContent ?? '').trim() !== '')
      && e.scrollWidth > e.clientWidth + 1)
    .map(e => `"${labelOf(e)}" ${e.scrollWidth}>${e.clientWidth}px`);
  return bad.length ? `text overflow: ${bad.join(' | ')}` : true;
}

// ---------------------------------------------------------------- camera and direction

/** NDC position (x right, y up, -1..1) through the active camera. Use with a fixed camera. */
export function toScreen(world: ENGINE.World, p: THREE.Vector3): THREE.Vector2 | null {
  const cam = world.getActiveCamera();
  if (!cam) return null;
  const v = p.clone().project(cam);
  return new THREE.Vector2(v.x, v.y);
}

/** Flat camera forward and right. Camera.getWorldDirection is the look direction; right = forward × up. */
export function cameraAxes(world: ENGINE.World): { fwd: THREE.Vector3; right: THREE.Vector3 } {
  const fwd = new THREE.Vector3(0, 0, -1);
  world.getActiveCamera()?.getWorldDirection(fwd);
  fwd.y = 0;
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  return { fwd, right: new THREE.Vector3().crossVectors(fwd, new THREE.Vector3(0, 1, 0)).normalize() };
}

/** Camera yaw (+ = turned right) and pitch (+ = looking up), in degrees. Check both axes. */
export function cameraYawPitch(world: ENGINE.World): { yaw: number; pitch: number } | null {
  const cam = world.getActiveCamera();
  if (!cam) return null;
  const d = cam.getWorldDirection(new THREE.Vector3());
  return { yaw: THREE.MathUtils.radToDeg(Math.atan2(d.x, -d.z)), pitch: THREE.MathUtils.radToDeg(Math.asin(THREE.MathUtils.clamp(d.y, -1, 1))) };
}

/** Signed yaw change in degrees, wrapped to -180..180. */
export function yawDelta(a: number, b: number): number { return ((b - a + 540) % 360) - 180; }

export function v3(p: THREE.Vector3): string { return `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})`; }

// ---------------------------------------------------------------- frame time, audio, errors

/** Wall-clock frame times between node ticks. No profiler or Insights needed. */
export class FrameRecorder {
  private samples: number[] = [];
  private last = 0;
  private on = false;
  public start(): void { this.samples = []; this.last = performance.now(); this.on = true; }
  public sample(): void {
    if (!this.on) return;
    const now = performance.now();
    this.samples.push(now - this.last);
    this.last = now;
  }
  /** Stats over the recorded frames; the first frame is dropped (it includes the step change). */
  public stop(): { frames: number; medianMs: number; maxMs: number } {
    this.on = false;
    const s = this.samples.slice(1);
    if (s.length === 0) return { frames: 0, medianMs: 0, maxMs: 0 };
    const sorted = [...s].sort((a, b) => a - b);
    return { frames: s.length, medianMs: sorted[Math.floor(sorted.length / 2)], maxMs: sorted[sorted.length - 1] };
  }
}

/**
 * Audibility after a real event: an AnalyserNode tapped off the world's AudioListener gain, which the
 * engine's Master bus feeds (.engine/src/utils/GlobalAudioManager.ts). Audible = at least 10 samples
 * with RMS > 0.002. No listener, a suspended context, or fewer than 10 samples = 'unknown'. Verify in Play.
 */
export class AudioMeter {
  private analyser: AnalyserNode | null = null;
  private buf = new Float32Array(1024);
  private loud = 0;
  private samples = 0;
  private unknown = false;
  constructor(private readonly world: ENGINE.World) {}
  public start(): void {
    this.loud = 0; this.samples = 0; this.unknown = false;
    const listener = this.world.audioListener;
    if (!listener || listener.context.state !== 'running') { this.unknown = true; return; }
    this.analyser = listener.context.createAnalyser();
    this.analyser.fftSize = 1024;
    listener.gain.connect(this.analyser);
  }
  public sample(): void {
    if (!this.analyser) return;
    this.analyser.getFloatTimeDomainData(this.buf);
    let sq = 0;
    for (let i = 0; i < this.buf.length; i++) sq += this.buf[i] * this.buf[i];
    this.samples++;
    if (Math.sqrt(sq / this.buf.length) > 0.002) this.loud++;
  }
  public stop(): 'audible' | 'silent' | 'unknown' {
    if (this.analyser) { try { this.world.audioListener?.gain.disconnect(this.analyser); } catch { /* already gone */ } }
    this.analyser = null;
    if (this.unknown || this.samples < 10) return 'unknown';
    return this.loud >= 10 ? 'audible' : 'silent';
  }
}

/** Counts errors that are not [SMOKE] lines while the run is live. */
export class ErrorWatch {
  public count = 0;
  public first = '';
  private original: typeof console.error | null = null;
  private readonly onError = (e: ErrorEvent): void => this.note(e.message);
  private readonly onRejection = (e: PromiseRejectionEvent): void => this.note(String(e.reason));
  public start(): void {
    if (this.original) return;
    const original = console.error.bind(console);
    this.original = original;
    console.error = (...args: unknown[]): void => {
      if (!(typeof args[0] === 'string' && args[0].startsWith('[SMOKE]'))) this.note(args.map(String).join(' '));
      original(...args);
    };
    window.addEventListener('error', this.onError);
    window.addEventListener('unhandledrejection', this.onRejection);
  }
  public stop(): void {
    if (this.original) console.error = this.original;
    this.original = null;
    window.removeEventListener('error', this.onError);
    window.removeEventListener('unhandledrejection', this.onRejection);
  }
  private note(msg: string): void { this.count++; if (!this.first) this.first = msg.slice(0, 160); }
}

// ---------------------------------------------------------------- projectile hit log

export interface ShotRecord { hit: string; seconds: number; metres: number; }
export const shotLog: ShotRecord[] = [];

/** Call from the game's projectile hit handler. No-op unless the smoke test is running. */
export function noteShotHit(hit: string, secondsSinceFired: number, metresFromMuzzle: number): void {
  if (!smokeActive) return;
  shotLog.push({ hit, seconds: secondsSinceFired, metres: metresFromMuzzle });
}

// ---------------------------------------------------------------- runner

export interface SmokeStep {
  /** Stable id from the verification plan (S01, S02, ...). */
  id: string;
  name: string;
  /** Runs once when the step starts. */
  act?: () => void;
  /** Runs every tick while the step is live (sample positions, feed a meter). t = seconds into the step. */
  during?: (dt: number, t: number) => void;
  /** Seconds before the check. With `until`, the upper bound. */
  wait: number;
  /** Check early as soon as this returns true. */
  until?: () => boolean;
  /** true = PASS; a string = FAIL with that reason. */
  check: () => boolean | string;
  /** Runs in every filtered run too: the step that reaches Playing (S02) and the console check (S16). */
  always?: boolean;
}

@ENGINE.GameClass()
export class SmokeTestNode extends ENGINE.SceneNode {
  public readonly frames = new FrameRecorder();
  public readonly errors = new ErrorWatch();
  private steps: SmokeStep[] = [];
  private i = 0;
  private t = 0;
  private total = 0;
  private acted = false;
  private pass = 0;
  private fail = 0;
  private tag = '';

  /**
   * `tag` prefixes every line on multi-client runs, e.g. 'client 2'. `only` (default: the armed
   * filter) keeps those ids plus `always` steps, in their original order.
   */
  public setSteps(steps: SmokeStep[], tag = '', only: string[] | null = smokeStepFilter()): void {
    this.steps = only ? steps.filter(s => s.always || only.includes(s.id.toUpperCase())) : steps;
    this.tag = tag ? `(${tag}) ` : '';
    this.errors.start();
    const unknown = only?.filter(id => !steps.some(s => s.id.toUpperCase() === id)) ?? [];
    if (unknown.length) smokeLog(`${this.tag}unknown step ids ${unknown.join(',')}`);
    smokeLog(`${this.tag}START ${this.steps.length} steps${only ? ` of ${steps.length} (only ${this.steps.map(s => s.id).join(',')})` : ''}`);
    if (this.steps.length === 0) this.finish();
  }

  // Not in the GameMode's gameplay-node list, so it keeps ticking while the game is paused.
  public override tickPrePhysics(dt: number): void {
    super.tickPrePhysics(dt);
    this.frames.sample();
    const step = this.steps[this.i];
    if (!step) return;
    this.total += dt;
    if (!this.acted) {
      this.acted = true;
      this.t = 0;
      try { step.act?.(); } catch (e) { smokeLog(`${this.tag}act threw in ${step.id}: ${String(e)}`); }
    }
    this.t += dt;
    try { step.during?.(dt, this.t); } catch (e) { smokeLog(`${this.tag}during threw in ${step.id}: ${String(e)}`); }
    let early = false;
    try { early = step.until?.() ?? false; } catch { early = false; }
    if (this.t < step.wait && !early) return;
    let r: boolean | string;
    try { r = step.check(); } catch (e) { r = `check threw ${String(e)}`; }
    if (r === true) this.pass++; else this.fail++;
    smokeLog(`${this.tag}${r === true ? 'PASS' : 'FAIL'} ${step.id} ${step.name} (${this.t.toFixed(1)} s)${r === true ? '' : `: ${r === false ? 'check failed' : r}`}`);
    this.i++;
    this.acted = false;
    if (this.i === this.steps.length) this.finish();
  }

  private finish(): void {
    releaseHeldKeys();
    this.errors.stop();
    smokeLog(`${this.tag}DONE pass ${this.pass} fail ${this.fail} errors ${this.errors.count} in ${this.total.toFixed(1)} s`);
    smokeActive = false;
  }
}
