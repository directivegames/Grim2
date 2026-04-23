/**
 * Installs developer skills from the genesys-harness-development repository into the project.
 *
 * Looks for a sibling `genesys-harness-development` directory next to the current project,
 * then copies everything from its `approved-skills/` folder into `.agents/skills/` in this project.
 *
 * Merge behaviour:
 * - Skills present in approved-skills are copied (overwriting any existing version).
 * - Skills that exist only in the project's .agents/skills/ are left untouched.
 *
 * Usage: pnpm install-developer-skills
 */

import fs from 'fs';
import path from 'path';

import { getProjectRoot } from './common.js';

const HARNESS_REPO_NAME = 'genesys-harness-development';
const APPROVED_SKILLS_DIR = 'approved-skills';
const TARGET_SKILLS_DIR = path.join('.agents', 'skills');

function findHarnessRoot(projectRoot: string): string | null {
  // The harness repo should be a sibling of the project root's parent directory.
  // e.g. project at C:\git\my-project  → look for C:\git\genesys-harness-development
  const parentDir = path.dirname(projectRoot);
  const candidate = path.join(parentDir, HARNESS_REPO_NAME);
  return fs.existsSync(candidate) ? candidate : null;
}

function copyDirMerge(src: string, dest: string, relPath = ''): { copied: number; updated: number } {
  let copied = 0;
  let updated = 0;

  fs.mkdirSync(dest, { recursive: true });

  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcEntry = path.join(src, entry.name);
    const destEntry = path.join(dest, entry.name);
    const displayPath = path.join(relPath, entry.name);

    if (entry.isDirectory()) {
      const result = copyDirMerge(srcEntry, destEntry, displayPath);
      copied += result.copied;
      updated += result.updated;
    } else {
      const exists = fs.existsSync(destEntry);
      fs.copyFileSync(srcEntry, destEntry);
      if (exists) {
        console.log(`  🔄 Updated: ${displayPath}`);
        updated++;
      } else {
        console.log(`  ✅ Installed: ${displayPath}`);
        copied++;
      }
    }
  }

  return { copied, updated };
}

function main(): void {
  const projectRoot = getProjectRoot();
  console.log(`📁 Project root: ${projectRoot}\n`);

  const harnessRoot = findHarnessRoot(projectRoot);
  if (!harnessRoot) {
    const parentDir = path.dirname(projectRoot);
    console.warn('⚠️  WARNING: Could not locate the harness repository.');
    console.warn(`   Expected to find it at: ${path.join(parentDir, HARNESS_REPO_NAME)}`);
    console.warn(`   Make sure '${HARNESS_REPO_NAME}' is checked out as a sibling of this project.`);
    process.exit(1);
  }

  console.log(`🔍 Found harness repository: ${harnessRoot}`);

  const approvedSkillsPath = path.join(harnessRoot, APPROVED_SKILLS_DIR);
  if (!fs.existsSync(approvedSkillsPath)) {
    console.error(`❌ ERROR: '${APPROVED_SKILLS_DIR}' folder not found inside the harness repository.`);
    console.error(`   Expected: ${approvedSkillsPath}`);
    process.exit(1);
  }

  const skillEntries = fs.readdirSync(approvedSkillsPath);
  if (skillEntries.length === 0) {
    console.log(`ℹ️  No skills found in ${approvedSkillsPath}`);
    console.log('   Nothing to install.');
    return;
  }

  const targetPath = path.join(projectRoot, TARGET_SKILLS_DIR);
  console.log(`📦 Installing skills into: ${targetPath}\n`);

  const { copied, updated } = copyDirMerge(approvedSkillsPath, targetPath);

  console.log(`\n${'='.repeat(50)}`);
  console.log('Developer Skills Install Summary:');
  console.log(`  Newly installed : ${copied}`);
  console.log(`  Updated         : ${updated}`);
  console.log(`  Total           : ${copied + updated}`);
  console.log(`${'='.repeat(50)}`);
}

main();
