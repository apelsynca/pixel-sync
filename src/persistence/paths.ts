import * as fs from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { randomUUID } from 'node:crypto';
import { DocumentError, fail } from '../core/schema';

export type FileIO = typeof fs;
export interface FileTicket { path: string; check: () => Promise<void> }
const samePath = (a: string, b: string) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const identity = (stat: Awaited<ReturnType<typeof fs.lstat>>) => `${stat.dev}:${stat.ino}`;
export async function exists(path: string, io = fs): Promise<boolean> { try { await io.lstat(path); return true; } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; } }
export function relativeName(value: string): string[] {
  if (!value || value.length > 1024 || isAbsolute(value) || win32.isAbsolute(value) || value.includes(':') || [...value].some(character => character.charCodeAt(0) < 32)) fail('path_denied', 'Use a path relative to the selected workspace');
  const parts = value.replaceAll('\\', '/').split('/');
  if (parts.some(part => !part || part === '.' || part === '..' || part.length > 255 || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) fail('path_denied', 'Path contains an unsafe or non-portable component');
  return parts;
}
export async function workspaceTicket(root: string | null, value: string, io = fs): Promise<FileTicket> {
  if (!root) fail('workspace_required', 'Choose an MCP workspace folder in Pixel Editor');
  const parts = relativeName(value), path = resolve(root, ...parts), rel = relative(root, path);
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail('path_denied', 'Path must remain inside the workspace');
  const parents = new Map<string, string>();
  const check = async () => {
    let current = root;
    for (let index = -1; index < parts.length - 1; index++) {
      if (index >= 0) current = join(current, parts[index]);
      const stat = await io.lstat(current);
      if (!stat.isDirectory() || stat.isSymbolicLink() || !samePath(await io.realpath(current), current)) fail('path_denied', 'Linked or redirected workspace folders are not allowed');
      const key = identity(stat), previous = parents.get(current);
      if (previous && previous !== key) fail('path_denied', 'Workspace folders changed during the operation; retry');
      parents.set(current, key);
    }
    if (await exists(path, io)) {
      const stat = await io.lstat(path);
      if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || (stat.isFile() && stat.nlink > 1) || !samePath(await io.realpath(path), path)) fail('path_denied', 'Linked or redirected workspace files are not allowed');
    }
  };
  await check(); return { path, check };
}
export function nativeTicket(path: string): FileTicket { if (!isAbsolute(path)) fail('path_denied', 'Native file dialogs must supply an absolute path'); return { path, check: async () => undefined }; }
export async function readBounded(ticket: FileTicket, limit: number, io = fs): Promise<Buffer> {
  await ticket.check();
  const handle = await io.open(ticket.path, constants.O_RDONLY | (process.platform === 'win32' ? 0 : constants.O_NOFOLLOW));
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) fail('unsupported_format', 'Expected a regular file');
    if (stat.size > limit) fail('size_limit', `Input exceeds ${Math.floor(limit / 1024 / 1024)} MiB`);
    await ticket.check();
    if (identity(await io.stat(ticket.path)) !== identity(stat)) fail('path_denied', 'File changed while opening');
    const buffer = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < buffer.length) { const result = await handle.read(buffer, offset, Math.min(1024 * 1024, buffer.length - offset), null); if (!result.bytesRead) break; offset += result.bytesRead; }
    await ticket.check();
    const after = await handle.stat();
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs || identity(await io.stat(ticket.path)) !== identity(stat)) fail('io_error', 'File changed while reading; retry');
    return buffer.subarray(0, stat.size);
  } finally { await handle.close(); }
}
export async function atomicWrite(ticket: FileTicket, bytes: Uint8Array | string, overwrite: boolean, io = fs): Promise<void> {
  await ticket.check();
  if (!overwrite && await exists(ticket.path, io)) fail('already_exists', 'Destination exists; choose a new name or set overwrite: true');
  const temporary = join(dirname(ticket.path), `.pixel-${randomUUID()}.tmp`);
  try {
    const handle = await io.open(temporary, 'wx', 0o600);
    try { await ticket.check(); await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    await ticket.check();
    if (overwrite) await io.rename(temporary, ticket.path);
    else {
      // Hard-link publication is atomic and refuses an existing file, including a
      // destination created after the initial check. Works on Windows NTFS too.
      try { await io.link(temporary, ticket.path); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('already_exists', 'Destination was created during the write; choose a new name'); throw error; }
    }
  } finally {
    // Cleanup must not mask the original error or report failure after publication.
    await io.rm(temporary, { force: true }).catch(() => undefined);
  }
}
export async function atomicExport(ticket: FileTicket, png: Buffer, metadata: unknown, io = fs): Promise<void> {
  await ticket.check(); if (await exists(ticket.path, io)) fail('already_exists', 'Export folder exists; choose a new folder name');
  const temporary = join(dirname(ticket.path), `.pixel-export-${randomUUID()}`);
  try {
    await io.mkdir(temporary, { mode: 0o700 }); await ticket.check();
    await atomicWrite(nativeTicket(join(temporary, 'sheet.png')), png, true, io);
    await atomicWrite(nativeTicket(join(temporary, 'sheet.json')), JSON.stringify(metadata, null, 2) + '\n', true, io);
    await ticket.check(); if (await exists(ticket.path, io)) fail('already_exists', 'Export folder was created during export; choose a new name');
    await io.rename(temporary, ticket.path);
  } finally { await io.rm(temporary, { recursive: true, force: true }).catch(() => undefined); }
}
export async function fileFailure<T>(action: () => Promise<T>): Promise<T> {
  try { return await action(); } catch (error) {
    if (error instanceof DocumentError) throw error;
    return fail('io_error', 'File operation failed. Check the file, destination folder, permissions, and available disk space.');
  }
}
