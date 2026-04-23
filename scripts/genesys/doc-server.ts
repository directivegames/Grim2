import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { addDocTools } from './mcp/doc-tools.js';

// Create an MCP server
const server = new McpServer({
  name: 'Genesys-Doc-Server',
  version: '0.0.1'
});

addDocTools(server);

// Start receiving messages on stdin and sending messages on stdout
const transport = new StdioServerTransport();
await server.connect(transport);
