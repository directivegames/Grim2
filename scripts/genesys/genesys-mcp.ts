// How to use:
// it must be built first with: pnpm build
// open cursor settings - MCP servers, refresh and make sure "genesys" is connected
// and you're good to go with asking cursor to place primitives in a specified project
//
// for another MCP client (e.g. cline) that wants to use this, the command is: `pnpm exec tsx ./scripts/genesys/genesys-mcp.ts`
import pathlib from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import * as THREE from 'three';
import { z } from 'zod';


import { ActorInfoSchema, TransformSchema } from './common.js';
import { EditorIdSchema, getClientWebSocket, getCurrentScene } from './mcp/editor-functions.js';
import { addEditorTools } from './mcp/editor-tools.js';
import { getSceneState } from './mcp/get-scene-state.js';
import { assetDescriptions, AssetType, populateAssets, searchForAssets } from './mcp/search-assets.js';
import { mcpLogger } from './mcp/utils.js';
import { generateCode } from './misc.js';
import { addGltf, placeJsClassActor, placePrefab, placePrimitive, removeActors, updateActors } from './place-actors.js';

import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';


// Create an MCP server
const server = new McpServer({
  name: 'Genesys-MCP',
  version: '0.0.1'
}, {
  capabilities: {
    logging: {}  // to support sendLoggingMessage
  }
});


const classRule = `
The class name should start with '${ENGINE.Prefix.GAME}' or '${ENGINE.Prefix.ENGINE}' to indicate if it is a class from game project or engine. 
If it starts with neither, it will be matched against all registered classes. If none is found, an error will be returned.
`;


function requestEditorReload(editorId?: string) {
  const ws = getClientWebSocket(editorId);
  ws.send(JSON.stringify({
    command: 'reload'
  }));
}

addEditorTools(server);

const primitiveTypes = Object.values(ENGINE.WorldCommands.PrimitiveType);

server.registerTool(
  'placePrimitive',
  {
    description: 'Place 3D primitives in the specified scene.',
    inputSchema: {
      editorId: EditorIdSchema,
      primitiveActors: z.array(
        z.object({
          primitives: z.array(
            z.object({
              type: z.enum(primitiveTypes as [string, ...string[]])
                .describe(`Type of primitive to place, one of: ${primitiveTypes.join(', ')}`),
              transform: TransformSchema.optional().describe('Transform of the primitive relative to the actor'),
              color: z.union([z.array(z.number()).length(3), z.string(), z.number()]).optional().describe('Color as [r, g, b], hex string, hex number, or X11 color name'),
            }).strict().describe('A primitive to add to the actor.')
          ).describe('A list of primitives to add to the actor.'),
          info: ActorInfoSchema.describe('Information about the primitive actor.'),
          transform: TransformSchema.optional().describe('Transform of the actor in the scene'),
        }).strict().describe('An actor containing primitives to place.')
      ).describe('A list of lists of primitives to add. Each inner list represents a single actor to place.'),
    },
  },
  async ({ editorId, primitiveActors }) => {
    let actorIds: string[] = [];
    let sceneName: string;

    {
      using loggerContext = mcpLogger(server);
      try {
        sceneName = await getCurrentScene(editorId);
        actorIds = await placePrimitive({
          sceneName,
          primitiveActors: primitiveActors.map(primitiveActor => ({
            miscInfo: {
              name: primitiveActor.info.name,
              description: primitiveActor.info.description ?? '',
            },
            transform: {
              position: new THREE.Vector3(...(primitiveActor.transform?.position ?? [0, 0, 0])),
              rotation: new THREE.Euler(...(primitiveActor.transform?.rotation ?? [0, 0, 0])),
              scale: new THREE.Vector3(...(primitiveActor.transform?.scale ?? [1, 1, 1])),
            },
            primitives: primitiveActor.primitives.map(primitive => ({
              type: primitive.type,
              transform: {
                position: new THREE.Vector3(...(primitive.transform?.position ?? [0, 0, 0])),
                rotation: new THREE.Euler(...(primitive.transform?.rotation ?? [0, 0, 0])),
                scale: new THREE.Vector3(...(primitive.transform?.scale ?? [1, 1, 1])),
              },
              color: Array.isArray(primitive.color) ? new THREE.Color(...primitive.color) : new THREE.Color(primitive.color as (string | number)),
            }))
          }))
        });
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `${error}` }]
        };
      }

      if (actorIds.length > 0) {
        requestEditorReload(editorId);
      }
    }

    const uuids = actorIds.join(', ');
    const text = `Primitives placed successfully in ${sceneName}, placed actor UUIDs are [${uuids}]`;
    return {
      content: [{ type: 'text', text }]
    };
  }
);

server.registerTool(
  'removeActors',
  {
    description: 'Remove one or more actors from the scene by their UUIDs.',
    inputSchema: {
      editorId: EditorIdSchema,
      actorIds: z.array(z.string()).describe('List of actor UUIDs to remove'),
    },
  },
  async ({ editorId, actorIds }) => {
    {
      using loggerContext = mcpLogger(server);
      const sceneName = await getCurrentScene(editorId);
      await removeActors({ sceneName, actorIds });

      if (actorIds.length > 0) {
        requestEditorReload(editorId);
      }
    }
    const text = `${actorIds.length} actors removed successfully`;
    return {
      content: [{ type: 'text', text }]
    };
  }
);


server.registerTool(
  'addGltf',
  {
    description: 'Add GLTF models to the scene.',
    inputSchema: {
      editorId: EditorIdSchema,
      gltfs: z.array(
        z.object({
          path: z.string().describe(`Path or URL to the GLTF model to add. 
Unless explicitly told by user, otherwise it should always be one of these
- fetched from the result of searchAssets tool
- copied from an existing path of an existing placed GLTF actor.
- use a verified URL to a GLTF model
Never make up a relative path to a file, because that won't be resolved by the editor.
`),
          transform: TransformSchema.optional().describe('Transform of the GLTF model'),
          info: ActorInfoSchema.describe('Information about the GLTF model actor.'),
        }).strict().describe('A GLTF model to add.')
      ).describe('A list of GLTF models to add.'),
    },
  },
  async ({ editorId, gltfs }) => {
    let actorIds: string[] = [];

    {
      using loggerContext = mcpLogger(server);
      const sceneName = await getCurrentScene(editorId);
      actorIds = await addGltf({
        sceneName,
        gltfs: gltfs.map(gltf => ({
          path: gltf.path,
          transform: {
            position: new THREE.Vector3(...(gltf.transform?.position ?? [0, 0, 0])),
            rotation: new THREE.Euler(...(gltf.transform?.rotation ?? [0, 0, 0])),
            scale: new THREE.Vector3(...(gltf.transform?.scale ?? [1, 1, 1])),
          },
          miscInfo: {
            name: gltf.info.name,
            description: gltf.info.description ?? '',
          },
        }))
      });

      if (actorIds.length > 0) {
        requestEditorReload(editorId);
      }
    }

    const uuids = actorIds.join(', ');
    const text = `GLTFs added successfully, placed actor UUIDs are [${uuids}]`;
    return {
      content: [{ type: 'text', text }]
    };
  }
);

server.registerTool(
  'placePrefab',
  {
    description: 'Place prefabs in the scene.',
    inputSchema: {
      editorId: EditorIdSchema,
      prefabs: z.array(
        z.object({
          path: z.string().describe('Path to the prefab to place'),
          transform: TransformSchema.optional().describe('Transform of the prefab'),
          info: ActorInfoSchema.describe('Information about the prefab actor.'),
        }).strict().describe('A prefab to place.')
      ).describe('A list of prefabs to place. Each prefab can have a transform.'),
    },
  },
  async ({ editorId, prefabs }) => {
    let actorIds: string[] = [];

    {
      using loggerContext = mcpLogger(server);
      const sceneName = await getCurrentScene(editorId);
      actorIds = await placePrefab({
        sceneName,
        prefabs: prefabs.map(prefab => ({
          path: prefab.path,
          transform: {
            position: new THREE.Vector3(...(prefab.transform?.position ?? [0, 0, 0])),
            rotation: new THREE.Euler(...(prefab.transform?.rotation ?? [0, 0, 0])),
            scale: new THREE.Vector3(...(prefab.transform?.scale ?? [1, 1, 1])),
          },
          miscInfo: {
            name: prefab.info.name,
            description: prefab.info.description ?? '',
          },
        }))
      });

      if (actorIds.length > 0) {
        requestEditorReload(editorId);
      }
    }
    const uuids = actorIds.join(', ');
    const text = `Prefabs placed successfully, placed actor UUIDs are [${uuids}]`;
    return {
      content: [{ type: 'text', text }]
    };
  }
);


server.registerTool(
  'searchAssets',
  {
    description: `Search for assets in the project and engine directories.
When the user requests to place something in the scene, unless it is clearly a primitive, always try calling this first to see if any assets are fitting the request.
Before using the assets found, **always** call the \`getAssetsMetadata\` tool to get the metadata about the assets, unless the given metadata is already fetched.
Here is the list of assets types, including:
${Object.entries(assetDescriptions).map(([type, description]) => `- ${type}: ${description}`).join('\n')}
`,
    inputSchema: {
      acceptedTypes: z.array(z.enum(Object.values(AssetType) as [string, ...string[]])).describe('List of types of assets to search for. An empty array means all types.'),
      searchKeywords: z.array(z.string()).describe('List of keywords to search for in the assets. Wildcards are not supported, use multiple keywords to search for multiple terms. Use an empty array to search for all assets.'),
    },
  },
  async ({ acceptedTypes, searchKeywords }) => {
    using loggerContext = mcpLogger(server);

    const dirs = [`${ENGINE.PROJECT_PATH_PREFIX}/assets`, `${ENGINE.ENGINE_PATH_PREFIX}/assets`];
    const {assets, metadataDescription} = await searchForAssets(dirs, acceptedTypes as AssetType[], searchKeywords);

    const result: CallToolResult = {content: []};
    if (metadataDescription && Object.keys(metadataDescription).length > 0) {
      result.content.push(
        { type: 'text', text: `Here is the description of the metadata fields of the assets, per asset type:\n${JSON.stringify(metadataDescription, null, 2)}` }
      );
    }

    result.content.push({ type: 'text', text: `Assets:\n${JSON.stringify(assets, null, 2)}` });
    return result;
  }
);


server.registerTool(
  'getAssetsMetadata',
  {
    description: 'Get metadata for the assets found by the `searchAssets` tool.',
    inputSchema: {
      assetPaths: z.array(z.string()).describe('List of asset paths to get metadata for. The asset paths are the keys retrieved from the result of \`searchAssets\` tool.'),
    },
  },
  async ({ assetPaths }) => {
    using loggerContext = mcpLogger(server);

    try {
      const assetsInfo = await populateAssets(assetPaths, { peek: false });
      const metadataDescription = assetsInfo.metadataDescription;
      const assets = assetsInfo.assets;

      const result: CallToolResult = {content: []};
      if (metadataDescription && Object.keys(metadataDescription).length > 0) {
        result.content.push(
          { type: 'text', text: `Here is the description of the metadata fields of the assets, per asset type:\n${JSON.stringify(metadataDescription, null, 2)}` }
        );
      }

      result.content.push({ type: 'text', text: `Assets:\n${JSON.stringify(assets, null, 2)}` });
      return result;

    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error getting assets metadata: ${error}` }]
      };
    }
  }
);


server.registerTool(
  'placeJsClassActor',
  {
    description: 'Place a JavaScript game or engine class actor in the scene.',
    inputSchema: {
      editorId: EditorIdSchema,
      actors: z.array(
        z.object({
          className: z.string().describe(`The name of the JavaScript class to place. ${classRule}`),
          constructorParams: z.array(z.record(z.any())).optional()
            .describe(`Optional constructor parameters to pass to the actor class.
Use the getAssetsMetadata tool to discover what parameters each actor class requires,
and the parameters should be an array that corresponds to the "jsClassConstructorParams" from the result of the getAssetsMetadata tool.
If the actor class has no constructor parameters, the array should be empty.
          `),
          info: ActorInfoSchema.describe('Information about the actor.'),
        }).strict().describe('A JavaScript class actor to place.')
      ).describe('A list of JavaScript class actors to place. Each actor can have a transform and constructor parameters.'),
    },
  },
  async ({ editorId, actors }) => {
    using loggerContext = mcpLogger(server);

    const sceneName = await getCurrentScene(editorId);

    const result = await placeJsClassActor({sceneName, jsClasses: actors.map(actor => ({
      className: actor.className,
      constructorParams: actor.constructorParams,
      actorInfo: actor.info,
    }))});

    if (result.length > 0) {
      requestEditorReload(editorId);
    }

    const uuids = result.join(', ');
    const text = `JavaScript class actors placed successfully, placed actor UUIDs are [${uuids}]`;
    return {
      content: [{ type: 'text', text }]
    };
  }
);


server.registerTool(
  'generateTemplateCode',
  {
    description: 'Generate template code for a class of actor or component. When the user asks to create a new actor or component, always try calling this first to see if any template code is available, and iterate on the code it generates until it is correct.',
    inputSchema: {
      className: z.string().describe('The name of the class to generate template code for.'),
      filePath: z.string().describe(`The path to the file to generate the template code for.
If it is a relative path, it will be relative to the 'src/' directory, so don't include the extra 'src/' in the path.
The file name should be lower camel case, such as 'myActor.ts', or 'fancyMovementComponent.ts'.`
      ),
      baseClassName: z.string().describe(`The name of the base class to generate the template code for. ${classRule}`),
    },
  },
  async ({ className, filePath, baseClassName }) => {
    using loggerContext = mcpLogger(server);

    const fullFilePath = pathlib.isAbsolute(filePath) ? filePath : pathlib.join('src', filePath);
    let success = false;
    try {
      success = await generateCode(className, fullFilePath, baseClassName);
    }
    catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Failed to generate code: ${error}` }]
      };
    }

    if (success) {
      return {
        content: [
          {
            type: 'text',
            text: `template code for class ${className} has been generated at ${fullFilePath}`
          }
        ]
      };
    }

    return {
      isError: true,
      content: [{ type: 'text', text: `Error: Template code for class ${className} has not been generated.` }]
    };
  }
);


server.registerTool(
  'getSceneState',
  {
    description: `
Get the current state of the scene to understand the state of the current scene and its actors.
**DO NOT** try reading the scene file directly unless explicitly asked by the user.
The first time calling this tool, always call without specifiedActors and getDetailedComponentsInfo to have an overview of the scene.
And then call this tool with \`specifiedActors\`, and set \`getDetailedComponentsInfo\` to true, to get more detailed information about specific actors, including their bounding boxes info, etc.
`,
    inputSchema: {
      editorId: EditorIdSchema,
      specifiedActors: z.array(z.string()).optional().describe('A list of actor UUIDs. If specified, actors not in this list will contain only very basic information, namely their UUID and name.'),
      getDetailedComponentsInfo: z.boolean().optional().describe('If true, will contain detailed information about their properties, otherwise they will contain only their UUID and name. If specifiedActors is present, only actors in this list will have detailed information.'),
    },
  },
  async ({editorId, specifiedActors, getDetailedComponentsInfo}) => {
    using loggerContext = mcpLogger(server);

    try {
      const sceneName = await getCurrentScene(editorId);
      const state = await getSceneState(sceneName, specifiedActors, getDetailedComponentsInfo);
      function roundNumbersReplacer(key: string, value: any) {
        if (typeof value === 'number') {
          return Number(value.toFixed(5));
        }
        return value;
      }
      return {
        content: [{ type: 'text', text: `The following is the state of the scene currently opened in the editor:\n\`\`\`json\n${JSON.stringify(state, roundNumbersReplacer)}\n\`\`\`` }]
      };
    }
    catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Error getting scene state: ${error}` }]
      };
    }
  }
);

server.registerTool(
  'updateActors',
  {
    description: 'Update the properties of existing actors in the scene.',
    inputSchema: {
      editorId: EditorIdSchema,
      actors: z.array(
        z.object({
          uuid: z.string().describe('UUID of the actor to update'),
          transform: TransformSchema.optional().describe('New transform of the actor'),
          info: ActorInfoSchema.optional().describe('New information about the actor.'),
        }).strict().describe('An actor to update with its new properties.')
      ).describe('A list of actors to update with their new properties.'),
    },
  },
  async ({editorId, actors}) => {
    using loggerContext = mcpLogger(server);

    const makeActorUpdateArg = (actor: typeof actors[number]) => {
      const args: any = {};
      args.uuid = actor.uuid;
      if (actor.transform) {
        args.transform = {};
        if (actor.transform.position) {
          args.transform.position = new THREE.Vector3(...actor.transform.position);
        }
        if (actor.transform.rotation) {
          args.transform.rotation = new THREE.Euler(...actor.transform.rotation);
        }
        if (actor.transform.scale) {
          args.transform.scale = new THREE.Vector3(...actor.transform.scale);
        }
      }
      if (actor.info) {
        args.actorInfo = {};
        if (actor.info.name) {
          args.actorInfo.name = actor.info.name;
        }
        if (actor.info.description) {
          args.actorInfo.description = actor.info.description;
        }
      }
      return args;
    };

    const sceneName = await getCurrentScene(editorId);
    const updatedActorsNum = await updateActors({
      sceneName,
      actorsToUpdate: actors.map(actorToUpdate => makeActorUpdateArg(actorToUpdate))
    });

    if (updatedActorsNum > 0) {
      requestEditorReload(editorId);
    }

    return {
      content: [{ type: 'text', text: `Completed, ${updatedActorsNum} actors updated` }]
    };
  }
);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
server.server.sendLoggingMessage({level: 'info', data: 'starting up MCP server for Genesys'});
