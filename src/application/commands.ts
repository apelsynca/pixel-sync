import { DocumentEngine, type Change, type DocumentInfo } from '../core/document';
import { DocumentError, type Operation } from '../core/schema';
import { z } from 'zod';
import { guardSchema, parse } from '../core/schema';
import { composite } from '../core/drawing';
import type { FramePixels } from '../shared/api';
import { animationPreviewSchema, inspectDocument, inspectPixelsSchema, previewSchema, renderPreview } from './inspection';

export type DocumentEvent = { document: DocumentInfo; change?: Change };
export interface Gesture {
  commit(operations: Operation[]): Promise<Change>;
  cancel(): void;
}
/** Shared serialization boundary for future IPC and MCP adapters. Submit an entire
 * pointer gesture as one edit; never expose staged state between its operations. */
export class CommandService {
  private readonly engine = new DocumentEngine();
  private queue: Promise<unknown> = Promise.resolve();
  private readonly listeners = new Set<(event: DocumentEvent) => void>();
  subscribe(listener: (event: DocumentEvent) => void): () => void {
    this.listeners.add(listener); return () => { this.listeners.delete(listener); };
  }
  private enqueue<T>(action: () => T | Promise<T>, signal?: AbortSignal): Promise<T> {
    const result = this.queue.then(() => { if (signal?.aborted) throw new DocumentError('cancelled', 'Command cancelled before execution'); return action(); });
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private notify(event: DocumentEvent) {
    for (const listener of this.listeners) {
      // A faulty view must not change a committed command's success or block peers.
      try { listener(structuredClone(event)); } catch { /* subscriber owns its errors */ }
    }
  }
  getDocument(signal?: AbortSignal) { return this.enqueue(() => this.engine.getDocument(), signal); }
  inspectPixels(input: unknown, signal?: AbortSignal) {
    const request = structuredClone(input);
    return this.enqueue(() => {
      const args = parse(inspectPixelsSchema, request), document = inspectDocument(this.engine, args);
      const { frameId, layerId, x, y, width, height } = args;
      return { documentId: document.documentId, revision: document.revision, frameId, layerId: layerId ?? null, x, y, width, height,
        pixels: this.engine.getPixels({ frameId, layerId, x, y, width, height }) };
    }, signal);
  }
  getPreview(input: unknown, signal?: AbortSignal) {
    const request = structuredClone(input);
    return this.enqueue(() => { const args = parse(previewSchema, request); return renderPreview(this.engine, { ...args, frameIds: [args.frameId], columns: 1 }); }, signal);
  }
  getAnimationPreview(input: unknown, signal?: AbortSignal) {
    const request = structuredClone(input);
    return this.enqueue(() => renderPreview(this.engine, parse(animationPreviewSchema, request)), signal);
  }
  getPixels(input: Parameters<DocumentEngine['getPixels']>[0]) {
    const request = structuredClone(input); return this.enqueue(() => this.engine.getPixels(request));
  }
  getFrame(input: unknown): Promise<FramePixels> {
    const request = structuredClone(input);
    return this.enqueue(() => {
      const args = parse(guardSchema.extend({ frameId: z.string().min(1).max(128), allLayers: z.boolean().default(false) }), request);
      this.engine.assertRevision({ documentId: args.documentId, expectedRevision: args.expectedRevision });
      const document = this.engine.getDocument()!;
      if (!document.frames.some(frame => frame.id === args.frameId)) throw new DocumentError('missing_frame', 'Frame no longer exists');
      const layers = document.layers.map(layer => {
        const pixels = new Uint8Array(document.width * document.height * 4);
        const bandHeight = Math.floor(65_536 / document.width);
        for (let y = 0; y < document.height; y += bandHeight) {
          const height = Math.min(bandHeight, document.height - y);
          pixels.set(this.engine.getPixels({ frameId: args.frameId, layerId: layer.id, x: 0, y, width: document.width, height }), y * document.width * 4);
        }
        return { id: layer.id, visible: layer.visible, pixels };
      });
      return { documentId: document.documentId, revision: document.revision, frameId: args.frameId, width: document.width, height: document.height,
        layers: args.allLayers ? layers : [{ id: 'composite', visible: true, pixels: composite(document.width, document.height, layers.filter(layer => layer.visible).map(layer => layer.pixels)) }] };
    });
  }
  /** Reserve the queue on pointer-down; commit one atomic batch on pointer-up.
   * The owning view must cancel on pointer cancellation or window teardown. */
  beginGesture(input: unknown): Promise<Gesture> {
    const request = structuredClone(input);
    let ready!: (gesture: Gesture) => void;
    let reject!: (error: unknown) => void;
    const result = new Promise<Gesture>((resolve, fail) => { ready = resolve; reject = fail; });
    void this.enqueue(async () => {
      this.engine.assertRevision(request);
      await new Promise<void>(release => {
        let closed = false;
        ready({
          commit: async operations => {
            if (closed) throw new DocumentError('invalid_arguments', 'Gesture already committed or cancelled');
            closed = true;
            try {
              // Guard was validated above; the engine still rechecks it on commit.
              const change = this.engine.edit({ ...(request as object), operations: structuredClone(operations) });
              if (change.summary !== 'No changes') this.notify({ document: change.document, change });
              return change;
            } finally { release(); }
          },
          cancel: () => { if (!closed) { closed = true; release(); } },
        });
      });
    }).catch(reject);
    return result;
  }
  newDocument(input: unknown, signal?: AbortSignal) {
    const request = structuredClone(input);
    return this.enqueue(() => { const document = this.engine.newDocument(request); this.notify({ document }); return document; }, signal);
  }
  edit(input: unknown, signal?: AbortSignal) { return this.mutate('edit', input, signal); }
  undo(input: unknown, signal?: AbortSignal) { return this.mutate('undo', input, signal); }
  redo(input: unknown, signal?: AbortSignal) { return this.mutate('redo', input, signal); }
  private mutate(method: 'edit' | 'undo' | 'redo', input: unknown, signal?: AbortSignal) {
    const request = structuredClone(input);
    return this.enqueue(() => { const change = this.engine[method](request); if (change.summary !== 'No changes') this.notify({ document: change.document, change }); return change; }, signal);
  }
  markSaved(input: unknown) {
    const request = structuredClone(input);
    return this.enqueue(() => { const document = this.engine.markSaved(request); this.notify({ document }); return document; });
  }
}
