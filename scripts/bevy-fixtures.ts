// Generate the sample through the production project loader/compositor/exporter.
import { mkdir, writeFile } from 'node:fs/promises';
import { DocumentEngine } from '../src/core/document';
import { encodePng, renderSpriteSheet } from '../src/persistence/images';

const width = 16, height = 16;
const frames = [80, 120, 250].map((duration, index) => {
  const pixels = new Uint8Array(width * height * 4);
  for (let y = 3; y < 13; y++) for (let x = 4; x < 12; x++) {
    const edge = x === 4 || x === 11 || y === 3 || y === 12;
    pixels.set(edge ? [30, 45, 65, 255] : [70 + index * 50, 195, 165, 255], (y * width + x) * 4);
  }
  // A translucent highlight, two eyes and a moving foot make alpha/alignment visible.
  pixels.set([255, 255, 255, 128], (4 * width + 5) * 4);
  for (const x of [6, 9]) pixels.set([20, 25, 35, 255], (6 * width + x) * 4);
  pixels.set([30, 45, 65, 255], (13 * width + 5 + index * 2) * 4);
  return { id: `frame-${index}`, duration, cels: { body: Buffer.from(pixels).toString('base64') } };
});
const project = { version: 1, width, height, layers: [{ id: 'body', name: 'Body', visible: true }], frames, palette: [], clips: [
  { name: 'idle', frameIds: ['frame-0', 'frame-1'], loop: true },
  { name: 'walk', frameIds: ['frame-2', 'frame-0', 'frame-1'], loop: true },
  { name: 'once', frameIds: ['frame-1', 'frame-2'], loop: false },
] };
const engine = new DocumentEngine();
const doc = engine.replaceProject(project, {});
const sheet = renderSpriteSheet(engine, 2);
// Session identity is incidental; make generated fixtures reproducible.
sheet.metadata.documentId = 'pixel-sync-bevy-demo';
const directory = new URL('../examples/bevy/assets/demo/', import.meta.url);
await mkdir(directory, { recursive: true });
await Promise.all([
  writeFile(new URL('demo.pixel.json', directory), JSON.stringify(project, null, 2) + '\n'),
  writeFile(new URL('sheet.json', directory), JSON.stringify(sheet.metadata, null, 2) + '\n'),
  writeFile(new URL('sheet.png', directory), sheet.png),
  writeFile(new URL('static.png', directory), encodePng(width, height, engine.getPixels({ frameId: doc.frames[0].id, x: 0, y: 0, width, height }))),
]);
console.log('Generated Bevy fixtures from the PixelSync exporter');
