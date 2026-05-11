import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

interface MeshInstance {
  path: string;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  scale: [number, number, number];
}

interface ActorDefinition {
  displayName: string;
  meshes: MeshInstance[];
}

interface FolderDefinition {
  name: string;
  actors: ActorDefinition[];
  isInstanced?: boolean;
}

interface MeshCombData {
  folders?: FolderDefinition[];
  actors?: ActorDefinition[];
  cleanFolders?: boolean;
}

function quaternionToEuler(q: [number, number, number, number]): [number, number, number] {
  const [x, y, z, w] = q;
  
  // Roll (x-axis rotation)
  const sinr_cosp = 2 * (w * x + y * z);
  const cosr_cosp = 1 - 2 * (x * x + y * y);
  const roll = Math.atan2(sinr_cosp, cosr_cosp);
  
  // Pitch (y-axis rotation)
  const sinp = 2 * (w * y - z * x);
  const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * Math.PI / 2 : Math.asin(sinp);
  
  // Yaw (z-axis rotation)
  const siny_cosp = 2 * (w * z + x * y);
  const cosy_cosp = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny_cosp, cosy_cosp);
  
  return [roll, pitch, yaw];
}

function generateUuid(): string {
  return crypto.randomBytes(8).toString('hex');
}

function generateFullUuid(): string {
  return crypto.randomUUID();
}

function checkGlbFileExists(assetPath: string, projectRoot: string): boolean {
  // Convert @project/assets/... to actual file path
  let filePath = assetPath;
  
  if (filePath.startsWith('@project/assets/')) {
    filePath = filePath.replace('@project/assets/', 'assets/');
  } else if (filePath.startsWith('@project/../assets/')) {
    filePath = filePath.replace('@project/../assets/', 'assets/');
  } else if (filePath.startsWith('@project/')) {
    filePath = filePath.replace('@project/', '');
  }
  
  const fullPath = path.join(projectRoot, filePath);
  return fs.existsSync(fullPath);
}

function createActorJson(actorDef: ActorDefinition, mesh: MeshInstance) {
  const actorUuid = generateUuid();
  const componentUuid = generateFullUuid();
  const euler = quaternionToEuler(mesh.quaternion);
  
  const actor: any = {
    rootComponent: {
      modelUrl: mesh.path,
      uuid: componentUuid,
      position: {
        _: mesh.position,
        $bc: "v3"
      },
      $bc: "ENGINE.GLTFMeshComponent"
    },
    editorData: {
      displayName: actorDef.displayName
    },
    uuid: actorUuid,
    $bc: "ENGINE.GLTFMeshActor"
  };
  
  // Only add rotation if it's not identity
  if (euler[0] !== 0 || euler[1] !== 0 || euler[2] !== 0) {
    actor.rootComponent.rotation = {
      _: euler,
      $bc: "e"
    };
  }
  
  // Only add scale if it's not [1, 1, 1]
  if (mesh.scale[0] !== 1 || mesh.scale[1] !== 1 || mesh.scale[2] !== 1) {
    actor.rootComponent.scale = {
      _: mesh.scale,
      $bc: "v3"
    };
  }
  
  return actor;
}

function createInstancedMeshActors(folderName: string, actors: ActorDefinition[]): any[] {
  // Group meshes by path (model URL)
  const meshGroups = new Map<string, MeshInstance[]>();
  for (const actorDef of actors) {
    for (const mesh of actorDef.meshes) {
      if (!meshGroups.has(mesh.path)) {
        meshGroups.set(mesh.path, []);
      }
      meshGroups.get(mesh.path)!.push(mesh);
    }
  }
  
  // Create one instanced actor per unique mesh type
  const instancedActors: any[] = [];
  
  for (const [modelUrl, meshes] of meshGroups.entries()) {
    const actorUuid = generateUuid();
    const componentUuid = generateFullUuid();
    
    // Create instances array for this mesh type
    const instances: any[] = [];
    for (const mesh of meshes) {
      const euler = quaternionToEuler(mesh.quaternion);
      
      const instance: any = {
        position: {
          _: mesh.position,
          $bc: "v3"
        },
        rotation: {
          $bc: "e"
        },
        scale: {
          _: mesh.scale,
          $bc: "v3"
        }
      };
      
      // Add rotation array if it's not identity
      if (euler[0] !== 0 || euler[1] !== 0 || euler[2] !== 0) {
        instance.rotation._ = euler;
      }
      
      instances.push(instance);
    }
    
    // Extract asset name from model URL (e.g., "@project/assets/models/SCIFI01/SM_SFFENCE_B.glb" -> "SM_SFFENCE_B")
    const assetName = modelUrl.split('/').pop()?.replace('.glb', '') || folderName;
    const displayName = `INSTANCED_${assetName}`;
    
    const actor: any = {
      rootComponent: {
        instances: instances,
        modelUrl: modelUrl,
        uuid: componentUuid,
        name: "InstancedGltfMeshComponent",
        $bc: "ENGINE.InstancedGltfMeshComponent"
      },
      editorData: {
        displayName: displayName
      },
      uuid: actorUuid,
      $bc: "ENGINE.Actor"
    };
    
    instancedActors.push(actor);
  }
  
  return instancedActors;
}

function transformsMatch(
  existing: any,
  newMesh: MeshInstance,
  epsilon: number = 0.0001
): boolean {
  // Safety check: ensure rootComponent exists
  if (!existing.rootComponent) {
    return false;
  }
  
  // Check position - be defensive about structure
  const existingPos = existing.rootComponent.position?._; 
  if (!existingPos || !Array.isArray(existingPos) || existingPos.length !== 3) {
    return false; // Can't compare if position structure is missing or invalid
  }
  
  if (
    Math.abs(existingPos[0] - newMesh.position[0]) > epsilon ||
    Math.abs(existingPos[1] - newMesh.position[1]) > epsilon ||
    Math.abs(existingPos[2] - newMesh.position[2]) > epsilon
  ) {
    return false;
  }
  
  // Check rotation
  const newEuler = quaternionToEuler(newMesh.quaternion);
  const existingRot = existing.rootComponent.rotation?._ || [0, 0, 0];
  if (
    Math.abs(existingRot[0] - newEuler[0]) > epsilon ||
    Math.abs(existingRot[1] - newEuler[1]) > epsilon ||
    Math.abs(existingRot[2] - newEuler[2]) > epsilon
  ) {
    return false;
  }
  
  // Check scale
  const existingScale = existing.rootComponent.scale?._ || [1, 1, 1];
  if (
    Math.abs(existingScale[0] - newMesh.scale[0]) > epsilon ||
    Math.abs(existingScale[1] - newMesh.scale[1]) > epsilon ||
    Math.abs(existingScale[2] - newMesh.scale[2]) > epsilon
  ) {
    return false;
  }
  
  // Check modelUrl
  if (existing.rootComponent.modelUrl !== newMesh.path) {
    return false;
  }
  
  return true;
}

export async function importMeshCombAsActors(args: {
  meshCombFilePath: string;
  sceneName: string;
  clean?: boolean;
}): Promise<string[]> {
  const { meshCombFilePath, sceneName, clean = false } = args;
  
  // Resolve @project prefix
  let resolvedMeshCombPath = meshCombFilePath;
  if (meshCombFilePath.startsWith('@project/')) {
    const projectRoot = process.cwd();
    resolvedMeshCombPath = path.join(projectRoot, meshCombFilePath.replace('@project/', ''));
  }
  
  // Read mesh-comb file
  if (!fs.existsSync(resolvedMeshCombPath)) {
    throw new Error(`Mesh combination file not found: ${resolvedMeshCombPath}`);
  }
  
  const meshCombData: MeshCombData = JSON.parse(fs.readFileSync(resolvedMeshCombPath, 'utf-8'));
  
  // Read scene file
  const projectRoot = process.cwd();
  const sceneFilePath = path.join(projectRoot, 'assets', `${sceneName}.genesys-scene`);
  
  if (!fs.existsSync(sceneFilePath)) {
    throw new Error(`Scene file not found: ${sceneFilePath}`);
  }
  
  console.log(`\nImporting: ${meshCombFilePath}`);
  console.log(`Into scene: assets/${sceneName}.genesys-scene`);
  
  // Check if cleanFolders flag is set in the export file (overrides CLI flag)
  const cleanFromFile = meshCombData.cleanFolders || false;
  const shouldClean = clean || cleanFromFile;
  
  if (cleanFromFile && !clean) {
    console.log('🧹 Clean mode enabled from export file');
  }
  
  const sceneData = JSON.parse(fs.readFileSync(sceneFilePath, 'utf-8'));
  
  // Handle both array and object formats for actors
  let actors: any[];
  const actorsData = sceneData.$root.actors;
  
  if (Array.isArray(actorsData)) {
    actors = actorsData;
  } else if (actorsData && typeof actorsData === 'object') {
    // Convert object to array
    actors = Object.values(actorsData).filter(v => v !== null && typeof v === 'object');
  } else {
    actors = [];
  }
  
  const sceneTree = sceneData.$root.editorData.sceneTree;
  
  console.log(`Existing actors: ${actors.length}`);
  
  // Build map of existing actors by displayName
  const existingActorsByName = new Map<string, any>();
  for (const actor of actors) {
    if (actor.editorData?.displayName) {
      existingActorsByName.set(actor.editorData.displayName, actor);
    }
  }
  
  const newActorUuids: string[] = [];
  const folderMap = new Map<string, string[]>();
  let createdCount = 0;
  let skippedCount = 0;
  let replacedCount = 0;
  let movedCount = 0;
  let deletedCount = 0;
  let missingFilesCount = 0;
  let instancedComponentsCreated = 0;
  const foldersCreated = new Set<string>();
  const missingFiles = new Set<string>();
  
  // Track where actors currently are in the scene tree
  const actorCurrentLocations = new Map<string, string>(); // uuid -> folder path or 'root'
  
  function findActorInTree(node: any, actorUuid: string, path: string = ''): string | null {
    if (node.nodeType === 'actor' && node.id === actorUuid) {
      return path || 'root';
    }
    if (node.children) {
      for (const child of node.children) {
        const found = findActorInTree(child, actorUuid, node.nodeType === 'folder' ? (path ? `${path}/${node.name}` : node.name) : path);
        if (found !== null) return found;
      }
    }
    return null;
  }
  
  // Build map of current actor locations
  for (const actor of actors) {
    const location = findActorInTree(sceneTree, actor.uuid);
    if (location) {
      actorCurrentLocations.set(actor.uuid, location);
    }
  }
  
  // Process folders
  if (meshCombData.folders) {
    console.log(`\nProcessing ${meshCombData.folders.length} folder(s)...`);
    
    for (const folder of meshCombData.folders) {
      console.log(`\n📁 Folder: ${folder.name}`);
      console.log(`   isInstanced flag: ${folder.isInstanced}`);
      console.log(`   Actors in folder: ${folder.actors.length}`);
      
      const actorUuidsInFolder: string[] = [];
      
      // Check if this is an instanced folder (INSTANCED_ prefix or FORCE INSTANCES enabled)
      if (folder.isInstanced) {
        console.log(`   → Creating InstancedMeshComponent actors (one per mesh type)...`);
        
        // Filter out actors with missing GLB files
        const validActors: ActorDefinition[] = [];
        const skippedInFolder: string[] = [];
        
        for (const actorDef of folder.actors) {
          let allMeshesExist = true;
          for (const mesh of actorDef.meshes) {
            if (!checkGlbFileExists(mesh.path, projectRoot)) {
              missingFiles.add(mesh.path);
              missingFilesCount++;
              allMeshesExist = false;
              skippedInFolder.push(mesh.path);
            }
          }
          
          // Only include actors where all meshes exist
          if (allMeshesExist) {
            validActors.push(actorDef);
          }
        }
        
        if (skippedInFolder.length > 0) {
          console.log(`   ⚠️  Skipped ${skippedInFolder.length} actor(s) with missing files`);
        }
        
        if (validActors.length === 0) {
          console.log(`   ⚠️  No valid actors in folder ${folder.name} - all files missing`);
          continue;
        }
        
        // Create instanced actors (one per unique mesh type) using only valid actors
        const newInstancedActors = createInstancedMeshActors(folder.name, validActors);
        
        // For each instanced actor, check if we need to replace an existing one
        for (const newInstancedActor of newInstancedActors) {
          const displayName = newInstancedActor.editorData.displayName;
          const existingActor = existingActorsByName.get(displayName);
          
          if (existingActor) {
            // Replace existing actor
            const index = actors.findIndex((a: any) => a.uuid === existingActor.uuid);
            actors[index] = newInstancedActor;
            replacedCount++;
            console.log(`   ✓ Replaced: ${displayName} (${newInstancedActor.rootComponent.instances.length} instances)`);
          } else {
            // Create new actor
            actors.push(newInstancedActor);
            createdCount++;
            console.log(`   ✓ Created: ${displayName} (${newInstancedActor.rootComponent.instances.length} instances)`);
          }
          
          actorUuidsInFolder.push(newInstancedActor.uuid);
          newActorUuids.push(newInstancedActor.uuid);
          instancedComponentsCreated++;
        }
        
        console.log(`   → Total: ${newInstancedActors.length} instanced component(s) created/replaced`);
        
        folderMap.set(folder.name, actorUuidsInFolder);
        continue; // Skip normal processing for instanced folders
      }
      
      // Normal folder processing (individual actors)
      console.log(`   → Creating ${folder.actors.length} individual actors...`);
      for (const actorDef of folder.actors) {
        for (const mesh of actorDef.meshes) {
          // Check if the GLB file exists
          if (!checkGlbFileExists(mesh.path, projectRoot)) {
            missingFiles.add(mesh.path);
            missingFilesCount++;
            continue; // Skip this actor - don't create it
          }
          
          const existingActor = existingActorsByName.get(actorDef.displayName);
          
          if (existingActor) {
            // Check if transforms match
            if (transformsMatch(existingActor, mesh)) {
              // Skip - identical
              skippedCount++;
              actorUuidsInFolder.push(existingActor.uuid);
            } else {
              // Replace - transforms differ
              const index = actors.findIndex((a: any) => a.uuid === existingActor.uuid);
              const newActor = createActorJson(actorDef, mesh);
              actors[index] = newActor;
              actorUuidsInFolder.push(newActor.uuid);
              newActorUuids.push(newActor.uuid);
              replacedCount++;
            }
          } else {
            // Create new
            const newActor = createActorJson(actorDef, mesh);
            actors.push(newActor);
            actorUuidsInFolder.push(newActor.uuid);
            newActorUuids.push(newActor.uuid);
            createdCount++;
          }
        }
      }
      
      folderMap.set(folder.name, actorUuidsInFolder);
    }
  }
  
  // Process root-level actors
  if (meshCombData.actors) {
    for (const actorDef of meshCombData.actors) {
      for (const mesh of actorDef.meshes) {
        // Check if the GLB file exists
        if (!checkGlbFileExists(mesh.path, projectRoot)) {
          missingFiles.add(mesh.path);
          missingFilesCount++;
          continue; // Skip this actor - don't create it
        }
        
        const existingActor = existingActorsByName.get(actorDef.displayName);
        
        if (existingActor) {
          if (transformsMatch(existingActor, mesh)) {
            skippedCount++;
          } else {
            const index = actors.findIndex((a: any) => a.uuid === existingActor.uuid);
            const newActor = createActorJson(actorDef, mesh);
            actors[index] = newActor;
            newActorUuids.push(newActor.uuid);
            replacedCount++;
          }
        } else {
          const newActor = createActorJson(actorDef, mesh);
          actors.push(newActor);
          newActorUuids.push(newActor.uuid);
          createdCount++;
        }
      }
    }
  }
  
  // Collect all actor UUIDs that will be managed by the import
  const allManagedActorUuids = new Set<string>();
  for (const actorUuids of folderMap.values()) {
    for (const uuid of actorUuids) {
      allManagedActorUuids.add(uuid);
    }
  }
  
  // Remove all managed actors from the entire scene tree first (to avoid duplicates)
  function removeActorsFromTree(node: any, uuidsToRemove: Set<string>) {
    if (node.children) {
      node.children = node.children.filter((child: any) => {
        if (child.nodeType === 'actor' && uuidsToRemove.has(child.id)) {
          return false; // Remove this actor
        }
        if (child.nodeType === 'folder') {
          removeActorsFromTree(child, uuidsToRemove); // Recurse into folders
        }
        return true; // Keep this node
      });
    }
  }
  
  removeActorsFromTree(sceneTree, allManagedActorUuids);
  
  // Update scene tree folders (supports nested paths like "LEVEL01/CORRIDOR")
  if (folderMap.size > 0) {
    for (const [folderPath, actorUuids] of folderMap.entries()) {
      const parts = folderPath.split('/');
      let currentChildren = sceneTree.children;
      
      // Navigate/create nested folder structure
      for (let i = 0; i < parts.length; i++) {
        const folderName = parts[i];
        const isLeaf = i === parts.length - 1;
        
        let folder = currentChildren.find((n: any) => n.nodeType === 'folder' && n.name === folderName);
        
        if (!folder) {
          // Create new folder
          folder = {
            id: `folder-${Math.random().toString(36).substring(2, 18)}`,
            name: folderName,
            nodeType: 'folder',
            children: []
          };
          currentChildren.push(folder);
          foldersCreated.add(folderPath);
        }
        
        if (isLeaf) {
          // This is the final folder - check for moves
          for (const uuid of actorUuids) {
            const currentLocation = actorCurrentLocations.get(uuid);
            if (currentLocation && currentLocation !== folderPath) {
              movedCount++;
            }
          }
          
          // Add actors here (they've already been removed from everywhere else)
          folder.children.push(...actorUuids.map(uuid => ({
            id: uuid,
            nodeType: 'actor'
          })));
        } else {
          // Navigate deeper
          currentChildren = folder.children;
        }
      }
    }
  }
  
  // Check for deleted actors (actors that were in the import file's folders but no longer exist)
  const importedActorNames = new Set<string>();
  if (meshCombData.folders) {
    for (const folder of meshCombData.folders) {
      for (const actorDef of folder.actors) {
        importedActorNames.add(actorDef.displayName);
      }
    }
  }
  if (meshCombData.actors) {
    for (const actorDef of meshCombData.actors) {
      importedActorNames.add(actorDef.displayName);
    }
  }
  
  // Count how many actors from the import file are missing (were deleted)
  for (const name of importedActorNames) {
    if (!existingActorsByName.has(name)) {
      deletedCount++;
    }
  }
  
  // Clean mode: Remove empty folders within the exported folder hierarchy
  let foldersRemoved = 0;
  if (shouldClean && folderMap.size > 0) {
    // Get all root folder paths from the import
    const rootFolderPaths = new Set<string>();
    for (const folderPath of folderMap.keys()) {
      const rootFolder = folderPath.split('/')[0];
      rootFolderPaths.add(rootFolder);
    }
    
    // Function to recursively remove empty folders
    function cleanEmptyFolders(node: any, isInExportedFolder: boolean = false): boolean {
      if (node.nodeType === 'folder') {
        // Check if this folder is one of our exported root folders
        const isExportedRoot = rootFolderPaths.has(node.name);
        const shouldCleanInside = isInExportedFolder || isExportedRoot;
        
        if (node.children && node.children.length > 0) {
          // Recursively clean children
          node.children = node.children.filter((child: any) => {
            const keep = !cleanEmptyFolders(child, shouldCleanInside);
            if (!keep && shouldCleanInside) {
              foldersRemoved++;
            }
            return keep;
          });
        }
        
        // Return true if this folder is empty AND we should clean it
        return shouldCleanInside && (!node.children || node.children.length === 0);
      }
      return false; // Don't remove actors
    }
    
    // Clean the scene tree
    sceneTree.children = sceneTree.children.filter((child: any) => {
      const shouldRemove = cleanEmptyFolders(child);
      if (shouldRemove) {
        foldersRemoved++;
      }
      return !shouldRemove;
    });
  }
  
  // Write back to scene file
  // Convert actors array back to object format if original was object
  if (typeof actorsData === 'object' && !Array.isArray(actorsData)) {
    const actorsObj: any = {};
    actors.forEach((actor, index) => {
      actorsObj[String(index + 1)] = actor;
    });
    actorsObj.$length = actors.length + 1;
    sceneData.$root.actors = actorsObj;
  } else {
    sceneData.$root.actors = actors;
  }
  
  fs.writeFileSync(sceneFilePath, JSON.stringify(sceneData, null, 2));
  
  console.log(`\n--- Import Summary ---`);
  console.log(`Folders created: ${foldersCreated.size}`);
  if (foldersCreated.size > 0) {
    for (const folder of foldersCreated) {
      console.log(`  - ${folder}`);
    }
  }
  console.log(`Actors moved: ${movedCount}`);
  console.log(`Actors deleted: ${deletedCount}`);
  if (shouldClean) {
    console.log(`Empty folders removed: ${foldersRemoved}`);
  }
  
  // Show instanced folders
  if (meshCombData.folders) {
    const instancedFolders = meshCombData.folders.filter(f => f.isInstanced);
    if (instancedFolders.length > 0) {
      console.log(`\n📦 Instanced Collections:`);
      for (const folder of instancedFolders) {
        console.log(`  - ${folder.name} (${folder.actors.length} instances)`);
      }
    }
  }
  
  // Warning for missing files
  if (missingFilesCount > 0) {
    console.log(`\n⚠️  WARNING: ${missingFilesCount} actors skipped due to missing GLB files:`);
    for (const missingFile of missingFiles) {
      console.log(`   ❌ ${missingFile}`);
    }
  }
  
  console.log(``);
  if (instancedComponentsCreated > 0) {
    console.log(`✓ Created: ${createdCount} actors & ${instancedComponentsCreated} InstancedComponent${instancedComponentsCreated > 1 ? 's' : ''}`);
  } else {
    console.log(`✓ Created: ${createdCount}`);
  }
  console.log(`✓ Replaced: ${replacedCount}`);
  console.log(`✓ Skipped: ${skippedCount}`);
  if (missingFilesCount > 0) {
    console.log(`⚠️  Skipped (missing files): ${missingFilesCount}`);
  }
  console.log(`✓ Total actors in scene: ${actors.length}`);
  console.log(`✓ Scene saved: assets/${sceneName}.genesys-scene\n`);
  
  return newActorUuids;
}

// CLI support
const isMainModule = process.argv[1]?.includes('import-mesh-comb-as-actors');

if (isMainModule) {
  const meshCombFilePath = process.argv[2];
  const sceneName = process.argv[3] || 'default';
  const clean = process.argv[4] === 'clean';
  
  if (!meshCombFilePath) {
    console.error('Usage: pnpm import-mesh-comb <mesh-comb-file-path> [scene-name] [clean]');
    console.error('Example: pnpm import-mesh-comb @project/assets/_source/FTPT01-scifi_11.genesys-mesh-comb default');
    console.error('Example: pnpm import-mesh-comb @project/assets/_source/FTPT01-scifi_11.genesys-mesh-comb default clean');
    process.exit(1);
  }
  
  if (clean) {
    console.log('🧹 Clean mode enabled - will remove empty folders in exported hierarchy');
  }
  
  importMeshCombAsActors({ meshCombFilePath, sceneName, clean })
    .then((uuids) => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Error:', error.message);
      process.exit(1);
    });
}
