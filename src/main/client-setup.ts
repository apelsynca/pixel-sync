import { access, lstat, mkdir, open, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { delimiter, dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify, TomlError } from 'smol-toml';
import type { ClientId, ClientSetup } from '../shared/api';

type ObjectValue = Record<string, unknown>;
function object(value: unknown): ObjectValue {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Client configuration must contain an object.');
  return value as ObjectValue;
}
const exists = async (path: string) => { try { await access(path); return true; } catch { return false; } };
export interface SetupPaths { home: string; env: NodeJS.ProcessEnv; platform: NodeJS.Platform }
export function configPath(client: ClientId, paths: SetupPaths): string {
  return client === 'codex' ? join(paths.env.CODEX_HOME || join(paths.home, '.codex'), 'config.toml')
    : paths.env.CLAUDE_CONFIG_DIR ? join(paths.env.CLAUDE_CONFIG_DIR, '.claude.json') : join(paths.home, '.claude.json');
}
export function clientEntry(client: ClientId, port: number, token: string): ObjectValue {
  const url = `http://127.0.0.1:${port}/mcp/${client}`;
  return client === 'codex' ? { url, enabled: true, http_headers: { Authorization: `Bearer ${token}` } }
    : { type: 'http', url, headers: { Authorization: `Bearer ${token}` } };
}
export function setupSnippet(client: ClientId, port: number, token: string): string {
  const entry = clientEntry(client, port, token);
  return client === 'codex' ? stringify({ mcp_servers: { 'pixel-editor': entry } }) : JSON.stringify({ mcpServers: { 'pixel-editor': entry } }, null, 2);
}
export function updateConfig(client: ClientId, source: string, port: number, token: string): string {
  const entry = clientEntry(client, port, token);
  if (client === 'claude-code') {
    const config = object(source.trim() ? JSON.parse(source) : {});
    const servers = object(config.mcpServers ?? {});
    return JSON.stringify({ ...config, mcpServers: { ...servers, 'pixel-editor': entry } }, null, 2) + '\n';
  }
  const config = object(parse(source));
  const servers = object(config.mcp_servers ?? {});
  const expected = { ...config, mcp_servers: { ...servers, 'pixel-editor': entry } };
  // Preserve comments and unrelated text. Only replace conventional table blocks
  // for this one server, then parse and compare the entire result before writing.
  let skipping = false;
  const preserved = source.split(/\r?\n/).filter(line => {
    if (/^\s*\[/.test(line)) skipping = /^\s*\[\s*(?:mcp_servers|"mcp_servers"|'mcp_servers')\s*\.\s*(?:pixel-editor|"pixel-editor"|'pixel-editor')(?:\s*\.[^\]]+)?\s*\]\s*(?:#.*)?$/.test(line);
    return !skipping;
  }).join('\n');
  const output = `${preserved.trimEnd()}\n\n${setupSnippet(client, port, token)}`;
  try {
    if (!isDeepStrictEqual(parse(output), parse(stringify(expected)))) throw new Error('Unrelated settings changed');
  } catch { throw new Error('Existing Codex entry uses an unsupported TOML layout. Nothing was changed. Use the private configuration fallback in Instructions.'); }
  return output;
}
export async function inspectClient(client: ClientId, paths: SetupPaths, port: number, token: string): Promise<ClientSetup> {
  const path = configPath(client, paths);
  let configured = false, issue: string | null = null;
  const found = await exists(path);
  if (found) {
    try {
      const source = await readFile(path, 'utf8');
      const config = object(client === 'codex' ? parse(source) : JSON.parse(source));
      const servers = object(config[client === 'codex' ? 'mcp_servers' : 'mcpServers'] ?? {});
      configured = isDeepStrictEqual(JSON.parse(JSON.stringify(servers['pixel-editor'] ?? null)), clientEntry(client, port, token));
    } catch { issue = 'Cannot read this client configuration. Connect will leave an invalid file untouched.'; }
  }
  const command = client === 'codex' ? 'codex' : 'claude';
  const names = paths.platform === 'win32' ? [command + '.exe', command + '.cmd', command + '.bat'] : [command];
  const detected = found || (await Promise.all((paths.env.PATH ?? '').split(delimiter).filter(Boolean).flatMap(dir => names.map(name => exists(join(dir, name)))))).some(Boolean);
  return { client, detected, configured, configPath: path, issue, lastStatusCall: null };
}
/** Called only by the explicit Connect action. No subprocess or shell receives a token. */
export async function connectClient(client: ClientId, paths: SetupPaths, port: number, token: string): Promise<void> {
  const path = configPath(client, paths);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const lockPath = path + '.pixel-editor.lock';
  let lock;
  try { lock = await open(lockPath, 'wx', 0o600); }
  catch { throw new Error('Client setup is already in progress, or its configuration folder is not writable. Try again after the other setup finishes.'); }
  const temporary = path + '.' + randomUUID() + '.tmp';
  try {
    let source = '';
    try {
      if (!(await lstat(path)).isFile()) throw new Error('The configuration path is not a regular file. Use Instructions to configure its actual location.');
      source = await readFile(path, 'utf8');
    } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    const output = updateConfig(client, source, port, token);
    if (source) await writeFile(path + '.pixel-editor-backup-' + randomUUID(), source, { flag: 'wx', mode: 0o600 });
    await writeFile(temporary, output, { flag: 'wx', mode: 0o600 });
    let current = '';
    try { current = await readFile(path, 'utf8'); } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
    if (current !== source) throw new Error('The client changed its configuration during setup. Nothing was replaced; close the client and try Connect again.');
    await rename(temporary, path);
  } catch (error) {
    // Never forward parser details, existing file contents, or credential values to IPC.
    // eslint-disable-next-line preserve-caught-error -- parser causes may include credential-bearing source lines
    if (error instanceof SyntaxError || error instanceof TomlError) throw new Error('Client configuration is invalid. Nothing was changed. Repair it or use Instructions.');
    throw error;
  } finally { await rm(temporary, { force: true }); await lock.close(); await rm(lockPath, { force: true }); }
}
