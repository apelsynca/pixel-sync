import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { CommandService } from '../src/application/commands';
import type { DocumentInfo } from '../src/core/document';
import { startMcp } from '../src/mcp/server';
import { saveSettings } from '../src/mcp/settings';
import type { EditorStatus, McpOperation } from '../src/shared/api';

const token = 'e'.repeat(64), red = '#FF0000FF', blue = '#0000FFFF';
const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const guard = (document: DocumentInfo) => ({ documentId: document.documentId, expectedRevision: document.revision });
async function fixture(width = 4, height = 4) {
  const commands = new CommandService(), initial = await commands.newDocument({ width, height });
  let document = initial;
  const events: number[] = [], operations: McpOperation[] = [];
  commands.subscribe(event => { document = event.document; events.push(document.revision); });
  const running = await startMcp({ port: 0, token, commands,
    getStatus: (): EditorStatus => ({ instanceId: 'editing-test', milestone: 'mcp-editor', document, mcp: { enabled: true, endpoint: `http://127.0.0.1:${running.port}/mcp`, error: null } }),
    onOperation: event => operations.push(event),
  });
  let closed = false;
  const close = async () => { if (!closed) { closed = true; await running.close(); } };
  cleanup.push(close);
  const client = new Client({ name: 'editing-test', version: '1.0' }); cleanup.push(() => client.close());
  await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp/codex`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const call = async (name: string, args: Record<string, unknown> = {}) => await client.callTool({ name, arguments: args }) as CallToolResult;
  const get = async () => (await call('get_document')).structuredContent as unknown as DocumentInfo;
  const edit = async (operations: unknown[]) => call('edit_document', { ...guard(await get()), operations });
  const target = { frameId: initial.frames[0].id, layerId: initial.layers[0].id };
  return { commands, initial, running, client, call, get, edit, target, events, operations, close };
}
function image(result: CallToolResult) {
  expect(result.isError).not.toBe(true);
  const content = result.content.find(item => item.type === 'image');
  if (!content || content.type !== 'image') throw new Error('Expected PNG image content');
  expect(content.mimeType).toBe('image/png');
  return PNG.sync.read(Buffer.from(content.data, 'base64'));
}
const error = (result: CallToolResult, code: string) => { expect(result.isError).toBe(true); expect(result.structuredContent).toMatchObject({ error: { code } }); };

describe('MCP document editing over real transports', () => {
  it('advertises strict schemas, safe annotations and instructions for every implemented tool', async () => {
    const { client, get } = await fixture();
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['get_status', 'get_document', 'get_pixels', 'get_preview', 'get_animation_preview', 'new_document', 'edit_document', 'undo', 'redo']);
    for (const tool of tools) { expect(tool.inputSchema.type).toBe('object'); expect(tool.inputSchema.additionalProperties).toBe(false); expect(tool.annotations?.openWorldHint).toBe(false); }
    expect(tools.find(tool => tool.name === 'edit_document')?.annotations?.readOnlyHint).toBe(false);
    expect(client.getInstructions()).toContain('stale_revision');
    expect(await get()).toMatchObject({ width: 4, height: 4, capabilities: { files: false, drawing: true }, previewLimits: { dimension: 1024, frames: 16 } });
  });
  it('draws an animation with generated and supplied IDs, timing and clips; reads exact pixels and composites', async () => {
    const { edit, call, get, target, events, operations } = await fixture();
    const result = await edit([
      { type: 'add_layer', id: 'outline', name: 'Outline' },
      { type: 'draw_rectangle', frameId: target.frameId, layerId: 'outline', x1: 0, y1: 0, x2: 3, y2: 3, color: red, filled: false },
      { type: 'fill', frameId: target.frameId, layerId: 'outline', x: 1, y: 1, color: '#0000FF80' },
      { type: 'duplicate_frame', frameId: target.frameId, id: 'second' },
      { type: 'set_frame_duration', frameId: 'second', duration: 230 },
      { type: 'set_pixels', frameId: 'second', layerId: 'outline', pixels: [{ x: 1, y: 1, color: '#00000000' }] },
      { type: 'set_clip', name: 'walk', frameIds: ['second', target.frameId], loop: true },
    ]);
    expect(result.isError).not.toBe(true); expect(result.structuredContent).toMatchObject({ createdIds: ['outline', 'second'], document: { revision: 1, history: { undo: 1 } } });
    expect(events).toEqual([1]);
    const document = await get();
    expect(document.clips[0]).toEqual({ name: 'walk', frameIds: ['second', target.frameId], loop: true });
    const read = await call('get_pixels', { documentId: document.documentId, frameId: target.frameId, layerId: 'outline', x: 0, y: 0, width: 2, height: 2 });
    expect(read.structuredContent).toMatchObject({ encoding: 'rgba8-base64', revision: 1 });
    expect([...Buffer.from(read.structuredContent!.data as string, 'base64')]).toEqual([255, 0, 0, 255, 255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 128]);
    const composite = await call('get_pixels', { documentId: document.documentId, frameId: 'second', x: 1, y: 1, width: 1, height: 1 });
    expect(Buffer.from(composite.structuredContent!.data as string, 'base64')).toEqual(Buffer.alloc(4));
    const added = await edit([{ type: 'add_layer', name: 'Generated' }, { type: 'add_frame' }]);
    expect(added.structuredContent!.createdIds).toHaveLength(2);
    expect(operations.some(operation => operation.tool === 'edit_document' && operation.client === 'codex' && operation.revision === 1)).toBe(true);
    expect(JSON.stringify(operations)).not.toContain(token); expect(JSON.stringify(operations)).not.toContain('FF0000FF');
  });
  it('returns lossless cropped/scaled transparent PNGs and row-major contact sheets with timing metadata', async () => {
    const { edit, call, get, target } = await fixture(2, 2);
    await edit([{ type: 'set_pixels', ...target, pixels: [{ x: 1, y: 0, color: '#FF000080' }] }, { type: 'duplicate_frame', frameId: target.frameId, id: 'b' }, { type: 'set_frame_duration', frameId: 'b', duration: 320 }, { type: 'set_pixels', frameId: 'b', layerId: target.layerId, pixels: [{ x: 1, y: 0, color: blue }] }, { type: 'add_frame', id: 'c' }]);
    const document = await get();
    const single = await call('get_preview', { documentId: document.documentId, expectedRevision: document.revision, frameId: target.frameId, crop: { x: 1, y: 0, width: 1, height: 2 }, scale: 2 });
    const png = image(single); expect([png.width, png.height]).toEqual([2, 4]);
    expect([...png.data.subarray(0, 16)]).toEqual(Array(4).fill([255, 0, 0, 128]).flat()); expect(png.data.subarray(16)).toEqual(Buffer.alloc(16));
    const sheet = await call('get_animation_preview', { documentId: document.documentId, frameIds: ['b', target.frameId, 'c'], columns: 2, scale: 2 });
    const contact = image(sheet); expect([contact.width, contact.height]).toEqual([8, 8]);
    expect(sheet.structuredContent).toMatchObject({ revision: 1, columns: 2, rows: 2, frames: [{ frameId: 'b', duration: 320, x: 0, y: 0 }, { frameId: target.frameId, duration: 100, x: 4, y: 0 }, { frameId: 'c', duration: 100, x: 0, y: 4 }] });
    expect([...contact.data.subarray(2 * 4, 3 * 4)]).toEqual([0, 0, 255, 255]);
    expect([...contact.data.subarray(6 * 4, 7 * 4)]).toEqual([255, 0, 0, 128]);
    for (let y = 4; y < 8; y++) expect(contact.data.subarray((y * 8 + 4) * 4, (y * 8 + 8) * 4)).toEqual(Buffer.alloc(16));
  });
  it('rejects late invalid batches and stale writes without changing pixels, dirty state, events or history', async () => {
    const { commands, edit, get, call, target, initial, events } = await fixture();
    await commands.markSaved(guard(initial)); events.length = 0;
    const before = await get();
    error(await edit([{ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'add_layer', id: 'temporary', name: 'Temporary' }, { type: 'set_clip', name: 'broken', frameIds: ['missing'], loop: true }]), 'missing_frame');
    expect(await get()).toEqual(before); expect(events).toEqual([]);
    const raw = await call('get_pixels', { documentId: before.documentId, ...target, x: 0, y: 0, width: 1, height: 1 });
    expect(Buffer.from(raw.structuredContent!.data as string, 'base64')).toEqual(Buffer.alloc(4));
    const mutation = { ...guard(before), operations: [{ type: 'set_palette', colors: [red] }] };
    const writes = await Promise.all([call('edit_document', mutation), call('edit_document', mutation)]);
    expect(writes.filter(result => !result.isError)).toHaveLength(1); error(writes.find(result => result.isError)!, 'stale_revision');
    error(await call('get_preview', { ...guard(before), frameId: target.frameId }), 'stale_revision');
  });
  it('shares manual history through HTTP and the compiled stdio bridge, preserving error envelopes and images', async () => {
    const { commands, initial, running, call, get, target } = await fixture();
    const directory = await mkdtemp(join(tmpdir(), 'pixel-editing-bridge-')); cleanup.push(() => rm(directory, { recursive: true, force: true }));
    await saveSettings(directory, { port: running.port, token, enabled: true });
    const bridge = new Client({ name: 'editing-bridge-test', version: '1' }); cleanup.push(() => bridge.close());
    await bridge.connect(new StdioClientTransport({ command: process.execPath, args: ['dist/bridge.cjs', directory], stderr: 'pipe' }));
    expect((await bridge.listTools()).tools).toEqual((await callList()).tools);
    async function callList() { const other = new Client({ name: 'tool-list', version: '1' }); cleanup.push(() => other.close()); await other.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${running.port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } })); return other.listTools(); }
    await commands.edit({ ...guard(initial), operations: [{ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }] });
    const undo = await bridge.callTool({ name: 'undo', arguments: guard(await get()) }); expect(undo.isError).not.toBe(true);
    expect((await get()).history).toMatchObject({ undo: 0, redo: 1 });
    await bridge.callTool({ name: 'redo', arguments: guard(await get()) });
    const previewArgs = { documentId: initial.documentId, frameId: target.frameId };
    expect(await bridge.callTool({ name: 'get_preview', arguments: previewArgs })).toEqual(await call('get_preview', previewArgs));
    const bad = { name: 'edit_document', arguments: { ...guard(initial), operations: [{ type: 'clear_layer', ...target }] } };
    expect(await bridge.callTool(bad)).toEqual(await call(bad.name, bad.arguments));
    error(await call('undo', guard(initial)), 'stale_revision');
  });
  it('requires explicit guarded discard before new-document replacement and resets identity/history', async () => {
    const { initial, call, get } = await fixture();
    error(await call('new_document', { width: 8, height: 8 }), 'stale_revision');
    error(await call('new_document', { width: 8, height: 8, current: guard(initial) }), 'unsaved_document');
    const replacement = await call('new_document', { width: 8, height: 8, current: guard(initial), discardUnsaved: true });
    expect(replacement.structuredContent).toMatchObject({ width: 8, height: 8, revision: 0, history: { undo: 0, redo: 0 } });
    expect((await get()).documentId).not.toBe(initial.documentId);
    error(await call('redo', guard(initial)), 'stale_revision');
    error(await call('undo', guard(await get())), 'empty_history');
  });
  it('enforces request/read/preview bounds with structured, bounded errors and recovers for subsequent calls', async () => {
    const { initial, target, call, get, edit } = await fixture(512, 512);
    error(await call('get_pixels', { documentId: initial.documentId, frameId: target.frameId, x: 0, y: 0, width: 512, height: 512 }), 'size_limit');
    error(await call('get_preview', { documentId: initial.documentId, frameId: target.frameId, scale: 3 }), 'size_limit');
    error(await call('get_preview', { documentId: initial.documentId, frameId: target.frameId, crop: { x: 512, y: 0, width: 1, height: 1 } }), 'invalid_arguments');
    error(await call('get_animation_preview', { documentId: initial.documentId, frameIds: Array(17).fill(target.frameId) }), 'invalid_arguments');
    error(await call('get_animation_preview', { documentId: initial.documentId, frameIds: [target.frameId, target.frameId] }), 'invalid_arguments');
    error(await call('edit_document', { ...guard(initial), operations: [{ type: 'clear_layer', ...target, unexpected: true }] }), 'invalid_arguments');
    error(await call('get_document', { surprise: true }), 'invalid_arguments');
    error(await call('constructor'), 'invalid_arguments');
    const invalid = await edit([{ type: 'set_pixels', ...target, pixels: Array.from({ length: 100 }, () => ({ x: 0, y: 0, color: 'bad' })) }]);
    error(invalid, 'invalid_arguments'); expect(JSON.stringify(invalid).length).toBeLessThan(4096);
    error(await edit([{ type: 'set_pixels', ...target, pixels: Array.from({ length: 32769 }, () => ({ x: 0, y: 0, color: red })) }, { type: 'set_pixels', ...target, pixels: Array.from({ length: 32769 }, () => ({ x: 1, y: 1, color: red })) }]), 'size_limit');
    expect((await get()).revision).toBe(0);
    const large = image(await call('get_preview', { documentId: initial.documentId, frameId: target.frameId, scale: 2 }));
    expect([large.width, large.height]).toEqual([1024, 1024]); expect(large.data.every(value => value === 0)).toBe(true);
  });
  it('waits for a manual gesture before rejecting a competing stale mutation', async () => {
    const { commands, initial, client, target, get } = await fixture();
    const gesture = await commands.beginGesture(guard(initial));
    let finished = false;
    const pending = client.callTool({ name: 'edit_document', arguments: { ...guard(initial), operations: [{ type: 'set_palette', colors: [blue] }] } }).finally(() => { finished = true; });
    await new Promise(resolve => setTimeout(resolve, 20)); expect(finished).toBe(false);
    await gesture.commit([{ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }]);
    error(await pending as CallToolResult, 'stale_revision');
    expect(await get()).toMatchObject({ revision: 1, palette: [], history: { undo: 1 } });
  });
  it('cancels queued mutations when the HTTP connection and server close, without poisoning the command queue', async () => {
    const { commands, initial, target, running, close, operations } = await fixture();
    const gesture = await commands.beginGesture(guard(initial));
    const abort = new AbortController();
    const pending = fetch(`http://127.0.0.1:${running.port}/mcp`, { method: 'POST', signal: abort.signal, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'edit_document', arguments: { ...guard(initial), operations: [{ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }] } } }) }).catch(() => undefined);
    await new Promise(resolve => setTimeout(resolve, 20)); abort.abort(); await pending;
    await close(); gesture.cancel();
    expect(await commands.getDocument()).toEqual(initial);
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(operations.find(operation => operation.tool === 'edit_document')).toMatchObject({ outcome: 'error', summary: 'cancelled' });
    const controller = new AbortController(); controller.abort();
    await expect(commands.edit({ ...guard(initial), operations: [{ type: 'set_palette', colors: [red] }] }, controller.signal)).rejects.toMatchObject({ code: 'cancelled' });
    expect(await commands.getDocument()).toEqual(initial);
  });
});
