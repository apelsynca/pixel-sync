import { randomUUID } from 'node:crypto';
import { composite, flood, line, paint, rgba } from './drawing';
import { batchSchema, fail, guardSchema, LIMITS, newDocumentSchema, parse, pixelReadSchema, type Guard, type Operation } from './schema';

export interface Layer { id: string; name: string; visible: boolean }
export interface Frame { id: string; duration: number }
export interface Clip { name: string; frameIds: string[]; loop: boolean }
interface Metadata { layers: Layer[]; frames: Frame[]; clips: Clip[]; palette: string[] }
interface State extends Metadata { cels: Map<string, Map<string, Uint8Array>> }
interface Patch { frameId: string; layerId: string; offset: number; before?: Uint8Array; after?: Uint8Array }
interface Entry { before: Metadata; after: Metadata; patches: Patch[]; bytes: number; beforeVersion: number; afterVersion: number }
export interface DocumentInfo extends Metadata {
  documentId: string; revision: number; width: number; height: number; dirty: boolean;
  history: { undo: number; redo: number; bytes: number }; limits: typeof LIMITS;
}
export interface Change {
  document: DocumentInfo;
  changed: { frameId: string; layerId: string; bounds: { x: number; y: number; width: number; height: number } }[];
  createdIds: string[];
  summary: string;
}
const metadata = (state: Metadata): Metadata => structuredClone({ layers: state.layers, frames: state.frames, clips: state.clips, palette: state.palette });
const reorder = <T>(array: T[], index: number, destination: number) => {
  if (destination >= array.length) fail('invalid_arguments', 'Destination index is outside the list');
  array.splice(destination, 0, array.splice(index, 1)[0]);
};

/** Owns all buffers. No method returns an internal mutable reference. */
export class DocumentEngine {
  private state: State | null = null;
  private documentId = '';
  private revision = 0;
  private width = 0;
  private height = 0;
  private undoEntries: Entry[] = [];
  private redoEntries: Entry[] = [];
  private historyBytes = 0;
  private version = 0;
  private nextVersion = 0;
  private savedVersion = 0;

  getDocument(): DocumentInfo | null {
    if (!this.state) return null;
    return { ...metadata(this.state), documentId: this.documentId, revision: this.revision, width: this.width, height: this.height, dirty: this.version !== this.savedVersion,
      history: { undo: this.undoEntries.length, redo: this.redoEntries.length, bytes: this.historyBytes }, limits: LIMITS };
  }
  private requireState(): State { return this.state ?? fail('missing_document', 'Create a document first'); }
  private check(guard: Guard) {
    this.requireState();
    if (guard.documentId !== this.documentId || guard.expectedRevision !== this.revision) fail('stale_revision', 'Document identity or revision changed; read the document and retry');
  }
  assertRevision(input: unknown): void { this.check(parse(guardSchema, input)); }
  newDocument(input: unknown): DocumentInfo {
    const args = parse(newDocumentSchema, input);
    if (this.state) {
      if (!args.current) fail('stale_revision', 'Replacement requires the current document identity and revision');
      this.check(args.current);
      if (this.version !== this.savedVersion && !args.discardUnsaved) fail('unsaved_document', 'Replacement requires discardUnsaved or a prior save');
    } else if (args.current) fail('stale_revision', 'There is no current document to replace');
    const layerId = randomUUID(), frameId = randomUUID();
    this.width = args.width; this.height = args.height; this.documentId = randomUUID(); this.revision = 0;
    this.state = { layers: [{ id: layerId, name: 'Layer 1', visible: true }], frames: [{ id: frameId, duration: 100 }], clips: [], palette: [], cels: new Map([[frameId, new Map([[layerId, new Uint8Array(this.width * this.height * 4)]])]]) };
    this.undoEntries = []; this.redoEntries = []; this.historyBytes = 0;
    this.version = ++this.nextVersion; this.savedVersion = 0;
    return this.getDocument()!;
  }
  /** Called only after a persistence adapter has successfully saved this revision. */
  markSaved(input: unknown): DocumentInfo {
    this.check(parse(guardSchema, input)); this.savedVersion = this.version; return this.getDocument()!;
  }
  edit(input: unknown): Change {
    // Bound the aggregate before Zod clones individual supplied pixel objects.
    if (input && typeof input === 'object' && 'operations' in input && Array.isArray(input.operations) && input.operations.length <= LIMITS.operations) {
      let supplied = 0;
      for (const operation of input.operations) {
        if (operation && typeof operation === 'object' && operation.type === 'set_pixels' && Array.isArray(operation.pixels)) supplied += operation.pixels.length;
        if (supplied > LIMITS.suppliedPixels) fail('size_limit', 'Batch supplied pixel limit exceeded');
      }
    }
    const args = parse(batchSchema, input);
    this.check(args);
    const before = this.requireState();
    const stage: State = { ...metadata(before), cels: new Map([...before.cels].map(([id, cels]) => [id, new Map(cels)])) };
    const writable = new Set<Uint8Array>();
    const createdIds: string[] = [];
    let allocated = 0, supplied = 0;
    const allocate = (source?: Uint8Array) => {
      const bytes = this.width * this.height * 4;
      if (allocated + bytes > LIMITS.staging) fail('size_limit', 'Batch exceeds staged pixel memory limit; use smaller batches');
      allocated += bytes;
      const buffer = source ? source.slice() : new Uint8Array(bytes);
      writable.add(buffer); return buffer;
    };
    const checkSize = (frames: number, layers: number) => {
      if (frames > LIMITS.frames || layers > LIMITS.layers || frames * layers * this.width * this.height * 4 > LIMITS.pixels) fail('size_limit', 'Document frame, layer, or decoded pixel limit exceeded');
    };
    const frame = (id: string) => stage.frames.find(item => item.id === id) ?? fail('missing_frame', `Unknown frame: ${id}`);
    const layer = (id: string) => stage.layers.find(item => item.id === id) ?? fail('missing_layer', `Unknown layer: ${id}`);
    const pixels = (frameId: string, layerId: string) => {
      frame(frameId); layer(layerId);
      const cels = stage.cels.get(frameId)!;
      let buffer = cels.get(layerId)!;
      if (!writable.has(buffer)) { buffer = allocate(buffer); cels.set(layerId, buffer); }
      return buffer;
    };
    const freshId = (requested?: string) => {
      const id = requested ?? randomUUID();
      if (stage.frames.some(item => item.id === id) || stage.layers.some(item => item.id === id)) fail('invalid_arguments', `ID already exists: ${id}`);
      createdIds.push(id); return id;
    };
    for (const op of args.operations) {
      switch (op.type) {
        case 'add_layer': {
          checkSize(stage.frames.length, stage.layers.length + 1);
          const id = freshId(op.id);
          stage.layers.push({ id, name: op.name, visible: true });
          for (const cels of stage.cels.values()) cels.set(id, allocate());
          break;
        }
        case 'rename_layer': layer(op.layerId).name = op.name; break;
        case 'set_layer_visibility': layer(op.layerId).visible = op.visible; break;
        case 'move_layer': { const item = layer(op.layerId); reorder(stage.layers, stage.layers.indexOf(item), op.index); break; }
        case 'delete_layer': {
          const item = layer(op.layerId);
          if (stage.layers.length === 1) fail('invalid_arguments', 'Retain at least one layer');
          stage.layers.splice(stage.layers.indexOf(item), 1);
          for (const cels of stage.cels.values()) cels.delete(op.layerId);
          break;
        }
        case 'add_frame': case 'duplicate_frame': {
          checkSize(stage.frames.length + 1, stage.layers.length);
          const source = op.type === 'duplicate_frame' ? frame(op.frameId) : undefined;
          const id = freshId(op.id);
          stage.frames.push({ id, duration: source?.duration ?? (op.type === 'add_frame' ? op.duration : undefined) ?? 100 });
          stage.cels.set(id, new Map(stage.layers.map(item => [item.id, allocate(source ? stage.cels.get(source.id)!.get(item.id) : undefined)])));
          break;
        }
        case 'delete_frame': {
          const item = frame(op.frameId);
          if (stage.frames.length === 1) fail('invalid_arguments', 'Retain at least one frame');
          stage.frames.splice(stage.frames.indexOf(item), 1); stage.cels.delete(item.id); break;
        }
        case 'move_frame': { const item = frame(op.frameId); reorder(stage.frames, stage.frames.indexOf(item), op.index); break; }
        case 'set_frame_duration': frame(op.frameId).duration = op.duration; break;
        case 'set_palette': stage.palette = op.colors.map(value => value.toUpperCase()); break;
        case 'set_clip': {
          if (new Set(op.frameIds).size !== op.frameIds.length) fail('invalid_arguments', 'Clip frame IDs must be distinct');
          const index = stage.clips.findIndex(item => item.name === op.name);
          const clip = { name: op.name, frameIds: [...op.frameIds], loop: op.loop };
          if (index < 0) {
            if (stage.clips.length === LIMITS.clips) fail('size_limit', 'Clip limit exceeded');
            stage.clips.push(clip);
          } else stage.clips[index] = clip;
          break;
        }
        case 'delete_clip': {
          const index = stage.clips.findIndex(item => item.name === op.name);
          if (index < 0) fail('invalid_arguments', `Unknown clip: ${op.name}`);
          stage.clips.splice(index, 1); break;
        }
        default: {
          if (op.type === 'set_pixels') {
            supplied += op.pixels.length;
            if (supplied > LIMITS.suppliedPixels) fail('size_limit', 'Batch supplied pixel limit exceeded');
          }
          this.draw(pixels(op.frameId, op.layerId), op);
        }
      }
    }
    // References are validated on the final state, allowing clip repair and frame
    // deletion in either order within one transaction.
    for (const clip of stage.clips) for (const id of clip.frameIds) frame(id);
    const entry = this.diff(before, stage);
    if (entry.patches.length === 0 && JSON.stringify(entry.before) === JSON.stringify(entry.after)) {
      return { document: this.getDocument()!, changed: [], createdIds, summary: 'No changes' };
    }
    // Every accepted edit must remain undoable. Reject before publication if its
    // inverse alone exceeds the bounded history rather than silently losing it.
    if (entry.bytes > LIMITS.history) fail('size_limit', 'Edit exceeds undo memory limit; use smaller batches');
    entry.beforeVersion = this.version; entry.afterVersion = ++this.nextVersion;
    this.state = stage; this.version = entry.afterVersion; this.revision++;
    this.historyBytes -= this.redoEntries.reduce((sum, item) => sum + item.bytes, 0); this.redoEntries = [];
    this.undoEntries.push(entry); this.historyBytes += entry.bytes;
    while (this.historyBytes > LIMITS.history || this.undoEntries.length > 1024) this.historyBytes -= this.undoEntries.shift()!.bytes;
    return this.result(entry, createdIds, `Applied ${args.operations.length} operation(s)`);
  }
  private draw(buffer: Uint8Array, op: Extract<Operation, { frameId: string; layerId: string }>) {
    const put = (x: number, y: number, color: string) => paint(buffer, this.width, this.height, x, y, rgba(color));
    switch (op.type) {
      case 'clear_layer': buffer.fill(0); break;
      case 'set_pixels': for (const pixel of op.pixels) put(pixel.x, pixel.y, pixel.color); break;
      case 'draw_line': { const color = rgba(op.color); line(op.x1, op.y1, op.x2, op.y2, (x, y) => paint(buffer, this.width, this.height, x, y, color)); break; }
      case 'fill': flood(buffer, this.width, this.height, op.x, op.y, rgba(op.color)); break;
      case 'draw_rectangle': {
        const left = Math.min(op.x1, op.x2), right = Math.max(op.x1, op.x2), top = Math.min(op.y1, op.y2), bottom = Math.max(op.y1, op.y2);
        for (let y = Math.max(0, top); y <= Math.min(this.height - 1, bottom); y++) {
          for (let x = Math.max(0, left); x <= Math.min(this.width - 1, right); x++) {
            if (op.filled || x === left || x === right || y === top || y === bottom) put(x, y, op.color);
          }
        }
        break;
      }
    }
  }
  private diff(before: State, after: State): Entry {
    const entry: Entry = { before: metadata(before), after: metadata(after), patches: [], bytes: 0, beforeVersion: 0, afterVersion: 0 };
    // Conservative UTF-16 accounting plus per-patch bookkeeping; buffers exact.
    entry.bytes = 2 * (JSON.stringify(entry.before).length + JSON.stringify(entry.after).length) + 128;
    for (const frameId of new Set([...before.cels.keys(), ...after.cels.keys()])) {
      const previous = before.cels.get(frameId), next = after.cels.get(frameId);
      for (const layerId of new Set([...(previous?.keys() ?? []), ...(next?.keys() ?? [])])) {
        const a = previous?.get(layerId), b = next?.get(layerId);
        if (a === b) continue;
        let start = 0, end = (a ?? b)!.length;
        if (a && b) {
          while (start < end && a[start] === b[start]) start++;
          while (end > start && a[end - 1] === b[end - 1]) end--;
          if (start === end) continue;
        }
        entry.bytes += (end - start) * (Number(!!a) + Number(!!b)) + 128 + 2 * (frameId.length + layerId.length);
        // Stop before allocating more inverse buffers than history can retain.
        if (entry.bytes > LIMITS.history) fail('size_limit', 'Edit exceeds undo memory limit; use smaller batches');
        entry.patches.push({ frameId, layerId, offset: start, before: a?.slice(start, end), after: b?.slice(start, end) });
      }
    }
    return entry;
  }
  undo(input: unknown): Change { return this.travel(input, false); }
  redo(input: unknown): Change { return this.travel(input, true); }
  private travel(input: unknown, forward: boolean): Change {
    this.check(parse(guardSchema, input));
    const source = forward ? this.redoEntries : this.undoEntries, destination = forward ? this.undoEntries : this.redoEntries;
    const entry = source.at(-1) ?? fail('empty_history', `Nothing to ${forward ? 'redo' : 'undo'}`);
    const state = this.requireState(), target = forward ? entry.after : entry.before;
    const next: State = { ...metadata(target), cels: new Map(target.frames.map(frame => {
      const cels = new Map<string, Uint8Array>();
      for (const layer of target.layers) {
        const buffer = state.cels.get(frame.id)?.get(layer.id);
        if (buffer) cels.set(layer.id, buffer);
      }
      return [frame.id, cels];
    })) };
    for (const patch of entry.patches) {
      const value = forward ? patch.after : patch.before;
      if (!value) continue; // Deleted cels are already excluded by target metadata.
      const cels = next.cels.get(patch.frameId)!;
      const buffer = cels.get(patch.layerId)?.slice() ?? new Uint8Array(this.width * this.height * 4);
      buffer.set(value, patch.offset); cels.set(patch.layerId, buffer);
    }
    source.pop(); destination.push(entry); this.state = next; this.revision++;
    this.version = forward ? entry.afterVersion : entry.beforeVersion;
    return this.result(entry, [], forward ? 'Redo' : 'Undo');
  }
  private result(entry: Entry, createdIds: string[], summary: string): Change {
    return { document: this.getDocument()!, createdIds, summary, changed: entry.patches.map(patch => {
      const first = Math.floor(patch.offset / 4), last = Math.floor((patch.offset + Math.max(patch.before?.length ?? 0, patch.after?.length ?? 0) - 1) / 4);
      const y = Math.floor(first / this.width), endY = Math.floor(last / this.width);
      return { frameId: patch.frameId, layerId: patch.layerId, bounds: { x: y === endY ? first % this.width : 0, y, width: y === endY ? last - first + 1 : this.width, height: endY - y + 1 } };
    }) };
  }
  getPixels(input: unknown): Uint8Array {
    const state = this.requireState();
    const { x, y, width, height, frameId, layerId } = parse(pixelReadSchema, input);
    if (x + width > this.width || y + height > this.height) fail('invalid_arguments', 'Read region must lie inside the canvas');
    if (width * height > LIMITS.suppliedPixels) fail('size_limit', 'Read pixel limit exceeded');
    const cels = state.cels.get(frameId) ?? fail('missing_frame', `Unknown frame: ${frameId}`);
    const buffers = layerId === undefined ? state.layers.filter(layer => layer.visible).map(layer => cels.get(layer.id)!) : [cels.get(layerId) ?? fail('missing_layer', `Unknown layer: ${layerId}`)];
    const regions = buffers.map(buffer => {
      const region = new Uint8Array(width * height * 4);
      for (let row = 0; row < height; row++) { const start = ((y + row) * this.width + x) * 4; region.set(buffer.subarray(start, start + width * 4), row * width * 4); }
      return region;
    });
    return layerId === undefined ? composite(width, height, regions) : regions[0];
  }
}
