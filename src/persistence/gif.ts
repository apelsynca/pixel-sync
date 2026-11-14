import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { DocumentEngine } from '../core/document';
import { fail } from '../core/schema';

// Reserve index zero in every frame, including opaque frames, so disposal to
// background clears the previous image before drawing the next full canvas.
function indexFrame(pixels: Uint8Array) {
  const colors = new Map<number, number>();
  const opaque = new Uint8Array(pixels.length);
  let length = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 128) continue;
    const key = pixels[offset] << 16 | pixels[offset + 1] << 8 | pixels[offset + 2];
    if (colors.size <= 255 && !colors.has(key)) colors.set(key, colors.size + 1);
    opaque.set(pixels.subarray(offset, offset + 3), length); opaque[length + 3] = 255; length += 4;
  }
  const exact = colors.size <= 255;
  const palette = exact ? [...colors.keys()].map(key => [key >>> 16, key >>> 8 & 255, key & 255]) : quantize(opaque.subarray(0, length), 255);
  const mapped = exact ? null : applyPalette(pixels, palette);
  const indices = new Uint8Array(pixels.length / 4);
  for (let index = 0; index < indices.length; index++) {
    const offset = index * 4;
    if (pixels[offset + 3] < 128) continue;
    indices[index] = mapped ? mapped[index] + 1 : colors.get(pixels[offset] << 16 | pixels[offset + 1] << 8 | pixels[offset + 2])!;
  }
  return { indices, palette: [[0, 0, 0], ...(palette.length ? palette : [[0, 0, 0]])] };
}

export function renderGif(engine: DocumentEngine, clipName?: string) {
  const document = engine.getDocument() ?? fail('missing_document', 'Create a document first');
  const clip = clipName === undefined ? undefined : document.clips.find(item => item.name === clipName);
  if (clipName !== undefined && !clip) fail('invalid_arguments', 'Animation clip does not exist');
  const frames = clip ? clip.frameIds.map(id => document.frames.find(frame => frame.id === id)!) : document.frames;
  const loop = clip?.loop ?? true, gif = GIFEncoder();
  for (const frame of frames) {
    const pixels = new Uint8Array(document.width * document.height * 4);
    const bandHeight = Math.floor(65_536 / document.width);
    for (let row = 0; row < document.height; row += bandHeight) {
      const height = Math.min(bandHeight, document.height - row);
      pixels.set(engine.getPixels({ frameId: frame.id, x: 0, y: row, width: document.width, height }), row * document.width * 4);
    }
    const { indices, palette } = indexFrame(pixels);
    gif.writeFrame(indices, document.width, document.height, { palette, delay: frame.duration, repeat: loop ? 0 : -1, transparent: true, transparentIndex: 0, dispose: 2 });
  }
  gif.finish();
  return { bytes: Buffer.from(gif.bytes()), width: document.width, height: document.height, frameCount: frames.length, loop };
}
