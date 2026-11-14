import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { startMcp, type RunningMcp } from '../src/mcp/server';
import { loadSettings, readConnection, saveSettings } from '../src/mcp/settings';
import type { EditorStatus } from '../src/shared/api';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.reverse()) await close(); cleanup.length = 0; });
const token = 'a'.repeat(64);
async function fixture() {
  const status = (): EditorStatus => ({ instanceId: 'test-editor-instance', milestone: 'foundation', document: null, mcp: { enabled: true, endpoint: `http://127.0.0.1:${running.port}/mcp`, error: null } });
  const running: RunningMcp = await startMcp({ port: 0, token, getStatus: status });
  cleanup.push(() => running.close());
  return running;
}
async function temporaryDirectory() {
  const directory = await mkdtemp(join(tmpdir(), 'pixel-sync-'));
  cleanup.push(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
function client() {
  const instance = new Client({ name: 'integration-test', version: '1.0.0' });
  cleanup.push(() => instance.close());
  return instance;
}
describe('local MCP connection', () => {
  it('serves the same running instance through HTTP and a real stdio bridge process', async () => {
    const running = await fixture();
    const directory = await temporaryDirectory();
    await saveSettings(directory, { port: running.port, token, enabled: true });
    const direct = client();
    await direct.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
    const bridge = client();
    await bridge.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/bridge.cjs', directory], stderr: 'pipe' }));
    expect((await bridge.listTools()).tools.map(tool => tool.name)).toEqual(['get_status']);
    const httpResult = await direct.callTool({ name: 'get_status', arguments: {} });
    expect(await bridge.callTool({ name: 'get_status', arguments: {} })).toEqual(httpResult);
    expect(httpResult.structuredContent).toMatchObject({ instanceId: 'test-editor-instance', document: null });
    const bad = { name: 'missing_tool', arguments: {} };
    expect(await bridge.callTool(bad)).toEqual(await direct.callTool(bad));
  });
  it('rejects invalid credentials, host, origin, JSON and oversized bodies', async () => {
    const running = await fixture();
    const endpoint = `http://127.0.0.1:${running.port}/mcp`;
    const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
    expect((await fetch(endpoint, { method: 'POST' })).status).toBe(401);
    expect((await fetch(endpoint, { method: 'POST', headers: { ...headers, Origin: 'https://evil.example' } })).status).toBe(403);
    const invalidHostStatus = await new Promise<number | undefined>((resolve, reject) => {
      const req = request(endpoint, { method: 'POST', headers: { ...headers, Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
      req.on('error', reject); req.end();
    });
    expect(invalidHostStatus).toBe(403);
    expect((await fetch(endpoint, { method: 'POST', headers, body: '{' })).status).toBe(400);
    expect((await fetch(endpoint, { method: 'POST', headers, body: ' '.repeat(4 * 1024 * 1024 + 1) })).status).toBe(413);
  });
  it('reports a port collision without taking over the original server', async () => {
    const running = await fixture();
    await expect(startMcp({ port: running.port, token, getStatus: () => { throw new Error('unused'); } })).rejects.toThrow('already in use');
  });
  it('generates persistent credentials, defaults disabled, and preserves a chosen port', async () => {
    const directory = await temporaryDirectory();
    const settings = await loadSettings(directory);
    expect(settings.enabled).toBe(false);
    expect(settings.token).toMatch(/^[a-f0-9]{64}$/);
    expect(await loadSettings(directory)).toEqual(settings);
    await expect(readConnection(directory)).rejects.toThrow('disabled');
    await saveSettings(directory, { ...settings, enabled: true, port: 49152 });
    expect((await readConnection(directory)).port).toBe(49152);
  });
  it('exits the bridge with a useful diagnostic when the app is closed or disabled', async () => {
    const directory = await temporaryDirectory();
    await loadSettings(directory);
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const execute = promisify(execFile);
    await expect(execute(process.execPath, ['dist/bridge.cjs', directory])).rejects.toMatchObject({ stderr: expect.stringContaining('disabled') });
    const running = await fixture();
    const port = running.port;
    await running.close();
    cleanup.splice(cleanup.length - 1, 1);
    await saveSettings(directory, { port, token, enabled: true });
    await expect(execute(process.execPath, ['dist/bridge.cjs', directory])).rejects.toMatchObject({ stderr: expect.stringContaining('Open the app') });
  });
});
