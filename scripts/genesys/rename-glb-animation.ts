/**
 * Rename animation clips inside a GLB without Blender.
 *
 * Fixes global clip-name collisions in the engine (e.g. "Walking" on both
 * NewZombie and BigUndead merged animations).
 *
 * Usage:
 *   pnpm exec tsx ./scripts/genesys/rename-glb-animation.ts <glb-path> <from-name> <to-name>
 *
 * Big Undead death clip (default example):
 *   pnpm exec tsx ./scripts/genesys/rename-glb-animation.ts \
 *     assets/models/Bigundead/Meshy_AI_Oozebound_Office_Zomb_biped/Meshy_AI_Oozebound_Office_Zomb_biped_Meshy_AI_Meshy_Merged_Animations.glb \
 *     Walking BigUndead_Death
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

import { NodeIO } from '@gltf-transform/core';

const DEFAULT_GLB =
  'assets/models/Bigundead/Meshy_AI_Oozebound_Office_Zomb_biped/Meshy_AI_Oozebound_Office_Zomb_biped_Meshy_AI_Meshy_Merged_Animations.glb';
const DEFAULT_FROM = 'Walking';
const DEFAULT_TO = 'BigUndead_Death';

async function main(): Promise<void> {
  const glbPath = resolve(process.argv[2] ?? DEFAULT_GLB);
  const fromName = process.argv[3] ?? DEFAULT_FROM;
  const toName = process.argv[4] ?? DEFAULT_TO;

  if (!fromName || !toName) {
    console.error('Usage: rename-glb-animation.ts <glb-path> <from-name> <to-name>');
    process.exit(1);
  }

  const io = new NodeIO();
  const document = await io.readBinary(readFileSync(glbPath));
  const root = document.getRoot();
  const animations = root.listAnimations();

  console.log(`File: ${glbPath}`);
  console.log('Animations before:');
  for (const anim of animations) {
    console.log(`  - ${anim.getName() ?? '(unnamed)'}`);
  }

  let renamed = 0;
  for (const anim of animations) {
    if (anim.getName() === fromName) {
      anim.setName(toName);
      renamed++;
    }
  }

  if (renamed === 0) {
    console.error(`No animation named "${fromName}" found.`);
    process.exit(1);
  }

  const out = await io.writeBinary(document);
  writeFileSync(glbPath, Buffer.from(out));
  console.log(`Renamed ${renamed} clip(s): "${fromName}" -> "${toName}"`);
  console.log('Animations after:');
  for (const anim of root.listAnimations()) {
    console.log(`  - ${anim.getName() ?? '(unnamed)'}`);
  }
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
