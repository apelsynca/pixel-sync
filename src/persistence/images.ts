import { PNG } from 'pngjs';
import { inflateSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';
import { DocumentEngine } from '../core/document';
import { fail } from '../core/schema';
import type { ProjectFile } from '../core/project';

export const PNG_FILE_LIMIT = 16 * 1024 * 1024;
export function encodePng(width: number, height: number, pixels: Uint8Array): Buffer {
  const png = new PNG(); png.width = width; png.height = height;
  png.data = Buffer.from(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  return PNG.sync.write(png, { colorType: 6, inputColorType: 6, inputHasAlpha: true });
}
export function importPng(bytes: Buffer): ProjectFile {
  if (bytes.length > PNG_FILE_LIMIT) fail('size_limit', 'PNG input exceeds 16 MiB');
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') fail('unsupported_format', 'Expected a PNG with a valid IHDR header');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20), depth = bytes[24], color = bytes[25], interlace = bytes[28];
  if (!width || !height || width > 512 || height > 512) fail('size_limit', 'PNG dimensions must be between 1 and 512 pixels');
  const channels: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  if (!channels[color] || ![1, 2, 4, 8].includes(depth) || ([2, 4, 6].includes(color) && depth !== 8) || bytes[26] !== 0 || bytes[27] !== 0 || interlace > 1) fail('unsupported_format', 'Unsupported PNG encoding; use an 8-bit RGBA, RGB, grayscale, or indexed PNG');
  const compressed: Buffer[] = [];
  let ended = false;
  for (let offset = 8; offset < bytes.length;) {
    if (offset + 12 > bytes.length) fail('unsupported_format', 'Truncated PNG chunk');
    const length = bytes.readUInt32BE(offset), end = offset + 12 + length;
    if (end > bytes.length) fail('unsupported_format', 'Truncated PNG data');
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'acTL') fail('unsupported_format', 'Animated PNG import is not supported; import a single frame');
    if (type === 'IDAT') compressed.push(bytes.subarray(offset + 8, end - 4));
    if (type === 'IEND') { if (length || end !== bytes.length) fail('unsupported_format', 'Invalid PNG end chunk'); ended = true; }
    offset = end;
  }
  if (!ended || !compressed.length) fail('unsupported_format', 'PNG image data is missing');
  // pngjs bounds non-interlaced inflation but not Adam7 inflation. Validate the
  // exact scanline budget first, before its decoder can allocate inflated data.
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]];
  let expected = 0;
  for (const [x, y, dx, dy] of passes) {
    const w = Math.max(0, Math.ceil((width - x) / dx)), h = Math.max(0, Math.ceil((height - y) / dy));
    if (w && h) expected += (Math.ceil(w * channels[color] * depth / 8) + 1) * h;
  }
  try {
    if (inflateSync(Buffer.concat(compressed), { maxOutputLength: expected + 1 }).length !== expected) fail('unsupported_format', 'PNG scanline length does not match its dimensions');
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    const layerId = randomUUID(), frameId = randomUUID();
    return { version: 1, width, height, layers: [{ id: layerId, name: 'Imported PNG', visible: true }], frames: [{ id: frameId, duration: 100, cels: { [layerId]: decoded.data.toString('base64') } }], clips: [], palette: [] };
  } catch { return fail('unsupported_format', 'PNG data is invalid or exceeds its decoded scanline budget'); }
}
export function renderSpriteSheet(engine: DocumentEngine, requestedColumns?: number) {
  const document = engine.getDocument() ?? fail('missing_document', 'Create a document first');
  const columns = requestedColumns ?? Math.ceil(Math.sqrt(document.frames.length)), rows = Math.ceil(document.frames.length / columns);
  if (!Number.isInteger(columns) || columns < 1 || columns > document.frames.length) fail('invalid_arguments', 'Columns must be between 1 and the frame count');
  const width = columns * document.width, height = rows * document.height;
  if (width > 4096 || height > 4096 || width * height * 4 > 64 * 1024 * 1024) fail('size_limit', 'Sprite sheet exceeds 4096×4096 or 64 MiB; choose a more compact column count');
  const pixels = new Uint8Array(width * height * 4);
  document.frames.forEach((frame, index) => {
    const x = index % columns * document.width, y = Math.floor(index / columns) * document.height;
    const bandHeight = Math.floor(65_536 / document.width);
    for (let row = 0; row < document.height; row += bandHeight) {
      const count = Math.min(bandHeight, document.height - row), band = engine.getPixels({ frameId: frame.id, x: 0, y: row, width: document.width, height: count });
      for (let line = 0; line < count; line++) pixels.set(band.subarray(line * document.width * 4, (line + 1) * document.width * 4), ((y + row + line) * width + x) * 4);
    }
  });
  const metadata = { version: 1, image: 'sheet.png', imageWidth: width, imageHeight: height, frameWidth: document.width, frameHeight: document.height,
    frameCount: document.frames.length, columns, rows, padding: 0, offset: { x: 0, y: 0 }, units: { dimensions: 'pixels', duration: 'milliseconds' },
    documentId: document.documentId, revision: document.revision, frames: document.frames.map((frame, index) => ({ id: frame.id, index, duration: frame.duration })),
    clips: document.clips.map(clip => ({ name: clip.name, indices: clip.frameIds.map(id => document.frames.findIndex(frame => frame.id === id)), loop: clip.loop })),
  };
  return { png: encodePng(width, height, pixels), metadata };
}
