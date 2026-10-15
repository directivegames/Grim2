/**
 * Compress GLB files for web delivery: downscale textures to WebP (`EXT_texture_webp`),
 * bake MikkTSpace tangents, then Meshopt geometry. Fails if glTF-Validator reports
 * any error or warning.
 *
 * Usage (from project root):
 *   pnpm compress-glb <input.glb|folder> [output.glb]
 *   pnpm compress-glb assets/models/hero.glb
 *   pnpm compress-glb assets/models --preserve
 */
import fs from 'node:fs/promises';
import path from 'node:path';

import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { meshopt, tangents, textureCompress, unweld, weld } from '@gltf-transform/functions';
import { validateBytes } from 'gltf-validator';
import { MeshoptDecoder, MeshoptEncoder } from 'meshoptimizer';
import { generateTangents } from 'mikktspace';
import sharp from 'sharp';

interface CliOptions {
  inputPath: string;
  outputPath: string | undefined;
  maxSize: number;
  webpQuality: number;
  preserve: boolean;
  recursive: boolean;
}

interface ValidatorMessage {
  code?: string;
  severity?: number;
  message?: string;
  pointer?: string;
}

interface ValidatorReport {
  issues?: {
    numErrors?: number;
    numWarnings?: number;
    numInfos?: number;
    numHints?: number;
    messages?: ValidatorMessage[];
  };
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function printHelp(): void {
  console.log(`
Compress GLB files for web delivery (WebP textures + Meshopt geometry).

Usage:
  pnpm compress-glb <input.glb|folder> [output.glb]
  pnpm compress-glb assets/models/hero.glb
  pnpm compress-glb assets/models --preserve

Options:
  --max-size <px>       Longest texture edge (default: 1024)
  --webp-quality <n>    WebP quality 1-100 (default: 80)
  --preserve            Write <name>-compressed.glb beside sources (folders only)
  --recursive, -r       Process subfolders when input is a directory
  --help, -h            Show this help

Single-file default output: <name>-compressed.glb in the same folder.
Folder mode without --preserve overwrites each .glb in place.
`);
}

function resolveProjectPath(candidate: string): string {
  return path.isAbsolute(candidate) ? candidate : path.resolve(process.cwd(), candidate);
}

function parseArgs(argv: string[]): CliOptions | null {
  let maxSize = 1024;
  let webpQuality = 80;
  let preserve = false;
  let recursive = false;
  const positional: string[] = [];

  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--help' || arg === '-h') {
      return null;
    }
    if (arg === '--max-size') {
      maxSize = Number(argv[++index]);
      continue;
    }
    if (arg === '--webp-quality') {
      webpQuality = Number(argv[++index]);
      continue;
    }
    if (arg === '--preserve') {
      preserve = true;
      continue;
    }
    if (arg === '--recursive' || arg === '-r') {
      recursive = true;
      continue;
    }
    positional.push(arg);
  }

  if (positional.length === 0) {
    return null;
  }

  if (!Number.isFinite(maxSize) || maxSize < 4) {
    throw new Error('--max-size must be a number >= 4');
  }
  if (!Number.isFinite(webpQuality) || webpQuality < 1 || webpQuality > 100) {
    throw new Error('--webp-quality must be a number between 1 and 100');
  }

  const inputPath = resolveProjectPath(positional[0]);
  const outputPath = positional[1] ? resolveProjectPath(positional[1]) : undefined;

  return { inputPath, outputPath, maxSize, webpQuality, preserve, recursive };
}

async function createIo(): Promise<NodeIO> {
  await Promise.all([MeshoptEncoder.ready, MeshoptDecoder.ready]);
  return new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'meshopt.encoder': MeshoptEncoder,
      'meshopt.decoder': MeshoptDecoder,
    });
}

async function findGlbFiles(dir: string, recursive: boolean): Promise<string[]> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && recursive) {
      files.push(...await findGlbFiles(fullPath, recursive));
      continue;
    }
    if (
      entry.isFile()
      && entry.name.toLowerCase().endsWith('.glb')
      && !entry.name.toLowerCase().endsWith('-compressed.glb')
    ) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function resolveOutputPath(inputPath: string, options: CliOptions): string {
  if (options.outputPath) {
    return options.outputPath;
  }
  const dir = path.dirname(inputPath);
  const base = path.basename(inputPath, '.glb');
  const suffix = options.preserve || !options.outputPath ? '-compressed' : '';
  return path.join(dir, `${base}${suffix}.glb`);
}

function formatValidatorMessage(entry: ValidatorMessage): string {
  const code = entry.code ?? 'UNKNOWN';
  const pointer = entry.pointer ? ` ${entry.pointer}` : '';
  return `${code}:${pointer} ${entry.message ?? ''}`.trim();
}

async function assertValidGlb(filePath: string): Promise<void> {
  const bytes = new Uint8Array(await fs.readFile(filePath));
  const report = (await validateBytes(bytes)) as ValidatorReport;
  const issues = report.issues ?? {};
  const errors = issues.numErrors ?? 0;
  const warnings = issues.numWarnings ?? 0;

  if (errors > 0 || warnings > 0) {
    for (const message of (issues.messages ?? []).filter(entry => entry.severity === 0 || entry.severity === 1)) {
      console.error(`  ${formatValidatorMessage(message)}`);
    }
    throw new Error(`GLB failed glTF validation (${errors} error(s), ${warnings} warning(s)): ${filePath}`);
  }
}

async function compressGlbFile(inputPath: string, outputPath: string, options: CliOptions): Promise<void> {
  if (path.resolve(inputPath) === path.resolve(outputPath)) {
    const tempPath = `${outputPath}.compress-glb.tmp`;
    await fs.copyFile(inputPath, tempPath);
    await compressGlbAtPath(tempPath, options);
    await fs.rename(tempPath, outputPath);
    return;
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.copyFile(inputPath, outputPath);
  await compressGlbAtPath(outputPath, options);
}

async function compressGlbAtPath(filePath: string, options: CliOptions): Promise<void> {
  const sizeBefore = (await fs.stat(filePath)).size;
  const io = await createIo();
  const inputBytes = await fs.readFile(filePath);
  const document = await io.readBinary(inputBytes);
  const textureCount = document.getRoot().listTextures().length;

  await document.transform(
    textureCompress({
      encoder: sharp,
      targetFormat: 'webp',
      quality: options.webpQuality,
      resize: [options.maxSize, options.maxSize],
    }),
    unweld(),
    tangents({ generateTangents }),
    weld(),
    meshopt({ encoder: MeshoptEncoder, level: 'high' }),
  );

  const outputBytes = await io.writeBinary(document);
  await fs.writeFile(filePath, outputBytes);
  await assertValidGlb(filePath);

  const sizeAfter = (await fs.stat(filePath)).size;
  console.log(
    `${path.basename(filePath)}: ${formatBytes(sizeBefore)} → ${formatBytes(sizeAfter)} ` +
      `(${((1 - sizeAfter / sizeBefore) * 100).toFixed(1)}% saved, ${textureCount} texture(s), ` +
      `WebP q${options.webpQuality} max ${options.maxSize}px)`,
  );
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const options = parseArgs(argv);
  if (!options) {
    printHelp();
    const isHelp = argv.some(arg => arg === '--help' || arg === '-h');
    process.exit(isHelp ? 0 : 1);
  }

  const stat = await fs.stat(options.inputPath);
  const glbFiles = stat.isDirectory()
    ? await findGlbFiles(options.inputPath, options.recursive)
    : [options.inputPath];

  if (glbFiles.length === 0) {
    throw new Error(`No .glb files found under ${options.inputPath}`);
  }
  if (stat.isFile() && options.preserve) {
    throw new Error('--preserve applies to folder inputs only');
  }
  if (stat.isFile() && options.outputPath && glbFiles.length > 1) {
    throw new Error('Output path is only valid for a single input .glb');
  }

  for (const inputPath of glbFiles) {
    const outputPath = stat.isDirectory() && !options.preserve
      ? inputPath
      : resolveOutputPath(inputPath, options);
    await compressGlbFile(inputPath, outputPath, options);
  }
}

await main();
