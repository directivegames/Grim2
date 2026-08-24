import path from 'node:path';
import process from 'node:process';

import {
  runMigration,
  toProjectPath,
} from './migrate-animation-configs-lib.mjs';

function parseArguments(argv) {
  let projectRoot = process.cwd();
  let write = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--write') {
      write = true;
    } else if (argument === '--project') {
      const value = argv[index + 1];
      if (!value) {
        throw new Error('--project requires a directory path');
      }
      projectRoot = value;
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      return { help: true, projectRoot, write };
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }

  return {
    help: false,
    projectRoot: path.resolve(projectRoot),
    write,
  };
}

function printHelp() {
  console.log([
    'Migrate legacy Genesys animation configs to serialized resources.',
    '',
    'Usage:',
    '  node migrate-animation-configs.mjs [--project <path>] [--write]',
    '',
    'Without --write, validates and reports every proposed change.',
    'Writes are blocked if any config, sidecar, target, or reference is unsafe.',
  ].join('\n'));
}

function printResult(result, writeRequested) {
  if (result.migrations.length === 0) {
    console.log('No legacy .anim.json files found.');
    return;
  }

  console.log(writeRequested ? 'Animation config migration:' : 'Animation config migration dry run:');
  for (const migration of result.ready) {
    const resumeLabel = migration.targetState === 'equivalent' ? ' (resume existing target)' : '';
    console.log(
      `  ${toProjectPath(result.projectRoot, migration.sourcePath)}`
      + ` -> ${toProjectPath(result.projectRoot, migration.targetPath)}${resumeLabel}`,
    );
    if (migration.metaPath) {
      console.log(`    embed layout: ${toProjectPath(result.projectRoot, migration.metaPath)}`);
    }
  }
  for (const failure of result.blocked) {
    console.warn(
      `  BLOCKED ${toProjectPath(result.projectRoot, failure.sourcePath)}: ${failure.reason}`,
    );
  }
  for (const unresolved of result.unresolvedReferences) {
    console.warn(
      `  UNRESOLVED ${path.relative(result.projectRoot, unresolved.filePath).replaceAll(path.sep, '/')}`
      + ` -> ${toProjectPath(result.projectRoot, unresolved.sourcePath)}`,
    );
  }

  console.log(`Reference files ${result.applied ? 'updated' : 'to update'}: ${result.referenceUpdates.length}`);
  for (const update of result.referenceUpdates) {
    console.log(`  ${path.relative(result.projectRoot, update.filePath).replaceAll(path.sep, '/')}`);
  }

  if (!result.ok) {
    console.warn('No files were changed. Resolve every blocked item and rerun the dry run.');
  } else if (result.applied) {
    console.log(`Migrated ${result.ready.length} animation config(s).`);
  } else {
    console.log(`Would migrate ${result.ready.length} animation config(s).`);
    console.log('Run again with --write after reviewing this list.');
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }

  const result = await runMigration({
    platform: process.platform,
    projectRoot: options.projectRoot,
    write: options.write,
  });
  printResult(result, options.write);
  if (!result.ok) {
    process.exitCode = 1;
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
