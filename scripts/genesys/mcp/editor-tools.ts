
import { z } from 'zod';

import { EditorIdSchema, getClientWebSocket, getCurrentScene } from './editor-functions.js';
import { mcpLogger } from './utils.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { WebSocket } from 'ws';


export function addEditorTools(server: McpServer) {
  server.registerTool(
    'selectActors',
    {
      description: 'Make the editor to select an actor by its UUID.',
      inputSchema: {
        actorIds: z.array(z.string()).describe('UUIDs of the actors to select'),
        editorId: EditorIdSchema,
      },
    },
    async ({actorIds, editorId}) => {
      using loggerContext = mcpLogger(server);

      let ws: WebSocket;
      try {
        ws = getClientWebSocket(editorId);
      } catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Error connecting to client: ${error}` }]
        };
      }

      ws.send(JSON.stringify({
        command: 'selectActorsByIds',
        actorIds
      }));

      return {
        content: [{ type: 'text', text: 'Success' }]
      };
    }
  );


  server.registerTool(
    'getCurrentScene',
    {
      description: 'Get the current scene opened in the editor.',
      inputSchema: {
        editorId: EditorIdSchema
      }
    },
    async ({editorId}) => {
      using loggerContext = mcpLogger(server);

      try {
        const currentScene = await getCurrentScene(editorId);
        return {
          content: [{ type: 'text', text: `Current scene: ${currentScene}` }]
        };
      }
      catch (error) {
        return {
          isError: true,
          content: [{ type: 'text', text: `Failed to get the current scene: ${error}` }]
        };
      }
    }
  );
}


