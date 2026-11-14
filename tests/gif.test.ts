import { describe, expect, it } from 'vitest';
import { GifReader } from 'omggif';
import { DocumentEngine } from '../src/core/document';
import { renderGif } from '../src/persistence/gif';

const guard = (document: { documentId: string; revision: number }) => ({ documentId: document.documentId, expectedRevision: document.revision });
function pixels(reader: GifReader, frame: number) {
  const output = new Uint8Array(reader.width * reader.height * 4);
  reader.decodeAndBlitFrameRGBA(frame, output);
  return [...output];
}
describe('animated GIF export', () => {
  it('decodes visible composites in timeline order with exact small palettes, binary transparency, rounded timing and looping', () => {
    const engine = new DocumentEngine(), initial = engine.newDocument({ width: 2, height: 1 });
    const frameId = initial.frames[0].id, layerId = initial.layers[0].id;
    engine.edit({ ...guard(initial), operations: [
      { type: 'set_pixels', frameId, layerId, pixels: [{ x: 0, y: 0, color: '#112233FF' }, { x: 1, y: 0, color: '#000000FF' }] },
      { type: 'add_layer', id: 'hidden', name: 'Hidden' },
      { type: 'set_pixels', frameId, layerId: 'hidden', pixels: [{ x: 0, y: 0, color: '#FF0000FF' }] },
      { type: 'set_layer_visibility', layerId: 'hidden', visible: false },
      { type: 'add_frame', id: 'second', duration: 275 },
      { type: 'set_pixels', frameId: 'second', layerId, pixels: [{ x: 0, y: 0, color: '#ABCDEF7F' }, { x: 1, y: 0, color: '#12345680' }] },
      { type: 'add_frame', id: 'clear', duration: 10 },
      { type: 'move_frame', frameId: 'second', index: 0 },
    ] });
    const before = engine.getDocument(), exported = renderGif(engine), reader = new GifReader(exported.bytes);
    expect([reader.width, reader.height, reader.numFrames(), reader.loopCount()]).toEqual([2, 1, 3, 0]);
    expect(pixels(reader, 0)).toEqual([0, 0, 0, 0, 18, 52, 86, 255]);
    expect(pixels(reader, 1)).toEqual([17, 34, 51, 255, 0, 0, 0, 255]);
    expect(pixels(reader, 2)).toEqual(Array(8).fill(0));
    expect([0, 1, 2].map(index => reader.frameInfo(index).delay)).toEqual([28, 10, 1]);
    expect([0, 1, 2].map(index => reader.frameInfo(index).disposal)).toEqual([2, 2, 2]);
    expect(engine.getDocument()).toEqual(before);
  });
  it('honors clip frame order and non-looping playback and rejects missing clips', () => {
    const engine = new DocumentEngine(), initial = engine.newDocument({ width: 1, height: 1 });
    engine.edit({ ...guard(initial), operations: [
      { type: 'add_frame', id: 'second', duration: 230 },
      { type: 'set_clip', name: 'once', frameIds: ['second', initial.frames[0].id], loop: false },
    ] });
    const exported = renderGif(engine, 'once'), reader = new GifReader(exported.bytes);
    expect(exported).toMatchObject({ frameCount: 2, loop: false });
    expect(reader.loopCount()).toBeNull();
    expect([reader.frameInfo(0).delay, reader.frameInfo(1).delay]).toEqual([23, 10]);
    expect(() => renderGif(engine, 'missing')).toThrow('clip does not exist');
  });
  it('quantizes frames exceeding the palette limit into a decodable GIF', () => {
    const engine = new DocumentEngine(), initial = engine.newDocument({ width: 257, height: 1 });
    engine.edit({ ...guard(initial), operations: [{ type: 'set_pixels', frameId: initial.frames[0].id, layerId: initial.layers[0].id,
      pixels: Array.from({ length: 257 }, (_, x) => ({ x, y: 0, color: `#${(x * 997).toString(16).padStart(6, '0')}FF` })) }] });
    const reader = new GifReader(renderGif(engine).bytes);
    expect(reader.frameInfo(0).palette_size).toBeLessThanOrEqual(256);
    const output = pixels(reader, 0);
    expect(output.filter((_, index) => index % 4 === 3).every(alpha => alpha === 255)).toBe(true);
    expect(new Set(Array.from({ length: 257 }, (_, x) => output.slice(x * 4, x * 4 + 3).join(','))).size).toBeLessThanOrEqual(255);
  });
  it('reads full-size canvases in bands beyond the pixel inspection limit', () => {
    const engine = new DocumentEngine(); engine.newDocument({ width: 512, height: 512 });
    const reader = new GifReader(renderGif(engine).bytes);
    expect([reader.width, reader.height, reader.numFrames()]).toEqual([512, 512, 1]);
    expect(pixels(reader, 0).every(value => value === 0)).toBe(true);
  });
});
