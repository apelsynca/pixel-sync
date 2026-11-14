import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { CommandService } from '../application/commands';
import { PROJECT_LIMIT, validateProject, type ProjectFile } from '../core/project';
import { fail } from '../core/schema';
import { atomicWrite, nativeTicket, readBounded } from './paths';

export class RecoveryManager {
  private candidate: ProjectFile | null = null;
  private pending = false;
  private error: string | null = null;
  private stopped = false;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private writes: Promise<void> = Promise.resolve();
  private readonly path: string;
  private readonly unsubscribe: () => void;
  constructor(private readonly commands: CommandService, directory: string, private readonly changed: () => void = () => undefined) {
    this.path = join(directory, 'recovery.pixel.json');
    this.unsubscribe = commands.subscribe(event => {
      if (this.pending || this.stopped) return;
      clearTimeout(this.timer);
      if (event.document.dirty) this.timer = setTimeout(() => { void this.snapshot(); }, 500);
      else this.append(async () => { await fs.rm(this.path, { force: true }); });
    });
  }
  async initialize() {
    try {
      const bytes = await readBounded(nativeTicket(this.path), PROJECT_LIMIT);
      this.pending = true;
      this.candidate = validateProject(JSON.parse(bytes.toString('utf8')));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') { this.pending = true; this.error = 'The recovery snapshot cannot be read. It remains on disk until you discard it.'; }
    }
    this.changed();
  }
  state() { return { recoveryAvailable: this.pending, recoveryError: this.error }; }
  private append(action: () => Promise<void>) {
    this.writes = this.writes.then(async () => { await action(); if (this.error && !this.pending) { this.error = null; this.changed(); } }).catch(() => { this.error = 'The latest recovery snapshot could not be written. Save your project to a file.'; this.changed(); });
    return this.writes;
  }
  snapshot() {
    clearTimeout(this.timer);
    return this.append(async () => {
      if (this.pending || this.stopped) return;
      await this.commands.runFileAction(async engine => {
        if (!engine.getDocument()?.dirty || this.pending || this.stopped) return;
        const text = JSON.stringify(engine.exportProject()) + '\n';
        if (Buffer.byteLength(text) > PROJECT_LIMIT) fail('size_limit', 'Recovery snapshot exceeds project size limit');
        await atomicWrite(nativeTicket(this.path), text, true);
      });
    });
  }
  async restore(replacement: unknown) {
    if (!this.candidate) fail('unsupported_format', 'No readable recovery snapshot is available');
    const project = this.candidate;
    const document = await this.commands.runFileAction(async engine => engine.replaceProject(project, replacement, true));
    this.pending = false; this.candidate = null; this.error = null; this.changed();
    await this.snapshot(); return document;
  }
  async discard() {
    await fs.rm(this.path, { force: true });
    this.pending = false; this.candidate = null; this.error = null; this.changed();
    if ((await this.commands.getDocument())?.dirty) await this.snapshot();
  }
  async finish() {
    this.stopped = true; this.unsubscribe(); clearTimeout(this.timer); await this.writes;
    // An unanswered startup offer must survive closing the app.
    if (!this.pending) await fs.rm(this.path, { force: true });
  }
}
