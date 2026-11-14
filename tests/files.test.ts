import { afterEach, describe, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { deflateSync } from 'node:zlib';
import { PNG } from 'pngjs';
import { CommandService } from '../src/application/commands';
import { FileService } from '../src/persistence/files';
import { RecoveryManager } from '../src/persistence/recovery';
import { encodePng, importPng, renderSpriteSheet } from '../src/persistence/images';
import { PROJECT_LIMIT, validateProject } from '../src/core/project';
import type { DocumentInfo } from '../src/core/document';
import { DocumentEngine } from '../src/core/document';

const cleanup: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const guard = (document: DocumentInfo) => ({ documentId: document.documentId, expectedRevision: document.revision });
async function fixture(io: typeof fs = fs, width = 2, height = 2) {
  const directory = await fs.mkdtemp(join(tmpdir(), 'pixel-files-')); cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const root = join(directory, 'workspace'), data = join(directory, 'data'), outside = join(directory, 'outside');
  await fs.mkdir(root); await fs.mkdir(outside);
  const commands = new CommandService(), initial = await commands.newDocument({ width, height });
  const files = new FileService(commands, data, io); await files.initialize();
  const get = async () => (await commands.getDocument())!;
  const edit = async (operations: unknown[]) => commands.edit({ ...guard(await get()), operations });
  const project = async () => commands.runFileAction(async engine => engine.exportProject());
  const save = async (path = 'hero.pixel.json', overwrite = false) => files.execute('save_project', { ...guard(await get()), path, overwrite });
  return { directory, root, data, outside, commands, files, initial, get, edit, project, save, target: { frameId: initial.frames[0].id, layerId: initial.layers[0].id } };
}
const red = '#FF0000FF';
describe('project and image persistence', () => {
  it('round-trips animation, layer order/visibility, exact straight RGBA, palette, clips and timing with a new identity and no history', async () => {
    const f = await fixture(); await f.files.setWorkspace(f.root);
    await f.edit([{ type: 'set_pixels', ...f.target, pixels: [{ x: 0, y: 0, color: '#11223300' }, { x: 1, y: 0, color: '#EE992280' }] }, { type: 'add_layer', id: 'top', name: 'Foreground' }, { type: 'set_layer_visibility', layerId: 'top', visible: false }, { type: 'duplicate_frame', frameId: f.target.frameId, id: 'second' }, { type: 'set_frame_duration', frameId: 'second', duration: 275 }, { type: 'set_palette', colors: [red, '#00000000'] }, { type: 'set_clip', name: 'walk', frameIds: ['second', f.target.frameId], loop: false }]);
    const expected = await f.project(), before = await f.get();
    await f.save(); expect(await f.get()).toMatchObject({ revision: before.revision, dirty: false });
    await f.edit([{ type: 'clear_layer', ...f.target }]);
    await f.files.execute('open_project', { path: 'hero.pixel.json', current: guard(await f.get()), discardUnsaved: true });
    expect(await f.project()).toEqual(expected);
    expect(await f.get()).toMatchObject({ revision: 0, dirty: false, history: { undo: 0, redo: 0, bytes: 0 } });
    expect((await f.get()).documentId).not.toBe(before.documentId);
    expect(f.files.state().projectPath).toBe(join(f.root, 'hero.pixel.json'));
  });
  it('exports the visible composite, imports exact RGBA without marking it saved, and keeps exports from clearing dirty state', async () => {
    const f = await fixture(); await f.files.setWorkspace(f.root);
    await f.edit([{ type: 'set_pixels', ...f.target, pixels: [{ x: 0, y: 0, color: '#FF000080' }] }, { type: 'add_layer', id: 'hidden', name: 'Hidden' }, { type: 'set_pixels', frameId: f.target.frameId, layerId: 'hidden', pixels: [{ x: 0, y: 0, color: '#0000FFFF' }] }, { type: 'set_layer_visibility', layerId: 'hidden', visible: false }]);
    const before = await f.get();
    await f.files.execute('export_png', { ...guard(before), frameId: f.target.frameId, path: 'sprite.png' });
    expect(await f.get()).toEqual(before);
    const png = PNG.sync.read(await fs.readFile(join(f.root, 'sprite.png'))); expect([...png.data.subarray(0, 4)]).toEqual([255, 0, 0, 128]);
    await f.files.execute('import_png', { path: 'sprite.png', current: guard(before), discardUnsaved: true });
    expect(await f.get()).toMatchObject({ width: 2, height: 2, dirty: true, layers: [{ name: 'Imported PNG' }], frames: [{ duration: 100 }] });
    const imported = await f.commands.getFrame({ ...guard(await f.get()), frameId: (await f.get()).frames[0].id, allLayers: true });
    expect(Buffer.from(imported.layers[0].pixels)).toEqual(png.data); expect(f.files.state().projectPath).toBeNull();
  });
  it('publishes a regular-grid sheet and metadata together with timeline/clip order, unequal timing and transparent unused cells', async () => {
    const f = await fixture(fs, 1, 1); await f.files.setWorkspace(f.root);
    await f.edit([{ type: 'set_pixels', ...f.target, pixels: [{ x: 0, y: 0, color: red }] }, { type: 'add_frame', id: 'blue', duration: 230 }, { type: 'set_pixels', frameId: 'blue', layerId: f.target.layerId, pixels: [{ x: 0, y: 0, color: '#0000FFFF' }] }, { type: 'add_frame', id: 'clear', duration: 60 }, { type: 'move_frame', frameId: 'blue', index: 0 }, { type: 'set_clip', name: 'walk', frameIds: [f.target.frameId, 'blue'], loop: true }]);
    const before = await f.get();
    await f.files.execute('export_sprite_sheet', { ...guard(before), path: 'walk', columns: 2 });
    expect((await fs.readdir(join(f.root, 'walk'))).sort()).toEqual(['sheet.json', 'sheet.png']);
    const png = PNG.sync.read(await fs.readFile(join(f.root, 'walk', 'sheet.png'))), metadata = JSON.parse(await fs.readFile(join(f.root, 'walk', 'sheet.json'), 'utf8'));
    expect([png.width, png.height]).toEqual([2, 2]); expect([...png.data]).toEqual([0, 0, 255, 255, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(metadata).toMatchObject({ version: 1, image: 'sheet.png', frameCount: 3, columns: 2, rows: 2, padding: 0, revision: before.revision, frames: [{ id: 'blue', index: 0, duration: 230 }, { id: f.target.frameId, index: 1, duration: 100 }, { id: 'clear', index: 2, duration: 60 }], clips: [{ name: 'walk', indices: [1, 0], loop: true }] });
    expect(await f.get()).toEqual(before);
    await expect(f.files.execute('export_sprite_sheet', { ...guard(before), path: 'walk' })).rejects.toMatchObject({ code: 'already_exists' });
    expect(JSON.parse(await fs.readFile(join(f.root, 'walk', 'sheet.json'), 'utf8'))).toEqual(metadata);
  });
  it('requires a workspace and explicit overwrite, while native selections can save outside it', async () => {
    const f = await fixture();
    await expect(f.save()).rejects.toMatchObject({ code: 'workspace_required' });
    await f.files.setWorkspace(f.root); await f.save();
    await f.edit([{ type: 'set_palette', colors: [red] }]);
    const before = await f.get(), original = await fs.readFile(join(f.root, 'hero.pixel.json'));
    await expect(f.save()).rejects.toMatchObject({ code: 'already_exists' }); expect(await f.get()).toEqual(before); expect(await fs.readFile(join(f.root, 'hero.pixel.json'))).toEqual(original);
    await f.save('hero.pixel.json', true); expect((await f.get()).dirty).toBe(false);
    await f.files.executeNative('save_project', { ...guard(await f.get()), path: join(f.outside, 'selected.pixel.json'), overwrite: false });
    expect(await fs.stat(join(f.outside, 'selected.pixel.json'))).toBeTruthy();
  });
  it('keeps the last good project and dirty/history state when final replacement fails', async () => {
    const io: typeof fs = { ...fs, rename: async (source, destination) => { if (String(destination).endsWith('hero.pixel.json')) throw new Error('Injected disk failure'); await fs.rename(source, destination); } };
    const f = await fixture(io); await f.files.setWorkspace(f.root); await fs.writeFile(join(f.root, 'hero.pixel.json'), 'previous bytes');
    const before = await f.get(); await expect(f.save('hero.pixel.json', true)).rejects.toMatchObject({ code: 'io_error' });
    expect(await fs.readFile(join(f.root, 'hero.pixel.json'), 'utf8')).toBe('previous bytes'); expect(await f.get()).toEqual(before);
    expect((await fs.readdir(f.root)).some(name => name.startsWith('.pixel-'))).toBe(false);
  });
  it('does not publish incomplete sprite exports when directory publication fails', async () => {
    const io: typeof fs = { ...fs, rename: async (source, destination) => { if (String(destination).endsWith('broken')) throw new Error('Injected rename failure'); await fs.rename(source, destination); } };
    const f = await fixture(io); await f.files.setWorkspace(f.root);
    await expect(f.files.execute('export_sprite_sheet', { ...guard(await f.get()), path: 'broken' })).rejects.toMatchObject({ code: 'io_error' });
    expect(await fs.readdir(f.root)).toEqual([]);
  });
  it('refuses a destination created during no-overwrite publication', async () => {
    const io: typeof fs = { ...fs, link: async (source, destination) => { if (String(destination).endsWith('hero.pixel.json')) await fs.writeFile(destination, 'created concurrently'); await fs.link(source, destination); } };
    const f = await fixture(io); await f.files.setWorkspace(f.root);
    await expect(f.save()).rejects.toMatchObject({ code: 'already_exists' }); expect(await fs.readFile(join(f.root, 'hero.pixel.json'), 'utf8')).toBe('created concurrently');
    expect((await fs.readdir(f.root)).filter(name => name.startsWith('.pixel-'))).toEqual([]);
  });
  it('holds a consistent revision across async save and marks a later queued edit dirty', async () => {
    let enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const io: typeof fs = { ...fs, rename: async (source, destination) => { if (String(destination).endsWith('held.pixel.json')) { enter(); await gate; } await fs.rename(source, destination); } };
    const f = await fixture(io); await f.files.setWorkspace(f.root);
    const saving = f.files.execute('save_project', { ...guard(f.initial), path: 'held.pixel.json', overwrite: true }); await entered;
    const editing = f.commands.edit({ ...guard(f.initial), operations: [{ type: 'set_pixels', ...f.target, pixels: [{ x: 0, y: 0, color: red }] }] });
    release(); await saving; await editing;
    expect(await f.get()).toMatchObject({ revision: 1, dirty: true });
    const saved = JSON.parse(await fs.readFile(join(f.root, 'held.pixel.json'), 'utf8')); expect(Buffer.from(saved.frames[0].cels[f.target.layerId], 'base64')).toEqual(Buffer.alloc(16));
  });
  it('treats a successful publication as committed even if later temporary-file cleanup reports an error', async () => {
    let root = '';
    const io: typeof fs = { ...fs, rm: async (...args) => { if (root && String(args[0]).startsWith(root) && String(args[0]).endsWith('.tmp')) throw new Error('Injected cleanup failure'); await fs.rm(...args); } };
    const f = await fixture(io); root = f.root; await f.files.setWorkspace(root);
    await f.save('committed.pixel.json', true);
    expect((await f.get()).dirty).toBe(false); expect(JSON.parse(await fs.readFile(join(root, 'committed.pixel.json'), 'utf8')).version).toBe(1);
  });
  it('cancels a staged save before publication without changing an existing file or dirty state', async () => {
    let root = '', enter!: () => void, release!: () => void;
    const entered = new Promise<void>(resolve => { enter = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const io: typeof fs = { ...fs, open: async (...args) => { const handle = await fs.open(...args); if (root && String(args[0]).startsWith(root) && String(args[0]).endsWith('.tmp')) { const write = handle.writeFile.bind(handle); handle.writeFile = async (...data) => { enter(); await gate; return write(...data); }; } return handle; } };
    const f = await fixture(io); root = f.root; await f.files.setWorkspace(root); await fs.writeFile(join(root, 'hero.pixel.json'), 'old bytes');
    const before = await f.get(), controller = new AbortController();
    const writing = f.files.execute('save_project', { ...guard(before), path: 'hero.pixel.json', overwrite: true }, controller.signal);
    const outcome = writing.catch(error => error);
    await entered; controller.abort(); release();
    expect(await outcome).toMatchObject({ code: 'cancelled' }); expect(await f.get()).toEqual(before); expect(await fs.readFile(join(root, 'hero.pixel.json'), 'utf8')).toBe('old bytes');
  });
  it('rejects invalid projects and oversized file headers before replacing the current document', async () => {
    const f = await fixture(); await f.files.setWorkspace(f.root); const valid = await f.project(), before = await f.get();
    const invalid = [ { ...valid, version: 999 }, { ...valid, layers: [...valid.layers, valid.layers[0]] }, { ...valid, clips: [{ name: 'bad', frameIds: ['missing'], loop: true }] }, { ...valid, frames: [{ ...valid.frames[0], cels: { [f.target.layerId]: 'AAAA' } }] } ];
    for (const project of invalid) { await fs.writeFile(join(f.root, 'bad.pixel.json'), JSON.stringify(project)); await expect(f.files.execute('open_project', { path: 'bad.pixel.json', current: guard(before), discardUnsaved: true })).rejects.toMatchObject({ code: 'unsupported_format' }); expect(await f.get()).toEqual(before); }
    await fs.writeFile(join(f.root, 'large.pixel.json'), ''); await fs.truncate(join(f.root, 'large.pixel.json'), PROJECT_LIMIT + 1);
    await expect(f.files.execute('open_project', { path: 'large.pixel.json', current: guard(before), discardUnsaved: true })).rejects.toMatchObject({ code: 'size_limit' }); expect(await f.get()).toEqual(before);
    const huge = { ...valid, width: 512, height: 512, layers: Array.from({ length: 16 }, (_, i) => ({ id: `l${i}`, name: 'Layer', visible: true })), frames: Array.from({ length: 64 }, (_, i) => ({ id: `f${i}`, duration: 100, cels: {} })) };
    expect(() => validateProject(huge)).toThrow('128 MiB');
  });
  it('rejects PNG dimension/inflation bombs, APNG, and invalid data before decoding', () => {
    const png = encodePng(1, 1, new Uint8Array([255, 0, 0, 128]));
    const oversized = Buffer.from(png); oversized.writeUInt32BE(100_000, 16); expect(() => importPng(oversized)).toThrow('dimensions');
    const bomb = Buffer.concat([png.subarray(0, 33), chunk('IDAT', deflateSync(Buffer.alloc(2 * 1024 * 1024))), chunk('IEND', Buffer.alloc(0))]);
    expect(() => importPng(bomb)).toThrow('scanline budget');
    const animated = Buffer.concat([png.subarray(0, 33), chunk('acTL', Buffer.alloc(8)), png.subarray(33)]); expect(() => importPng(animated)).toThrow('Animated PNG');
    const interlaced = Buffer.from(png); interlaced[28] = 1; interlaced.writeUInt32BE(crc(interlaced.subarray(12, 29)), 29);
    expect(Buffer.from(Object.values(importPng(interlaced).frames[0].cels)[0], 'base64')).toEqual(Buffer.from([255, 0, 0, 128]));
    const badCrc = Buffer.from(png); badCrc[29] ^= 255; expect(() => importPng(badCrc)).toThrow('invalid');
  });
  it('rejects oversized sprite-sheet layouts before output allocation', () => {
    const engine = new DocumentEngine(), initial = engine.newDocument({ width: 512, height: 512 });
    engine.edit({ ...guard(initial), operations: Array.from({ length: 8 }, () => ({ type: 'add_frame' })) });
    expect(() => renderSpriteSheet(engine, 9)).toThrow('4096');
  });
});
function crc(data: Buffer) { let value = 0xffffffff; for (const byte of data) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ value >>> 1 : value >>> 1; } return (value ^ 0xffffffff) >>> 0; }
function chunk(type: string, data: Buffer) { const header = Buffer.alloc(8); header.writeUInt32BE(data.length); header.write(type, 4); const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc(Buffer.concat([Buffer.from(type), data]))); return Buffer.concat([header, data, checksum]); }

describe('workspace boundary and recovery', () => {
  it('rejects traversal, absolute/drive/UNC paths, ADS and reserved filenames; accepts safe Windows separators', async () => {
    const f = await fixture(); await f.files.setWorkspace(f.root);
    for (const path of ['../escape.pixel.json', 'a\\..\\escape.pixel.json', '/absolute.pixel.json', 'C:\\escape.pixel.json', 'C:relative.pixel.json', '\\\\server\\share\\x.pixel.json', 'x:stream.pixel.json', 'NUL.pixel.json', 'a./x.pixel.json', 'a//x.pixel.json']) await expect(f.save(path)).rejects.toMatchObject({ code: 'path_denied' });
    await fs.mkdir(join(f.root, 'sprites')); await f.save('sprites\\hero.pixel.json'); expect(await fs.stat(join(f.root, 'sprites', 'hero.pixel.json'))).toBeTruthy();
    const another = new FileService(f.commands, f.data); await another.initialize(); expect(another.state().workspace).toBe(f.root);
  });
  it('rejects symlink/junction parents and hard-linked files, including a redirected root after restart', async () => {
    const f = await fixture(); await f.files.setWorkspace(f.root);
    await fs.symlink(f.outside, join(f.root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.save('linked/escaped.pixel.json')).rejects.toMatchObject({ code: 'path_denied' }); expect(await fs.readdir(f.outside)).toEqual([]);
    await fs.writeFile(join(f.outside, 'original.pixel.json'), JSON.stringify(await f.project())); await fs.link(join(f.outside, 'original.pixel.json'), join(f.root, 'hard.pixel.json'));
    await expect(f.files.execute('open_project', { path: 'hard.pixel.json', current: guard(await f.get()), discardUnsaved: true })).rejects.toMatchObject({ code: 'path_denied' });
    await fs.rename(f.root, f.root + '-original'); await fs.symlink(f.outside, f.root, process.platform === 'win32' ? 'junction' : 'dir');
    await expect(f.save()).rejects.toMatchObject({ code: 'path_denied' });
    const restarted = new FileService(f.commands, f.data); await restarted.initialize(); expect(restarted.state()).toMatchObject({ workspace: null, workspaceError: expect.any(String) });
  });
  it('rechecks folder identity after opening a staged file and writes no escaped content', async () => {
    let root = '', outside = '', swapped = false;
    const io: typeof fs = { ...fs, open: async (...args) => {
      if (!swapped && String(args[0]).includes(join('sub', '.pixel-'))) { swapped = true; await fs.rename(join(root, 'sub'), join(root, 'sub-original')); await fs.symlink(outside, join(root, 'sub'), process.platform === 'win32' ? 'junction' : 'dir'); }
      return fs.open(...args);
    } };
    const f = await fixture(io); root = f.root; outside = f.outside; await f.files.setWorkspace(root); await fs.mkdir(join(root, 'sub'));
    await expect(f.save('sub/escaped.pixel.json')).rejects.toMatchObject({ code: 'path_denied' }); expect(await fs.readdir(outside)).toEqual([]);
  });
  it('offers a validated snapshot after a crash, restores dirty artwork without history/path, and clears it on normal close', async () => {
    const f = await fixture(); const old = new RecoveryManager(f.commands, f.data); await old.initialize(); cleanup.push(() => old.finish());
    await f.edit([{ type: 'set_pixels', ...f.target, pixels: [{ x: 1, y: 1, color: '#12345678' }] }]); await old.snapshot();
    const expected = await f.project(), restartedCommands = new CommandService(), blank = await restartedCommands.newDocument({}); await restartedCommands.markSaved(guard(blank));
    const recovery = new RecoveryManager(restartedCommands, f.data); await recovery.initialize();
    expect(recovery.state()).toMatchObject({ recoveryAvailable: true, recoveryError: null });
    await recovery.restore({ current: guard(blank), discardUnsaved: true });
    expect(await restartedCommands.runFileAction(async engine => engine.exportProject())).toEqual(expected);
    expect(await restartedCommands.getDocument()).toMatchObject({ dirty: true, revision: 0, history: { undo: 0, redo: 0 } });
    await recovery.finish(); await expect(fs.stat(join(f.data, 'recovery.pixel.json'))).rejects.toMatchObject({ code: 'ENOENT' });
  });
  it('preserves unanswered or corrupt recovery snapshots rather than replacing them with the initial blank canvas', async () => {
    const f = await fixture(); const contents = '{broken recovery'; await fs.writeFile(join(f.data, 'recovery.pixel.json'), contents);
    const recovery = new RecoveryManager(f.commands, f.data); await recovery.initialize();
    expect(recovery.state()).toMatchObject({ recoveryAvailable: true, recoveryError: expect.any(String) });
    await f.edit([{ type: 'set_palette', colors: [red] }]); await recovery.snapshot(); await recovery.finish();
    expect(await fs.readFile(join(f.data, 'recovery.pixel.json'), 'utf8')).toBe(contents);
  });
});
