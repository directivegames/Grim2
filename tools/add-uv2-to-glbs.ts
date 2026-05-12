#!/usr/bin/env node
/**
 * Add UV2 (lightmap UV) channels to all GLB files
 * Uses @gltf-transform v4 API
 */

import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { KHRDracoMeshCompression } from '@gltf-transform/extensions';
import * as fs from 'fs';
import * as path from 'path';

const MODELS_DIR = './assets/models';
const PROCESSED_DIR = './assets/models/with-uv2';

// Ensure output directory exists
if (!fs.existsSync(PROCESSED_DIR)) {
  fs.mkdirSync(PROCESSED_DIR, { recursive: true });
}

const io = new NodeIO().registerExtensions([KHRDracoMeshCompression]);

interface UV2Result {
  file: string;
  success: boolean;
  meshesProcessed: number;
  error?: string;
}

/**
 * Generate a proper lightmap UV channel for a primitive
 * This duplicates UV0 as UV2 (fast approach) or generates new UVs
 */
function generateUV2ForPrimitive(primitive: Primitive, document: Document): boolean {
  try {
    // Get the existing UVs (TEXCOORD_0)
    const uv0 = primitive.getAttribute('TEXCOORD_0');
    if (!uv0) {
      console.log(`    No UV0 found, skipping`);
      return false;
    }

    const vertexCount = uv0.getCount();
    
    // Get positions for spatial-based UV generation
    const positions = primitive.getAttribute('POSITION');
    if (!positions) {
      console.log(`    No positions found, duplicating UV0 as UV2`);
      // Clone UV0 as UV2
      const uv2Data: number[] = [];
      for (let i = 0; i < vertexCount; i++) {
        const uv: number[] = uv0.getElement(i, []);
        uv2Data.push(uv[0], uv[1]);
      }
      
      const root = document.getRoot();
      const buffer = root.listBuffers()[0] || document.createBuffer();
      
      const uv2 = document.createAccessor()
        .setType('VEC2')
        .setBuffer(buffer)
        .setArray(new Float32Array(uv2Data));
      
      primitive.setAttribute('TEXCOORD_1', uv2);
      return true;
    }

    // Calculate bounds
    let minX = Infinity, maxX = -Infinity;
    let minZ = Infinity, maxZ = -Infinity;
    
    for (let i = 0; i < vertexCount; i++) {
      const pos: number[] = positions.getElement(i, []);
      minX = Math.min(minX, pos[0]);
      maxX = Math.max(maxX, pos[0]);
      minZ = Math.min(minZ, pos[2]);
      maxZ = Math.max(maxZ, pos[2]);
    }
    
    const rangeX = maxX - minX || 1;
    const rangeZ = maxZ - minZ || 1;

    // Generate UV data array
    const uv2Data: number[] = [];
    for (let i = 0; i < vertexCount; i++) {
      const pos: number[] = positions.getElement(i, []);
      const u = (pos[0] - minX) / rangeX;
      const v = (pos[2] - minZ) / rangeZ;
      uv2Data.push(u, v);
    }

    // Create the UV2 accessor with the Float32Array
    const root = document.getRoot();
    const buffer = root.listBuffers()[0] || document.createBuffer();
    
    const uv2 = document.createAccessor()
      .setType('VEC2')
      .setBuffer(buffer)
      .setArray(new Float32Array(uv2Data));
    
    primitive.setAttribute('TEXCOORD_1', uv2);
    return true;
    
  } catch (error) {
    console.log(`    Error generating UV2: ${error}`);
    return false;
  }
}

/**
 * Process a single GLB file
 */
async function processGLB(filePath: string): Promise<UV2Result> {
  const fileName = path.basename(filePath);
  
  try {
    // Read the document
    const document = await io.read(filePath);
    const root = document.getRoot();
    
    let meshesProcessed = 0;
    let hadUV2Already = 0;
    
    // Process each mesh
    for (const mesh of root.listMeshes()) {
      const meshName = mesh.getName() || 'unnamed';
      
      for (const prim of mesh.listPrimitives()) {
        // Check if already has UV2
        const existingUV2 = prim.getAttribute('TEXCOORD_1');
        if (existingUV2) {
          hadUV2Already++;
          meshesProcessed++;
          continue;
        }
        
        // Generate UV2
        const success = generateUV2ForPrimitive(prim, document);
        if (success) {
          meshesProcessed++;
        }
      }
    }
    
    // Write the output
    const outputPath = path.join(PROCESSED_DIR, fileName);
    await io.write(outputPath, document);
    
    return {
      file: fileName,
      success: true,
      meshesProcessed
    };
    
  } catch (error) {
    return {
      file: fileName,
      success: false,
      meshesProcessed: 0,
      error: String(error)
    };
  }
}

/**
 * Main function
 */
async function main() {
  console.log('=== GLB UV2 Generator ===\n');
  
  // Find all GLB files
  const glbFiles: string[] = [];
  
  function findGLBs(dir: string) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        findGLBs(fullPath);
      } else if (item.name.endsWith('.glb')) {
        glbFiles.push(fullPath);
      }
    }
  }
  
  findGLBs(MODELS_DIR);
  console.log(`Found ${glbFiles.length} GLB files\n`);
  
  // Process each file
  const results: UV2Result[] = [];
  for (let i = 0; i < glbFiles.length; i++) {
    const file = glbFiles[i];
    const fileName = path.basename(file);
    console.log(`[${i + 1}/${glbFiles.length}] ${fileName}...`);
    
    const result = await processGLB(file);
    results.push(result);
    
    if (result.success) {
      console.log(`  ✓ Added UV2 to ${result.meshesProcessed} mesh(es)`);
    } else {
      console.log(`  ✗ ${result.error}`);
    }
  }
  
  // Summary
  console.log('\n=== Summary ===\n');
  const successful = results.filter(r => r.success);
  const totalMeshes = results.reduce((sum, r) => sum + r.meshesProcessed, 0);
  
  console.log(`Total files: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${results.length - successful.length}`);
  console.log(`Total meshes with UV2: ${totalMeshes}`);
  
  console.log(`\nProcessed files are in: ${PROCESSED_DIR}`);
  console.log('\nNext steps:');
  console.log('1. Backup your original models folder');
  console.log('2. Copy files from with-uv2/ to models/');
  console.log('3. Test in Genesys editor');
}

// Run if main module
const isMainModule = import.meta.url === `file://${process.argv[1]}` ||
                     process.argv[1]?.includes('add-uv2-to-glbs');

if (isMainModule) {
  main().catch(console.error);
}

export { main, processGLB };
