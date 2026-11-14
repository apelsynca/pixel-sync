import { createServer, type Server } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Server as McpServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { EditorStatus } from '../shared/api';
import type { ClientId } from '../shared/api';
import { createToolServer, type ToolOptions } from './tools';

export interface RunningMcp { port: number; close(): Promise<void> }
export async function startMcp(options: { port: number; token: string; getStatus: () => EditorStatus; onStatusCall?: (client: ClientId) => void } & Pick<ToolOptions, 'commands' | 'files' | 'onOperation'>): Promise<RunningMcp> {
  const active = new Set<McpServer>();
  const server: Server = createServer(async (request, response) => {
    const deny = (status: number, message: string) => { response.writeHead(status, { 'Content-Type': 'text/plain' }); response.end(message); };
    const host = request.headers.host;
    const address = server.address();
    const port = typeof address === 'object' && address ? address.port : options.port;
    if (host !== `127.0.0.1:${port}` && host !== `localhost:${port}`) return deny(403, 'Invalid Host');
    if (request.headers.origin !== undefined) return deny(403, 'Browser origins are not allowed');
    const received = Buffer.from(request.headers.authorization ?? '');
    const expected = Buffer.from(`Bearer ${options.token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) return deny(401, 'Bearer token required');
    const client = request.url === '/mcp/codex' ? 'codex' : request.url === '/mcp/claude-code' ? 'claude-code' : undefined;
    if (request.url !== '/mcp' && !client) return deny(404, 'Not found');
    if (request.method !== 'POST') return deny(405, 'Use MCP POST requests');
    const chunks: Buffer[] = [];
    let length = 0;
    try {
      for await (const chunk of request) {
        length += chunk.length;
        if (length > 4 * 1024 * 1024) { deny(413, 'Request exceeds 4 MiB'); return; }
        chunks.push(chunk);
      }
      let body: unknown;
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { return deny(400, 'Invalid JSON'); }
      const mcp = createToolServer({ ...options, client });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
      active.add(mcp);
      response.on('close', () => { active.delete(mcp); void mcp.close(); });
      await mcp.connect(transport);
      await transport.handleRequest(request, response, body);
    } catch {
      if (!response.headersSent) deny(500, 'MCP request failed');
      else response.end();
    }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(options.port, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'EADDRINUSE') throw new Error(`MCP port ${options.port} is already in use. Close the other app or change port in mcp-connection.json while Pixel Editor is closed.`);
    throw error;
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('No MCP listening address');
  let closing: Promise<void> | undefined;
  return { port: address.port, close() { return closing ??= (async () => {
    await Promise.all([...active].map(mcp => mcp.close()));
    await new Promise<void>((resolve, reject) => { server.close(error => error ? reject(error) : resolve()); server.closeAllConnections(); });
  })(); } };
}
