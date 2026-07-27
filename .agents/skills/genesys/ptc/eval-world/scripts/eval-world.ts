/**
 * Evaluates a JavaScript snippet in order to interact with the scene.
 */

import net from 'net';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';

const ALWAYS_HEADLESS = false; // Set to true to always run in headless mode, even if the SDK is open.

// ── Pipe client ───────────────────────────────────────────────────────────────

const PIPE_NAME =
  process.platform === 'win32'
    ? '\\\\.\\pipe\\genesys-sdk-agent-bridge'
    : '/tmp/genesys-sdk-agent-bridge';

interface PipeResponse {
  ok: boolean;
  result?: unknown;
  error?: string;
}

function callPipe(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(PIPE_NAME, () => {
      socket.write(JSON.stringify({ method, params }) + '\n');
    });

    let buffer = '';

    socket.on('data', (chunk) => {
      buffer += chunk.toString('utf-8');
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const response = JSON.parse(trimmed) as PipeResponse;
        socket.destroy();

        if (response.ok) {
          resolve(response.result);
        } else {
          reject(new Error(response.error ?? 'Unknown error'));
        }
      }
    });

    socket.on('error', reject);
  });
}

/** Returns true when the SDK pipe is accepting connections. */
function isPipeAvailable(): Promise<boolean> {
  if (ALWAYS_HEADLESS) {
    return new Promise((resolve) => {
      resolve(false);
    });
  }
  return new Promise((resolve) => {
    const socket = net.createConnection(PIPE_NAME, () => {
      socket.destroy();
      resolve(true);
    });
    socket.on('error', () => resolve(false));
  });
}

// ── Headless fallback ─────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HEADLESS_SCRIPT = path.join(__dirname, 'eval-world-headless.ts');

function runHeadless(script: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      // Reuse the same tsx loader that launched this script.
      [...process.execArgv, HEADLESS_SCRIPT, script],
      { stdio: 'inherit' }
    );
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`eval-world-headless exited with code ${code}`));
    });
    child.on('error', reject);
  });
}

// ── Argument parsing ──────────────────────────────────────────────────────────

import fs from 'fs';

const args = process.argv.slice(2);

let script: string | undefined;

const fileFlag = args.indexOf('--file');
if (fileFlag !== -1) {
  const filePath = args[fileFlag + 1];
  if (!filePath) {
    console.error('--file requires a path argument');
    process.exit(1);
  }
  script = fs.readFileSync(filePath, 'utf-8');
} else {
  script = args[0];
}

if (!script) {
  console.error('Usage: eval-world.ts <script>');
  console.error('       eval-world.ts --file <path>');
  console.error('  <script>  JavaScript string to evaluate. Must use `return` to produce a result.');
  process.exit(1);
}

// ── Main ──────────────────────────────────────────────────────────────────────

if (await isPipeAvailable()) {
  try {
    const result = await callPipe('editor/eval-world', { script });
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Failed to call pipe:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
} else {
  try {
    await runHeadless(script);
  } catch (err) {
    console.error('Headless eval failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
