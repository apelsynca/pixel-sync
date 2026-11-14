import assert from 'node:assert/strict';
import { _electron as electron } from 'playwright-core';
import { createRequire } from 'node:module';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const require = createRequire(import.meta.url);
for (const scale of [1, 1.5]) {
  const directory = await mkdtemp(join(tmpdir(), 'PixelSync playback '));
  const env = { ...process.env, PIXEL_SYNC_DATA_DIR: directory };
  delete env.ELECTRON_RUN_AS_NODE;
  let app;
  try {
    app = await electron.launch({ executablePath: process.argv[2] ? resolve(process.argv[2]) : require('electron'), args: [...(process.argv[2] ? [] : ['.']), `--force-device-scale-factor=${scale}`, ...(process.platform === 'linux' ? ['--ozone-platform=headless', '--no-sandbox', '--disable-gpu'] : [])], env });
    const page = await app.firstWindow();
    page.setDefaultTimeout(5000);
    await page.getByRole('button', { name: 'Connect AI client' }).waitFor();
    const ids = await page.evaluate(async () => {
      const d = await window.editor.getDocument();
      await window.editor.edit({ documentId: d.documentId, expectedRevision: d.revision, operations: [
        { type: 'set_frame_duration', frameId: d.frames[0].id, duration: 5000 },
        { type: 'duplicate_frame', frameId: d.frames[0].id, id: 'second' },
        { type: 'set_clip', name: 'once', frameIds: [d.frames[0].id, 'second'], loop: false },
      ] });
      return { first: d.frames[0].id, second: 'second', layer: d.layers[0].id };
    });
    await page.getByRole('button', { name: 'Frame 2', exact: true }).waitFor();
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 100));
    for (const stop of ['Space', 'button', 'end']) {
      await page.getByRole('button', { name: 'Frame 1', exact: true }).click();
      await page.getByLabel('Playback clip', { exact: true }).selectOption(stop === 'end' ? 'once' : '');
      await page.locator('header h1').click(); // Leave keyboard focus away from native controls.
      const before = await page.evaluate(() => window.editor.getDocument());
      await page.keyboard.press('Space');
      await page.clock.runFor(5100);
      assert.ok((await page.getByRole('button', { name: 'Frame 2', exact: true }).getAttribute('class')).includes('selected'));
      if (stop === 'end') await page.clock.runFor(5000);
      else if (stop === 'Space') await page.keyboard.press('Space');
      else await page.getByRole('button', { name: 'Ⅱ Pause', exact: true }).click();
      await page.getByRole('button', { name: '▷ Play', exact: true }).waitFor();
      assert.ok((await page.locator('footer').innerText()).includes('Frame 2 / 2'), `${stop}: stopping playback selects the visible frame for editing`);
      assert.equal(await page.getByRole('button', { name: 'Return to edit frame', exact: true }).count(), 0);
      assert.equal((await page.evaluate(() => window.editor.getDocument())).revision, before.revision, 'Stopping is a view-only action');
      const canvas = page.getByLabel('Pixel canvas');
      const box = await canvas.boundingBox();
      await page.mouse.click(box.x + 26.5 * box.width / 32, box.y + 26.5 * box.height / 32);
      await page.clock.runFor(32);
      const frames = await page.evaluate(async ids => {
        const d = await window.editor.getDocument();
        const read = async frameId => {
          const frame = await window.editor.getFrame({ documentId: d.documentId, expectedRevision: d.revision, frameId, allLayers: true });
          return [...frame.layers.find(layer => layer.id === ids.layer).pixels.slice((26 * 32 + 26) * 4, (26 * 32 + 26) * 4 + 4)];
        };
        return { revision: d.revision, first: await read(ids.first), second: await read(ids.second) };
      }, ids);
      assert.equal(frames.revision, before.revision + 1, `${stop}: can draw immediately after stopping`);
      assert.deepEqual(frames.first, [0, 0, 0, 0]);
      assert.deepEqual(frames.second, [233, 196, 106, 255]);
      await page.evaluate(async () => { const d = await window.editor.getDocument(); await window.editor.undo({ documentId: d.documentId, expectedRevision: d.revision }); });
    }
    console.log(`Playback smoke passed at ${scale * 100}%: Space, Pause and clip completion allow immediate drawing on the visible frame.`);
  } finally {
    if (app) { await app.evaluate(({ app }) => app.exit(0)).catch(() => undefined); await app.close().catch(() => undefined); }
    await rm(directory, { recursive: true, force: true });
  }
}
