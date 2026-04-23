import fs from 'fs';
import path from 'path';

import Ajv, { type ErrorObject } from 'ajv';

import { getProjectRoot } from './common.js';

interface ValidationError {
  file: string;
  errors: string[];
}

function findPrefabFiles(dir: string, prefabFiles: string[] = []): string[] {
  const files = fs.readdirSync(dir);

  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);

    if (stat.isDirectory()) {
      // Skip node_modules and other common directories that shouldn't contain prefabs
      if (file === 'node_modules' || file === 'dist' || file === '.git') {
        continue;
      }
      findPrefabFiles(filePath, prefabFiles);
    } else if (file.endsWith('.prefab.json')) {
      prefabFiles.push(filePath);
    }
  }

  return prefabFiles;
}

function validatePrefabs() {
  const projectRoot = getProjectRoot();
  const schemaPath = path.join(__dirname, 'prefab.schema.json');

  // Load the schema
  let schema: any;
  try {
    const schemaContent = fs.readFileSync(schemaPath, 'utf-8');
    schema = JSON.parse(schemaContent);
  } catch (error) {
    console.error(`❌ Failed to load schema from ${schemaPath}`);
    console.error(error);
    process.exit(1);
  }

  // Initialize Ajv
  const ajv = new (Ajv as any)({
    allErrors: true,
    validateSchema: false // Don't validate the schema itself
  });

  // Process $ref in the schema to use proper format
  const processedSchema = JSON.parse(JSON.stringify(schema), (key, value) => {
    if (key === '$ref' && typeof value === 'string' && !value.startsWith('#')) {
      return `#/definitions/${value}`;
    }
    return value;
  });

  const validate = ajv.compile(processedSchema);

  // Find all prefab files
  const prefabFiles = findPrefabFiles(projectRoot);

  if (prefabFiles.length === 0) {
    console.log('⚠️  No prefab files found in the project.');
    return;
  }

  console.log(`Found ${prefabFiles.length} prefab file(s) to validate:\n`);

  const validationErrors: ValidationError[] = [];
  let validCount = 0;

  // Validate each prefab file
  for (const prefabPath of prefabFiles) {
    const relativePath = path.relative(projectRoot, prefabPath);

    try {
      const prefabContent = fs.readFileSync(prefabPath, 'utf-8');
      const prefabData = JSON.parse(prefabContent);

      const valid = validate(prefabData);

      if (valid) {
        console.log(`✅ ${relativePath}`);
        validCount++;
      } else {
        console.log(`❌ ${relativePath}`);
        const errors = validate.errors?.map((err: ErrorObject) => {
          const path = (err as any).instancePath ?? '/';
          const message = err.message ?? 'unknown error';
          return `  - ${path}: ${message}`;
        }) ?? [];
        validationErrors.push({
          file: relativePath,
          errors
        });
      }
    } catch (error) {
      console.log(`❌ ${relativePath} (parse error)`);
      validationErrors.push({
        file: relativePath,
        errors: [`Failed to parse JSON: ${error instanceof Error ? error.message : String(error)}`]
      });
    }
  }

  // Print summary
  console.log(`\n${'='.repeat(60)}`);
  console.log('Validation Summary:');
  console.log(`  Total files: ${prefabFiles.length}`);
  console.log(`  Valid: ${validCount}`);
  console.log(`  Invalid: ${validationErrors.length}`);
  console.log(`${'='.repeat(60)}\n`);

  // Print detailed errors if any
  if (validationErrors.length > 0) {
    console.log('Validation Errors:\n');
    for (const { file, errors } of validationErrors) {
      console.log(`${file}:`);
      for (const error of errors) {
        console.log(error);
      }
      console.log('');
    }
    process.exit(1);
  } else {
    console.log('🎉 All prefab files are valid!');
  }
}

// Run validation
validatePrefabs();

