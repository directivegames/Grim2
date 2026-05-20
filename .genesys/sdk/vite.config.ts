import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');

/**
 * Walks `<project>/packs/` and emits a `@packs/<name>` alias per installed pack
 * pointing at its `src/` directory.  Run at config-evaluation time so newly
 * installed packs are picked up on the next dev server / build invocation.
 */
function collectPackAliases(): { find: string; replacement: string }[] {
  const packsRoot = path.join(PROJECT_ROOT, 'packs');
  if (!fs.existsSync(packsRoot)) return [];
  const entries = fs.readdirSync(packsRoot, { withFileTypes: true });
  const aliases: { find: string; replacement: string }[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const srcDir = path.join(packsRoot, entry.name, 'src');
    // Skip packs that have no src/ directory (e.g. assets-only packs) to
    // avoid Vite emitting unresolvable alias warnings at dev/build time.
    if (!fs.existsSync(srcDir)) continue;
    aliases.push({
      find: `@packs/${entry.name}`,
      replacement: srcDir,
    });
  }
  return aliases;
}

export default defineConfig({
  // Enable TypeScript support
  esbuild: {
    target: 'es2021',
  },

  plugins: [
    nodePolyfills({
      include: ['path'],
    }),
    (mkcert as any)(),
  ],

  // Configure module resolution
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: collectPackAliases(),
  },

  // Configure the dev server
  server: {
    port: 3000,
    host: '0.0.0.0',
    open: true,
    // Enable CORS for asset loading
    cors: true,
    // Serve source maps for debugging
    fs: {
      allow: ['..', '.']
    }
  },

  // Configure build options
  build: {
    target: 'es2021',
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      input: {
        main: 'index.html',
      },
    },
  },

  // Enable source maps for debugging in development
  css: {
    devSourcemap: true,
  },
});
