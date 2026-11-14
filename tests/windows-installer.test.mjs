import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { installerFileLists, nsisLiteral, nsisSourcePath } from '../scripts/windows-installer-files.mjs';

const directories = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const path = await mkdtemp(join(tmpdir(), 'PixelSync $installer '));
  directories.push(path);
  await mkdir(join(path, 'resources', 'nested'), { recursive: true });
  await writeFile(join(path, 'PixelSync.exe'), 'exe');
  await writeFile(join(path, 'resources', 'app.asar'), 'asar');
  await writeFile(join(path, 'resources', 'nested', '$sprite.png'), 'png');
  return path;
}

it('includes the full payload and removes only shipped files, with child directories removed first', async () => {
  const path = await fixture();
  const { install, uninstall } = await installerFileLists(path);
  expect(install).toContain('File "/oname=PixelSync.exe"');
  expect(install).toContain('File "/oname=app.asar"');
  expect(install).toContain('SetOutPath "$INSTDIR\\resources\\nested"');
  expect(install).toContain('/oname=$$sprite.png');
  expect(install).toContain('PixelSync $installer');
  expect(uninstall).toContain('Delete "$INSTDIR\\resources\\nested\\$$sprite.png"');
  expect(uninstall.indexOf('RMDir "$INSTDIR\\resources\\nested"')).toBeLessThan(uninstall.indexOf('RMDir "$INSTDIR\\resources"'));
  expect(uninstall).not.toContain('/r');
  expect(uninstall).not.toContain('*');
  expect(uninstall).not.toContain('$APPDATA');
});

it('rejects incomplete payloads and linked entries', async () => {
  const path = await fixture();
  await rm(join(path, 'PixelSync.exe'));
  await expect(installerFileLists(path)).rejects.toThrow('Missing Windows application payload');
  if (process.platform !== 'win32') {
    await symlink(join(path, 'resources', 'app.asar'), join(path, 'linked'));
    await expect(installerFileLists(path)).rejects.toThrow('regular files');
  }
});

it('rejects wildcard filenames that could turn uninstall into deleting user files', async () => {
  if (process.platform === 'win32') return;
  const path = await fixture();
  await writeFile(join(path, 'resources', '*.png'), 'invalid Windows filename');
  await expect(installerFileLists(path)).rejects.toThrow('Invalid Windows payload filename');
});

it('escapes NSIS variables and quotes, and rejects source-injecting control characters', () => {
  expect(nsisLiteral('$INSTDIR/"sprite"')).toBe('$$INSTDIR/$\\"sprite$\\"');
  expect(() => nsisLiteral('sprite\n!system command')).toThrow('control character');
  expect(nsisSourcePath('PixelSync $source')).toBe('PixelSync $source');
  expect(() => nsisSourcePath('source/${VERSION}')).toThrow('preprocessor');
});
