// OS-level GPU memory for the browser's GPU process. This is what the driver
// really allocated, including everything the in-page hook cannot see (driver
// padding, swap chains, shader pipelines, the compositor, other tabs).
//
// Windows: performance counters "GPU Process Memory" and "GPU Adapter Memory".
// Other systems: nvidia-smi when present; otherwise the sample says why it is
// unavailable. macOS exposes no per-process GPU counter without root.
import { execFile } from 'node:child_process';
import process from 'node:process';

function run(cmd, args, timeoutMs = 20000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 8 << 20 }, (err, stdout) => {
      resolve(err ? { ok: false, error: err.message, stdout: stdout ?? '' } : { ok: true, stdout });
    });
  });
}

const empty = (reason) => ({ source: 'unavailable', reason });

async function sampleWindows(pids) {
  const counters = [];
  for (const pid of pids) {
    counters.push(`\\GPU Process Memory(pid_${pid}_*)\\Dedicated Usage`);
    counters.push(`\\GPU Process Memory(pid_${pid}_*)\\Shared Usage`);
  }
  counters.push('\\GPU Adapter Memory(*)\\Dedicated Usage', '\\GPU Adapter Memory(*)\\Shared Usage');
  const list = counters.map((c) => `'${c}'`).join(',');
  const script = `$ErrorActionPreference='SilentlyContinue'; (Get-Counter -Counter ${list}).CounterSamples | ForEach-Object { $_.Path + '=' + [int64]$_.CookedValue }`;
  const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
  if (!r.ok && !r.stdout) return empty(`Get-Counter failed: ${r.error}`);

  const process_ = { dedicatedBytes: 0, sharedBytes: 0, instances: [] };
  const adapters = new Map();
  for (const line of r.stdout.split(/\r?\n/)) {
    const m = /\\gpu (process|adapter) memory\((.+?)\)\\(dedicated|shared) usage=(-?\d+)/i.exec(line);
    if (!m) continue;
    const [, scope, instance, metric, value] = m;
    const bytes = Number(value);
    const key = metric.toLowerCase() === 'dedicated' ? 'dedicatedBytes' : 'sharedBytes';
    if (scope.toLowerCase() === 'process') {
      process_[key] += bytes;
      process_.instances.push({ instance, [key]: bytes });
    } else {
      const a = adapters.get(instance) ?? { instance, dedicatedBytes: 0, sharedBytes: 0 };
      a[key] += bytes;
      adapters.set(instance, a);
    }
  }
  if (!process_.instances.length && !adapters.size) return empty('no GPU counters returned (GPU process pid unknown or counters disabled)');
  return { source: 'windows-perf-counter', pids, process: process_, adapters: [...adapters.values()] };
}

async function sampleNvidiaSmi(pids) {
  const apps = await run('nvidia-smi', ['--query-compute-apps=pid,used_memory', '--format=csv,noheader,nounits']);
  const gpu = await run('nvidia-smi', ['--query-gpu=name,memory.used,memory.total', '--format=csv,noheader,nounits']);
  if (!apps.ok && !gpu.ok) return empty(`nvidia-smi not available: ${apps.error}`);
  let dedicatedBytes = 0;
  const want = new Set(pids.map(String));
  for (const line of (apps.stdout ?? '').split(/\r?\n/)) {
    const [pid, mib] = line.split(',').map((s) => s.trim());
    if (want.has(pid) && Number.isFinite(Number(mib))) dedicatedBytes += Number(mib) * 1048576;
  }
  const adapters = (gpu.stdout ?? '').split(/\r?\n/).filter(Boolean).map((line) => {
    const [name, used, total] = line.split(',').map((s) => s.trim());
    return { instance: name, dedicatedBytes: Number(used) * 1048576, totalBytes: Number(total) * 1048576 };
  });
  return {
    source: 'nvidia-smi',
    pids,
    process: { dedicatedBytes, sharedBytes: 0, instances: [] },
    adapters,
    note: 'nvidia-smi lists only compute apps per process; graphics-only processes can show 0. Use the adapter total as the reference.',
  };
}

/** @param {number[]} pids GPU-process pids (from SystemInfo.getProcessInfo). */
export async function sampleOsGpuMemory(pids) {
  const list = [...new Set(pids)].filter(Number.isFinite);
  if (process.platform === 'win32') {
    if (!list.length) return empty('GPU process pid unknown; pass --gpu-pid=<pid>');
    return sampleWindows(list);
  }
  const smi = await sampleNvidiaSmi(list);
  if (smi.source !== 'unavailable') return smi;
  return empty(process.platform === 'darwin'
    ? 'macOS has no per-process GPU memory counter without root; use the in-page tracker and the engine snapshot'
    : smi.reason);
}
