import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse as toml } from 'smol-toml';
import { clientEntry, configPath, connectClient, inspectClient, updateConfig, type SetupPaths } from '../src/main/client-setup';
import { playbackFrame, pixelPosition } from '../src/renderer/playback';
import { CommandService } from '../src/application/commands';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
const token = 'c'.repeat(64);
async function fixture(): Promise<SetupPaths> {
  const home = await mkdtemp(join(tmpdir(), 'pixel-setup-')); directories.push(home);
  return { home, env: { PATH: '', CODEX_HOME: join(home, 'codex config'), CLAUDE_CONFIG_DIR: join(home, 'claude config') }, platform: process.platform };
}
describe('in-app client registration', () => {
  it('adds Codex HTTP authentication while preserving comments and unrelated settings', () => {
    const original = '# Personal config\nmodel = "test-model"\n[mcp_servers.other]\ncommand = "other-server"\n# Keep this comment\n[profiles.work]\nmodel = "work-model"\n';
    const output = updateConfig('codex', original, 47831, token);
    expect(output).toContain(original.trimEnd());
    expect(toml(output)).toMatchObject({ model: 'test-model', profiles: { work: { model: 'work-model' } }, mcp_servers: { other: { command: 'other-server' }, 'pixel-editor': clientEntry('codex', 47831, token) } });
    expect(output).not.toContain('bearer_token_env_var'); expect(output).not.toContain('.exe');
  });
  it('updates existing quoted Codex tables and credentials without retaining old transport fields', () => {
    const source = 'model = "keep"\n[mcp_servers."pixel-editor"]\ncommand = "old.exe"\nargs = ["--mcp-stdio"]\n[mcp_servers."pixel-editor".env]\nOLD = "secret"\n[mcp_servers.other]\nurl = "https://example.test/mcp"\n';
    const output = updateConfig('codex', source, 49999, token);
    expect(toml(output)).toMatchObject({ model: 'keep', mcp_servers: { 'pixel-editor': clientEntry('codex', 49999, token), other: { url: 'https://example.test/mcp' } } });
    expect(output).not.toContain('old.exe'); expect(output).not.toContain('OLD');
    expect(updateConfig('codex', output, 49999, token)).toBe(output);
  });
  it('refuses TOML layouts it cannot safely patch instead of changing unrelated content', () => {
    const source = 'mcp_servers = { "pixel-editor" = { command = "old" } }\n';
    expect(() => updateConfig('codex', source, 47831, token)).toThrow('unsupported TOML layout');
  });
  it('preserves Claude Code project preferences and other servers at user scope', () => {
    const config = { theme: 'dark', projects: { '/some/game': { hasTrustDialogAccepted: true } }, mcpServers: { other: { type: 'stdio', command: 'keep' }, 'pixel-editor': { type: 'stdio', command: 'old' } } };
    const output = JSON.parse(updateConfig('claude-code', JSON.stringify(config), 47831, token));
    expect(output).toEqual({ ...config, mcpServers: { ...config.mcpServers, 'pixel-editor': clientEntry('claude-code', 47831, token) } });
  });
  for (const client of ['codex', 'claude-code'] as const) {
    it(`registers ${client}, backs up the prior file, and detects stale credentials and ports`, async () => {
      const paths = await fixture(), path = configPath(client, paths);
      await mkdir(dirname(path), { recursive: true });
      const original = client === 'codex' ? 'model = "test"\n' : '{"theme":"dark"}';
      await writeFile(path, original);
      expect((await inspectClient(client, paths, 47831, token)).configured).toBe(false);
      await connectClient(client, paths, 47831, token);
      expect(await inspectClient(client, paths, 47831, token)).toMatchObject({ detected: true, configured: true, lastStatusCall: null });
      expect((await inspectClient(client, paths, 49999, token)).configured).toBe(false);
      expect((await inspectClient(client, paths, 47831, 'd'.repeat(64))).configured).toBe(false);
      const files = await readdir(dirname(path)), backup = files.find(name => name.includes('.pixel-editor-backup-'))!;
      expect(await readFile(join(dirname(path), backup), 'utf8')).toBe(original);
      expect(files.some(name => name.endsWith('.tmp') || name.endsWith('.lock'))).toBe(false);
    });
    it(`leaves invalid ${client} config untouched and does not disclose parser source`, async () => {
      const paths = await fixture(), path = configPath(client, paths);
      await mkdir(dirname(path), { recursive: true });
      const invalid = client === 'codex' ? `private = "${token}\n` : `{"private": "${token}`;
      await writeFile(path, invalid);
      try { await connectClient(client, paths, 47831, token); throw new Error('Expected failure'); }
      catch (error) { expect(String(error)).toContain('invalid'); expect(String(error)).not.toContain(token); }
      expect(await readFile(path, 'utf8')).toBe(invalid);
      expect((await readdir(dirname(path))).some(name => name.includes('.pixel-editor-') || name.endsWith('.tmp'))).toBe(false);
    });
  }
  it('does not steal an existing setup lock', async () => {
    const paths = await fixture(), path = configPath('codex', paths);
    await mkdir(dirname(path), { recursive: true }); await writeFile(path + '.pixel-editor.lock', 'lock');
    await expect(connectClient('codex', paths, 47831, token)).rejects.toThrow('already in progress');
    expect(await readFile(path + '.pixel-editor.lock', 'utf8')).toBe('lock');
  });
});

describe('manual editor frame reads and playback', () => {
  it('reads a maximum-size frame in bounded bands and returns defensive layer snapshots', async () => {
    const commands = new CommandService(), initial = await commands.newDocument({ width: 512, height: 512 });
    const guard = { documentId: initial.documentId, expectedRevision: initial.revision };
    await commands.edit({ ...guard, operations: [{ type: 'set_pixels', frameId: initial.frames[0].id, layerId: initial.layers[0].id, pixels: [{ x: 511, y: 511, color: '#FF0000FF' }] }] });
    const request = { ...guard, expectedRevision: 1, frameId: initial.frames[0].id, allLayers: true };
    const snapshot = await commands.getFrame(request);
    expect(snapshot.layers[0].pixels.slice(-4)).toEqual(new Uint8Array([255, 0, 0, 255]));
    snapshot.layers[0].pixels.fill(0);
    expect((await commands.getFrame({ ...request, allLayers: false })).layers[0].pixels.slice(-4)).toEqual(new Uint8Array([255, 0, 0, 255]));
    await expect(commands.getFrame({ ...request, expectedRevision: 0 })).rejects.toMatchObject({ code: 'stale_revision' });
    await expect(commands.getFrame({ ...request, frameId: 'deleted' })).rejects.toMatchObject({ code: 'missing_frame' });
  });
  it('uses unequal durations and residual elapsed time across missed callbacks and loop boundaries', () => {
    const frames = [{ id: 'a', duration: 100 }, { id: 'b', duration: 250 }, { id: 'c', duration: 50 }];
    const ids = ['b', 'a', 'c'];
    expect(playbackFrame(frames, ids, true, 249).frameId).toBe('b');
    expect(playbackFrame(frames, ids, true, 250).frameId).toBe('a');
    expect(playbackFrame(frames, ids, true, 1190).frameId).toBe('c');
    expect(playbackFrame(frames, ids, true, 1200).frameId).toBe('b');
    expect(playbackFrame(frames, ids, false, 400)).toEqual({ frameId: 'c', finished: true });
    expect(playbackFrame(frames, ids, false, 9_000)).toEqual({ frameId: 'c', finished: true });
  });
  it('maps pointer coordinates at fractional display scales and clipped positions', () => {
    expect(pixelPosition(125.5, 220.75, { left: 100, top: 200, width: 48, height: 48 }, 32, 32)).toEqual({ x: 17, y: 13 });
    expect(pixelPosition(99.9, 199.9, { left: 100, top: 200, width: 320, height: 320 }, 32, 32)).toEqual({ x: -1, y: -1 });
    expect(pixelPosition(1e9, -1e9, { left: 0, top: 0, width: 32, height: 32 }, 32, 32)).toEqual({ x: 4096, y: -4096 });
  });
});
