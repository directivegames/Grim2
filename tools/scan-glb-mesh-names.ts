import fs from 'fs';
import path from 'path';

const modelsDir = 'C:\\Users\\r2fir\\Desktop\\test game\\Grim\\Grim\\assets\\models';

interface GlbMeshInfo {
  filename: string;
  meshNames: string[];
}

function scanGlbFiles(): GlbMeshInfo[] {
  const results: GlbMeshInfo[] = [];
  
  const files = fs.readdirSync(modelsDir)
    .filter(f => f.toLowerCase().endsWith('.glb'))
    .sort();
  
  for (const filename of files) {
    const filepath = path.join(modelsDir, filename);
    const data = fs.readFileSync(filepath);
    
    // Look for mesh names in the GLB binary
    const content = data.toString('ascii', 0, Math.min(50000, data.length));
    const meshMatches = content.match(/Mesh_\d+(?:\.\d+)?/g) || [];
    const uniqueMeshes = [...new Set(meshMatches)];
    
    if (uniqueMeshes.length > 0) {
      results.push({
        filename,
        meshNames: uniqueMeshes
      });
    }
  }
  
  return results;
}

const glbInfo = scanGlbFiles();
console.log('GLB Files with Mesh names:');
for (const info of glbInfo) {
  console.log(`${info.filename}: ${info.meshNames.join(', ')}`);
}

// Save mapping
fs.writeFileSync(
  'C:\\Users\\r2fir\\Desktop\\test game\\Grim\\Grim\\tools\\glb-mesh-mapping.json',
  JSON.stringify(glbInfo, null, 2)
);

console.log(`\nScanned ${glbInfo.length} GLB files`);
