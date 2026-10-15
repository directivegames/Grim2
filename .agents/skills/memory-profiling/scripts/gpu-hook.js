// In-page WebGPU allocation tracker. Injected by capture-gpu.mjs before the game
// runs (main thread and workers). Not part of the game: it only exists in the
// page that capture-gpu.mjs launched or attached to.
//
// It wraps GPUDevice.createTexture / createBuffer and the destroy() methods, so
// it knows the exact bytes, format, usage and creation stack of every live
// texture and buffer the game asked the GPU for. It holds no strong reference
// to any GPU object, so it does not change what the game keeps alive.
//
// Limits: sizes are computed from the descriptor (driver padding, alignment and
// swap-chain textures are not included), and WebGL contexts are not tracked.
//
// Configuration comes from globalThis.__gnsx_gpumem_options, set by the capture
// script right before this file is evaluated.
(() => {
  'use strict';
  const g = globalThis;
  if (g.__gnsx_gpumem) return;

  const opts = Object.assign({ minStackBytes: 65536, stackFrames: 8 }, g.__gnsx_gpumem_options);
  const context = typeof document !== 'undefined' ? 'window' : 'worker';

  const hasGlobals = typeof g.GPUDevice !== 'undefined' && typeof g.GPUDevice.prototype.createTexture === 'function';
  const hasNavigatorGpu = typeof navigator !== 'undefined' && !!navigator.gpu;
  if (!hasGlobals && !hasNavigatorGpu) {
    g.__gnsx_gpumem = { supported: false, context };
    return;
  }

  const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());
  const origin = () => (typeof performance !== 'undefined' && performance.timeOrigin ? performance.timeOrigin : 0);
  const installedAt = clock();

  // ── WebGPU format table: [blockWidth, blockHeight, bytesPerBlock] ───────────
  const FORMATS = new Map();
  const def = (names, bytes, bw = 1, bh = 1) => { for (const n of names.split(' ')) FORMATS.set(n, [bw, bh, bytes]); };
  def('r8unorm r8snorm r8uint r8sint stencil8', 1);
  def('r16uint r16sint r16float r16unorm r16snorm rg8unorm rg8snorm rg8uint rg8sint depth16unorm', 2);
  def('r32uint r32sint r32float rg16uint rg16sint rg16float rg16unorm rg16snorm rgba8unorm rgba8unorm-srgb rgba8snorm rgba8uint rgba8sint '
    + 'bgra8unorm bgra8unorm-srgb rgb9e5ufloat rgb10a2uint rgb10a2unorm rg11b10ufloat depth24plus depth24plus-stencil8 depth32float', 4);
  def('rg32uint rg32sint rg32float rgba16uint rgba16sint rgba16float rgba16unorm rgba16snorm depth32float-stencil8', 8);
  def('rgba32uint rgba32sint rgba32float', 16);
  def('bc1-rgba-unorm bc1-rgba-unorm-srgb bc4-r-unorm bc4-r-snorm etc2-rgb8unorm etc2-rgb8unorm-srgb '
    + 'etc2-rgb8a1unorm etc2-rgb8a1unorm-srgb eac-r11unorm eac-r11snorm', 8, 4, 4);
  def('bc2-rgba-unorm bc2-rgba-unorm-srgb bc3-rgba-unorm bc3-rgba-unorm-srgb bc5-rg-unorm bc5-rg-snorm bc6h-rgb-ufloat '
    + 'bc6h-rgb-float bc7-rgba-unorm bc7-rgba-unorm-srgb etc2-rgba8unorm etc2-rgba8unorm-srgb eac-rg11unorm eac-rg11snorm', 16, 4, 4);
  const DEPTH = /^(depth|stencil)/;

  function formatInfo(fmt) {
    const hit = FORMATS.get(fmt);
    if (hit) return hit;
    const astc = /^astc-(\d+)x(\d+)-/.exec(fmt);
    if (astc) return [Number(astc[1]), Number(astc[2]), 16];
    return [1, 1, 4]; // unknown format: assume 4 bytes per texel
  }

  function textureBytes(d) {
    const size = d.size;
    let w; let h; let depth;
    if (typeof size.width === 'number') { w = size.width; h = size.height ?? 1; depth = size.depthOrArrayLayers ?? 1; }
    else { w = size[0]; h = size[1] ?? 1; depth = size[2] ?? 1; }
    const mips = d.mipLevelCount ?? 1;
    const samples = d.sampleCount ?? 1;
    const dim = d.dimension ?? '2d';
    const [bw, bh, bpb] = formatInfo(d.format);
    let total = 0;
    for (let l = 0; l < mips; l++) {
      const lw = Math.max(1, w >> l);
      const lh = dim === '1d' ? 1 : Math.max(1, h >> l);
      const ld = dim === '3d' ? Math.max(1, depth >> l) : depth;
      total += Math.ceil(lw / bw) * Math.ceil(lh / bh) * ld * bpb;
    }
    return total * samples;
  }

  // GPUBufferUsage / GPUTextureUsage bit values (fixed by the WebGPU spec).
  const BUF = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
  const TEX = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
  const names = (table, bits) => Object.keys(table).filter((k) => bits & table[k]).join('|');

  function bufferKind(u) {
    if (u & BUF.STORAGE) return 'buffer:storage';
    if (u & BUF.VERTEX) return 'buffer:vertex';
    if (u & BUF.INDEX) return 'buffer:index';
    if (u & BUF.UNIFORM) return 'buffer:uniform';
    if (u & BUF.INDIRECT) return 'buffer:indirect';
    if (u & (BUF.MAP_READ | BUF.MAP_WRITE)) return 'buffer:staging';
    return 'buffer:other';
  }

  function textureKind(d) {
    if (DEPTH.test(d.format)) return 'texture:depth';
    if ((d.usage ?? 0) & TEX.RENDER_ATTACHMENT) return 'texture:renderTarget';
    return 'texture:sampled';
  }

  // ── bookkeeping ─────────────────────────────────────────────────────────────
  const live = new Map(); // id -> record (never holds the GPU object)
  const byObject = new WeakMap();
  const deviceIds = new WeakMap();
  let nextId = 1;
  let nextDevice = 1;
  const totals = {
    liveBytes: 0, liveCount: 0, peakBytes: 0,
    createdCount: 0, createdBytes: 0,
    destroyedCount: 0, destroyedBytes: 0,
    gcReleasedCount: 0, gcReleasedBytes: 0,
  };

  function release(id, how) {
    const r = live.get(id);
    if (!r) return;
    live.delete(id);
    totals.liveBytes -= r.bytes;
    totals.liveCount--;
    if (how === 'destroy') { totals.destroyedCount++; totals.destroyedBytes += r.bytes; }
    else { totals.gcReleasedCount++; totals.gcReleasedBytes += r.bytes; }
  }

  // Resources that are never destroy()ed are freed when the JS object is collected.
  const registry = typeof FinalizationRegistry === 'function'
    ? new FinalizationRegistry((id) => release(id, 'gc'))
    : null;

  function __gnsx_stack() {
    const prev = Error.stackTraceLimit;
    Error.stackTraceLimit = opts.stackFrames + 4;
    const raw = new Error().stack || '';
    Error.stackTraceLimit = prev;
    const out = [];
    for (const line of raw.split('\n').slice(1)) {
      if (line.includes('__gnsx_')) continue;
      out.push(line.trim().replace(/^at /, ''));
      if (out.length >= opts.stackFrames) break;
    }
    return out.join('\n');
  }

  function deviceId(device) {
    let id = deviceIds.get(device);
    if (!id) { id = nextDevice++; deviceIds.set(device, id); }
    return id;
  }

  function __gnsx_track(type, device, obj, d) {
    const bytes = type === 'texture' ? textureBytes(d) : Number(d.size) || 0;
    const usage = d.usage ?? 0;
    const rec = {
      id: nextId++, type, bytes, usage,
      label: d.label || obj.label || '',
      device: deviceId(device),
      t: clock(),
      kind: type === 'texture' ? textureKind(d) : bufferKind(usage),
      stack: bytes >= opts.minStackBytes ? __gnsx_stack() : '',
    };
    if (type === 'texture') {
      const size = d.size;
      rec.format = d.format;
      rec.width = typeof size.width === 'number' ? size.width : size[0];
      rec.height = typeof size.width === 'number' ? (size.height ?? 1) : (size[1] ?? 1);
      rec.depth = typeof size.width === 'number' ? (size.depthOrArrayLayers ?? 1) : (size[2] ?? 1);
      rec.mips = d.mipLevelCount ?? 1;
      rec.samples = d.sampleCount ?? 1;
      rec.dimension = d.dimension ?? '2d';
      rec.usageNames = names(TEX, usage);
    } else {
      rec.usageNames = names(BUF, usage);
      rec.mappedAtCreation = Boolean(d.mappedAtCreation);
    }
    live.set(rec.id, rec);
    byObject.set(obj, rec);
    registry?.register(obj, rec.id, obj);
    totals.createdCount++;
    totals.createdBytes += bytes;
    totals.liveCount++;
    totals.liveBytes += bytes;
    if (totals.liveBytes > totals.peakBytes) totals.peakBytes = totals.liveBytes;
  }

  // ── patches ─────────────────────────────────────────────────────────────────
  // Prototypes are patched in place, so devices created before this script ran
  // are covered too. In some contexts (dedicated workers at startup) the
  // GPUDevice global is not defined yet, so the prototypes are also discovered
  // from the objects the game receives (requestAdapter -> requestDevice).
  const patchedProtos = new Set();

  function patchDestroy(proto) {
    if (!proto || patchedProtos.has(proto)) return;
    patchedProtos.add(proto);
    const orig = proto.destroy;
    if (typeof orig !== 'function') return;
    proto.destroy = function __gnsx_hook_destroy() {
      try {
        const r = byObject.get(this);
        if (r) release(r.id, 'destroy');
        registry?.unregister(this);
      } catch { /* ignore */ }
      return orig.call(this);
    };
  }

  function patchDevice(devProto) {
    if (!devProto || patchedProtos.has(devProto)) return;
    patchedProtos.add(devProto);
    const origCreateTexture = devProto.createTexture;
    const origCreateBuffer = devProto.createBuffer;
    const origDeviceDestroy = devProto.destroy;
    devProto.createTexture = function __gnsx_hook_createTexture(descriptor) {
      const tex = origCreateTexture.call(this, descriptor);
      try { patchDestroy(Object.getPrototypeOf(tex)); __gnsx_track('texture', this, tex, descriptor); } catch { /* tracking must never break the game */ }
      return tex;
    };
    devProto.createBuffer = function __gnsx_hook_createBuffer(descriptor) {
      const buf = origCreateBuffer.call(this, descriptor);
      try { patchDestroy(Object.getPrototypeOf(buf)); __gnsx_track('buffer', this, buf, descriptor); } catch { /* tracking must never break the game */ }
      return buf;
    };
    if (typeof origDeviceDestroy === 'function') {
      devProto.destroy = function __gnsx_hook_deviceDestroy() {
        try {
          const id = deviceIds.get(this);
          for (const r of [...live.values()]) if (r.device === id) release(r.id, 'destroy');
        } catch { /* ignore */ }
        return origDeviceDestroy.call(this);
      };
    }
  }

  function patchAdapter(adapterProto) {
    if (!adapterProto || patchedProtos.has(adapterProto)) return;
    patchedProtos.add(adapterProto);
    const orig = adapterProto.requestDevice;
    if (typeof orig !== 'function') return;
    adapterProto.requestDevice = async function __gnsx_hook_requestDevice(...args) {
      const device = await orig.apply(this, args);
      try { if (device) patchDevice(Object.getPrototypeOf(device)); } catch { /* ignore */ }
      return device;
    };
  }

  if (typeof g.GPUDevice !== 'undefined') patchDevice(g.GPUDevice.prototype);
  if (typeof g.GPUAdapter !== 'undefined') patchAdapter(g.GPUAdapter.prototype);
  const gpuObject = typeof navigator !== 'undefined' ? navigator.gpu : undefined;
  if (gpuObject) {
    const gpuProto = Object.getPrototypeOf(gpuObject);
    const origRequestAdapter = gpuProto.requestAdapter;
    if (typeof origRequestAdapter === 'function' && !patchedProtos.has(gpuProto)) {
      patchedProtos.add(gpuProto);
      gpuProto.requestAdapter = async function __gnsx_hook_requestAdapter(...args) {
        const adapter = await origRequestAdapter.apply(this, args);
        try { if (adapter) patchAdapter(Object.getPrototypeOf(adapter)); } catch { /* ignore */ }
        return adapter;
      };
    }
  }

  // ── reporting ───────────────────────────────────────────────────────────────
  const add = (map, key, bytes) => {
    const e = map[key] ?? (map[key] = { count: 0, bytes: 0 });
    e.count++; e.bytes += bytes;
  };

  function aggregate() {
    const byKind = {}; const byFormat = {};
    for (const r of live.values()) {
      add(byKind, r.kind, r.bytes);
      if (r.type === 'texture') add(byFormat, r.format, r.bytes);
    }
    return { byKind, byFormat };
  }

  g.__gnsx_gpumem = {
    supported: true,
    context,
    /** Cheap summary for periodic sampling. */
    stats() {
      return { context, now: origin() + clock(), totals: { ...totals }, byKind: aggregate().byKind };
    },
    /** Full report: aggregates plus the largest live resources with their creation stacks. */
    snapshot(o = {}) {
      const topN = o.topN ?? 300;
      const { byKind, byFormat } = aggregate();
      const sites = new Map();
      for (const r of live.values()) {
        const key = r.stack || '(small allocation: stack not recorded)';
        const e = sites.get(key) ?? { stack: key, count: 0, bytes: 0 };
        e.count++; e.bytes += r.bytes;
        sites.set(key, e);
      }
      const now = clock();
      const resources = [...live.values()]
        .sort((a, b) => b.bytes - a.bytes)
        .slice(0, topN)
        .map((r) => ({ ...r, ageMs: Math.round(now - r.t), t: undefined }));
      return {
        version: 1,
        supported: true,
        context,
        installedAtMs: origin() + installedAt,
        now: origin() + now,
        options: opts,
        devices: nextDevice - 1,
        totals: { ...totals },
        byKind,
        byFormat,
        bySite: [...sites.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 200),
        resources,
      };
    },
  };
})();
