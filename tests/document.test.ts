import { describe, expect, it } from 'vitest';
import { DocumentEngine, type DocumentInfo } from '../src/core/document';
import { CommandService } from '../src/application/commands';
import { DocumentError, LIMITS, type Operation } from '../src/core/schema';

const guard = (document: DocumentInfo) => ({ documentId: document.documentId, expectedRevision: document.revision });
function fixture(width = 4, height = 4) {
  const engine = new DocumentEngine();
  const initial = engine.newDocument({ width, height });
  const target = { frameId: initial.frames[0].id, layerId: initial.layers[0].id };
  const edit = (...operations: Operation[]) => engine.edit({ ...guard(engine.getDocument()!), operations });
  const read = (frameId = target.frameId, layerId: string | undefined = target.layerId) => engine.getPixels({ frameId, layerId, x: 0, y: 0, width, height });
  const pixel = (x: number, y: number, frameId = target.frameId, layerId = target.layerId) => [...engine.getPixels({ frameId, layerId, x, y, width: 1, height: 1 })];
  return { engine, initial, target, edit, read, pixel };
}
const red = '#FF0000FF', blue = '#0000FFFF', clear = '#00000000';
function code(action: () => unknown, expected: string) {
  try { action(); throw new Error('Expected a DocumentError'); }
  catch (error) { expect(error).toBeInstanceOf(DocumentError); expect((error as DocumentError).code).toBe(expected); }
}

describe('drawing and compositing', () => {
  it('creates transparent defaults and protects buffers and metadata from callers', () => {
    const { engine, initial, read } = fixture();
    expect(initial.frames[0].duration).toBe(100);
    expect(read().every(value => value === 0)).toBe(true);
    initial.layers[0].name = 'mutated'; read().fill(255);
    expect(engine.getDocument()!.layers[0].name).toBe('Layer 1');
    expect(read().every(value => value === 0)).toBe(true);
    expect(new DocumentEngine().newDocument({})).toMatchObject({ width: 32, height: 32 });
  });
  it('uses inclusive Bresenham pixels, clipping, replacement alpha, and transparent erasure', () => {
    const { edit, target, pixel, read } = fixture();
    edit({ type: 'draw_line', ...target, x1: -1, y1: -1, x2: 3, y2: 3, color: red });
    expect([0, 1, 2, 3].map(i => pixel(i, i))).toEqual(Array(4).fill([255, 0, 0, 255]));
    expect(pixel(0, 1)).toEqual([0, 0, 0, 0]);
    edit({ type: 'set_pixels', ...target, pixels: [{ x: 1, y: 1, color: '#0000FF80' }, { x: 2, y: 2, color: clear }, { x: 4, y: 4, color: red }] });
    expect(pixel(1, 1)).toEqual([0, 0, 255, 128]); expect(pixel(2, 2)).toEqual([0, 0, 0, 0]);
    edit({ type: 'clear_layer', ...target }); expect(read().every(value => value === 0)).toBe(true);
  });
  it('rasterizes steep and reversed lines deterministically', () => {
    const { edit, target, pixel } = fixture();
    edit({ type: 'draw_line', ...target, x1: 1, y1: 3, x2: 0, y2: 0, color: red });
    expect([[0, 0], [0, 1], [1, 2], [1, 3]].map(([x, y]) => pixel(x, y))).toEqual(Array(4).fill([255, 0, 0, 255]));
  });
  it('normalizes rectangle corners and clips without inventing border pixels', () => {
    const { edit, target, pixel } = fixture();
    edit({ type: 'draw_rectangle', ...target, x1: 3, y1: 3, x2: -1, y2: -1, filled: false, color: red });
    expect(pixel(0, 0)).toEqual([0, 0, 0, 0]); expect(pixel(3, 0)).toEqual([255, 0, 0, 255]);
    edit({ type: 'draw_rectangle', ...target, x1: 2, y1: 2, x2: 1, y2: 1, filled: true, color: blue });
    for (const x of [1, 2]) for (const y of [1, 2]) expect(pixel(x, y)).toEqual([0, 0, 255, 255]);
  });
  it('flood fills exact RGBA matches with four-connected boundaries', () => {
    const { edit, target, pixel, engine } = fixture(3, 3);
    edit({ type: 'set_pixels', ...target, pixels: [{ x: 1, y: 0, color: red }, { x: 0, y: 1, color: red }] });
    edit({ type: 'fill', ...target, x: 0, y: 0, color: blue });
    expect(pixel(0, 0)).toEqual([0, 0, 255, 255]); expect(pixel(1, 1)).toEqual([0, 0, 0, 0]);
    const revision = engine.getDocument()!.revision;
    edit({ type: 'fill', ...target, x: 0, y: 0, color: blue });
    expect(engine.getDocument()!.revision).toBe(revision);
    edit({ type: 'fill', ...target, x: 2, y: 2, color: '#00000080' });
    expect(pixel(1, 1)).toEqual([0, 0, 0, 128]);
  });
  it('composites bottom-to-top source-over with shared visibility and layer order', () => {
    const { engine, target, edit } = fixture(1, 1);
    edit({ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'add_layer', id: 'top', name: 'Top' }, { type: 'set_pixels', frameId: target.frameId, layerId: 'top', pixels: [{ x: 0, y: 0, color: '#0000FF80' }] });
    const composite = () => [...engine.getPixels({ frameId: target.frameId, x: 0, y: 0, width: 1, height: 1 })];
    expect(composite()).toEqual([127, 0, 128, 255]);
    edit({ type: 'move_layer', layerId: 'top', index: 0 }); expect(composite()).toEqual([255, 0, 0, 255]);
    edit({ type: 'set_layer_visibility', layerId: target.layerId, visible: false }); expect(composite()).toEqual([0, 0, 255, 128]);
    edit({ type: 'set_layer_visibility', layerId: 'top', visible: false }); expect(composite()).toEqual([0, 0, 0, 0]);
  });
});

describe('atomic document and animation lifecycle', () => {
  it('deep-copies duplicated frames, adds transparent cels, and shares layer metadata', () => {
    const { engine, edit, target, pixel } = fixture();
    edit({ type: 'set_frame_duration', frameId: target.frameId, duration: 230 }, { type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'duplicate_frame', frameId: target.frameId, id: 'copy' }, { type: 'add_frame', id: 'blank' }, { type: 'add_layer', id: 'shared', name: 'Shared' });
    expect(engine.getDocument()!.frames.map(frame => frame.duration)).toEqual([230, 230, 100]);
    expect(pixel(0, 0, 'copy')).toEqual([255, 0, 0, 255]); expect(pixel(0, 0, 'blank')).toEqual([0, 0, 0, 0]);
    edit({ type: 'clear_layer', frameId: 'copy', layerId: target.layerId }, { type: 'rename_layer', layerId: 'shared', name: 'Foreground' });
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]); expect(pixel(0, 0, 'copy')).toEqual([0, 0, 0, 0]);
    for (const frame of engine.getDocument()!.frames) expect(pixel(0, 0, frame.id, 'shared')).toEqual([0, 0, 0, 0]);
    edit({ type: 'delete_layer', layerId: 'shared' });
    for (const frame of engine.getDocument()!.frames) code(() => pixel(0, 0, frame.id, 'shared'), 'missing_layer');
    engine.undo(guard(engine.getDocument()!));
    expect(engine.getDocument()!.layers[1].name).toBe('Foreground');
  });
  it('keeps ordered clip references through reordering and repairs deletions atomically', () => {
    const { engine, edit, target, pixel } = fixture();
    edit({ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'duplicate_frame', frameId: target.frameId, id: 'copy' }, { type: 'set_clip', name: 'walk', frameIds: ['copy', target.frameId], loop: false });
    edit({ type: 'move_frame', frameId: 'copy', index: 0 });
    expect(engine.getDocument()!.clips[0].frameIds).toEqual(['copy', target.frameId]);
    const before = engine.getDocument();
    code(() => edit({ type: 'delete_frame', frameId: target.frameId }), 'missing_frame');
    expect(engine.getDocument()).toEqual(before);
    edit({ type: 'delete_frame', frameId: target.frameId }, { type: 'set_clip', name: 'walk', frameIds: ['copy'], loop: true });
    engine.undo(guard(engine.getDocument()!));
    expect(engine.getDocument()!.clips[0]).toMatchObject({ frameIds: ['copy', target.frameId], loop: false });
    expect(pixel(0, 0)).toEqual([255, 0, 0, 255]);
    engine.redo(guard(engine.getDocument()!)); expect(engine.getDocument()!.frames).toHaveLength(1);
    edit({ type: 'delete_clip', name: 'walk' }); expect(engine.getDocument()!.clips).toEqual([]);
  });
  it('rolls back pixels, metadata, dirty state, revisions and redo after a late failure', () => {
    const { engine, edit, target, read } = fixture();
    engine.markSaved(guard(engine.getDocument()!));
    edit({ type: 'set_palette', colors: [red] }); engine.undo(guard(engine.getDocument()!));
    const before = engine.getDocument(), pixels = read();
    code(() => edit({ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'add_layer', id: 'temporary', name: 'Temporary' }, { type: 'set_clip', name: 'bad', frameIds: ['missing'], loop: true }), 'missing_frame');
    expect(engine.getDocument()).toEqual(before); expect(read()).toEqual(pixels); expect(before!.dirty).toBe(false);
    engine.redo(guard(engine.getDocument()!)); expect(engine.getDocument()!.palette).toEqual([red]);
  });
  it('enforces schemas, identities, durations, unique IDs, references and minimum counts', () => {
    const { engine, initial, edit, target } = fixture();
    code(() => edit({ type: 'delete_frame', frameId: target.frameId }), 'invalid_arguments');
    code(() => edit({ type: 'delete_layer', layerId: target.layerId }), 'invalid_arguments');
    code(() => edit({ type: 'add_frame', id: target.layerId }), 'invalid_arguments');
    code(() => edit({ type: 'set_frame_duration', frameId: target.frameId, duration: 9 }), 'invalid_arguments');
    code(() => edit({ type: 'set_frame_duration', frameId: target.frameId, duration: 60_001 }), 'invalid_arguments');
    code(() => edit({ type: 'set_clip', name: 'x', frameIds: [target.frameId, target.frameId], loop: true }), 'invalid_arguments');
    code(() => edit({ type: 'move_layer', layerId: target.layerId, index: 1 }), 'invalid_arguments');
    code(() => engine.edit({ ...guard(initial), operations: [{ type: 'set_palette', colors: ['red'] }] }), 'invalid_arguments');
    edit({ type: 'set_frame_duration', frameId: target.frameId, duration: 10 });
    code(() => engine.undo(guard(initial)), 'stale_revision');
    code(() => engine.edit({ documentId: 'wrong', expectedRevision: 1, operations: [{ type: 'set_palette', colors: [] }] }), 'stale_revision');
    code(() => new DocumentEngine().undo(guard(initial)), 'missing_document');
  });
  it('guards unsaved replacement and never reuses document identities or history', () => {
    const { engine, initial } = fixture();
    code(() => engine.newDocument({}), 'stale_revision');
    code(() => engine.newDocument({ current: guard(initial) }), 'unsaved_document');
    const replacement = engine.newDocument({ current: guard(initial), discardUnsaved: true });
    expect(replacement.documentId).not.toBe(initial.documentId); expect(replacement.history.undo).toBe(0);
    code(() => engine.undo(guard(initial)), 'stale_revision');
    engine.markSaved(guard(replacement));
    expect(engine.newDocument({ current: guard(replacement) }).width).toBe(32);
    code(() => engine.newDocument({ width: 513, discardUnsaved: true }), 'invalid_arguments');
  });
});

describe('history and bounds', () => {
  it('groups a gesture, restores all state, advances revisions, and clears redo on a branch', () => {
    const { engine, edit, target, read } = fixture();
    engine.markSaved(guard(engine.getDocument()!));
    edit({ type: 'set_pixels', ...target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'set_pixels', ...target, pixels: [{ x: 1, y: 0, color: blue }] }, { type: 'set_palette', colors: [red, blue] });
    const painted = read(); expect(engine.getDocument()!.history.undo).toBe(1);
    engine.undo(guard(engine.getDocument()!)); expect(read().every(value => value === 0)).toBe(true); expect(engine.getDocument()).toMatchObject({ revision: 2, dirty: false, palette: [] });
    engine.redo(guard(engine.getDocument()!)); expect(read()).toEqual(painted); expect(engine.getDocument()).toMatchObject({ revision: 3, dirty: true, palette: [red, blue] });
    engine.undo(guard(engine.getDocument()!)); edit({ type: 'set_palette', colors: [blue] });
    code(() => engine.redo(guard(engine.getDocument()!)), 'empty_history');
    expect(engine.getDocument()!.revision).toBe(5);
  });
  it('stores a small pixel patch on a large canvas and reports changed bounds', () => {
    const { engine, edit, target } = fixture(512, 512);
    const result = edit({ type: 'set_pixels', ...target, pixels: [{ x: 300, y: 200, color: red }] });
    expect(result.changed).toEqual([{ ...target, bounds: { x: 300, y: 200, width: 1, height: 1 } }]);
    expect(engine.getDocument()!.history.bytes).toBeLessThan(4096);
    code(() => engine.getPixels({ frameId: target.frameId, x: 0, y: 0, width: 512, height: 512 }), 'size_limit');
    code(() => engine.getPixels({ frameId: target.frameId, x: -1, y: 0, width: 1, height: 1 }), 'invalid_arguments');
  });
  it('bounds operations, supplied pixels, frame/layer/clip counts and metadata history', () => {
    const { engine, edit, target } = fixture(1, 1);
    code(() => edit(...Array.from({ length: 257 }, (): Operation => ({ type: 'set_palette', colors: [] }))), 'invalid_arguments');
    const pixels = Array.from({ length: 32_769 }, () => ({ x: 0, y: 0, color: red }));
    code(() => edit({ type: 'set_pixels', ...target, pixels }, { type: 'set_pixels', ...target, pixels }), 'size_limit');
    edit(...Array.from({ length: 63 }, (_, i): Operation => ({ type: 'add_frame', id: `f${i}` })));
    code(() => edit({ type: 'add_frame' }), 'size_limit');
    edit(...Array.from({ length: 15 }, (_, i): Operation => ({ type: 'add_layer', id: `l${i}`, name: 'Layer' })));
    code(() => edit({ type: 'add_layer', name: 'Too many' }), 'size_limit');
    edit(...Array.from({ length: 64 }, (_, i): Operation => ({ type: 'set_clip', name: `clip${i}`, frameIds: [target.frameId], loop: true })));
    code(() => edit({ type: 'set_clip', name: 'overflow', frameIds: [target.frameId], loop: true }), 'size_limit');
    for (let i = 0; i < 1030; i++) edit({ type: 'set_frame_duration', frameId: target.frameId, duration: 10 + (i % 2) });
    expect(engine.getDocument()!.history.undo).toBeLessThanOrEqual(1024); expect(engine.getDocument()!.history.bytes).toBeLessThanOrEqual(LIMITS.history);
  });
  it('enforces decoded memory before allocation and evicts old history within its byte budget', () => {
    const { engine, edit, target } = fixture(512, 512);
    edit(...Array.from({ length: 7 }, (_, i): Operation => ({ type: 'add_frame', id: `f${i}` })));
    for (let i = 0; i < 15; i++) edit({ type: 'add_layer', id: `l${i}`, name: 'Layer' });
    const full = engine.getDocument()!;
    expect(full.layers.length * full.frames.length * 512 * 512 * 4).toBe(LIMITS.pixels);
    expect(full.history.bytes).toBeLessThanOrEqual(LIMITS.history); expect(full.history.undo).toBeLessThan(16);
    code(() => edit({ type: 'add_frame' }), 'size_limit'); expect(engine.getDocument()).toEqual(full);
    // Copying and deleting the same large cel repeatedly cannot bypass staging limits.
    code(() => edit(...Array.from({ length: 130 }, (_, i): Operation[] => [{ type: 'delete_layer', layerId: i === 0 ? 'l14' : `temp${i - 1}` }, { type: 'add_layer', id: `temp${i}`, name: 'Temp' }]).flat().slice(0, 256)), 'size_limit');
    expect(engine.getDocument()).toEqual(full);
    expect(engine.getPixels({ ...target, x: 0, y: 0, width: 1, height: 1 })).toEqual(new Uint8Array(4));
  });
  it('rejects a transaction too large to undo and retains the original state and history', () => {
    const { engine, edit, target } = fixture(512, 512);
    edit(...Array.from({ length: 32 }, (_, i): Operation => ({ type: 'add_frame', id: `f${i}` })));
    const before = engine.getDocument()!;
    code(() => edit(...before.frames.map((frame): Operation => ({ type: 'fill', frameId: frame.id, layerId: target.layerId, x: 0, y: 0, color: red }))), 'size_limit');
    expect(engine.getDocument()).toEqual(before);
    for (const frame of before.frames) expect(engine.getPixels({ frameId: frame.id, x: 511, y: 511, width: 1, height: 1 })).toEqual(new Uint8Array(4));
  });
  it('tracks the saved version across undo, redo and divergent branches', () => {
    const { engine, edit } = fixture();
    edit({ type: 'set_palette', colors: [red] }); engine.markSaved(guard(engine.getDocument()!));
    engine.undo(guard(engine.getDocument()!)); expect(engine.getDocument()!.dirty).toBe(true);
    engine.redo(guard(engine.getDocument()!)); expect(engine.getDocument()!.dirty).toBe(false);
    engine.undo(guard(engine.getDocument()!)); edit({ type: 'set_palette', colors: [blue] });
    expect(engine.getDocument()!.dirty).toBe(true);
  });
});

describe('serialized application commands', () => {
  it('holds competing commands until a whole gesture commits, and releases on cancellation or invalid edits', async () => {
    const service = new CommandService();
    const initial = await service.newDocument({});
    const gesture = await service.beginGesture(guard(initial));
    let finished = false;
    const competing = service.edit({ ...guard(initial), operations: [{ type: 'set_palette', colors: [blue] }] }).finally(() => { finished = true; });
    // Attach a rejection handler before committing the gesture.
    const outcome = Promise.allSettled([competing]);
    await Promise.resolve(); expect(finished).toBe(false);
    await gesture.commit([{ type: 'set_palette', colors: [red] }]);
    expect(await outcome).toMatchObject([{ status: 'rejected', reason: { code: 'stale_revision' } }]);
    const current = (await service.getDocument())!;
    const cancelled = await service.beginGesture(guard(current));
    const pending = service.getDocument(); cancelled.cancel();
    expect(await pending).toEqual(current);
    await expect(cancelled.commit([])).rejects.toMatchObject({ code: 'invalid_arguments' });
    const invalid = await service.beginGesture(guard(current));
    await expect(invalid.commit([{ type: 'delete_frame', frameId: current.frames[0].id }])).rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(await service.getDocument()).toEqual(current);
    await expect(service.beginGesture(guard(initial))).rejects.toMatchObject({ code: 'stale_revision' });
    expect(await service.getDocument()).toEqual(current);
  });
  it('rejects concurrent stale writes, recovers after failures, and publishes only committed states', async () => {
    const service = new CommandService(), events: number[] = [];
    service.subscribe(() => { throw new Error('broken view'); });
    service.subscribe(event => { events.push(event.document.revision); event.document.layers[0].name = 'external'; });
    const initial = await service.newDocument({});
    const request = { ...guard(initial), operations: [{ type: 'set_palette', colors: [red] }] };
    const first = service.edit(request), second = service.edit(request);
    request.operations[0].colors[0] = blue;
    const results = await Promise.allSettled([first, second]);
    expect(results[0].status).toBe('fulfilled'); expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'stale_revision' } });
    const current = (await service.getDocument())!;
    expect(current.palette).toEqual([red]); expect(current.layers[0].name).toBe('Layer 1'); expect(events).toEqual([0, 1]);
    await service.undo(guard(current)); expect((await service.getDocument())!.revision).toBe(2);
    expect(events).toEqual([0, 1, 2]);
  });
});
