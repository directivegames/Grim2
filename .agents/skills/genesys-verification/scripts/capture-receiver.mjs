#!/usr/bin/env node
// Capture receiver for in-Play frames (genesys-verification).
//
// The smoke node POSTs canvas frames here, and this server writes them under <project>/.scratch/play/.
// (The editor's captureScreenshot can also capture Play, with target "auto" or "play".)
//
//   node capture-receiver.mjs [--port 8765] [--idle 10] [--root <project>] [--clean] [--arm [mode]]
//
//   Smoke gate (one-shot): the receiver, not the game, decides whether the next Play runs the smoke
//   test. Arm it with --arm at start or POST /arm; the smoke node asks GET /smoke at beginPlay.
//     mode '1' (default)  → the first GET /smoke gets 200 "1", then the receiver disarms
//     mode 'net:<ms>'     → every GET /smoke within <ms> of arming gets 200 "net" (two-client runs)
//     step filter         → append ':<ids>' to either mode ('1:S02,S09,S16', 'net:60000:N01') and the
//                           answer carries it ("1:S02,S09,S16"), so that Play runs only those steps.
//                           Re-check one fix without replaying the whole ~60 s tour.
//   Not armed → 204, so the creator's own Play never runs the smoke test.
//
//   POST /<name>   body: data:image/jpeg;base64,... or data:image/png;base64,...
//                  → .scratch/play/<name>.jpg (or .png); prints the saved path
//   POST /log      body: JSON {"line": "..."} or plain text → appended to .scratch/play/smoke.log
//   GET  /health   → 200 "ok" (check the receiver is up before entering Play)
//   POST /arm      body: 1 | net:<ms>, each with an optional :<ids> filter → arms the gate
//                  (curl -X POST http://127.0.0.1:8765/arm -d 1, or -d 1:S09,S10,S16)
//   GET  /smoke    → 200 with the mode while armed (then disarms for '1'), 204 otherwise
//
// Binds 127.0.0.1 only. Exits after --idle minutes with no request (default 10) or on SIGINT.
// Plain Node, no dependencies.

import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith('--') ? true : v;
}

function findProjectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return path.resolve(start);
    dir = up;
  }
}

const port = Number(arg('port', process.env.CAPTURE_PORT ?? 8765));
const idleMinutes = Number(arg('idle', 10));
const root = arg('root', null) ? path.resolve(String(arg('root'))) : findProjectRoot(process.cwd());
const outDir = path.join(root, '.scratch', 'play');
const logFile = path.join(outDir, 'smoke.log');
const MAX_BODY = 25 * 1024 * 1024;

// ---- smoke gate
let armed = null; // { mode: '1', only } or { mode: 'net', until: epoch ms, only }; only = 'S09,S10' or ''
const IDS = '(?::([A-Za-z]+\\d+(?:,[A-Za-z]+\\d+)*))?';
function arm(raw) {
  const text = String(raw ?? '1').trim().replace(/\s+/g, '') || '1';
  const net = new RegExp(`^net(?::(\\d+))?${IDS}$`).exec(text);
  if (net) {
    const ms = Number(net[1] ?? 60000);
    armed = { mode: 'net', until: Date.now() + ms, only: net[2] ?? '' };
    console.log(`[capture] armed net for ${Math.round(ms / 1000)} s${armed.only ? ` (only ${armed.only})` : ''}`);
    return `net ${ms}${armed.only ? ` only ${armed.only}` : ''}`;
  }
  const one = new RegExp(`^1${IDS}$`).exec(text);
  if (!one) return null;
  armed = { mode: '1', only: one[1] ?? '' };
  console.log(`[capture] armed 1 (next Play runs the smoke test once${armed.only ? `, only ${armed.only}` : ''})`);
  return `1${armed.only ? ` only ${armed.only}` : ''}`;
}
function consume() {
  if (!armed) return null;
  const suffix = armed.only ? `:${armed.only}` : '';
  if (armed.mode === 'net') {
    if (Date.now() > armed.until) { armed = null; console.log('[capture] net arm expired'); return null; }
    console.log(`[capture] smoke consumed (net${suffix})`);
    return `net${suffix}`;
  }
  armed = null;
  console.log(`[capture] smoke consumed (1${suffix}), disarmed`);
  return `1${suffix}`;
}
const armArg = arg('arm', null);
if (armArg !== null && arm(armArg === true ? '1' : armArg) === null) {
  console.error(`[capture] bad --arm value "${armArg}" (use 1, net:<ms>, optionally followed by :<ids> such as 1:S09,S16)`);
  process.exit(1);
}

fs.mkdirSync(outDir, { recursive: true });
if (arg('clean', false)) {
  for (const f of fs.readdirSync(outDir)) {
    if (/\.(jpe?g|png)$/i.test(f) || f === 'smoke.log') fs.rmSync(path.join(outDir, f));
  }
}

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Private-Network': 'true',
};

let idleTimer = null;
function touch() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    console.log(`[capture] idle ${idleMinutes} min, exiting`);
    process.exit(0);
  }, idleMinutes * 60 * 1000);
}

function reply(res, code, text) {
  res.writeHead(code, { ...CORS, 'Content-Type': 'text/plain' });
  res.end(text);
}

function safeName(raw) {
  const name = decodeURIComponent(raw).replace(/^\/+/, '').replace(/\.(jpe?g|png)$/i, '');
  const clean = name.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64);
  return clean || `frame-${Date.now()}`;
}

const server = http.createServer((req, res) => {
  touch();
  if (req.method === 'OPTIONS') return reply(res, 204, '');
  const url = new URL(req.url ?? '/', 'http://127.0.0.1');
  if (req.method === 'GET' && url.pathname === '/health') return reply(res, 200, 'ok');
  if (req.method === 'GET' && url.pathname === '/smoke') {
    const mode = consume();
    return mode ? reply(res, 200, mode) : reply(res, 204, '');
  }
  if (req.method !== 'POST') return reply(res, 405, 'POST only');

  const chunks = [];
  let size = 0;
  req.on('data', (c) => {
    size += c.length;
    if (size > MAX_BODY) { reply(res, 413, 'too large'); req.destroy(); return; }
    chunks.push(c);
  });
  req.on('end', () => {
    if (res.writableEnded) return;
    const body = Buffer.concat(chunks).toString('utf8');

    if (url.pathname === '/arm') {
      const r = arm(body);
      return r ? reply(res, 200, `armed ${r}`) : reply(res, 400, 'body must be 1 or net:<ms>, optionally followed by :<ids> (1:S09,S16)');
    }

    if (url.pathname === '/log') {
      let line = body.trim();
      try {
        const j = JSON.parse(body);
        line = typeof j === 'string' ? j : (j.line ?? JSON.stringify(j));
      } catch { /* plain text */ }
      fs.appendFileSync(logFile, `${line}\n`);
      console.log(`[capture] log ${line}`);
      return reply(res, 200, 'ok');
    }

    const m = /^data:image\/(jpeg|jpg|png);base64,(.+)$/s.exec(body.trim());
    if (!m) return reply(res, 400, 'expected a data:image/jpeg or data:image/png URL as the body');
    const ext = m[1] === 'png' ? 'png' : 'jpg';
    const bytes = Buffer.from(m[2], 'base64');
    if (bytes.length === 0) return reply(res, 400, 'empty image');
    const file = path.join(outDir, `${safeName(url.pathname)}.${ext}`);
    fs.writeFileSync(file, bytes);
    console.log(`[capture] saved ${file} (${Math.round(bytes.length / 1024)} KB)`);
    return reply(res, 200, file);
  });
});

server.on('error', (e) => {
  console.error(`[capture] ${e.code === 'EADDRINUSE' ? `port ${port} is in use (another receiver running?)` : e.message}`);
  process.exit(1);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[capture] listening on http://127.0.0.1:${port} → ${outDir} (idle exit ${idleMinutes} min)`);
  touch();
});

process.on('SIGINT', () => { console.log('[capture] stopped'); process.exit(0); });
process.on('SIGTERM', () => process.exit(0));
