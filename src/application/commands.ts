import { DocumentEngine, type Change, type DocumentInfo } from '../core/document';
import { DocumentError, type Operation } from '../core/schema';

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
  private enqueue<T>(action: () => T | Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.then(() => undefined, () => undefined);
    return result;
  }
  private notify(event: DocumentEvent) {
    for (const listener of this.listeners) {
      // A faulty view must not change a committed command's success or block peers.
      try { listener(structuredClone(event)); } catch { /* subscriber owns its errors */ }
    }
  }
  getDocument() { return this.enqueue(() => this.engine.getDocument()); }
  getPixels(input: Parameters<DocumentEngine['getPixels']>[0]) {
    const request = structuredClone(input); return this.enqueue(() => this.engine.getPixels(request));
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
  newDocument(input: unknown) {
    const request = structuredClone(input);
    return this.enqueue(() => { const document = this.engine.newDocument(request); this.notify({ document }); return document; });
  }
  edit(input: unknown) { return this.mutate('edit', input); }
  undo(input: unknown) { return this.mutate('undo', input); }
  redo(input: unknown) { return this.mutate('redo', input); }
  private mutate(method: 'edit' | 'undo' | 'redo', input: unknown) {
    const request = structuredClone(input);
    return this.enqueue(() => { const change = this.engine[method](request); if (change.summary !== 'No changes') this.notify({ document: change.document, change }); return change; });
  }
  markSaved(input: unknown) {
    const request = structuredClone(input);
    return this.enqueue(() => { const document = this.engine.markSaved(request); this.notify({ document }); return document; });
  }
}
