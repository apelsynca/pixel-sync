import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile, stat } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { GifReader } from 'omggif';
import { PNG } from 'pngjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const require = createRequire(import.meta.url), directory = await mkdtemp(join(tmpdir(), 'Pixel files UI '));
const data = join(directory, 'data'), workspace = join(directory, 'workspace'), native = join(directory, 'native selections');
await Promise.all([data, workspace, native].map(path => mkdir(path)));
const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
const token = randomBytes(32).toString('hex');
await writeFile(join(data, 'mcp-connection.json'), JSON.stringify({ port, token, enabled: true }));
const env = { ...process.env, PIXEL_SYNC_DATA_DIR: data, CODEX_HOME: join(directory, 'codex'), CLAUDE_CONFIG_DIR: join(directory, 'claude') }; delete env.ELECTRON_RUN_AS_NODE;
let application, page, client;
const errors = [];
async function launch() {
  application = await electron.launch({ executablePath: process.argv[2] ? resolve(process.argv[2]) : require('electron'), args: [...(process.argv[2] ? [] : ['.']), ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : [])], env, timeout: 20000 });
  page = await application.firstWindow(); page.setDefaultTimeout(8000); page.on('pageerror', error => errors.push(error.message));
  await page.getByRole('button', { name: 'Connect AI client' }).waitFor();
}
const document = () => page.evaluate(() => window.editor.getDocument());
const guard = document => ({ documentId: document.documentId, expectedRevision: document.revision });
async function editPixel(x, y, color) { await page.evaluate(async ({ x, y, color }) => { const d = await window.editor.getDocument(); await window.editor.edit({ documentId: d.documentId, expectedRevision: d.revision, operations: [{ type: 'set_pixels', frameId: d.frames[0].id, layerId: d.layers[0].id, pixels: [{ x, y, color }] }] }); }, { x, y, color }); }
async function nativeMenu(id) {
  const deadline = Date.now() + 8000;
  while (!await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? false, id)) {
    if (Date.now() > deadline) throw new Error(`Menu item ${id} did not become enabled`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  await application.evaluate(({ Menu }, id) => { const item = Menu.getApplicationMenu().getMenuItemById(id); item.click(); }, id);
}
async function fileMenu(name) { await nativeMenu(({ 'Open project…': 'open', 'Export frame PNG…': 'export-png', 'Export sprite sheet…': 'export-sheet', 'Import PNG…': 'import' })[name]); }
async function saveDialog(path) { await application.evaluate(({ dialog }, path) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: path }); }, path); }
async function openDialog(path) { await application.evaluate(({ dialog }, path) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] }); }, path); }
async function answer(response) { await application.evaluate(({ dialog }, response) => { dialog.showMessageBox = async () => ({ response, checkboxChecked: false }); }, response); }
async function waitUntil(action) { const deadline = Date.now() + 8000; while (true) { try { if (await action()) return; } catch { /* Wait for asynchronous I/O. */ } if (Date.now() > deadline) throw new Error('Timed out waiting for file state'); await new Promise(resolve => setTimeout(resolve, 40)); } }
async function projectPixel(path, x, y) { const p = JSON.parse(await readFile(path, 'utf8')); return [...Buffer.from(p.frames[0].cels[p.layers[0].id], 'base64').subarray((y * p.width + x) * 4, (y * p.width + x + 1) * 4)]; }
try {
  await launch();
  await editPixel(1, 1, '#FF000080');
  let d = await document();
  await page.evaluate(async guard => { const d = await window.editor.getDocument(); await window.editor.edit({ ...guard, operations: [{ type: 'duplicate_frame', frameId: d.frames[0].id, id: 'second' }, { type: 'set_frame_duration', frameId: 'second', duration: 240 }, { type: 'set_clip', name: 'walk', frameIds: ['second', d.frames[0].id], loop: false }] }); }, guard(d));
  const projectPath = join(native, 'hero.pixel.json');
  await writeFile(projectPath, 'previous project'); await answer(1); await saveDialog(join(native, 'hero'));
  await nativeMenu('save');
  await waitUntil(async () => await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('save').enabled));
  assert.equal(await readFile(projectPath, 'utf8'), 'previous project'); assert.equal((await document()).dirty, true);
  await answer(0);
  await saveDialog(join(native, 'hero')); await nativeMenu('save');
  await waitUntil(async () => (await document()).dirty === false); assert.deepEqual(await projectPixel(projectPath, 1, 1), [255, 0, 0, 128]);
  await editPixel(1, 1, '#0000FFFF');
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => { throw new Error('Save should reuse the associated project path'); }; });
  await waitUntil(async () => await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('save').enabled));
  await page.keyboard.press('Control+s'); await waitUntil(async () => (await document()).dirty === false); assert.deepEqual(await projectPixel(projectPath, 1, 1), [0, 0, 255, 255]);
  const saved = JSON.parse(await readFile(projectPath, 'utf8'));
  await nativeMenu('new');
  await page.getByRole('dialog', { name: 'New canvas' }).getByLabel('Width', { exact: true }).fill('8');
  await page.getByRole('dialog', { name: 'New canvas' }).getByLabel('Height', { exact: true }).fill('8');
  await page.getByRole('button', { name: 'Create canvas', exact: true }).click(); await waitUntil(async () => (await document()).width === 8);
  await answer(1); await openDialog(projectPath); await fileMenu('Open project…');
  await waitUntil(async () => (await document()).frames.length === 2); d = await document(); assert.equal(d.dirty, false); assert.equal(d.frames[0].id, saved.frames[0].id); assert.equal(d.frames[1].duration, 240); assert.equal(d.clips[0].name, 'walk');
  await saveDialog(join(native, 'frame.png')); await fileMenu('Export frame PNG…');
  await waitUntil(async () => !!await stat(join(native, 'frame.png')));
  const png = PNG.sync.read(await readFile(join(native, 'frame.png'))); assert.deepEqual([...png.data.subarray((1 * 32 + 1) * 4, (1 * 32 + 1) * 4 + 4)], [0, 0, 255, 255]);
  await saveDialog(join(native, 'all-frames')); await nativeMenu('export-gif');
  await waitUntil(async () => !!await stat(join(native, 'all-frames.gif')));
  const allGif = new GifReader(await readFile(join(native, 'all-frames.gif')));
  assert.equal(allGif.numFrames(), 2); assert.equal(allGif.loopCount(), 0);
  await page.getByLabel('Playback clip').selectOption('walk');
  await saveDialog(join(native, 'clip.gif')); await page.getByRole('button', { name: 'Export GIF…', exact: true }).click();
  await waitUntil(async () => !!await stat(join(native, 'clip.gif')));
  const clipGif = new GifReader(await readFile(join(native, 'clip.gif')));
  assert.equal(clipGif.numFrames(), 2); assert.equal(clipGif.loopCount(), null);
  assert.equal(clipGif.frameInfo(0).delay, 24); assert.equal(clipGif.frameInfo(1).delay, 10);
  assert.equal((await document()).dirty, false);
  await application.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
  await nativeMenu('export-gif');
  await waitUntil(async () => await application.evaluate(({ Menu }) => Menu.getApplicationMenu().getMenuItemById('export-gif').enabled));
  await openDialog(native); await fileMenu('Export sprite sheet…');
  await page.getByRole('dialog', { name: 'Export sprite sheet' }).getByLabel('Folder name', { exact: true }).fill('gui-sheet');
  await page.getByRole('dialog', { name: 'Export sprite sheet' }).getByLabel('Columns', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Choose parent folder…', exact: true }).click();
  await waitUntil(async () => !!await stat(join(native, 'gui-sheet', 'sheet.json')));
  const sheet = JSON.parse(await readFile(join(native, 'gui-sheet', 'sheet.json'), 'utf8')); assert.equal(sheet.frameCount, 2); assert.deepEqual(sheet.clips[0].indices, [1, 0]);
  await openDialog(join(native, 'frame.png')); await fileMenu('Import PNG…'); await waitUntil(async () => (await document()).frames.length === 1);
  assert.equal((await document()).dirty, true);
  await page.getByRole('button', { name: 'Connect AI client' }).click(); await openDialog(workspace);
  await page.getByRole('button', { name: 'Choose workspace…', exact: true }).click(); await page.getByText('MCP workspace selected.', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Close connections' }).click();
  client = new Client({ name: 'file-ui-test', version: '1' }); await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
  let result = await client.callTool({ name: 'save_project', arguments: { ...guard(await document()), path: 'from-mcp.pixel.json' } }); assert.ok(!result.isError);
  assert.deepEqual(await projectPixel(join(workspace, 'from-mcp.pixel.json'), 1, 1), [0, 0, 255, 255]);
  result = await client.callTool({ name: 'save_project', arguments: { ...guard(await document()), path: '../denied.pixel.json' } }); assert.equal(result.structuredContent.error.code, 'path_denied');
  await editPixel(5, 5, '#E9C46AFF');
  await waitUntil(async () => (await projectPixel(join(data, 'recovery.pixel.json'), 5, 5)).join(',') === '233,196,106,255');
  const exited = once(application.process(), 'exit'); application.process().kill('SIGKILL'); await exited; application = undefined; await client.close(); client = undefined;
  await launch(); await page.getByRole('dialog', { name: 'Recover artwork', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Recover artwork', exact: true }).click(); await page.getByRole('dialog', { name: 'Recover artwork', exact: true }).waitFor({ state: 'hidden' });
  d = await document(); assert.equal(d.dirty, true); assert.equal(d.frames.length, 1); assert.equal((await page.evaluate(() => window.editor.getFileState())).projectPath, null);
  const recoveredPath = join(native, 'recovered.pixel.json'); await saveDialog(recoveredPath); await nativeMenu('save');
  await waitUntil(async () => (await document()).dirty === false); assert.deepEqual(await projectPixel(recoveredPath, 5, 5), [233, 196, 106, 255]);
  await editPixel(6, 6, '#2A9D8FFF'); await answer(2); await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
  assert.equal((await document()).dirty, true); assert.equal((await page.evaluate(() => window.editor.getStatus())).mcp.enabled, true);
  await answer(0); await application.close(); application = undefined;
  assert.deepEqual(await projectPixel(recoveredPath, 6, 6), [42, 157, 143, 255]);
  await assert.rejects(stat(join(data, 'recovery.pixel.json')), { code: 'ENOENT' });
  await launch(); assert.equal((await page.evaluate(() => window.editor.getFileState())).recoveryAvailable, false); assert.ok((await page.evaluate(() => window.editor.getFileState())).workspace);
  assert.deepEqual(errors, []); await application.close(); application = undefined;
  console.log('File UI smoke passed: native Save/Open/PNG/GIF/sheet dialogs, Save shortcut, workspace MCP save, crash/restart recovery, close Cancel/Save, and normal-close snapshot cleanup.');
} finally {
  await client?.close();
  if (application) { await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await application.close().catch(() => undefined); }
  await rm(directory, { recursive: true, force: true });
}
