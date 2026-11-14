import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { PNG } from 'pngjs';

const require = createRequire(import.meta.url);
for (const scale of [1, 1.5]) {
  const directory = await mkdtemp(join(tmpdir(), 'PixelSync UI '));
  const token = randomBytes(32).toString('hex');
  const reservation = createServer(); reservation.listen(0, '127.0.0.1'); await once(reservation, 'listening');
  const port = reservation.address().port; await new Promise(resolve => reservation.close(resolve));
  const codexHome = join(directory, 'codex'), claudeHome = join(directory, 'claude');
  await mkdir(codexHome); await mkdir(claudeHome);
  await writeFile(join(codexHome, 'config.toml'), '# Keep this comment\nmodel = "test-model"\n');
  await writeFile(join(claudeHome, '.claude.json'), '{"theme":"dark"}');
  await writeFile(join(directory, 'mcp-connection.json'), JSON.stringify({ port, token, enabled: false }));
  const env = { ...process.env, PIXEL_SYNC_DATA_DIR: directory, CODEX_HOME: codexHome, CLAUDE_CONFIG_DIR: claudeHome };
  delete env.ELECTRON_RUN_AS_NODE;
  let application;
  const clients = [];
  try {
    application = await electron.launch({ executablePath: process.argv[2] ? resolve(process.argv[2]) : require('electron'), args: [...(process.argv[2] ? [] : ['.']), `--force-device-scale-factor=${scale}`, ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : [])], env, timeout: 20_000 });
    const page = await application.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    page.setDefaultTimeout(8000);
    await page.getByRole('button', { name: 'Connect AI client' }).waitFor();
async function nativeMenu(id) {
  const deadline = Date.now() + 8000;
  while (!await application.evaluate(({ Menu }, id) => Menu.getApplicationMenu()?.getMenuItemById(id)?.enabled ?? false, id)) {
    if (Date.now() > deadline) throw new Error(`Menu item ${id} did not become enabled`);
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  await application.evaluate(({ Menu }, id) => { const item = Menu.getApplicationMenu().getMenuItemById(id); item.click(); }, id);
}
    const document = () => page.evaluate(() => window.editor.getDocument());
    const waitRevision = async revision => page.waitForFunction(async expected => (await window.editor.getDocument())?.revision === expected, revision);
    const snapshot = () => page.evaluate(async () => { const d = await window.editor.getDocument(); const frame = await window.editor.getFrame({ documentId: d.documentId, expectedRevision: d.revision, frameId: d.frames[0].id, allLayers: true }); return frame.layers.map(layer => ({ ...layer, pixels: [...layer.pixels] })); });
    const pixel = async (x, y, layer = 0) => (await snapshot())[layer].pixels.slice((y * 32 + x) * 4, (y * 32 + x) * 4 + 4);
    const canvas = page.getByLabel('Pixel canvas');
    async function point(x, y) { const box = await canvas.boundingBox(); return { x: box.x + (x + 0.5) * box.width / 32, y: box.y + (y + 0.5) * box.height / 32 }; }
    async function stroke(x1, y1, x2 = x1, y2 = y1) {
      // Wait for the current frame snapshot to be available before pointer-down.
      const revision = (await document()).revision;
      await page.waitForFunction(expected => document.querySelector('[aria-label="Pixel canvas"]').dataset.revision === String(expected), revision);
      const a = await point(x1, y1), b = await point(x2, y2);
      await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
    }
    await page.waitForFunction(() => document.querySelector('[aria-label="Pixel canvas"]').width === 32);
    // Frame reads and React painting are asynchronous; the first thumbnail confirms they have reached the view.
    await page.waitForFunction(() => document.querySelector('.zoom-value')?.textContent !== '1200%');
    const initialZoom = Number.parseInt(await page.locator('.zoom-value').innerText(), 10);
    const zoomPoint = await point(16, 16);
    await page.mouse.move(zoomPoint.x, zoomPoint.y);
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, -120);
    await page.keyboard.up('Control');
    await page.waitForFunction(expected => document.querySelector('.zoom-value')?.textContent === `${expected}%`, initialZoom + 100, { timeout: 1500 });
    await page.keyboard.down('Control');
    await page.mouse.wheel(0, 120);
    await page.keyboard.up('Control');
    await page.waitForFunction(expected => document.querySelector('.zoom-value')?.textContent === `${expected}%`, initialZoom, { timeout: 1500 });
    const viewport = page.locator('.canvas-viewport');
    await viewport.evaluate(element => { for (let i = 0; i < 40; i++) element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: -120, cancelable: true })); });
    await page.waitForFunction(() => document.querySelector('.zoom-value')?.textContent === '3200%');
    const viewportBounds = await viewport.boundingBox();
    await page.mouse.move(viewportBounds.x + viewportBounds.width / 2, viewportBounds.y + viewportBounds.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForFunction(() => document.querySelector('.canvas-viewport').scrollTop > 0);
    assert.equal(await page.locator('.zoom-value').innerText(), '3200%');
    await viewport.evaluate(element => { for (let i = 0; i < 40; i++) element.dispatchEvent(new WheelEvent('wheel', { ctrlKey: true, deltaY: 120, cancelable: true })); });
    await page.waitForFunction(() => document.querySelector('.zoom-value')?.textContent === '100%');
    assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.getZoomFactor()), 1);
    assert.equal((await document()).revision, 0);
    assert.equal(await page.locator('.document-toolbar').getByRole('button', { name: /Save|New canvas|Undo|Redo/ }).count(), 0);
    const menuState = await application.evaluate(({ Menu }) => {
      const menu = Menu.getApplicationMenu();
      return { file: menu.items.find(item => item.label === 'File').submenu.items.map(item => item.id), undo: menu.getMenuItemById('undo').enabled, redo: menu.getMenuItemById('redo').enabled, saveShortcut: menu.getMenuItemById('save').accelerator };
    });
    assert.ok(['new', 'open', 'save', 'save-as', 'import', 'export-png', 'export-gif', 'export-sheet'].every(id => menuState.file.includes(id)));
    assert.equal(menuState.undo, false); assert.equal(menuState.redo, false); assert.equal(menuState.saveShortcut, 'CmdOrCtrl+S');
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await stroke(2, 3, 10, 3); await waitRevision(1);
    assert.deepEqual(await pixel(2, 3), [233, 196, 106, 255]); assert.deepEqual(await pixel(10, 3), [233, 196, 106, 255]);
    assert.equal((await document()).history.undo, 1);
    await nativeMenu('undo'); await waitRevision(2); assert.deepEqual(await pixel(2, 3), [0, 0, 0, 0]);
    await nativeMenu('redo'); await waitRevision(3);
    const p = await point(5, 7); await page.mouse.move(p.x, p.y); await page.mouse.down(); await page.keyboard.press('Escape'); await page.mouse.up();
    assert.equal((await document()).revision, 3); assert.deepEqual(await pixel(5, 7), [0, 0, 0, 0]);
    await page.getByRole('button', { name: 'Rectangle', exact: true }).click(); await page.getByLabel('Filled rectangle').check();
    await stroke(10, 10, 14, 14); await waitRevision(4); assert.deepEqual(await pixel(12, 12), [233, 196, 106, 255]);
    await page.getByRole('button', { name: 'Eraser', exact: true }).click(); await stroke(12, 12); await waitRevision(5); assert.deepEqual(await pixel(12, 12), [0, 0, 0, 0]);
    await page.getByRole('button', { name: 'Add layer', exact: true }).click(); await waitRevision(6);
    await page.getByRole('button', { name: 'Layer 2', exact: true }).click();
    await page.getByLabel('Layer name', { exact: true }).fill('Outline'); await page.getByLabel('Layer name', { exact: true }).blur(); await waitRevision(7);
    await page.getByRole('button', { name: 'Pencil', exact: true }).click(); await stroke(4, 4); await waitRevision(8); assert.deepEqual(await pixel(4, 4, 1), [233, 196, 106, 255]);
    await page.getByRole('button', { name: 'Duplicate', exact: true }).click(); await waitRevision(9);
    await page.getByRole('button', { name: 'Frame 2', exact: true }).click();
    await page.getByLabel('Frame duration', { exact: true }).fill('250'); await page.getByLabel('Frame duration', { exact: true }).blur(); await waitRevision(10);
    await page.getByRole('button', { name: 'Add clip', exact: true }).click();
    await page.getByRole('dialog', { name: 'Edit animation clip' }).getByLabel('Loop playback').uncheck();
    await page.getByRole('button', { name: 'Save clip', exact: true }).click(); await waitRevision(11);
    assert.deepEqual((await document()).clips.map(clip => [clip.name, clip.frameIds.length, clip.loop]), [['walk', 2, false]]);
    await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
    await page.getByRole('button', { name: '▷ Play', exact: true }).click();
    await page.getByRole('button', { name: '▷ Play', exact: true }).waitFor();
    assert.ok((await page.locator('footer').innerText()).includes('Frame 2 / 2'));
    assert.equal((await document()).revision, 11);
    await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
    await page.getByRole('button', { name: '◉ Onion skin', exact: true }).click();
    await page.getByRole('button', { name: '▦ Grid', exact: true }).click();
    await page.getByRole('button', { name: 'Zoom in', exact: true }).click();
    await page.getByRole('button', { name: 'Fit', exact: true }).click();
    await page.getByRole('button', { name: 'Connect AI client' }).click();
    await page.getByRole('button', { name: 'Connect to Codex', exact: true }).click();
    await page.getByText('Codex configured. Restart the client', { exact: false }).waitFor();
    await page.getByRole('button', { name: 'Connect to Claude Code', exact: true }).click();
    await page.getByText('Claude Code configured. Restart the client', { exact: false }).waitFor();
    const configured = await page.evaluate(() => window.editor.getClients());
    assert.ok(configured.every(client => client.configured && !client.lastStatusCall));
    assert.ok(!JSON.stringify(configured).includes(token));
    assert.ok((await readFile(join(codexHome, 'config.toml'), 'utf8')).includes('# Keep this comment'));
    assert.equal(JSON.parse(await readFile(join(claudeHome, '.claude.json'), 'utf8')).theme, 'dark');
    for (const name of ['codex', 'claude-code']) {
      const client = new Client({ name: 'editor-ui-test', version: '1.0' }); clients.push(client);
      await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp/${name}`), { requestInit: { headers: { Authorization: `Bearer ${token}` } } }));
      assert.equal((await page.evaluate(() => window.editor.getClients())).find(item => item.client === name).lastStatusCall, null);
      const status = await client.callTool({ name: 'get_status', arguments: {} });
      assert.equal(status.structuredContent.document.revision, 11);
      assert.ok((await page.evaluate(() => window.editor.getClients())).find(item => item.client === name).lastStatusCall);
      assert.ok((await client.listTools()).tools.some(tool => tool.name === 'edit_document'));
    }
    await page.getByRole('button', { name: 'Check connection', exact: true }).first().click();
    await page.getByText('Status call received', { exact: false }).first().waitFor();
    await page.getByRole('button', { name: 'Close connections' }).click();
    const assistant = clients[0];
    const remote = async (name, args = {}) => { const result = await assistant.callTool({ name, arguments: args }); assert.ok(!result.isError, JSON.stringify(result.structuredContent)); return result; };
    const currentGuard = async () => { const d = await document(); return { documentId: d.documentId, expectedRevision: d.revision }; };
    const beforeMcp = await document(), firstFrame = beforeMcp.frames[0].id;
    await remote('edit_document', { ...await currentGuard(), operations: [
      { type: 'add_layer', id: 'mcp-layer', name: 'MCP art' },
      { type: 'draw_rectangle', frameId: firstFrame, layerId: 'mcp-layer', x1: 18, y1: 18, x2: 23, y2: 23, filled: true, color: '#2A9D8FFF' },
      { type: 'set_pixels', frameId: beforeMcp.frames[1].id, layerId: 'mcp-layer', pixels: [{ x: 0, y: 0, color: '#0000FFFF' }] },
      { type: 'duplicate_frame', frameId: firstFrame, id: 'mcp-second' },
      { type: 'set_frame_duration', frameId: 'mcp-second', duration: 160 },
      { type: 'set_pixels', frameId: 'mcp-second', layerId: 'mcp-layer', pixels: [{ x: 18, y: 18, color: '#E76F51FF' }] },
      { type: 'set_clip', name: 'mcp-demo', frameIds: [firstFrame, 'mcp-second'], loop: true },
    ] });
    await waitRevision(12);
    await page.waitForFunction(() => document.querySelector('[aria-label="Pixel canvas"]').dataset.revision === '12');
    await page.getByRole('button', { name: 'MCP art', exact: true }).waitFor();
    assert.equal((await document()).frames.length, 3);
    const preview = await remote('get_preview', { documentId: beforeMcp.documentId, frameId: firstFrame });
    const png = PNG.sync.read(Buffer.from(preview.content.find(item => item.type === 'image').data, 'base64'));
    assert.deepEqual([...png.data.subarray((18 * 32 + 18) * 4, (18 * 32 + 18) * 4 + 4)], [42, 157, 143, 255]);
    assert.deepEqual([...png.data.subarray(0, 4)], [0, 0, 0, 0]);
    const visiblePixels = await canvas.evaluate(element => [...element.getContext('2d').getImageData(0, 0, 32, 32).data]);
    assert.deepEqual(visiblePixels.slice((18 * 32 + 18) * 4, (18 * 32 + 18) * 4 + 4), [42, 157, 143, 255]);
    assert.ok(visiblePixels[3] > 0, 'Onion skin should remain a view overlay, excluded from the PNG');
    const sheet = await remote('get_animation_preview', { documentId: beforeMcp.documentId, frameIds: [firstFrame, 'mcp-second'], columns: 2, scale: 2 });
    assert.deepEqual([sheet.structuredContent.width, sheet.structuredContent.height], [128, 64]);
    await nativeMenu('undo'); await waitRevision(13);
    assert.equal((await document()).layers.some(layer => layer.id === 'mcp-layer'), false);
    await remote('redo', await currentGuard()); await waitRevision(14);
    assert.equal((await document()).clips.some(clip => clip.name === 'mcp-demo'), true);
    await stroke(6, 6); await waitRevision(15);
    const read = await remote('get_pixels', { documentId: beforeMcp.documentId, frameId: firstFrame, layerId: beforeMcp.layers[1].id, x: 6, y: 6, width: 1, height: 1 });
    assert.deepEqual([...Buffer.from(read.structuredContent.data, 'base64')], [233, 196, 106, 255]);
    await remote('undo', await currentGuard()); await waitRevision(16); assert.deepEqual(await pixel(6, 6, 1), [0, 0, 0, 0]);
    await nativeMenu('redo'); await waitRevision(17);
    await page.getByLabel('Playback clip', { exact: true }).selectOption('mcp-demo');
    await page.getByRole('button', { name: '▷ Play', exact: true }).click();
    await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).waitFor();
    await remote('edit_document', { ...await currentGuard(), operations: [{ type: 'set_palette', colors: ['#2A9D8FFF'] }] }); await waitRevision(18);
    await page.getByRole('button', { name: '▷ Play', exact: true }).waitFor();
    assert.ok((await page.locator('footer').innerText()).includes('Frame 1 / 3'));
    for (let i = 0; i < 52; i++) await remote('get_document');
    const recent = await page.evaluate(() => window.editor.getRecentOperations());
    assert.equal(recent.length, 50); assert.ok(!JSON.stringify(recent).includes(token));
    await page.getByRole('button', { name: 'Connect AI client' }).click();
    await page.waitForFunction(() => document.querySelectorAll('[aria-label="Recent MCP operations"] li').length === 50);
    assert.equal(await page.getByRole('region', { name: 'Recent MCP operations' }).locator('li').count(), 50);
    await page.getByRole('button', { name: 'Close connections' }).click();
    // Verify the native unsaved-replacement guard without interacting with an OS dialog.
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 2, checkboxChecked: false }); });
    const identity = (await document()).documentId;
    await nativeMenu('new');
    await page.getByRole('button', { name: 'Create canvas', exact: true }).click();
    await page.getByRole('dialog', { name: 'New canvas' }).waitFor({ state: 'hidden' });
    assert.equal((await document()).documentId, identity);
    await page.screenshot({ path: join(directory, 'editor.png') });
    assert.deepEqual(errors, []);
    await application.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0].close(); });
    assert.equal((await page.evaluate(() => window.editor.getStatus())).mcp.enabled, true);
    await application.evaluate(({ dialog }) => { dialog.showMessageBox = async () => ({ response: 1, checkboxChecked: false }); });
    await application.close(); application = undefined;
    console.log(`Editor smoke passed at ${scale * 100}% display scale: manual/MCP drawing, cross-interface history, overlays excluded from PNG previews, animation, playback pause on mutation, client setup, bounded operation history, cancellation and unsaved prompts.`);
  } finally {
    await Promise.allSettled(clients.map(client => client.close()));
    if (application) {
      // Teardown deliberately discards this isolated test artwork, bypassing the real unsaved prompt.
      await application.evaluate(({ app }) => app.exit(0)).catch(() => undefined);
      await application.close().catch(() => undefined);
    }
    await rm(directory, { recursive: true, force: true });
  }
}
