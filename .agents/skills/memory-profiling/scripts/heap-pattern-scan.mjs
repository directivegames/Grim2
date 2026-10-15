// Shared capture-artifact and known-owner heuristics for heap reports.
// Keep in sync with references/known-heap-patterns.md (human detail lives there).

/**
 * @param {{
 *   liveTotal: number,
 *   classRows: [string, number, number, number][],
 *   namedRetainers: { label: string, retained: number, path: string }[],
 *   timeline: boolean,
 *   attributed: number,
 *   preRecording: number,
 * }} ctx
 * @returns {{ id: string, kind: string, retained: number, message: string, source: 'skill' }[]}
 */
export function scanHeapPatterns(ctx) {
  const byClass = new Map(ctx.classRows.map(([name, retained]) => [name, retained]));
  const hits = [];
  const add = (id, kind, retained, message) => {
    if (retained < 512 * 1024) return;
    hits.push({ id, kind, retained, message, source: 'skill' });
  };

  const external = byClass.get('system / ExternalStringData') ?? 0;
  const code = byClass.get('(code)') ?? 0;
  const strings = byClass.get('(string)') ?? 0;
  add(
    'dev-external-strings',
    'artifact',
    external,
    'Large external string storage — usually dev script source or deps prebundle text, not shipped game memory.',
  );
  if (code + strings > ctx.liveTotal * 0.35) {
    add(
      'dev-code-and-strings',
      'artifact',
      code + strings,
      'Compiled code plus string heap is a large share of live memory — typical for Vite dev; compare production builds before optimizing.',
    );
  }

  for (const r of ctx.namedRetainers) {
    if (/DevTools debugger|devtools:/i.test(r.path)) {
      add('devtools-attached', 'artifact', r.retained, `DevTools is retaining ${r.label} — close DevTools on the game window for fair captures.`);
    }
    if (/chrome-extension:\/\//i.test(r.path)) {
      add('browser-extension', 'artifact', r.retained, 'A browser extension object appears on a GC path — use a clean Chrome profile (capture script does this by default).');
    }
  }

  const wasm = byClass.get('system / CppGCManaged (WasmNativeModule)') ?? 0;
  add('wasm-module', 'runtime', wasm, 'Compiled WebAssembly modules (physics, navigation, etc.) — high-water mark while the page is open.');

  const arrayBuf = byClass.get('ArrayBuffer') ?? 0;
  const jsArrayData = byClass.get('system / JSArrayBufferData') ?? 0;
  add(
    'binary-payloads',
    'runtime',
    Math.max(arrayBuf, jsArrayData),
    'ArrayBuffer-backed payloads (meshes, audio, textures, downloads). Drill into section 8 paths for the owning subsystem.',
  );

  const procedural = byClass.get('ProceduralSfxSystem') ?? 0;
  add(
    'procedural-sfx-prewarm',
    'owner',
    procedural,
    'ProceduralSfxSystem.buffers — prewarmed procedural SFX PCM (see known-heap-patterns.md).',
  );

  const resMgr = byClass.get('ResourceManager') ?? 0;
  add('resource-manager-cache', 'owner', resMgr, 'ResourceManager — GLTF/texture cache; parsers can stay alive on cachedModels entries.');

  const gltfParser = byClass.get('GLTFParser') ?? 0;
  add('gltf-parser', 'owner', gltfParser, 'GLTFParser — often paired with ResourceManager.cachedModels; check which assets are pinned.');

  const animActions = byClass.get('AnimationAction') ?? 0;
  if (animActions > 5 * 1024 * 1024) {
    add(
      'animation-actions',
      'owner',
      animActions,
      'Many AnimationAction / AnimationClip instances — global AnimationClipCache or per-character clip clones (see known-heap-patterns.md).',
    );
  }

  if (ctx.timeline && ctx.preRecording > ctx.liveTotal * 0.25) {
    add(
      'pre-recording-live',
      'artifact',
      ctx.preRecording,
      'Much of the live heap was allocated before the timeline started — shorten warmup or start recording earlier if you need allocation attribution for load.',
    );
  }

  return hits;
}

const DEFAULT_MIN = 512 * 1024;

/**
 * @param {object} ctx same shape as scanHeapPatterns
 * @param {object[]} rules from the project's .genesys/heap-patterns.json
 */
export function scanProjectHeapPatterns(ctx, rules) {
  if (!rules?.length) return [];
  const byClass = new Map(ctx.classRows.map(([name, retained]) => [name, retained]));
  const hits = [];

  for (const rule of rules) {
    if (!rule?.id || !rule.message) {
      throw new Error('each project pattern needs "id" and "message"');
    }
    const m = rule.match ?? {};
    if (!Object.keys(m).length) {
      throw new Error(`project pattern "${rule.id}" needs a "match" object`);
    }
    const min = rule.minRetainedBytes ?? DEFAULT_MIN;
    let retained = 0;
    let matched = false;

    if (m.constructor) {
      const r = byClass.get(m.constructor) ?? 0;
      if (r > 0) {
        retained = Math.max(retained, r);
        matched = true;
      }
    }
    if (m.constructorRegex) {
      const re = new RegExp(m.constructorRegex);
      for (const [name, r] of byClass) {
        if (re.test(name) && r > 0) {
          retained = Math.max(retained, r);
          matched = true;
        }
      }
    }
    if (m.pathContains) {
      let sum = 0;
      for (const nr of ctx.namedRetainers) {
        if (nr.path.includes(m.pathContains)) sum += nr.retained;
      }
      if (sum > 0) {
        retained = Math.max(retained, sum);
        matched = true;
      }
    }
    if (m.pathRegex) {
      const re = new RegExp(m.pathRegex);
      let sum = 0;
      for (const nr of ctx.namedRetainers) {
        if (re.test(nr.path)) sum += nr.retained;
      }
      if (sum > 0) {
        retained = Math.max(retained, sum);
        matched = true;
      }
    }
    if (m.labelContains) {
      let sum = 0;
      for (const nr of ctx.namedRetainers) {
        if (nr.label.includes(m.labelContains)) sum += nr.retained;
      }
      if (sum > 0) {
        retained = Math.max(retained, sum);
        matched = true;
      }
    }
    if (m.labelRegex) {
      const re = new RegExp(m.labelRegex);
      let sum = 0;
      for (const nr of ctx.namedRetainers) {
        if (re.test(nr.label)) sum += nr.retained;
      }
      if (sum > 0) {
        retained = Math.max(retained, sum);
        matched = true;
      }
    }

    if (matched && retained >= min) {
      hits.push({
        id: rule.id,
        kind: rule.kind ?? 'owner',
        retained,
        message: rule.message,
        source: 'project',
      });
    }
  }
  return hits;
}

export function mergeHeapPatternHits(builtin, project) {
  const byId = new Map();
  for (const h of builtin) byId.set(h.id, h);
  for (const h of project) byId.set(h.id, h);
  return [...byId.values()].sort((a, b) => b.retained - a.retained);
}
