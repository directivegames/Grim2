
import path from 'path';

import * as ENGINE from '@gnsx/genesys.js';
import getPort from 'get-port';
import { nanoid } from 'nanoid';
import { WebSocket, WebSocketServer } from 'ws';
import { z } from 'zod';

import { StorageProvider } from '../storageProvider.js';

const clients = new Map<string, WebSocket>();

// prefer 8765 to 8770
const port = await getPort({port: [8765, 8766, 8767, 8768, 8769, 8770]});
const wss = new WebSocketServer({ port });
const portFile = path.join(ENGINE.PROJECT_PATH_PREFIX, `${process.argv[2] ?? ''}.mcp-port`);

wss.on('error', error => {
  console.error('WebSocket server error:', error);
});

wss.on('listening', () => {
  new StorageProvider().uploadFile(ENGINE.AssetPath.fromString(portFile), port.toString());
});

interface ClientResponse {
  requestId: string;
  data: any;
}
const pendingRequests = new Map<string, (data: any) => void>();

wss.on('connection', (ws) => {
  let clientId: string | null = null;

  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message.toString());

      // Client registers itself
      if (data.type === 'register' && typeof data.clientId === 'string') {
        clientId = data.clientId;
        clients.set(clientId!, ws);
        // console.log(`Client registered: ${clientId}`);
      }
      else {
        const resolver = pendingRequests.get(data.requestId);
        if (resolver) {
          resolver(data);
          pendingRequests.delete(data.requestId);
        }
      }
    } catch (err) {
      // console.error('Invalid message:', message.toString());
    }
  });

  ws.on('close', () => {
    if (clientId) {
      clients.delete(clientId);
      // console.log(`Client disconnected: ${clientId}`);
    }
  });
});

// when cursor exits
process.stdin.on('end', shutdown);
process.stdin.on('close', shutdown);

// normally when process exits
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown); // Ctrl+C
process.on('SIGQUIT', shutdown);

function shutdown() {
  wss.close(() => {
    new StorageProvider().deleteFile(ENGINE.AssetPath.fromString(portFile));
    process.exit(0);
  });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.terminate(); // force close
    }
  });
  clients.clear();
}

export const EditorIdSchema = z.string().optional().describe(`
ID of the editor that should respond.
If not provided, will proceed if there is only one editor connected, will return error if there are multiple editors connected.
Can always try without providing this, and only ask the user to provide it if there are multiple editors connected.
`);

export function getClientWebSocket(editorId?: string | null) {
  if (clients.size === 0) {
    throw new Error('No editors connected. Please make sure the Genesys editor is running and connected to the MCP.');
  }

  const editorIds = Array.from(clients.keys());
  if (!editorId) {
    if (clients.size > 1) {
      throw new Error(`Multiple editors connected, please specify editorId. Available editor IDs: ${editorIds}`);
    }

    // only one editor connected, use its ID
    editorId = editorIds[0];
  }

  const ws = clients.get(editorId);
  if (ws && ws.readyState === WebSocket.OPEN) {
    return ws;
  } else {
    throw new Error(`Editor with ID ${editorId} is not connected or not ready. Please specify a valid editor ID, available editor IDs: ${editorIds}`);
  }
}


export async function getCurrentScene(editorId?: string | null): Promise<string> {
  let ws: WebSocket;
  try {
    ws = getClientWebSocket(editorId);
  }
  catch (error) {
    return Promise.reject(error);
  }

  const requestId = nanoid();
  const message = {
    command: 'getCurrentScene',
    requestId,
  };

  ws.send(JSON.stringify(message));

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      pendingRequests.delete(requestId);
      reject(new Error('Timeout waiting for client to response with current scene'));
    }, 500);  // 500 ms timeout

    pendingRequests.set(requestId, (data: any) => {
      clearTimeout(timeout);
      if ('currentScene' in data) {
        resolve(data.currentScene);
      } else {
        reject(new Error('Invalid response from editor'));
      }
    });
  });
}
