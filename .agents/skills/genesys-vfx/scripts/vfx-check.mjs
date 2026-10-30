#!/usr/bin/env node
// Validate hand-written VFX definition files with the engine's own validator (VFXDefinition.fromJSON),
// before Play finds the error. Run from the game project (it loads @gnsx/genesys.js from there).
//
//   node vfx-check.mjs assets/vfx/torch-fire.vfx.json [more.json ...]
//
// Prints OK or the validator's error per file, plus a pool check: the worst-case live particles
// one instance of each emitter keeps alive versus its particle system's nbParticles pool.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

const files = process.argv.slice(2);
if (files.length === 0 || files.includes('--help') || files.includes('-h')) {
  console.log('usage: node vfx-check.mjs <definition.json> [...]\nValidates with VFXDefinition.fromJSON from the project\'s @gnsx/genesys.js.');
  process.exit(files.length === 0 ? 2 : 0);
}

function findProjectRoot(start) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', '@gnsx', 'genesys.js'))) return dir;
    const up = path.dirname(dir);
    if (up === dir) return null;
    dir = up;
  }
}

const root = findProjectRoot(process.cwd()) ?? findProjectRoot(path.dirname(path.resolve(files[0])));
if (!root) {
  console.error('ERROR no node_modules/@gnsx/genesys.js above the current directory or the first file. Run from the game project.');
  process.exit(2);
}
const require = createRequire(path.join(root, 'package.json'));
let ENGINE;
try {
  ENGINE = await import(pathToFileURL(require.resolve('@gnsx/genesys.js')).href);
} catch (err) {
  console.error(`ERROR could not load @gnsx/genesys.js from ${root}: ${err.message}`);
  process.exit(2);
}

let failed = 0;
for (const file of files) {
  let json;
  try {
    json = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.log(`FAIL ${file}  ${err.message}`);
    failed++;
    continue;
  }
  if (json && typeof json === 'object' && ('$root' in json || '$version' in json)) {
    console.log(`SKIP ${file}  serialized resource format (saved by the editor); the editor validates it`);
    continue;
  }
  try {
    const def = ENGINE.VFXDefinition.fromJSON(json);
    console.log(`OK   ${file}  name=${def.name}  particles=${def.particles.length}  emitters=${def.emitters.length}`);
    def.emitters.forEach((e, i) => {
      const pool = def.particles[e.particlesIndex ?? 0]?.nbParticles ?? 1000;
      const n = e.nbParticles ?? 1000;
      const life = (e.particlesLifetime ?? [0.1, 1])[1];
      const dur = Math.max(e.duration ?? 1, 1e-3);
      const live = e.spawnMode === 'burst' ? n * (e.loop ? Math.max(1, Math.ceil(life / dur)) : 1) : Math.ceil((n / dur) * life);
      const note = live > pool ? `  WARN pool ${pool} < ${live} live per instance: raise particles[${e.particlesIndex ?? 0}].nbParticles` : '';
      console.log(`     emitter ${i}: ~${live} live particles per instance, pool ${pool} (shared by every instance named "${def.name}")${note}`);
    });
  } catch (err) {
    console.log(`FAIL ${file}  ${err.message}`);
    failed++;
  }
}
process.exit(failed ? 1 : 0);
