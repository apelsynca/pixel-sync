import { dialog, type BrowserWindow } from 'electron';
import { basename, join } from 'node:path';
import { z } from 'zod';
import { CommandService } from '../application/commands';
import { fail, parse, type Guard } from '../core/schema';
import { FileService } from '../persistence/files';
import { RecoveryManager } from '../persistence/recovery';
import { exists, relativeName } from '../persistence/paths';

const guard = (document: { documentId: string; revision: number }): Guard => ({ documentId: document.documentId, expectedRevision: document.revision });
export class FileDialogs {
  constructor(private commands: CommandService, private files: FileService, private recovery: RecoveryManager, private window: () => BrowserWindow, private cancelGesture: () => void) {}
  private async approveAppendedPath(selected: string, actual: string) {
    if (selected === actual || !await exists(actual)) return true;
    const answer = await dialog.showMessageBox(this.window(), { type: 'question', message: 'Replace the existing file?', detail: basename(actual), buttons: ['Replace', 'Cancel'], defaultId: 1, cancelId: 1 });
    return answer.response === 0;
  }
  async save(saveAs = false): Promise<boolean> {
    this.cancelGesture();
    const document = await this.commands.getDocument(); if (!document) return false;
    let path = this.files.state().documentId === document.documentId ? this.files.state().projectPath : null;
    if (!path || saveAs) {
      const chosen = await dialog.showSaveDialog(this.window(), { title: 'Save Pixel Editor project', defaultPath: path ?? 'Untitled.pixel.json', filters: [{ name: 'Pixel Editor project', extensions: ['pixel.json'] }], properties: ['showOverwriteConfirmation'] });
      if (chosen.canceled || !chosen.filePath) return false;
      path = chosen.filePath.toLowerCase().endsWith('.pixel.json') ? chosen.filePath : chosen.filePath + '.pixel.json';
      if (!await this.approveAppendedPath(chosen.filePath, path)) return false;
    }
    await this.files.executeNative('save_project', { ...guard(document), path, overwrite: true }); return true;
  }
  async confirmReplacement(): Promise<Guard | undefined> {
    this.cancelGesture();
    const current = await this.commands.getDocument(); if (!current) return undefined;
    if (!current.dirty) return guard(current);
    const answer = await dialog.showMessageBox(this.window(), { type: 'question', message: 'Save your changes before continuing?', detail: 'Keep the layers, pixels and animation in a Pixel Editor project.', buttons: ['Save', 'Discard', 'Cancel'], defaultId: 0, cancelId: 2 });
    if (answer.response === 2) return undefined;
    if (answer.response === 1) return guard(current);
    if (!await this.save()) return undefined;
    const saved = (await this.commands.getDocument())!;
    if (saved.dirty) fail('stale_revision', 'Artwork changed while saving. Try the action again.');
    return guard(saved);
  }
  async newDocument(input: unknown) {
    const dimensions = parse(z.strictObject({ width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512) }), input);
    const current = await this.confirmReplacement();
    if (!current) return this.commands.getDocument();
    return this.commands.newDocument({ ...dimensions, current, discardUnsaved: true });
  }
  async open(png = false) {
    const chosen = await dialog.showOpenDialog(this.window(), { title: png ? 'Import PNG' : 'Open Pixel Editor project', properties: ['openFile'], filters: [{ name: png ? 'PNG image' : 'Pixel Editor project', extensions: png ? ['png'] : ['pixel.json'] }] });
    if (chosen.canceled || !chosen.filePaths[0]) return;
    const current = await this.confirmReplacement(); if (!current) return;
    await this.files.executeNative(png ? 'import_png' : 'open_project', { path: chosen.filePaths[0], current, discardUnsaved: true });
  }
  async exportPng(input: unknown) {
    const frameId = parse(z.string().min(1).max(128), input), document = await this.commands.getDocument(); if (!document) return;
    const chosen = await dialog.showSaveDialog(this.window(), { title: 'Export current frame as PNG', defaultPath: 'sprite.png', filters: [{ name: 'PNG image', extensions: ['png'] }], properties: ['showOverwriteConfirmation'] });
    if (chosen.canceled || !chosen.filePath) return;
    const path = chosen.filePath.toLowerCase().endsWith('.png') ? chosen.filePath : chosen.filePath + '.png';
    if (!await this.approveAppendedPath(chosen.filePath, path)) return;
    await this.files.executeNative('export_png', { ...guard(document), frameId, path, overwrite: true });
  }
  async exportSheet(input: unknown) {
    const args = parse(z.strictObject({ name: z.string().trim().min(1).max(128), columns: z.number().int().min(1).max(64) }), input);
    if (relativeName(args.name).length !== 1) fail('invalid_arguments', 'Use a single new folder name');
    const document = await this.commands.getDocument(); if (!document) return;
    const chosen = await dialog.showOpenDialog(this.window(), { title: `Choose a parent folder for ${args.name}`, properties: ['openDirectory'] });
    if (chosen.canceled || !chosen.filePaths[0]) return;
    await this.files.executeNative('export_sprite_sheet', { ...guard(document), path: join(chosen.filePaths[0], args.name), columns: args.columns });
  }
  async chooseWorkspace() {
    const chosen = await dialog.showOpenDialog(this.window(), { title: 'Choose the folder MCP may read and write', properties: ['openDirectory'] });
    if (!chosen.canceled && chosen.filePaths[0]) await this.files.setWorkspace(chosen.filePaths[0]);
  }
  async restore() {
    const current = await this.confirmReplacement(); if (current) await this.recovery.restore({ current, discardUnsaved: true });
  }
  async confirmClose(): Promise<boolean> {
    const current = await this.confirmReplacement(); if (!current) return false;
    const latest = await this.commands.getDocument();
    if (!latest || current.documentId !== latest.documentId || current.expectedRevision !== latest.revision) fail('stale_revision', 'Artwork changed while deciding whether to close. Try closing again.');
    return true;
  }
}
