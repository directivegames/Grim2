#!/usr/bin/env node
// Offline sound synthesis -> mono 16-bit 44.1 kHz WAV under the game's assets/. No dependencies.
// WAV ships raw unless the project's asset compiler has audio compression on (then MP3 at build);
// each run prints which one applies (genesys-asset-compiler owns the setting).
//
//   node synth.mjs sfx <preset> <out.wav> [--seed 1] [--pitch 1.0] [--length 1.0] [--volume 0.9] [--loop]
//   node synth.mjs music <mood> <out.wav> [--bpm N] [--bars 16] [--key A] [--seed 1]
//   node synth.mjs list
//
// sfx presets: hit, hurt, death, pickup, coin, powerup, jump, land, footstep, shoot, laser,
//   cast, magic, explosion, whoosh, click, confirm, cancel, door, alarm
// ambience presets (seamless loops by default): wind, rain, hum, fire
// music moods: dark, tense, heroic, upbeat, calm, mystic
// keys: C C# D D# E F F# G G# A A# B (flats Db Eb Gb Ab Bb also accepted)
//
// --loop renders an sfx as a seamless loop: the tail is crossfaded into the head, so the file
// repeats without a click (ambience presets always loop). --length scales the preset length.
// Music renders an exact number of bars (length = bars x 4 x 60 / bpm) and wraps its reverb and
// delay tail back to the start, so it loops without a click. Vary --seed for a different take.
// The printed @project/... path is computed from the game project that contains the output file.
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const HELP = fs.readFileSync(new URL(import.meta.url), 'utf8').split('\n').slice(1)
  .filter((l, i, a) => a.slice(0, i + 1).every((x) => x.startsWith('//')))
  .map((l) => l.replace(/^\/\/ ?/, '')).join('\n');
const FLAGS = {
  sfx: { seed: 'number', pitch: 'number', length: 'number', volume: 'number', loop: 'boolean' },
  music: { seed: 'number', bpm: 'number', bars: 'number', key: 'key' },
  list: {},
};
const fail = (msg) => { console.error(`ERROR ${msg}`); process.exit(2); };

function parseArgs(argv) {
  if (argv.includes('--help') || argv.includes('-h')) { console.log(HELP); process.exit(0); }
  const pos = [];
  const flags = {};
  const cmd = argv[0];
  const valid = FLAGS[cmd];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) { pos.push(a); continue; }
    const name = a.slice(2);
    if (!valid) break;
    const type = valid[name];
    if (!type) fail(`unknown flag --${name} for "${cmd}". Valid: ${Object.keys(valid).map((k) => '--' + k).join(', ') || '(none)'}`);
    if (type === 'boolean') { flags[name] = true; continue; }
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) fail(`--${name} needs a value`);
    if (type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n) || n <= 0) fail(`--${name} must be a positive number, got "${v}"`);
      flags[name] = n;
    } else {
      flags[name] = v;
    }
  }
  return { pos, flags };
}
// ---------------------------------------------------------------- utilities
let rngState = 1;
const seedRng = (s) => { rngState = (s * 2654435761) >>> 0 || 1; };
const rnd = () => { rngState ^= rngState << 13; rngState ^= rngState >>> 17; rngState ^= rngState << 5; return ((rngState >>> 0) / 4294967296); };
const noise = () => rnd() * 2 - 1;
const TAU = Math.PI * 2;
const midi = (n) => 440 * 2 ** ((n - 69) / 12);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function env(t, a, d, s, r, len) {
  if (t < a) return t / a;
  if (t < a + d) return 1 - (1 - s) * ((t - a) / d);
  if (t < len - r) return s;
  return Math.max(0, s * (1 - (t - (len - r)) / r));
}
const expDecay = (t, k) => Math.exp(-t * k);

function osc(type, phase) {
  const p = phase - Math.floor(phase);
  switch (type) {
    case 'sine': return Math.sin(TAU * p);
    case 'square': return p < 0.5 ? 1 : -1;
    case 'saw': return 2 * p - 1;
    case 'tri': return 1 - 4 * Math.abs(p - 0.5);
    default: return 0;
  }
}

// one-pole low-pass / high-pass, stateful
function lowpass(buf, cutoff) {
  const a = 1 - Math.exp(-TAU * cutoff / SR);
  let y = 0;
  for (let i = 0; i < buf.length; i++) { y += a * (buf[i] - y); buf[i] = y; }
  return buf;
}
function highpass(buf, cutoff) {
  const a = Math.exp(-TAU * cutoff / SR);
  let y = 0, x1 = 0;
  for (let i = 0; i < buf.length; i++) { y = a * (y + buf[i] - x1); x1 = buf[i]; buf[i] = y; }
  return buf;
}

// Run a stateful filter as if the buffer were a loop: warm it on the last second first.
function circular(buf, fn) {
  const pre = Math.min(buf.length, SR);
  const tmp = new Float32Array(pre + buf.length);
  tmp.set(buf.subarray(buf.length - pre), 0);
  tmp.set(buf, pre);
  fn(tmp);
  buf.set(tmp.subarray(pre));
  return buf;
}

function normalize(buf, peak = 0.89) {
  let m = 0;
  for (const v of buf) m = Math.max(m, Math.abs(v));
  if (m > 0) for (let i = 0; i < buf.length; i++) buf[i] = Math.tanh((buf[i] / m) * 1.2) / Math.tanh(1.2) * peak;
  return buf;
}

function fadeEdges(buf, ms = 4) {
  const n = Math.min(buf.length >> 1, Math.round(SR * ms / 1000));
  for (let i = 0; i < n; i++) { buf[i] *= i / n; buf[buf.length - 1 - i] *= i / n; }
  return buf;
}

// The game project that contains `file`: the nearest folder upward holding a *.genesys-project
// file, else the nearest holding package.json. Never the shell's cwd.
function findProjectRoot(file) {
  let dir = path.dirname(path.resolve(file));
  let pkg = null;
  for (;;) {
    let names = [];
    try { names = fs.readdirSync(dir); } catch { /* unreadable: keep walking */ }
    if (names.some((n) => n.endsWith('.genesys-project'))) return { root: dir, config: path.join(dir, names.find((n) => n.endsWith('.genesys-project'))) };
    if (!pkg && names.includes('package.json')) pkg = dir;
    const up = path.dirname(dir);
    if (up === dir) return pkg ? { root: pkg, config: null } : null;
    dir = up;
  }
}

function audioCompressionOn(configPath) {
  if (!configPath) return null;
  try {
    const ac = JSON.parse(fs.readFileSync(configPath, 'utf8')).assetCompiler ?? {};
    const au = ac.audioCompression ?? {};
    return ac.enabled === true && au.enabled !== false && au.formats?.wav !== false;
  } catch { return null; }
}

const MUSIC_BUDGET_KB = 1536; // music bed <= 1.5 MB after compression (genesys-assets budget table)

function writeWav(file, buf, kind) {
  const data = Buffer.alloc(buf.length * 2);
  for (let i = 0; i < buf.length; i++) data.writeInt16LE(Math.round(clamp(buf[i], -1, 1) * 32767), i * 2);
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + data.length, 4); h.write('WAVE', 8);
  h.write('fmt ', 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write('data', 36); h.writeUInt32LE(data.length, 40);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, Buffer.concat([h, data]));
  const kb = Math.round((44 + data.length) / 1024);
  const secs = buf.length / SR;
  const proj = findProjectRoot(file);
  const rel = proj ? path.relative(proj.root, file).split(path.sep).join('/') : null;
  const inAssets = rel !== null && rel.startsWith('assets/');
  const logical = inAssets ? `@project/${rel}` : '(no @project path)';
  console.log(`WAV ${rel ?? file}  ${secs.toFixed(2)} s  ${kb} KB  ->  ${logical}`);
  if (!proj) console.log(`WARN ${file} is not inside a game project; move it under <project>/assets/ before referencing it.`);
  else if (!inAssets) console.log(`WARN ${rel} is outside ${proj.root}/assets/; the game cannot load it.`);
  const mp3 = audioCompressionOn(proj?.config);
  if (mp3 === true) console.log(`NOTE ships as MP3 (assetCompiler audio compression is on); ~${Math.max(1, Math.round(secs * 16))} KB at the default quality.`);
  else if (mp3 === false) {
    console.log('NOTE ships as this raw WAV: assetCompiler audio compression is off for this project.');
    if (kind === 'music' && kb > MUSIC_BUDGET_KB) console.log(`WARN ${kb} KB is over the ${MUSIC_BUDGET_KB} KB music budget raw. Turn on audio compression (genesys-asset-compiler) or render fewer --bars.`);
  }
}

// ---------------------------------------------------------------- sfx
// Each preset: (t, len, P) → sample. P = { pitch, rnd } with per-render random constants.
const SFX = {
  hit: { len: 0.22, f: (t, L, P) => (noise() * expDecay(t, 38) * 0.8 + Math.sin(TAU * 90 * P.pitch * t * (1 - t * 2)) * expDecay(t, 18)), lp: 3200 },
  hurt: { len: 0.3, f: (t, L, P) => osc('square', 420 * P.pitch * t * (1 - t * 1.4)) * expDecay(t, 9) * 0.6 + noise() * expDecay(t, 40) * 0.3, lp: 2600 },
  death: { len: 0.9, f: (t, L, P) => osc('saw', (300 - 220 * t / L) * P.pitch * t) * env(t, 0.01, 0.1, 0.7, 0.4, L) * 0.6 + noise() * expDecay(t, 6) * 0.25, lp: 1800 },
  pickup: { len: 0.25, f: (t, L, P) => osc('square', (t < 0.07 ? 880 : 1320) * P.pitch * t) * env(t, 0.003, 0.05, 0.5, 0.12, L) * 0.5, lp: 6000 },
  coin: { len: 0.35, f: (t, L, P) => osc('square', (t < 0.06 ? 988 : 1319) * P.pitch * t) * expDecay(t, t < 0.06 ? 4 : 10) * 0.45, lp: 7000 },
  powerup: { len: 0.6, f: (t, L, P) => osc('tri', midi(60 + [0, 4, 7, 12, 16][Math.min(4, Math.floor(t / 0.1))]) * P.pitch * t) * env(t, 0.005, 0.05, 0.8, 0.15, L) * 0.7, lp: 8000 },
  jump: { len: 0.28, f: (t, L, P) => Math.sin(TAU * (220 + 900 * t) * P.pitch * t) * env(t, 0.005, 0.05, 0.6, 0.15, L) * 0.7, lp: 5000 },
  land: { len: 0.18, f: (t, L, P) => (noise() * 0.6 + Math.sin(TAU * 70 * t)) * expDecay(t, 30), lp: 900 },
  footstep: { len: 0.12, f: (t, L, P) => noise() * expDecay(t, 45) * (0.7 + 0.3 * P.r1), lp: 1400 },
  shoot: { len: 0.25, f: (t, L, P) => (osc('saw', (700 - 1800 * t) * P.pitch * t) * 0.5 + noise() * 0.5) * expDecay(t, 16), lp: 4500 },
  laser: { len: 0.3, f: (t, L, P) => osc('square', (1600 * Math.exp(-t * 9)) * P.pitch * t) * expDecay(t, 8) * 0.5, lp: 6000 },
  cast: { len: 0.55, f: (t, L, P) => (Math.sin(TAU * (300 + 500 * t) * P.pitch * t + 3 * Math.sin(TAU * 7 * t)) * 0.6 + noise() * 0.3 * Math.sin(Math.PI * t / L)) * env(t, 0.03, 0.1, 0.7, 0.25, L), lp: 5000, hp: 200 },
  magic: { len: 1.0, f: (t, L, P) => [0, 7, 12, 19].reduce((s, n, k) => s + Math.sin(TAU * midi(72 + n) * P.pitch * t) * expDecay(Math.max(0, t - k * 0.06), 5) * (t > k * 0.06 ? 1 : 0), 0) * 0.3, lp: 9000 },
  explosion: { len: 1.4, f: (t, L, P) => (noise() * expDecay(t, 3.2) + Math.sin(TAU * 45 * t) * expDecay(t, 4) * 0.8) * env(t, 0.004, 0.1, 0.9, 0.6, L), lp: 900 },
  whoosh: { len: 0.45, f: (t, L, P) => noise() * Math.sin(Math.PI * t / L) ** 2, lp: 2200, hp: 300 },
  click: { len: 0.05, f: (t, L, P) => Math.sin(TAU * 1800 * P.pitch * t) * expDecay(t, 90), lp: 8000 },
  confirm: { len: 0.32, f: (t, L, P) => osc('tri', (t < 0.09 ? 660 : 990) * P.pitch * t) * env(t, 0.003, 0.05, 0.6, 0.15, L) * 0.8, lp: 7000 },
  cancel: { len: 0.3, f: (t, L, P) => osc('tri', (t < 0.09 ? 520 : 350) * P.pitch * t) * env(t, 0.003, 0.05, 0.6, 0.15, L) * 0.8, lp: 5000 },
  door: { len: 0.9, f: (t, L, P) => (osc('saw', (55 + 12 * Math.sin(TAU * 3 * t)) * t) * 0.5 + noise() * 0.4) * env(t, 0.05, 0.2, 0.6, 0.3, L), lp: 700 },
  alarm: { len: 1.0, f: (t, L, P) => osc('square', (Math.floor(t * 6) % 2 ? 660 : 880) * P.pitch * t) * 0.4, lp: 4000 },
  // ambience: stationary beds, rendered as seamless loops (see renderSfx)
  wind: { len: 8, loop: true, f: (t, L, P) => noise() * (0.55 + 0.3 * Math.sin(TAU * 0.11 * t + P.r1 * 6) + 0.15 * Math.sin(TAU * 0.37 * t + 1.3)), lp: 520, hp: 70 },
  rain: { len: 6, loop: true, gen: (n, P) => { const b = new Float32Array(n); let drop = 0; for (let i = 0; i < n; i++) { if (rnd() < 0.0009) drop = 0.4 + 0.6 * rnd(); drop *= 0.992; b[i] = noise() * (0.35 + drop); } return b; }, lp: 6500, hp: 900 },
  hum: { len: 4, loop: true, xfade: 'linear', f: (t, L, P) => (Math.sin(TAU * 50 * P.pitch * t) * 0.6 + Math.sin(TAU * 100 * P.pitch * t) * 0.3 + Math.sin(TAU * 150 * P.pitch * t) * 0.12) * (0.85 + 0.15 * Math.sin(TAU * 0.5 * t)) + noise() * 0.03, lp: 1200 },
  fire: { len: 6, loop: true, gen: (n, P) => { const b = new Float32Array(n); let pop = 0; for (let i = 0; i < n; i++) { if (rnd() < 0.0012) pop = (0.5 + 0.5 * rnd()) * (rnd() < 0.5 ? 1 : -1); pop *= 0.93; b[i] = noise() * 0.18 + noise() * Math.abs(pop) * 1.4; } return b; }, lp: 5000, hp: 120 },
};

function renderSfx(name, o) {
  const p = SFX[name];
  if (!p) fail(`unknown sfx preset "${name}". Presets: ${Object.keys(SFX).join(', ')}`);
  seedRng(o.seed);
  const L = p.len * o.length;
  const P = { pitch: o.pitch * (1 + (rnd() - 0.5) * 0.06), r1: rnd() };
  const loop = o.loop || p.loop === true;
  // A loop renders filter warm-up + body + crossfade tail, then folds the tail into the head.
  const warm = loop ? Math.round(0.5 * SR) : 0;
  const body = Math.round(L * SR);
  const xf = loop ? Math.round(Math.min(0.5, L * 0.25) * SR) : 0;
  const n = warm + body + xf;
  const span = n / SR;
  let buf;
  if (p.gen) buf = p.gen(n, P);
  else { buf = new Float32Array(n); for (let i = 0; i < n; i++) buf[i] = p.f(i / SR, loop ? span : L, P); }
  if (p.lp) lowpass(buf, p.lp);
  if (p.hp) highpass(buf, p.hp);
  if (!loop) { normalize(buf, o.volume); return { buf: fadeEdges(buf, 2), loop: false }; }
  const seg = buf.subarray(warm);
  const out = new Float32Array(body);
  out.set(seg.subarray(0, body));
  for (let i = 0; i < xf; i++) {
    const a = i / xf;
    const [gIn, gOut] = p.xfade === 'linear' ? [a, 1 - a] : [Math.sin(a * Math.PI / 2), Math.cos(a * Math.PI / 2)];
    out[i] = seg[i] * gIn + seg[body + i] * gOut;   // out[0] == seg[body]: continues straight from out[body - 1]
  }
  normalize(out, o.volume);
  return { buf: out, loop: true, xfade: xf / SR };
}

// ---------------------------------------------------------------- music
const MOODS = {
  dark:   { bpm: 70,  scale: 'minor', prog: [0, 5, 3, 4], pad: 0.5, bass: 0.6, arp: 0.18, drums: 'sparse', lp: 1400, swing: 0 },
  tense:  { bpm: 120, scale: 'minor', prog: [0, 0, 5, 4], pad: 0.35, bass: 0.7, arp: 0.3, drums: 'pulse', lp: 2200, swing: 0 },
  heroic: { bpm: 110, scale: 'minor', prog: [0, 5, 2, 6], pad: 0.45, bass: 0.6, arp: 0.3, drums: 'march', lp: 3200, swing: 0 },
  upbeat: { bpm: 128, scale: 'major', prog: [0, 4, 5, 3], pad: 0.35, bass: 0.6, arp: 0.35, drums: 'four', lp: 4500, swing: 0 },
  calm:   { bpm: 80,  scale: 'major', prog: [0, 5, 3, 4], pad: 0.55, bass: 0.4, arp: 0.25, drums: 'none', lp: 2600, swing: 0.1 },
  mystic: { bpm: 84,  scale: 'dorian', prog: [0, 3, 0, 6], pad: 0.55, bass: 0.45, arp: 0.28, drums: 'sparse', lp: 2000, swing: 0 },
};
const SCALES = { minor: [0, 2, 3, 5, 7, 8, 10], major: [0, 2, 4, 5, 7, 9, 11], dorian: [0, 2, 3, 5, 7, 9, 10] };
const KEYS = { C: 48, 'C#': 49, D: 50, 'D#': 51, E: 52, F: 53, 'F#': 54, G: 55, 'G#': 56, A: 45, 'A#': 46, B: 47 };
const FLATS = { Db: 'C#', Eb: 'D#', Gb: 'F#', Ab: 'G#', Bb: 'A#' };
function keyRoot(k) {
  const norm = String(k).charAt(0).toUpperCase() + String(k).slice(1);
  const name = FLATS[norm] ?? norm;
  if (!(name in KEYS)) fail(`unknown --key "${k}". Keys: ${Object.keys(KEYS).join(' ')} (flats ${Object.keys(FLATS).join(' ')} also work)`);
  return KEYS[name];
}

function renderMusic(mood, o) {
  const M = MOODS[mood];
  if (!M) fail(`unknown music mood "${mood}". Moods: ${Object.keys(MOODS).join(', ')}`);
  seedRng(o.seed);
  const bpm = o.bpm || M.bpm;
  const bars = o.bars || 16;
  const beat = 60 / bpm;
  const barLen = beat * 4;
  const total = Math.round(bars * barLen * SR);
  const root = keyRoot(o.key);
  const sc = SCALES[M.scale];
  const deg = (d, oct = 0) => root + sc[((d % 7) + 7) % 7] + 12 * (Math.floor(d / 7) + oct);
  const chord = (d) => [deg(d), deg(d + 2), deg(d + 4)];
  const mix = new Float32Array(total);
  const add = (start, len, fn, gain) => {
    const s0 = Math.round(start * SR);
    const n = Math.round(len * SR);
    for (let i = 0; i < n; i++) mix[(s0 + i) % total] += fn(i / SR, len) * gain; // wrap → seamless loop
  };
  // progression with an occasional variation every 8 bars
  const prog = [];
  for (let b = 0; b < bars; b++) {
    let d = M.prog[b % M.prog.length];
    if (b % 8 === 7 && rnd() < 0.5) d = [4, 6, 3][Math.floor(rnd() * 3)];
    prog.push(d);
  }
  // pad: detuned saws per chord, slow attack, filtered later
  const pad = new Float32Array(total);
  prog.forEach((d, b) => {
    for (const n of chord(d)) for (const det of [-0.08, 0.07]) {
      const f = midi(n + 12 + det);
      const s0 = Math.round(b * barLen * SR), len = barLen * 1.05;
      for (let i = 0; i < Math.round(len * SR); i++) {
        const t = i / SR;
        pad[(s0 + i) % total] += osc('saw', f * t) * env(t, barLen * 0.3, 0.2, 0.8, barLen * 0.3, len) * 0.12;
      }
    }
  });
  circular(pad, (b) => { lowpass(b, M.lp * 0.6); lowpass(b, M.lp); });
  for (let i = 0; i < total; i++) mix[i] += pad[i] * M.pad;
  // bass: root on beats 1 and 3 (or every beat for pulse/four)
  const bassHits = M.drums === 'pulse' || M.drums === 'four' ? [0, 1, 2, 3] : [0, 2.5];
  prog.forEach((d, b) => bassHits.forEach((h) => {
    const f = midi(deg(d, -1));
    add(b * barLen + h * beat, beat * 0.9, (t, L) => (Math.sin(TAU * f * t) * 0.8 + osc('saw', f * t) * 0.2) * env(t, 0.005, 0.1, 0.7, 0.1, L), M.bass);
  }));
  // arp: chord tones in eighths, pluck envelope, seeded pattern
  const pattern = [0, 1, 2, 1, 2, 0, 1, 2].map((v) => (rnd() < 0.2 ? (v + 1) % 3 : v));
  prog.forEach((d, b) => {
    const tones = chord(d);
    for (let k = 0; k < 8; k++) {
      if (rnd() < (M.drums === 'none' || M.drums === 'sparse' ? 0.35 : 0.12)) continue;
      const f = midi(tones[pattern[k]] + 24);
      const sw = k % 2 ? M.swing * beat * 0.5 : 0;
      add(b * barLen + k * beat / 2 + sw, beat * 0.6, (t) => osc('tri', f * t + 0.25) * expDecay(t, 9) * Math.min(1, t / 0.002), M.arp); // starts at a zero crossing: no click per note
    }
  });
  // drums
  const kick = (t) => Math.sin(TAU * (50 + 90 * Math.exp(-t * 30)) * t) * expDecay(t, 9);
  const snare = (t) => (noise() * 0.7 + Math.sin(TAU * 190 * t) * 0.3) * expDecay(t, 18);
  const hat = (t) => noise() * expDecay(t, 70);
  const drumBuf = new Float32Array(total);
  const hit = (time, fn, len, g) => { const s0 = Math.round(time * SR); for (let i = 0; i < len * SR; i++) drumBuf[(s0 + i) % total] += fn(i / SR) * g; };
  for (let b = 0; b < bars; b++) {
    const t0 = b * barLen;
    switch (M.drums) {
      case 'four': for (let k = 0; k < 4; k++) { hit(t0 + k * beat, kick, 0.4, 0.9); hit(t0 + k * beat + beat / 2, hat, 0.08, 0.25); } hit(t0 + beat, snare, 0.25, 0.5); hit(t0 + 3 * beat, snare, 0.25, 0.5); break;
      case 'march': hit(t0, kick, 0.4, 0.9); hit(t0 + 2 * beat, kick, 0.4, 0.7); for (let k = 0; k < 8; k++) hit(t0 + k * beat / 2, snare, 0.15, k % 2 ? 0.12 : 0.22); hit(t0 + beat, snare, 0.25, 0.45); hit(t0 + 3 * beat, snare, 0.25, 0.45); break;
      case 'pulse': for (let k = 0; k < 4; k++) hit(t0 + k * beat, kick, 0.35, 0.75); for (let k = 0; k < 16; k++) hit(t0 + k * beat / 4, hat, 0.05, k % 4 === 2 ? 0.25 : 0.1); break;
      case 'sparse': hit(t0, kick, 0.6, 0.8); if (b % 2) hit(t0 + 2.5 * beat, kick, 0.6, 0.5); hit(t0 + 3 * beat, snare, 0.4, 0.18); break;
      default: break;
    }
  }
  circular(drumBuf, (b) => highpass(b, 30));
  for (let i = 0; i < total; i++) mix[i] += drumBuf[i];
  // space: two wrapped feedback delays (cheap reverb), wrapped so the loop stays seamless
  const wet = new Float32Array(total);
  for (const [ms, fb, g] of [[beat * 750, 0.35, 0.25], [113, 0.55, 0.18]]) {
    const dl = Math.round(SR * ms / 1000);
    const line = Float32Array.from(mix);
    for (let pass = 0; pass < 2; pass++) for (let i = 0; i < total; i++) line[i] = mix[i] + line[(i - dl + total) % total] * fb;
    for (let i = 0; i < total; i++) wet[i] += (line[i] - mix[i]) * g;
  }
  circular(wet, (b) => lowpass(b, 3000));
  for (let i = 0; i < total; i++) mix[i] += wet[i];
  circular(mix, (b) => highpass(b, 25));
  normalize(mix, 0.8);
  return mix;
}

// ---------------------------------------------------------------- main
const { pos, flags } = parseArgs(process.argv.slice(2));
const [cmd, what, out, ...extra] = pos;
const o = { seed: 1, pitch: 1, length: 1, volume: 0.9, loop: false, bpm: 0, bars: 16, key: 'A', ...flags };
if (o.volume > 1) fail('--volume must be at most 1');
if (cmd === 'list' && !what) {
  const amb = Object.keys(SFX).filter((k) => SFX[k].loop);
  console.log('sfx presets: ' + Object.keys(SFX).filter((k) => !SFX[k].loop).join(', '));
  console.log('ambience presets (seamless loops): ' + amb.map((k) => `${k} (${SFX[k].len} s)`).join(', '));
  console.log('music moods: ' + Object.entries(MOODS).map(([k, v]) => `${k} (${v.bpm} bpm, 16 bars = ${(16 * 240 / v.bpm).toFixed(1)} s)`).join(', '));
  console.log('keys: ' + Object.keys(KEYS).join(' '));
} else if ((cmd === 'sfx' || cmd === 'music') && what && out && extra.length === 0) {
  if (!out.toLowerCase().endsWith('.wav')) fail(`output must be a .wav file, got "${out}"`);
  if (cmd === 'sfx') {
    const r = renderSfx(what, o);
    writeWav(path.resolve(out), r.buf, 'sfx');
    if (r.loop) console.log(`LOOP seamless: tail crossfaded into the head over ${r.xfade.toFixed(2)} s; play it with loop: true`);
  } else {
    if (!Number.isInteger(o.bars)) fail(`--bars must be a whole number, got ${o.bars}`);
    writeWav(path.resolve(out), renderMusic(what, o), 'music');
    console.log(`LOOP seamless: ${o.bars} bars at ${o.bpm || MOODS[what].bpm} bpm`);
  }
} else {
  if (cmd && !FLAGS[cmd]) console.error(`ERROR unknown command "${cmd}". Commands: sfx, music, list`);
  else if (extra.length) console.error(`ERROR unexpected argument(s): ${extra.join(' ')}`);
  else if (cmd) console.error(`ERROR "${cmd}" needs ${cmd === 'list' ? 'no arguments' : 'a preset or mood and an output .wav path'}`);
  console.log(HELP);
  process.exit(2);
}
