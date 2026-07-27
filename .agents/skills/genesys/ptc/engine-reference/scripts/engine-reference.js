/**
 * engine-reference.js
 *
 * Looks up one or more engine class names and prints the contents of their
 * .d.ts declaration files from the engine package dist directory.
 *
 * Usage:
 *   node .agents/skills/engine-reference/scripts/engine-reference.js <ClassName> [ClassName2 ...]
 *
 * Example:
 *   node .agents/skills/engine-reference/scripts/engine-reference.js PointLightComponent CharacterMovementComponent
 */

import * as fs from 'fs';
import * as path from 'path';

const ENGINE_DIST_ROOT = path.resolve('node_modules/@gnsx/genesys.js/dist/src');

function main() {
    const targets = process.argv.slice(2);
    if (targets.length === 0) {
        console.error('Usage: engine-reference.js <ClassName> [ClassName2 ...]');
        process.exit(1);
    }

    if (!fs.existsSync(ENGINE_DIST_ROOT)) {
        console.error(`Engine dist not found at: ${ENGINE_DIST_ROOT}`);
        process.exit(1);
    }

    let foundAll = true;
    for (const target of targets) {
        const filePath = findDeclarationFile(target);
        if (!filePath) {
            console.error(`[engine-reference] Could not locate .d.ts for "${target}" under ${ENGINE_DIST_ROOT}`);
            foundAll = false;
            continue;
        }
        printFile(target, filePath);
    }

    if (!foundAll) process.exit(1);
}

function findDeclarationFile(className) {
    const fileName = `${className}.d.ts`;
    return walkDir(ENGINE_DIST_ROOT, fileName);
}

function walkDir(dir, fileName) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            const result = walkDir(fullPath, fileName);
            if (result) return result;
        } else if (entry.isFile() && entry.name === fileName) {
            return fullPath;
        }
    }
    return null;
}

function printFile(className, filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`\n${'='.repeat(80)}`);
    console.log(`// ${className}  —  ${filePath}`);
    console.log('='.repeat(80));
    console.log(content);
}

main();
