import fs from 'fs';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

import { defineConfig } from 'vite';
import mkcert from 'vite-plugin-mkcert';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, '../..');
const require = createRequire(path.join(PROJECT_ROOT, 'package.json'));

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

/**
 * pnpm GVS realpaths Vite into the global store. `vite-plugin-node-polyfills`
 * injects a bare `vite-plugin-node-polyfills/shims/*` import into any file that
 * references `process` / `Buffer` / `global` — including Vite's own client —
 * which then cannot resolve from the store. Pin those specifiers to the ESM
 * builds; `require.resolve` returns `.cjs`, which Rolldown wraps in CJS interop
 * and TDZ-crashes (`__vite__cjsImport0_... before initialization`).
 */
function collectPolyfillShimAliases(): { find: string; replacement: string }[] {
  return ['buffer', 'global', 'process'].map((name) => ({
    find: `vite-plugin-node-polyfills/shims/${name}`,
    replacement: require.resolve(`vite-plugin-node-polyfills/shims/${name}`).replace(
      /index\.cjs$/,
      'index.js',
    ),
  }));
}

const polyfillShimAliases = collectPolyfillShimAliases();

type DepSourcemapTransformContext = {
  environment: {
    mode: string;
    depsOptimizer?: {
      isOptimizedDepFile(id: string): boolean;
    };
  };
};

/**
 * The dev server otherwise base64-inlines each prebundled dependency's source
 * map into the script response. V8 keeps that string for the life of the page.
 * A short external URL is fetched only when a debugger opens the script.
 */
function keepDepSourcemapsExternal() {
  return {
    name: 'keep-dep-sourcemaps-external',
    apply: 'serve' as const,
    enforce: 'post' as const,
    transform(this: DepSourcemapTransformContext, code: string, id: string) {
      if (this.environment.mode !== 'dev') return null;
      const file = id.split('?', 1)[0];
      if (!file.endsWith('.js')) return null;
      if (!this.environment.depsOptimizer?.isOptimizedDepFile(file)) return null;
      if (code.includes('sourceMappingURL=')) return null;
      if (!fs.existsSync(`${file}.map`)) return null;
      return {
        code: `${code}\n//# sourceMappingURL=${path.basename(file)}.map\n`,
        map: { mappings: '' },
      };
    },
  };
}

export default defineConfig({
  // Enable TypeScript support
  esbuild: {
    target: 'es2021',
  },

  plugins: [
    nodePolyfills({
      include: ['path'],
      globals: {
        // Buffer/global inject into the optimizer graph and TDZ-crash under
        // Rolldown. `path-browserify` still needs `process.cwd()` for resolve.
        Buffer: false,
        global: false,
        process: true,
      },
    }),
    (mkcert as any)(),
    keepDepSourcemapsExternal(),
  ],

  // Configure module resolution
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: [...collectPackAliases(), ...polyfillShimAliases],
  },

  optimizeDeps: {
    exclude: polyfillShimAliases.map((alias) => alias.find),
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
      // Shim files resolve into the GVS store; allow their dist dirs so the
      // browser can load them after the alias rewrite.
      allow: ['..', '.', ...polyfillShimAliases.map((alias) => path.dirname(alias.replacement))],
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
