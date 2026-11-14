import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { installerFileLists, nsisSourcePath } from './windows-installer-files.mjs';

process.chdir(fileURLToPath(new URL('..', import.meta.url)));
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with ${result.status ?? result.signal}`);
}

// Native compilers for Linux, macOS and Windows. No Wine, Mono or elevation.
const checksum = '56997fdefe25e7928a1a68b4583d08b240b66cf660234053b20131a74cc082f4';
const tools = resolve('out/tools/nsis-3.12');
const archive = join(tools, 'nsis-bundle.tar.gz');
await mkdir(tools, { recursive: true });
let data;
try { data = await readFile(archive); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!data) {
  console.log('Downloading the portable NSIS 3.12 compiler (4 MB)...');
  const response = await fetch('https://github.com/electron-userland/electron-builder-binaries/releases/download/nsis%401.2.1/nsis-bundle-3.12.tar.gz', { signal: AbortSignal.timeout(120_000) });
  if (!response.ok) throw new Error(`NSIS download failed: HTTP ${response.status}`);
  data = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(data).digest('hex') !== checksum) throw new Error(`NSIS checksum mismatch; remove ${archive} and retry.`);
await writeFile(archive, data);
run('tar', ['-xzf', archive, '-C', tools]);
const bundle = join(tools, 'nsis-bundle');
const platforms = { linux: 'linux', darwin: 'mac', win32: 'windows' };
const architecture = { x64: 'x64', arm64: 'arm64' }[process.arch];
if (!platforms[process.platform] || !architecture) throw new Error('Build on Linux, macOS or Windows with an x64 or arm64 host.');
const compiler = process.platform === 'win32' ? join(bundle, 'windows/makensis.exe') : join(bundle, platforms[process.platform], architecture, 'makensis');

const verified = process.argv.includes('--from-package');
if (!verified) {
  run(process.execPath, ['scripts/build.mjs']);
  run(process.execPath, ['node_modules/@electron-forge/cli/dist/electron-forge.js', 'package', '--platform=win32', '--arch=x64']);
}
const runtime = resolve('out/PixelSync-win32-x64');
const { extractFile } = await import('@electron/asar');
const packaged = JSON.parse(extractFile(join(runtime, 'resources/app.asar'), 'package.json').toString());
const pkg = JSON.parse(await readFile('package.json', 'utf8'));
if (packaged.version !== pkg.version || packaged.productName !== pkg.productName) throw new Error('The Windows package metadata is stale; run bun run package:win first.');
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) throw new Error('Windows installer versions must use major.minor.patch.');
const artifacts = resolve(`out/make/windows/x64/${pkg.version}`);
await mkdir(artifacts, { recursive: true });
const lists = await installerFileLists(runtime);
const generated = resolve('out/installer');
await mkdir(generated, { recursive: true });
await writeFile(join(generated, 'install-files.nsh'), lists.install);
await writeFile(join(generated, 'uninstall-files.nsh'), lists.uninstall);
const setup = join(artifacts, `PixelSync-${pkg.version}-Setup.exe`);
const prefix = process.platform === 'win32' ? '/' : '-';
run(compiler, [`${prefix}V2`, `${prefix}WX`, `${prefix}DVERSION=${pkg.version}`, `${prefix}DOUTPUT_FILE=${nsisSourcePath(setup)}`, `${prefix}DGENERATED_DIR=${nsisSourcePath(generated)}`, resolve('installer/windows.nsi')], { env: { ...process.env, NSISDIR: join(bundle, 'windows') } });
run(process.execPath, ['scripts/release-manifest.mjs', artifacts]);
console.log(`Windows installer: ${setup}`);
