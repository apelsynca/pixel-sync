import * as fs from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import { CommandService } from '../application/commands';
import { renderPreview } from '../application/inspection';
import { fail, guardSchema, parse, replacementSchema } from '../core/schema';
import { PROJECT_LIMIT } from '../core/project';
import { atomicExport, atomicWrite, fileFailure, nativeTicket, readBounded, workspaceTicket, type FileIO } from './paths';
import { encodePng, importPng, PNG_FILE_LIMIT, renderSpriteSheet } from './images';

const path = z.string().min(1).max(1024);
export const openProjectSchema = replacementSchema.extend({ path });
export const saveProjectSchema = guardSchema.extend({ path, overwrite: z.boolean().default(false) });
export const exportPngSchema = saveProjectSchema.extend({ frameId: z.string().min(1).max(128) });
export const exportSheetSchema = guardSchema.extend({ path, columns: z.number().int().min(1).max(64).optional() });
export type FileAction = 'open_project' | 'save_project' | 'import_png' | 'export_png' | 'export_sprite_sheet';
type FileArgs = z.infer<typeof openProjectSchema> | z.infer<typeof saveProjectSchema> | z.infer<typeof exportPngSchema> | z.infer<typeof exportSheetSchema>;
export interface FileState { documentId: string | null; projectPath: string | null; workspace: string | null; workspaceError: string | null }
export class FileService {
  private workspace: string | null = null;
  private workspaceError: string | null = null;
  private projectPath: string | null = null;
  private projectId: string | null = null;
  private readonly listeners = new Set<() => void>();
  constructor(private readonly commands: CommandService, private readonly directory: string, private readonly io: FileIO = fs) {
    commands.subscribe(event => { if (event.document.documentId !== this.projectId && this.projectPath) { this.projectPath = null; this.projectId = null; this.changed(); } });
  }
  async initialize() {
    await this.io.mkdir(this.directory, { recursive: true, mode: 0o700 });
    try {
      const bytes = await readBounded(nativeTicket(join(this.directory, 'workspace.json')), 4096, this.io);
      const config = z.strictObject({ root: z.string().nullable() }).parse(JSON.parse(bytes.toString('utf8')));
      if (config.root) { const root = await this.io.realpath(config.root); if (!(await this.io.lstat(config.root)).isDirectory() || (process.platform === 'win32' ? root.toLowerCase() !== config.root.toLowerCase() : root !== config.root)) throw new Error('Workspace redirected'); this.workspace = root; }
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') this.workspaceError = 'Saved workspace is unavailable. Choose a workspace folder again.'; }
  }
  state(): FileState { return { documentId: this.projectId, projectPath: this.projectPath, workspace: this.workspace, workspaceError: this.workspaceError }; }
  hasWorkspace() { return this.workspace !== null; }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) { try { listener(); } catch { /* View errors do not fail file operations. */ } } }
  async setWorkspace(root: string | null) {
    await this.commands.runFileAction(async () => fileFailure(async () => {
      let canonical: string | null = null;
      if (root) { canonical = await this.io.realpath(root); if (!(await this.io.stat(canonical)).isDirectory()) fail('path_denied', 'Choose a workspace folder'); }
      await atomicWrite(nativeTicket(join(this.directory, 'workspace.json')), JSON.stringify({ root: canonical }), true, this.io);
      this.workspace = canonical; this.workspaceError = null; this.changed();
    }));
    return this.state();
  }
  execute(action: FileAction, input: unknown, signal?: AbortSignal) { return this.run(action, input, false, signal); }
  executeNative(action: FileAction, input: unknown) { return this.run(action, input, true); }
  private run(action: FileAction, input: unknown, native: boolean, signal?: AbortSignal) {
    const request = structuredClone(input), root = this.workspace;
    return this.commands.runFileAction(async engine => fileFailure(async () => {
      if (!native && root !== this.workspace) fail('path_denied', 'Workspace changed while this command was queued; retry');
      const schema = action === 'open_project' || action === 'import_png' ? openProjectSchema : action === 'export_png' ? exportPngSchema : action === 'export_sprite_sheet' ? exportSheetSchema : saveProjectSchema;
      const args = parse<FileArgs>(schema, request);
      const ticket = native ? nativeTicket(args.path) : await workspaceTicket(root, args.path, this.io);
      const check = ticket.check;
      ticket.check = async () => { if (signal?.aborted) fail('cancelled', 'File operation cancelled before publication'); await check(); if (signal?.aborted) fail('cancelled', 'File operation cancelled before publication'); };
      const extension = action === 'open_project' || action === 'save_project' ? '.pixel.json' : action === 'import_png' || action === 'export_png' ? '.png' : null;
      if (extension && !args.path.toLowerCase().endsWith(extension)) fail('unsupported_format', `Use a ${extension} filename`);
      if (action === 'open_project' || action === 'import_png') {
        const replacement = parse(openProjectSchema, args);
        engine.assertReplacement({ current: replacement.current, discardUnsaved: replacement.discardUnsaved });
        const bytes = await readBounded(ticket, action === 'open_project' ? PROJECT_LIMIT : PNG_FILE_LIMIT, this.io);
        let project: unknown;
        if (action === 'import_png') project = importPng(bytes);
        else { try { project = JSON.parse(bytes.toString('utf8')); } catch { fail('unsupported_format', 'Project is not valid JSON'); } }
        await ticket.check();
        const document = engine.replaceProject(project, { current: replacement.current, discardUnsaved: replacement.discardUnsaved }, action === 'import_png');
        this.projectPath = action === 'open_project' ? ticket.path : null; this.projectId = document.documentId; this.changed();
        return { document, path: args.path };
      }
      const guarded = parse(guardSchema, { documentId: 'documentId' in args ? args.documentId : undefined, expectedRevision: 'expectedRevision' in args ? args.expectedRevision : undefined });
      engine.assertRevision(guarded);
      if (action === 'save_project') {
        const save = parse(saveProjectSchema, args), text = JSON.stringify(engine.exportProject()) + '\n';
        if (Buffer.byteLength(text) > PROJECT_LIMIT) fail('size_limit', 'Serialized project exceeds 192 MiB');
        await atomicWrite(ticket, text, save.overwrite, this.io);
        const document = engine.markSaved(guarded);
        this.projectPath = ticket.path; this.projectId = document.documentId; this.changed();
        return { document, path: args.path };
      }
      if (action === 'export_png') {
        const png = parse(exportPngSchema, args), preview = renderPreview(engine, { ...guarded, frameIds: [png.frameId], columns: 1, scale: 1 });
        await atomicWrite(ticket, encodePng(preview.width, preview.height, preview.pixels), png.overwrite, this.io);
        return { ...guarded, revision: preview.revision, path: args.path, frameId: png.frameId, width: preview.width, height: preview.height };
      }
      const sheet = renderSpriteSheet(engine, parse(exportSheetSchema, args).columns);
      await atomicExport(ticket, sheet.png, sheet.metadata, this.io);
      return { documentId: guarded.documentId, revision: guarded.expectedRevision, path: args.path, files: ['sheet.png', 'sheet.json'], frameCount: sheet.metadata.frameCount, columns: sheet.metadata.columns, rows: sheet.metadata.rows };
    }), signal);
  }
}
