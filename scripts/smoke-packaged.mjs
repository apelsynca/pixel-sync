import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { cp, mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:net';
import { once } from 'node:events';

const sourceExecutable = resolve(process.argv[2] ?? `out/PixelSync-${process.platform}-${process.arch}/${process.platform === 'win32' ? 'PixelSync.exe' : 'PixelSync'}`);
const directory = await mkdtemp(join(tmpdir(), 'PixelSync smoke '));
// Exercise GUI and stdio launch from a complete runtime folder with spaces by default.
let executable = sourceExecutable;
if (!process.argv[2]) {
  const runtimeDirectory = join(directory, 'Application with spaces');
  await cp(dirname(sourceExecutable), runtimeDirectory, { recursive: true });
  executable = join(runtimeDirectory, basename(sourceExecutable));
}
// Reserve an available test port before starting Electron.
const reservation = createServer();
reservation.listen(0, '127.0.0.1');
await once(reservation, 'listening');
const port = reservation.address().port;
await new Promise(resolve => reservation.close(resolve));
const token = randomBytes(32).toString('hex');
await writeFile(join(directory, 'mcp-connection.json'), JSON.stringify({ port, token, enabled: true }));
const workspace = join(directory, 'MCP workspace'); await mkdir(workspace);
await writeFile(join(directory, 'workspace.json'), JSON.stringify({ root: await realpath(workspace) }));
const env = { ...process.env, PIXEL_SYNC_DATA_DIR: directory };
delete env.ELECTRON_RUN_AS_NODE;
const headless = process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
const application = spawn(executable, headless ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : [], { env, stdio: ['ignore', 'pipe', 'pipe'] });
let diagnostics = '';
application.stderr.on('data', chunk => { diagnostics += chunk; });
const direct = new Client({ name: 'packaged-http-smoke', version: '1.0.0' });
const bridge = new Client({ name: 'packaged-stdio-smoke', version: '1.0.0' });
try {
  const endpoint = new URL(`http://127.0.0.1:${port}/mcp`);
  const deadline = Date.now() + 30_000;
  while (true) {
    try {
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(500) });
      if (response.status === 401) break;
    } catch { /* Electron may still be starting. */ }
    if (application.exitCode !== null || Date.now() > deadline) throw new Error(`Packaged app did not start: ${diagnostics}`);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  await direct.connect(new StreamableHTTPClientTransport(endpoint, { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  const transport = new StdioClientTransport({ command: executable, args: [...(headless ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : []), '--mcp-stdio'], env, stderr: 'pipe' });
  let bridgeDiagnostics = '';
  transport.stderr?.on('data', chunk => { bridgeDiagnostics += chunk; });
  try { await bridge.connect(transport); }
  catch (cause) { throw new Error(`Packaged stdio bridge failed: ${bridgeDiagnostics}`, { cause }); }
  const status = await direct.callTool({ name: 'get_status', arguments: {} });
  assert.deepEqual(await bridge.callTool({ name: 'get_status', arguments: {} }), status);
  assert.equal(status.structuredContent.mcp.enabled, true);
  assert.equal(status.structuredContent.document.width, 32);
  assert.equal(status.structuredContent.document.frames.length, 1);
  assert.ok((await bridge.listTools()).tools.some(tool => tool.name === 'edit_document'));
  const document = (await bridge.callTool({ name: 'get_document', arguments: {} })).structuredContent;
  const edit = await bridge.callTool({ name: 'edit_document', arguments: { documentId: document.documentId, expectedRevision: document.revision, operations: [
    { type: 'set_pixels', frameId: document.frames[0].id, layerId: document.layers[0].id, pixels: [{ x: 1, y: 1, color: '#FF0000FF' }] },
  ] } });
  assert.equal(edit.isError, undefined);
  const read = await direct.callTool({ name: 'get_pixels', arguments: { documentId: document.documentId, frameId: document.frames[0].id, x: 1, y: 1, width: 1, height: 1 } });
  assert.deepEqual([...Buffer.from(read.structuredContent.data, 'base64')], [255, 0, 0, 255]);
  const previewArgs = { documentId: document.documentId, frameId: document.frames[0].id };
  assert.deepEqual(await bridge.callTool({ name: 'get_preview', arguments: previewArgs }), await direct.callTool({ name: 'get_preview', arguments: previewArgs }));
  const undo = await direct.callTool({ name: 'undo', arguments: { documentId: document.documentId, expectedRevision: 1 } });
  assert.equal(undo.structuredContent.document.revision, 2);
  const redo = await bridge.callTool({ name: 'redo', arguments: { documentId: document.documentId, expectedRevision: 2 } });
  assert.equal(redo.structuredContent.document.revision, 3);
  const saved = await bridge.callTool({ name: 'save_project', arguments: { documentId: document.documentId, expectedRevision: 3, path: 'smoke.pixel.json' } });
  assert.equal(saved.structuredContent.document.dirty, false);
  assert.equal(JSON.parse(await readFile(join(workspace, 'smoke.pixel.json'), 'utf8')).version, 1);
  const exported = await direct.callTool({ name: 'export_sprite_sheet', arguments: { documentId: document.documentId, expectedRevision: 3, path: 'smoke-sheet' } });
  assert.equal(exported.structuredContent.frameCount, 1);
  assert.equal(JSON.parse(await readFile(join(workspace, 'smoke-sheet', 'sheet.json'), 'utf8')).revision, 3);
  const reopened = await bridge.callTool({ name: 'open_project', arguments: { path: 'smoke.pixel.json', current: { documentId: document.documentId, expectedRevision: 3 } } });
  assert.equal(reopened.structuredContent.document.dirty, false); assert.notEqual(reopened.structuredContent.document.documentId, document.documentId);
  const bridgePid = transport.pid;
  assert.ok(bridgePid, 'The executable stdio transport has a child process');
  await bridge.close();
  const cleanupDeadline = Date.now() + 5000;
  while (true) {
    try { process.kill(bridgePid, 0); }
    catch (error) { if (error.code === 'ESRCH') break; throw error; }
    assert.ok(Date.now() < cleanupDeadline, 'The executable stdio bridge exits after transport close');
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  console.log(`Packaged HTTP and executable stdio share edits, PNG previews, history, project save/open, and sprite-sheet export in one live app; bridge cleanup passed${executable.includes(' ') ? ' from an executable path containing spaces' : ''}.`);
} finally {
  await Promise.allSettled([bridge.close(), direct.close()]);
  if (application.exitCode === null) {
    const exited = once(application, 'exit');
    application.kill();
    await exited;
  }
  await rm(directory, { recursive: true, force: true });
}
