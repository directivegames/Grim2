#!/usr/bin/env tsx

import { readdir, readFile, stat, writeFile } from 'fs/promises';
import { join } from 'path';

/**
 * Recursively finds all TypeScript files in a directory
 */
async function findTsFiles(dir: string): Promise<string[]> {
  const files: string[] = [];

  try {
    const entries = await readdir(dir);

    for (const entry of entries) {
      const fullPath = join(dir, entry);
      const stats = await stat(fullPath);

      if (stats.isDirectory()) {
        const subFiles = await findTsFiles(fullPath);
        files.push(...subFiles);
      } else if (entry.endsWith('.ts') || entry.endsWith('.tsx')) {
        files.push(fullPath);
      }
    }
  } catch (error) {
    console.warn(`Warning: Could not read directory ${dir}:`, error);
  }

  return files;
}

/**
 * Removes comments from TypeScript code using regex
 */
function removeComments(code: string): { cleaned: string; hadComments: boolean } {
  const originalLength = code.length;

  // Remove single-line comments (// comments)
  // This regex handles // comments but preserves URLs and string literals
  let cleaned = code.replace(/^(\s*)\/\/.*$/gm, '$1');

  // Remove multi-line comments (/* ... */ and /** ... */)
  // This regex handles nested quotes and preserves strings
  cleaned = cleaned.replace(/\/\*[\s\S]*?\*\//g, '');

  // Clean up multiple consecutive empty lines (replace with single empty line)
  cleaned = cleaned.replace(/\n\s*\n\s*\n/g, '\n\n');

  // Trim trailing whitespace on each line
  cleaned = cleaned.replace(/[ \t]+$/gm, '');

  const hadComments = cleaned.length !== originalLength || cleaned !== code;

  return { cleaned, hadComments };
}

/**
 * Removes comments from a TypeScript file
 */
async function removeCommentsFromFile(filePath: string): Promise<boolean> {
  try {
    const content = await readFile(filePath, 'utf8');
    const { cleaned, hadComments } = removeComments(content);

    if (!hadComments) {
      return false; // No comments to remove
    }

    await writeFile(filePath, cleaned, 'utf8');
    return true;
  } catch (error) {
    console.error(`Error processing file ${filePath}:`, error);
    return false;
  }
}

async function main() {
  const engineDir = '.engine';

  console.log(`Searching for TypeScript files in ${engineDir}...`);
  console.log(`Current working directory: ${process.cwd()}`);

  try {
    const tsFiles = await findTsFiles(engineDir);

    console.log(`Found ${tsFiles.length} TypeScript files.`);
    if (tsFiles.length > 0) {
      console.log('First few files:');
      tsFiles.slice(0, 5).forEach(file => console.log(`  - ${file}`));
    }

    if (tsFiles.length === 0) {
      console.log('No TypeScript files found in .engine folder.');
      return;
    }

    let processedCount = 0;
    let modifiedCount = 0;

    for (const filePath of tsFiles) {
      console.log(`Processing: ${filePath}`);

      try {
        const wasModified = await removeCommentsFromFile(filePath);
        processedCount++;

        if (wasModified) {
          modifiedCount++;
          console.log('  ✓ Comments removed');
        } else {
          console.log('  - No comments found');
        }
      } catch (error) {
        console.error(`  ✗ Error: ${error}`);
      }
    }

    console.log('\nCompleted:');
    console.log(`- Files processed: ${processedCount}`);
    console.log(`- Files modified: ${modifiedCount}`);
    console.log(`- Files skipped: ${processedCount - modifiedCount}`);

  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

// Always run main if this file is executed directly
main().catch((error) => {
  console.error('Unexpected error:', error);
  console.error('Stack trace:', error.stack);
  process.exit(1);
});