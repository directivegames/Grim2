// Live-only analysis of a Chrome .heaptimeline / .heapsnapshot.
//
// Freed allocations are ignored: everything reported is an object that is
// still present in the final snapshot. Retained sizes come from a dominator
// tree over strong edges (weak edges skipped, shortcut edges only from the
// root), matching Chrome DevTools. Native payloads without their own
// allocation stack (ArrayBuffer backing stores, external strings) are
// attributed to the nearest dominator that has one.
//
// Usage:
//   node --max-old-space-size=20000 <this> <capture> [options]
// Options:
//   --out=<file>            report path (default: next to the capture, <capture>.retained.txt)
//   --project=<regex>       script URL pattern for "project" frames (default: /src/)
//   --probe=<id,id>         dump the retained children of these @ids
//   --depth=<n>             probe depth (default 2)
//   --class=<Name,Name>     list the largest instances of these constructors with a GC root path
//   --late-from=<seconds>   list live bytes allocated after this time, by stack
//   --holders=<Name>        find objects holding the most edges to this class
//   --wide                  list 45 top-level dominator children and stop at depth 2
//   --json-only             write <capture>.summary.json only (no .retained.txt)
//   --no-json               skip the .summary.json sidecar (text report only)
//   --json-out=<file>       summary path (default: next to capture)
//   --project-root=<dir>    game project root (default: capture meta projectCwd, else cwd)
//   --patterns=<file>       project rules file (default: <project-root>/.genesys/heap-patterns.json)
//   --no-project-patterns   skill-wide section 0 only
import { open, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { loadProjectHeapPatterns } from './load-project-heap-patterns.mjs';
import { mergeHeapPatternHits, scanHeapPatterns, scanProjectHeapPatterns } from './heap-pattern-scan.mjs';

// Timelines carry trace_node_id per node (7 fields); plain snapshots do not (6).
let NF = 7, TRACE_IDX = 5;
const EF = 3, TF = 6;
const TYPE_NAMES = ['hidden', 'array', 'string', 'object', 'code', 'closure', 'regexp', 'number',
  'native', 'synthetic', 'concatenated string', 'sliced string', 'symbol', 'bigint', 'object shape'];
const STRING_TYPES = new Set([2, 10, 11]);
const T_SYNTHETIC = 9;
const E_CONTEXT = 0, E_ELEMENT = 1, E_HIDDEN = 4, E_SHORTCUT = 5, E_WEAK = 6;

const positional = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const flags = Object.fromEntries(process.argv.slice(2).filter((a) => a.startsWith('--')).map((a) => {
  const [k, ...v] = a.slice(2).split('=');
  return [k, v.length ? v.join('=') : 'true'];
}));
if (!positional[0]) {
  console.error('Usage: node analyze-heap-retained.mjs <file.heaptimeline|file.heapsnapshot> [--out=...] [--probe=ids] ...');
  process.exit(1);
}
const inputPath = path.resolve(positional[0]);
if (!/\.heaptimeline$/i.test(inputPath) && !/\.heapsnapshot$/i.test(inputPath)) {
  console.error('Expected a Chrome heap capture: .heaptimeline (allocation stacks) or .heapsnapshot (retainers only).');
  process.exit(1);
}
const captureKind = /\.heaptimeline$/i.test(inputPath) ? 'heaptimeline' : 'heapsnapshot';
const ALLOCATION_TIMELINE_HINT =
  'This file is a plain heap snapshot — it has no allocation call stacks. '
  + 'To see who created live objects, record an allocation timeline (.heaptimeline): '
  + 'DevTools Memory → "Allocation instrumentation on timeline", or '
  + 'capture-heap.mjs with default --mode=timeline (not --mode=snapshot). '
  + 'See recording-captures.md in this skill.';
// Reports stay beside the capture (default: <project>/.genesys/captures).
const baseName = path.basename(inputPath).replace(/\.(heaptimeline|heapsnapshot)$/, '');
const outPath = path.resolve(flags.out ?? path.join(path.dirname(inputPath), `${baseName}.retained.txt`));
const jsonPath = path.resolve(flags['json-out'] ?? path.join(path.dirname(inputPath), `${baseName}.summary.json`));
const writeTextReport = flags['json-only'] !== 'true';
const writeJson = flags['no-json'] !== 'true';
// Genesys: game src, packs, built bundle, and Vite @fs paths.
const projectPattern = flags.project
  ? new RegExp(flags.project)
  : /(\/(src|packs)\/|\.dist\/|@fs\/)/;

const fmt = (b) => {
  const v = Math.abs(b);
  if (v < 1024) return `${b.toFixed(0)} B`;
  const u = ['KB', 'MB', 'GB']; let s = v / 1024, i = 0;
  while (s >= 1024 && i < 2) { s /= 1024; i++; }
  return `${b < 0 ? '-' : ''}${s.toFixed(s >= 100 ? 0 : s >= 10 ? 1 : 2)} ${u[i]}`;
};
const cnt = (v) => Math.round(v).toLocaleString('en-US');
const pct = (a, b) => (b ? `${(a / b * 100).toFixed(1)}%` : '0%');

async function findMarker(file, from, marker) {
  const needle = Buffer.from(marker);
  const chunk = Buffer.allocUnsafe(4 << 20);
  let pos = from, pending = Buffer.alloc(0);
  for (;;) {
    const { bytesRead } = await file.read(chunk, 0, chunk.length, pos);
    pos += bytesRead;
    const win = pending.length ? Buffer.concat([pending, chunk.subarray(0, bytesRead)]) : chunk.subarray(0, bytesRead);
    const i = win.indexOf(needle);
    if (i >= 0) return pos - bytesRead - pending.length + i;
    if (!bytesRead) return -1;
    pending = Buffer.from(win.subarray(Math.max(0, win.length - needle.length + 1)));
  }
}

async function parseUint32(file, start, end, length) {
  const data = new Uint32Array(length);
  const chunk = Buffer.allocUnsafe(8 << 20);
  let pos = start, idx = 0, acc = 0, inNum = false;
  outer: while (pos < end) {
    const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, end - pos), pos);
    if (!bytesRead) break;
    pos += bytesRead;
    for (let i = 0; i < bytesRead; i++) {
      const c = chunk[i];
      if (c >= 48 && c <= 57) { acc = acc * 10 + (c - 48); inNum = true; }
      else {
        if (inNum) { data[idx++] = acc; acc = 0; inNum = false; }
        if (c === 93) break outer;
      }
    }
  }
  if (idx !== length) throw new Error(`expected ${length} numbers, parsed ${idx}`);
  return data;
}

async function readText(file, start, end) {
  const buf = Buffer.allocUnsafe(Math.max(0, end - start));
  await file.read(buf, 0, buf.length, start);
  return buf.toString('utf8');
}

async function parseStrings(file, start, end, needed) {
  const strings = new Map();
  const chunk = Buffer.allocUnsafe(8 << 20);
  let pos = start, index = 0, inStr = false, esc = false, cur = [], keep = false, done = false;
  let uni = -1, uniBuf = '';
  while (pos < end && !done) {
    const { bytesRead } = await file.read(chunk, 0, Math.min(chunk.length, end - pos), pos);
    if (!bytesRead) break;
    pos += bytesRead;
    const text = chunk.toString('latin1', 0, bytesRead);
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (!inStr) {
        if (ch === '"') { inStr = true; keep = needed.has(index); cur = []; }
        else if (ch === ']') { done = true; break; }
        continue;
      }
      if (uni >= 0) {
        uniBuf += ch;
        if (uniBuf.length === 4) { if (keep) cur.push(String.fromCharCode(parseInt(uniBuf, 16))); uni = -1; uniBuf = ''; }
        continue;
      }
      if (esc) {
        esc = false;
        if (ch === 'u') { uni = 0; uniBuf = ''; continue; }
        if (keep) cur.push(ch === 'n' ? '\n' : ch === 't' ? '\t' : ch === 'r' ? '\r' : ch);
        continue;
      }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') {
        if (keep) {
          const s = Buffer.from(cur.join(''), 'latin1').toString('utf8');
          strings.set(index, s.length > 200 ? s.slice(0, 200) : s);
        }
        index++; inStr = false; continue;
      }
      if (keep && cur.length < 400) cur.push(ch);
    }
  }
  return strings;
}

async function main() {
  const file = await open(inputPath, 'r');
  const { size: fileSize } = await file.stat();
  const nodesAt = await findMarker(file, 0, '"nodes":[');
  if (nodesAt < 0) throw new Error('not a V8 heap snapshot: missing "nodes"');
  const header = JSON.parse(`${(await readText(file, 0, nodesAt)).trim().replace(/,$/, '')}}`);
  const meta = header.snapshot.meta;
  const fields = meta.node_fields.join();
  if (fields === 'type,name,id,self_size,edge_count,trace_node_id,detachedness') { NF = 7; TRACE_IDX = 5; }
  else if (fields === 'type,name,id,self_size,edge_count,detachedness') { NF = 6; TRACE_IDX = -1; }
  else throw new Error(`unexpected node_fields ${meta.node_fields}`);
  const N = header.snapshot.node_count, E = header.snapshot.edge_count, T = header.snapshot.trace_function_count ?? 0;
  const timeline = T > 0;
  const markers = timeline
    ? ['"nodes":[', '"edges":[', '"trace_function_infos":[', '"trace_tree":[', '"samples":[', '"locations":[', '"strings":[']
    : ['"nodes":[', '"edges":[', '"strings":['];
  const off = {}; let from = nodesAt;
  for (const m of markers) {
    const at = await findMarker(file, from, m);
    if (at < 0) throw new Error(`missing ${m}`);
    off[m] = at + m.length; from = at + m.length;
  }
  // Numbers stop at the first ']', so the strings offset is a safe upper bound.
  const edgesEnd = timeline ? off['"trace_function_infos":['] : off['"strings":['];

  console.error(`parsing ${cnt(N)} nodes, ${cnt(E)} edges`);
  const nodes = await parseUint32(file, off['"nodes":['], off['"edges":['], N * NF);
  const edges = await parseUint32(file, off['"edges":['], edgesEnd, E * EF);
  let infos = new Uint32Array(0), traceRoots = [], samples = [];
  if (timeline) {
    infos = await parseUint32(file, off['"trace_function_infos":['], off['"trace_tree":['], T * TF);
    traceRoots = JSON.parse((await readText(file, off['"trace_tree":['] - 1, off['"samples":['] - '"samples":['.length)).trim().replace(/,$/, ''));
    const sampleText = await readText(file, off['"samples":['], off['"locations":['] - '"locations":['.length);
    samples = sampleText.slice(0, sampleText.indexOf(']')).split(',').filter((s) => s.trim()).map(Number);
  }

  const needed = new Set();
  for (let i = 0; i < N; i++) if (!STRING_TYPES.has(nodes[i * NF])) needed.add(nodes[i * NF + 1]);
  for (let e = 0; e < E; e++) { const t = edges[e * EF]; if (t !== E_ELEMENT && t !== E_HIDDEN) needed.add(edges[e * EF + 1]); }
  for (let i = 0; i < T; i++) { needed.add(infos[i * TF + 1]); needed.add(infos[i * TF + 2]); }
  console.error('parsing strings');
  const strings = await parseStrings(file, off['"strings":['], fileSize, needed);
  await file.close();

  const S = (i) => strings.get(i) ?? '';
  const selfOf = (n) => nodes[n * NF + 3];
  const nodeClass = (n) => {
    const t = nodes[n * NF];
    if (STRING_TYPES.has(t)) return '(string)';
    if (t === 5) return `(closure ${S(nodes[n * NF + 1]) || 'anon'})`;
    if (t === 1) return '(array)';
    if (t === 4) return '(code)';
    const name = S(nodes[n * NF + 1]);
    return (name.length > 70 ? `${name.slice(0, 67)}...` : name) || `(${TYPE_NAMES[t]})`;
  };
  const nodeLabel = (n) => `${nodeClass(n)} @${nodes[n * NF + 2]}`;
  const edgeName = (e) => {
    const t = edges[e * EF], v = edges[e * EF + 1];
    if (t === E_ELEMENT || t === E_HIDDEN) return `[${v}]`;
    if (t === E_CONTEXT) return `ctx:${S(v)}`;
    return S(v) || `#${v}`;
  };

  // Forward and reverse edge indexes over strong edges.
  const firstEdge = new Uint32Array(N + 1);
  for (let i = 0; i < N; i++) firstEdge[i + 1] = firstEdge[i] + nodes[i * NF + 4];
  const essential = (fromNode, e) => { const t = edges[e * EF]; return t !== E_WEAK && (t !== E_SHORTCUT || fromNode === 0); };
  console.error('building retainers');
  const retFirst = new Uint32Array(N + 1);
  for (let n = 0; n < N; n++) for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (essential(n, e)) retFirst[edges[e * EF + 2] / NF + 1]++;
  for (let i = 0; i < N; i++) retFirst[i + 1] += retFirst[i];
  const retNode = new Uint32Array(retFirst[N]); const retEdge = new Uint32Array(retFirst[N]);
  {
    const fill = new Uint32Array(N);
    for (let n = 0; n < N; n++) for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (essential(n, e)) {
      const t = edges[e * EF + 2] / NF; const k = retFirst[t] + fill[t]++; retNode[k] = n; retEdge[k] = e;
    }
  }

  // Iterative DFS postorder from the root.
  const post = new Int32Array(N).fill(-1); const order = new Uint32Array(N);
  let reachable = 0;
  {
    const stack = new Uint32Array(N); const stackEdge = new Uint32Array(N); const visited = new Uint8Array(N);
    let sp = 1; stack[0] = 0; stackEdge[0] = firstEdge[0]; visited[0] = 1;
    while (sp) {
      const n = stack[sp - 1];
      let pushed = false;
      for (let e = stackEdge[sp - 1]; e < firstEdge[n + 1]; e++) {
        if (!essential(n, e)) continue;
        const t = edges[e * EF + 2] / NF;
        if (visited[t]) continue;
        visited[t] = 1; stackEdge[sp - 1] = e + 1; stack[sp] = t; stackEdge[sp] = firstEdge[t]; sp++; pushed = true; break;
      }
      if (!pushed) { sp--; post[n] = reachable; order[reachable] = n; reachable++; }
    }
  }

  // Cooper-Harvey-Kennedy dominators on postorder indices.
  console.error(`dominators over ${cnt(reachable)} reachable nodes`);
  const rootPo = post[0];
  const dom = new Int32Array(reachable).fill(-1); dom[rootPo] = rootPo;
  for (let changed = true, pass = 1; changed; pass++) {
    changed = false;
    for (let po = rootPo - 1; po >= 0; po--) {
      const n = order[po];
      let nd = -1;
      for (let k = retFirst[n]; k < retFirst[n + 1]; k++) {
        const p = post[retNode[k]];
        if (p < 0 || dom[p] < 0) continue;
        if (nd < 0) { nd = p; continue; }
        let a = p, b = nd;
        while (a !== b) { while (a < b) a = dom[a]; while (b < a) b = dom[b]; }
        nd = a;
      }
      if (nd >= 0 && dom[po] !== nd) { dom[po] = nd; changed = true; }
    }
    if (!changed) console.error(`dominators converged in ${pass} passes`);
  }
  const idom = new Int32Array(N).fill(-1);
  for (let po = 0; po < reachable; po++) idom[order[po]] = order[dom[po]];

  const retained = new Float64Array(N);
  let liveTotal = 0, unreachableBytes = 0;
  for (let n = 0; n < N; n++) { retained[n] = selfOf(n); liveTotal += selfOf(n); if (post[n] < 0) unreachableBytes += selfOf(n); }
  for (let po = 0; po < reachable; po++) { const n = order[po]; if (n !== 0) retained[idom[n]] += retained[n]; }

  // Credit each node to the nearest dominator carrying an allocation stack.
  const ownerTrace = new Uint32Array(N);
  const ownerNode = new Int32Array(N).fill(-1);
  for (let po = reachable - 1; po >= 0; po--) {
    const n = order[po]; const tid = TRACE_IDX < 0 ? 0 : nodes[n * NF + TRACE_IDX];
    if (tid) { ownerTrace[n] = tid; ownerNode[n] = n; }
    else if (n !== 0) { ownerTrace[n] = ownerTrace[idom[n]]; ownerNode[n] = ownerNode[idom[n]]; }
  }

  const traceById = new Map();
  const walk = (flat, parent) => {
    const list = [];
    for (let i = 0; i + 4 < flat.length; i += 5) {
      const t = { id: flat[i], fn: flat[i + 1], parent, children: [], live: 0, liveIncl: 0, liveCount: 0, classes: null };
      traceById.set(t.id, t); t.children = walk(flat[i + 4], t); list.push(t);
    }
    return list;
  };
  const roots = walk(traceRoots, null);
  const fnScript = (fn) => S(infos[fn * TF + 2]);
  const fnName = (fn) => S(infos[fn * TF + 1]) || '(anonymous)';
  const shortScript = (s) => {
    if (!s) return '';
    const m = s.match(/localhost:\d+\/(.*?)(\?.*)?$/);
    return (m ? m[1] : s).replace(/^node_modules\/\.vite\/deps\//, 'deps/');
  };
  const frame = (t) => {
    if (!t || t.fn === undefined) return '(root)';
    const sc = shortScript(fnScript(t.fn));
    return sc ? `${fnName(t.fn)} ${sc}:${infos[t.fn * TF + 4] + 1}` : fnName(t.fn);
  };
  const isProject = (t) => projectPattern.test(fnScript(t.fn) ?? '') && !/node_modules/.test(fnScript(t.fn));
  const add = (map, key, size, c = 1) => { const x = map.get(key); if (x) { x.size += size; x.count += c; } else map.set(key, { size, count: c }); };

  let attributed = 0, preRecording = 0, directTraced = 0;
  const preRecordingByClass = new Map();
  for (let n = 0; n < N; n++) {
    const sz = selfOf(n); if (!sz || post[n] < 0) continue;
    const t = ownerTrace[n] ? traceById.get(ownerTrace[n]) : null;
    if (!t) { preRecording += sz; add(preRecordingByClass, nodeClass(n), sz); continue; }
    if (TRACE_IDX >= 0 && nodes[n * NF + TRACE_IDX]) directTraced += sz;
    attributed += sz; t.live += sz; t.liveCount++;
    t.classes ??= new Map();
    add(t.classes, nodeClass(n), sz);
  }
  const incl = (t) => { let s = t.live; for (const c of t.children) s += incl(c); t.liveIncl = s; return s; };
  for (const r of roots) incl(r);

  const L = [];
  const table = (title, map, total, n = 25) => {
    L.push(title);
    for (const [k, v] of [...map.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, n)) {
      L.push(`${fmt(v.size).padStart(10)} ${pct(v.size, total).padStart(6)} ${cnt(v.count).padStart(10)}  ${k}`);
    }
    L.push('');
  };
  const allocSite = (n) => {
    const t = ownerTrace[n] ? traceById.get(ownerTrace[n]) : null;
    if (!t) return '';
    let p = t;
    while (p && p.fn !== undefined && !isProject(p)) p = p.parent;
    return `  [alloc ${frame(t)}${p && p !== t && p.fn !== undefined ? ` <- ${frame(p)}` : ''}]`;
  };

  L.push(`Capture ${path.basename(inputPath)}  (live objects only; freed allocations excluded)`);
  L.push(`Live heap ${fmt(liveTotal)} in ${cnt(N)} nodes; unreachable ${fmt(unreachableBytes)}`);
  if (timeline) {
    L.push(`Allocated during the recording and still live: ${fmt(attributed)} (${pct(attributed, liveTotal)}); ${fmt(directTraced)} has its own stack, ${fmt(attributed - directTraced)} is payload credited to a traced owner`);
    L.push(`Live but owned by nothing allocated during the recording: ${fmt(preRecording)}`);
  } else {
    L.push('Plain heap snapshot: no allocation stacks; sections 1-5 and 9 are skipped.');
    L.push(ALLOCATION_TIMELINE_HINT);
  }
  L.push('');

  if (timeline) {
    L.push('== 1. Top-down allocation call tree (live bytes, including credited native payload) ==');
    const thr = Math.max(attributed * 0.004, 1 << 20);
    const printTree = (t, depth, label) => {
      if (t.liveIncl < thr || depth > 40) return;
      let cur = t, rec = 0;
      for (;;) {
        const big = cur.children.filter((c) => c.liveIncl >= thr);
        if (big.length === 1 && cur.live < thr && frame(big[0]) === frame(cur)) { cur = big[0]; rec++; } else break;
      }
      L.push(`${'  '.repeat(depth)}${fmt(t.liveIncl).padStart(9)} self ${fmt(cur.live).padStart(9)}  ${label ?? frame(t)}${rec ? `  (x${rec + 1} recursion)` : ''}`);
      if (cur.live >= thr && cur.classes) {
        const top = [...cur.classes.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 4).map(([k, v]) => `${k} ${fmt(v.size)}`).join(', ');
        L.push(`${'  '.repeat(depth + 1)}          = ${top}`);
      }
      for (const k of cur.children.filter((c) => c.liveIncl >= thr).sort((a, b) => b.liveIncl - a.liveIncl).slice(0, 8)) printTree(k, depth + 1);
    };
    for (const r of roots) printTree(r, 0, '(all live allocations recorded)');
    L.push('');

    const byProject = new Map(), byLeaf = new Map(), byFunctionIncl = new Map();
    for (const t of traceById.values()) {
      if (!t.live) continue;
      let p = t;
      while (p && p.fn !== undefined && !isProject(p)) p = p.parent;
      add(byProject, p && p.fn !== undefined ? frame(p) : '(no frame matches --project)', t.live, t.liveCount);
      const fr = []; let q = t; while (q && q.fn !== undefined && fr.length < 4) { fr.push(frame(q)); q = q.parent; }
      add(byLeaf, fr.join('  <=  '), t.live, t.liveCount);
      const seen = new Set(); q = t;
      while (q && q.fn !== undefined) { const f = frame(q); if (!seen.has(f)) { seen.add(f); add(byFunctionIncl, f, t.live, t.liveCount); } q = q.parent; }
    }
    table(`== 2. Live bytes by nearest project frame (script matching ${projectPattern}) ==`, byProject, attributed, 30);
    table('== 3. Live bytes by function, inclusive (any frame on the stack) ==', byFunctionIncl, attributed, 45);
    table('== 4. Live bytes by leaf allocation site (4 innermost frames) ==', byLeaf, attributed, 30);
    table('== 5. Live bytes not owned by any traced object ==', preRecordingByClass, preRecording, 15);
  }

  // Dominator tree children, CSR.
  const childFirst = new Uint32Array(N + 1);
  for (let n = 1; n < N; n++) if (idom[n] >= 0) childFirst[idom[n] + 1]++;
  for (let i = 0; i < N; i++) childFirst[i + 1] += childFirst[i];
  const domChild = new Uint32Array(childFirst[N]);
  {
    const cf = new Uint32Array(N);
    for (let n = 1; n < N; n++) if (idom[n] >= 0) { const p = idom[n]; domChild[childFirst[p] + cf[p]++] = n; }
  }
  const kids = (n) => Array.from(domChild.subarray(childFirst[n], childFirst[n + 1]));
  const viaEdge = (n) => {
    const p = idom[n];
    for (let k = retFirst[n]; k < retFirst[n + 1]; k++) if (retNode[k] === p) return `.${edgeName(retEdge[k])}`;
    const k = retFirst[n];
    return k < retFirst[n + 1] ? ` (via ${nodeClass(retNode[k])}.${edgeName(retEdge[k])})` : '';
  };

  L.push('== 6. Dominator tree: who retains it (single-owner chains collapsed) ==');
  const dthr = Math.max(liveTotal * 0.004, 1 << 20);
  const wide = flags.wide === 'true';
  const printDom = (n, depth, via) => {
    let cur = n, skipped = 0;
    for (;;) {
      const big = kids(cur).filter((c) => retained[c] >= dthr);
      if (big.length === 1 && retained[big[0]] > retained[cur] * 0.97 && depth > 1) { cur = big[0]; skipped++; } else break;
    }
    L.push(`${'  '.repeat(depth)}${fmt(retained[n]).padStart(9)}  ${via}${nodeLabel(n)}${skipped ? `  ... ${skipped} single-owner hops ... ${nodeLabel(cur)}` : ''}${allocSite(cur)}`);
    if (depth > 18 || (wide && depth >= 2)) return;
    const children = kids(cur);
    const shown = children.filter((c) => retained[c] >= dthr).sort((a, b) => retained[b] - retained[a]).slice(0, wide && depth <= 1 ? 45 : 10);
    for (const c of shown) printDom(c, depth + 1, `${viaEdge(c)} -> `);
    const rest = children.reduce((s, c) => s + retained[c], 0) - shown.reduce((s, c) => s + retained[c], 0);
    if (rest >= dthr) L.push(`${'  '.repeat(depth + 1)}${fmt(rest).padStart(9)}  (${cnt(children.length - shown.length)} smaller children)`);
  };
  printDom(0, 0, '');
  L.push('');

  // Retained size by constructor, counting only outermost instances.
  const classId = new Map(); const nodeCls = new Uint32Array(N);
  for (let n = 0; n < N; n++) { const k = nodeClass(n); let id = classId.get(k); if (id === undefined) { id = classId.size; classId.set(k, id); } nodeCls[n] = id; }
  const onStack = new Uint32Array(classId.size);
  const clsRet = new Float64Array(classId.size), clsCnt = new Float64Array(classId.size), clsSelf = new Float64Array(classId.size);
  {
    const it = new Uint32Array(N); const dstack = new Uint32Array(N); let dsp = 1;
    dstack[0] = 0; it[0] = childFirst[0]; onStack[nodeCls[0]]++;
    while (dsp) {
      const n = dstack[dsp - 1];
      if (it[n] < childFirst[n + 1]) {
        const c = domChild[it[n]++]; const cl = nodeCls[c];
        if (nodes[c * NF] !== T_SYNTHETIC) {
          clsCnt[cl]++; clsSelf[cl] += selfOf(c);
          if (!onStack[cl]) clsRet[cl] += retained[c];
        }
        onStack[cl]++; it[c] = childFirst[c]; dstack[dsp++] = c;
      } else { onStack[nodeCls[n]]--; dsp--; }
    }
  }
  const clsRows = [...classId.keys()].map((k, i) => [k, clsRet[i], clsCnt[i], clsSelf[i]]).filter((r) => r[2] > 0).sort((a, b) => b[1] - a[1]);
  L.push('== 7. Retained size by constructor (outermost instances, like DevTools Summary) ==');
  L.push('  retained    shallow      count  constructor');
  for (const [k, r, c, s] of clsRows.slice(0, 50)) L.push(`${fmt(r).padStart(10)} ${fmt(s).padStart(10)} ${cnt(c).padStart(10)}  ${k}`);
  L.push('');

  // Shortest strong path from the root, for labelling owners.
  const dist = new Int32Array(N).fill(-1);
  {
    const q = new Uint32Array(N); let h = 0, tl = 0; q[tl++] = 0; dist[0] = 0;
    while (h < tl) {
      const n = q[h++];
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
        if (!essential(n, e)) continue;
        const t = edges[e * EF + 2] / NF;
        if (dist[t] < 0) { dist[t] = dist[n] + 1; q[tl++] = t; }
      }
    }
  }
  const pathOf = (n) => {
    const parts = []; let cur = n;
    for (let guard = 0; cur !== 0 && guard < 14; guard++) {
      let best = -1, be = -1;
      for (let k = retFirst[cur]; k < retFirst[cur + 1]; k++) {
        const p = retNode[k];
        if (dist[p] < 0 || dist[p] !== dist[cur] - 1) continue;
        const sys = /^system|^\(/.test(nodeClass(p));
        if (best < 0 || !sys) { best = p; be = retEdge[k]; if (!sys) break; }
      }
      if (best < 0) break;
      parts.push(`${nodeClass(best)}.${edgeName(be)}`); cur = best;
    }
    return parts.reverse().join(' -> ');
  };

  const cands = [];
  for (let n = 1; n < N; n++) {
    if (retained[n] < 2 * 1024 * 1024) continue;
    const t = nodes[n * NF]; if (t !== 3 && t !== 5) continue;
    if (t === 3 && /^system|^\(|^Object$|^Array$|^Map$|^Set$/.test(nodeClass(n))) continue;
    cands.push(n);
  }
  cands.sort((a, b) => retained[b] - retained[a]);
  L.push('== 8. Largest named retainers (>= 2 MB) with a shortest GC root path ==');
  for (const n of cands.slice(0, 40)) {
    L.push(`${fmt(retained[n]).padStart(10)}  ${nodeLabel(n)}${allocSite(n)}`);
    L.push(`            path: ${pathOf(n)}`);
  }
  L.push('');

  const sT = [], sI = [];
  for (let i = 0; i + 1 < samples.length; i += 2) { sT.push(samples[i]); sI.push(samples[i + 1]); }
  const timeOfId = (id) => {
    let lo = 0, hi = sI.length - 1;
    while (lo < hi) { const m = (lo + hi) >> 1; if (sI[m] < id) lo = m + 1; else hi = m; }
    return id > sI[sI.length - 1] ? -1 : sT[lo] - sT[0];
  };
  if (sI.length) {
    const B = 20; const buckets = new Float64Array(B);
    const span = Math.max(1, sT[sT.length - 1] - sT[0]);
    for (let n = 0; n < N; n++) {
      const o = ownerNode[n]; if (o < 0) continue;
      const tm = timeOfId(nodes[o * NF + 2]); if (tm < 0) continue;
      buckets[Math.min(B - 1, Math.floor(tm / span * B))] += selfOf(n);
    }
    L.push('== 9. Live bytes by allocation time (owner id -> sample time) ==');
    for (let b = 0; b < B; b++) {
      const label = `${(span * b / B / 1e6).toFixed(0)}-${(span * (b + 1) / B / 1e6).toFixed(0)}s`;
      L.push(`${label.padStart(10)} ${fmt(buckets[b]).padStart(10)}  ${'#'.repeat(Math.round(buckets[b] / Math.max(1, attributed) * 100))}`);
    }
    L.push('');
  }

  if (flags['late-from'] && sI.length) {
    const fromUs = Number(flags['late-from']) * 1e6;
    const late = new Map();
    for (let n = 0; n < N; n++) {
      const o = ownerNode[n]; if (o < 0 || timeOfId(nodes[o * NF + 2]) < fromUs) continue;
      const fr = []; let q = traceById.get(ownerTrace[n]);
      while (q && q.fn !== undefined && fr.length < 7) { fr.push(frame(q)); q = q.parent; }
      add(late, fr.join('  <=  '), selfOf(n));
    }
    table(`== Live bytes allocated after ${flags['late-from']}s ==`, late, [...late.values()].reduce((s, v) => s + v.size, 0), 20);
  }

  if (flags.probe) {
    const want = new Set(flags.probe.split(',').map(Number));
    const byId = new Map();
    for (let n = 0; n < N; n++) if (want.has(nodes[n * NF + 2])) byId.set(nodes[n * NF + 2], n);
    const depthMax = Number(flags.depth ?? 2);
    const dump = (n, depth, via) => {
      L.push(`${'  '.repeat(depth)}${fmt(retained[n]).padStart(9)}  ${via}${nodeLabel(n)}  self ${fmt(selfOf(n))}${depth === 0 ? allocSite(n) : ''}`);
      if (depth >= depthMax) return;
      const outs = [];
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) {
        if (edges[e * EF] === E_WEAK) continue;
        const t = edges[e * EF + 2] / NF;
        outs.push([t, e, idom[t] === n]);
      }
      outs.sort((a, b) => retained[b[0]] - retained[a[0]]);
      for (const [t, e, dominated] of outs.slice(0, 14)) {
        if (retained[t] < 64 * 1024) continue;
        if (dominated) dump(t, depth + 1, `.${edgeName(e)} -> `);
        else L.push(`${'  '.repeat(depth + 1)}${fmt(retained[t]).padStart(9)}  .${edgeName(e)} -> ${nodeLabel(t)}  (shared)`);
      }
      L.push(`${'  '.repeat(depth + 1)}(${outs.length} edges)`);
    };
    L.push('== Probe ==');
    for (const id of want) {
      const n = byId.get(id);
      if (n === undefined) L.push(`@${id} not found`); else { dump(n, 0, ''); L.push(`   path: ${pathOf(n)}`); L.push(''); }
    }
  }

  if (flags.class) {
    for (const cls of flags.class.split(',')) {
      const hits = [];
      for (let n = 0; n < N; n++) if (nodeClass(n) === cls) hits.push(n);
      hits.sort((a, b) => retained[b] - retained[a]);
      L.push(`== ${cls}: ${cnt(hits.length)} instances, retained sum ${fmt(hits.reduce((s, n) => s + retained[n], 0))} ==`);
      for (const n of hits.slice(0, 12)) L.push(`   ${fmt(retained[n]).padStart(9)}  ${nodeLabel(n)}  path: ${pathOf(n).split(' -> ').slice(-5).join(' -> ')}`);
      L.push('');
    }
  }

  if (flags.holders) {
    const cls = flags.holders;
    const byHolderClass = new Map(); const perNode = [];
    for (let n = 0; n < N; n++) {
      let c = 0;
      for (let e = firstEdge[n]; e < firstEdge[n + 1]; e++) if (nodeClass(edges[e * EF + 2] / NF) === cls) c++;
      if (!c) continue;
      add(byHolderClass, nodeClass(n), 0, c);
      if (c >= 500) perNode.push([n, c]);
    }
    perNode.sort((a, b) => b[1] - a[1]);
    L.push(`== Holders of ${cls}: ${perNode.length} objects hold >= 500 each ==`);
    for (const [n, c] of perNode.slice(0, 12)) L.push(`   ${cnt(c).padStart(8)}  ${nodeLabel(n)}  ${fmt(retained[n])}  path: ${pathOf(n).split(' -> ').slice(-4).join(' -> ')}`);
    L.push('   by holder class (edge count):');
    for (const [k, v] of [...byHolderClass.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 8)) L.push(`   ${cnt(v.count).padStart(10)}  ${k}`);
    L.push('');
  }

  const namedRetainers = cands.slice(0, 40).map((n) => ({
    id: nodes[n * NF + 2],
    label: nodeLabel(n),
    retained: retained[n],
    path: pathOf(n),
  }));

  let captureMeta = null;
  const metaPath = path.join(path.dirname(inputPath), `${baseName}.meta.json`);
  try {
    captureMeta = JSON.parse(await readFile(metaPath, 'utf8'));
  } catch { /* optional sidecar from capture-heap.mjs */ }

  const scanCtx = {
    liveTotal,
    classRows: clsRows,
    namedRetainers,
    timeline,
    attributed,
    preRecording,
  };
  let projectPatternsFile = null;
  let projectRules = [];
  if (flags['no-project-patterns'] !== 'true') {
    const loaded = await loadProjectHeapPatterns({
      projectRoot: flags['project-root'],
      patternsPath: flags.patterns,
      captureMeta,
    });
    projectPatternsFile = loaded.file;
    projectRules = loaded.patterns;
  }
  const patterns = mergeHeapPatternHits(
    scanHeapPatterns(scanCtx),
    scanProjectHeapPatterns(scanCtx, projectRules),
  );
  const section0 = [
    '== 0. Pattern hints (skill + project; see known-heap-patterns.md and project-heap-patterns.md) ==',
    ...(projectPatternsFile ? [`  project rules: ${projectPatternsFile}`] : []),
    ...(patterns.length
      ? patterns.slice(0, 18).map((p) => `  [${p.source}/${p.kind}] ${fmt(p.retained).padStart(9)}  ${p.message}`)
      : ['  (no large pattern hits)']),
    '',
  ];
  L.splice(4, 0, ...section0);

  const dthrSummary = Math.max(liveTotal * 0.004, 1 << 20);
  const topDominators = kids(0)
    .filter((c) => retained[c] >= dthrSummary)
    .sort((a, b) => retained[b] - retained[a])
    .slice(0, 25)
    .map((c) => ({
      id: nodes[c * NF + 2],
      label: nodeLabel(c),
      retained: retained[c],
    }));

  const allocationStacks = timeline;
  const summary = {
    capture: baseName,
    inputPath,
    analyzedAt: new Date().toISOString(),
    captureKind,
    allocationStacks,
    allocationStacksHint: allocationStacks ? null : ALLOCATION_TIMELINE_HINT,
    liveTotal,
    unreachableBytes,
    timeline,
    attributed,
    preRecording,
    projectPatternsFile,
    patterns,
    constructors: clsRows.slice(0, 40).map(([name, r, c, s]) => ({
      name, retained: r, count: c, shallow: s,
    })),
    namedRetainers,
    dominators: topDominators,
    captureMeta,
  };

  await mkdir(path.dirname(outPath), { recursive: true });
  if (writeTextReport) {
    await writeFile(outPath, `${L.join('\n')}\n`);
    console.error(`wrote ${outPath}`);
  }
  if (writeJson) {
    await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`);
    console.error(`wrote ${jsonPath}`);
  }
  if (!allocationStacks) {
    console.error('note: plain .heapsnapshot — no allocation stacks (see allocationStacksHint in .summary.json)');
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
