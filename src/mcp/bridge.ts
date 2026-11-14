import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConnection } from './settings';

/** Forward protocol envelopes unchanged; the running app remains authoritative. */
export async function runBridge(directory: string): Promise<void> {
  const settings = await readConnection(directory);
  const endpoint = new URL(`http://127.0.0.1:${settings.port}/mcp`);
  // Fail before stdio initialization if the app is closed, with a bounded wait.
  await fetch(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }), signal: AbortSignal.timeout(3000) }).then(response => {
    if (!response.ok && response.status !== 202) throw new Error(`Pixel Editor refused the connection (${response.status}).`);
  }).catch(error => { throw new Error('Cannot connect to Pixel Editor. Open the app and enable MCP.', { cause: error }); });
  const http = new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${settings.token}` } } });
  const stdio = new StdioServerTransport();
  let closing = false;
  const close = async () => { if (closing) return; closing = true; await Promise.allSettled([http.close(), stdio.close()]); };
  http.onmessage = message => {
    if ('result' in message && typeof message.result === 'object' && message.result && 'protocolVersion' in message.result && typeof message.result.protocolVersion === 'string') http.setProtocolVersion(message.result.protocolVersion);
    void stdio.send(message).catch(close);
  };
  stdio.onmessage = message => {
    void http.send(message).catch(async error => {
      if ('id' in message) await stdio.send({ jsonrpc: '2.0', id: message.id, error: { code: -32603, message: `Pixel Editor connection failed: ${error instanceof Error ? error.message : String(error)}` } });
      else process.stderr.write('Pixel Editor connection lost.\n');
    });
  };
  http.onerror = error => process.stderr.write(`Pixel Editor bridge: ${error.message}\n`);
  stdio.onclose = () => { void close(); };
  process.stdin.once('end', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
  process.once('SIGINT', () => { void close(); });
  await http.start();
  await stdio.start();
}
