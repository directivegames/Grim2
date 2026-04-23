import * as ENGINE from '@gnsx/genesys.js';
import * as THREE from 'three';

import { ThreeEulerSchema, ThreeVector3Schema } from './mcp/search-actors.js';
import { loadWorld, registerGameClassesIfAnyNotRegistered } from './mcp/utils.js';

import '../src/game.js';

function convertConstructorParams(value: any): any {
  // If not an object, return as is
  if (!value || typeof value !== 'object') {
    return value;
  }

  // Check if it's a Vector3
  const vector3Result = ThreeVector3Schema.safeParse(value);
  if (vector3Result.success) {
    return new THREE.Vector3(
      vector3Result.data.x,
      vector3Result.data.y,
      vector3Result.data.z
    );
  }

  // Check if it's an Euler
  const eulerResult = ThreeEulerSchema.safeParse(value);
  if (eulerResult.success) {
    return new THREE.Euler(
      eulerResult.data.x,
      eulerResult.data.y,
      eulerResult.data.z
    );
  }

  // Handle arrays
  if (Array.isArray(value)) {
    return value.map(convertConstructorParams);
  }

  // Handle objects
  const result: Record<string, any> = {};
  for (const [key, val] of Object.entries(value)) {
    result[key] = convertConstructorParams(val);
  }
  return result;
}


export async function placePrimitive(args: {
  sceneName: string;
  primitiveActors: ENGINE.WorldCommands.PrimitiveActorArgs[];
}): Promise<string[]> {

  using worldResource = await loadWorld(args.sceneName, { skipLoadingGLTF: true });

  const actors = ENGINE.WorldCommands.placePrimitives({
    world: worldResource.world,
    primitiveActors: args.primitiveActors,
  });

  return actors.map(actor => actor.uuid);
}


export async function removeActors(args: {
  sceneName: string;
  actorIds: string[];
}) {
  using worldResource = await loadWorld(args.sceneName, { skipLoadingGLTF: true });

  ENGINE.WorldCommands.removeActorsByUuids({
    world: worldResource.world,
    actorIds: args.actorIds,
  });
}

export async function addGltf(args: {
  sceneName: string;
  gltfs: ENGINE.WorldCommands.GltfArgs[];
}) {
  using worldResource = await loadWorld(args.sceneName, { skipLoadingGLTF: true });

  const actors = await ENGINE.WorldCommands.placeGltfs({
    world: worldResource.world,
    gltfs: args.gltfs
  });

  return actors.map(actor => actor.uuid);
}

export async function placePrefab(args: {
  sceneName: string;
  prefabs: ENGINE.WorldCommands.PrefabArgs[];
}) {
  using worldResource = await loadWorld(args.sceneName, { skipLoadingGLTF: true });

  const actors = await ENGINE.WorldCommands.placePrefabs({
    world: worldResource.world,
    prefabs: args.prefabs
  });

  return actors.map(actor => actor.uuid);
}

export async function placeJsClassActor(args: {
  sceneName: string;
  jsClasses: {
    className: string;
    constructorParams?: Record<string, any>[]
    actorInfo?: ENGINE.WorldCommands.ActorMiscInfo;
  }[]
}): Promise<string[]> {
  await registerGameClassesIfAnyNotRegistered(
    args.jsClasses.map(jsClass => jsClass.className)
  );
  using worldResource = await loadWorld(args.sceneName, { skipLoadingGLTF: true });

  const actors: ENGINE.Actor[] = [];

  for (const { className, constructorParams, actorInfo } of args.jsClasses) {
    try {
      // Convert constructor parameters if they exist
      const convertedParams = constructorParams ? convertConstructorParams(constructorParams) : [];

      const actor = ENGINE.ClassRegistry.constructObject(className, false, ...convertedParams);
      if (actorInfo) {
        const { name, ...rest } = actorInfo;
        if (name) actor.setName(name);
        Object.assign(actor.editorData, rest);
      }
      actors.push(actor);
    } catch (e) {
      console.error(`Error constructing object ${className}`, e);
    }
  }

  worldResource.world.addActors(...actors);
  return actors.map(actor => actor.uuid);
}


export async function updateActors(args: {
  sceneName: string;
  actorsToUpdate: {
    uuid: string;
    transform?: ENGINE.WorldCommands.Transform;
    actorInfo?: ENGINE.WorldCommands.ActorMiscInfo;
  }[];
}): Promise<number> {
  const readonly = args.actorsToUpdate.length == 0;
  using worldResource = await loadWorld(args.sceneName, { readonly, skipLoadingGLTF: true });
  let count = 0;

  for (const { uuid, transform, actorInfo } of args.actorsToUpdate) {
    const actor = worldResource.world.getActorByUuid(uuid);
    if (!actor) {
      continue;
    }
    if (transform) {
      if (transform.position) {
        actor.setWorldPosition(transform.position);
      }
      if (transform.rotation) {
        actor.setWorldRotation(transform.rotation);
      }
      if (transform.scale) {
        actor.setWorldScale(transform.scale);
      }
      if (actorInfo) {
        const { name, ...rest } = actorInfo;
        if (name) actor.setName(name);
        Object.assign(actor.editorData, rest);
      }
    }
    count += 1;
  }
  return count;
}

