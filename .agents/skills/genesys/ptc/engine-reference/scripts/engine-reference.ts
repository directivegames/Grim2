/**
 * engine-reference.ts
 *
 * Looks up one or more engine class names and prints the contents of their
 * source files from the .engine/src directory.
 *
 * Usage:
 *   pnpm exec tsx .cursor/skills/engine-reference/scripts/engine-reference.ts <ClassName> [ClassName2 ...]
 *
 * Example:
 *   pnpm exec tsx .cursor/skills/engine-reference/scripts/engine-reference.ts PointLightComponent CharacterMovementComponent
 */

import * as fs from 'fs';
import * as path from 'path';

const ENGINE_DATA_PATH = path.resolve('.engine/src/engine-data.ts');
const ENGINE_SRC_ROOT = path.resolve('.engine/src');

function buildClassMap(engineDataSource: string): Map<string, string> {
    const map = new Map<string, string>();
    // Match: import { Foo, Bar } from './some/path.js';
    const importRegex = /import\s*\{([^}]+)\}\s*from\s*['"]([^'"]+)['"]/g;
    let match: RegExpExecArray | null;
    while ((match = importRegex.exec(engineDataSource)) !== null) {
        const names = match[1].split(',').map(n => n.trim()).filter(Boolean);
        // Convert './components/lights/PointLightComponent.js' -> 'components/lights/PointLightComponent.ts'
        let relativePath = match[2].replace(/^\.\//, '').replace(/\.js$/, '.ts');
        // Skip test/game example imports (not part of engine public API)
        if (relativePath.startsWith('../')) continue;
        for (const name of names) {
            if (!map.has(name)) {
                map.set(name, path.join(ENGINE_SRC_ROOT, relativePath));
            }
        }
    }
    return map;
}

function main() {
    const targets = process.argv.slice(2);
    if (targets.length === 0) {
        console.error('Usage: engine-reference.ts <ClassName> [ClassName2 ...]');
        process.exit(1);
    }

    if (!fs.existsSync(ENGINE_DATA_PATH)) {
        console.error(`engine-data.ts not found at: ${ENGINE_DATA_PATH}`);
        process.exit(1);
    }

    const engineDataSource = fs.readFileSync(ENGINE_DATA_PATH, 'utf-8');
    const classMap = buildClassMap(engineDataSource);

    let foundAll = true;
    for (const target of targets) {
        const filePath = classMap.get(target);
        if (!filePath) {
            // Try a fallback: search all .ts files under .engine/src for the class definition
            console.error(`\n[engine-reference] "${target}" not found in engine-data.ts imports. Trying filesystem search...`);
            const found = searchEngineSource(target);
            if (found) {
                printFile(target, found);
            } else {
                console.error(`[engine-reference] Could not locate source for "${target}"`);
                foundAll = false;
            }
            continue;
        }

        if (!fs.existsSync(filePath)) {
            console.error(`[engine-reference] File not found on disk: ${filePath}`);
            foundAll = false;
            continue;
        }

        printFile(target, filePath);
    }

    if (!foundAll) process.exit(1);
}

function printFile(className: string, filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`\n${'='.repeat(80)}`);
    console.log(`// ${className}  —  ${filePath}`);
    console.log('='.repeat(80));
    console.log(content);
}

function searchEngineSource(className: string): string | null {
    const pattern = new RegExp(`\\bclass\\s+${className}\\b`);
    return walkDir(ENGINE_SRC_ROOT, pattern);
}

function walkDir(dir: string, pattern: RegExp): string | null {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const result = walkDir(fullPath, pattern);
            if (result) return result;
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            if (pattern.test(content)) return fullPath;
        }
    }
    return null;
}

main();
