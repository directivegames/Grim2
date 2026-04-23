import fs from 'fs';
import path from 'path';

import { getProjectRoot } from '../common.js';

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';


const enginePathName = 'node_modules/@gnsx/genesys.js';
const docPathName = 'node_modules/@gnsx/genesys.js/docs';
const enginePath = path.join(getProjectRoot(), enginePathName);
const docsPath = path.join(getProjectRoot(), docPathName);


function listDocs(): string[] {
  const docs: string[] = [];
  for (const filePath of fs.readdirSync(docsPath, { recursive: true })) {
    if (typeof filePath !== 'string') {
      continue;
    }
    if (fs.statSync(path.join(docsPath, filePath)).isDirectory()) {
      continue;
    }
    docs.push(filePath.replace(/\\/g, '/'));
  }
  return docs.filter(doc => !doc.includes('deprecated'));
}

function inlineFileReferences(content: string): string {
  // Regular expression to match <file path={relative/path/to/file}>
  const fileRefRegex = /<file path=\{([^}]+)\}>/g;

  return content.replace(fileRefRegex, (match, filePath) => {
    try {
      const fullPath = path.join(enginePath, filePath);

      // Check if file exists
      if (!fs.existsSync(fullPath)) {
        return `<!-- File not found: ${filePath} -->`;
      }

      // Read the file content
      const fileContent = fs.readFileSync(fullPath, 'utf8');
      let inlinedContent = '<file_contents>\n';
      inlinedContent += `\`\`\`path={${filePath}}\n`;
      inlinedContent += fileContent;
      inlinedContent += '\n\`\`\`\n';
      inlinedContent += '</file_contents>\n';
      // Return the inlined content with proper markdown formatting
      return inlinedContent;
    } catch (error) {
      return `<!-- Error reading file ${filePath}: ${error instanceof Error ? error.message : 'Unknown error'} -->`;
    }
  });
}

function extractInstruction(content: string): string | undefined {
  // Look for "## Instruction" section and extract the next line
  const instructionRegex = /^## Instruction\s*\n(.+)$/m;
  const match = content.match(instructionRegex);
  return match ? match[1].trim() : undefined;
}

export function addDocTools(server: McpServer) {
  server.registerTool(
    'listDocs',
    {
      description: 'Lists genesys.js engine development documentations.',
    },
    async () => {
      const docPaths = listDocs();
      const docs = [];
      for (const docPath of docPaths) {
        const docContent = fs.readFileSync(path.join(docsPath, docPath), 'utf8');
        const instruction = extractInstruction(docContent);
        docs.push({
          path: path.join(docPathName, docPath),
          instruction,
        });
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(docs, null, 2) }]
      };
    }
  );
}
