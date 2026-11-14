import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const root = resolve(process.argv[2] ?? 'out/make');
const generated = new Set(['release-manifest.json', 'SHA256SUMS']);
async function collect(directory, prefix = '') {
  const files = [];
  for (const name of (await readdir(directory)).sort()) {
    const relative = prefix + name;
    if (generated.has(relative)) continue;
    const path = join(directory, name);
    const info = await lstat(path);
    if (info.isDirectory()) files.push(...await collect(path, `${relative}/`));
    else if (info.isFile()) {
      if (!info.size) throw new Error(`Release artifact is empty: ${relative}`);
      files.push({ path, relative, bytes: info.size });
    }
    else throw new Error(`Release artifacts must be regular files: ${relative}`);
    if (/[\r\n\\]/.test(relative)) throw new Error(`Unsupported artifact filename: ${JSON.stringify(relative)}`);
  }
  return files;
}
async function digest(path) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest('hex');
}
const files = await collect(root);
if (!files.length) throw new Error(`No release artifacts in ${root}; run Electron Forge make first.`);
const artifacts = [];
for (const file of files) artifacts.push({ path: file.relative, bytes: file.bytes, sha256: await digest(file.path) });
const git = (...args) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const manifest = {
  schemaVersion: 1,
  product: pkg.productName,
  version: pkg.version,
  generatedAt: new Date().toISOString(),
  source: { commit: git('rev-parse', 'HEAD'), dirty: git('status', '--porcelain', '--untracked-files=normal') !== '', lockfileSha256: await digest(new URL('../bun.lock', import.meta.url)) },
  build: { platform: process.platform, arch: process.arch, node: process.version, packageManager: pkg.packageManager },
  artifacts,
};
await writeFile(join(root, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
await writeFile(join(root, 'SHA256SUMS'), artifacts.map(file => `${file.sha256}  ${file.path}\n`).join(''));
console.log(`Recorded ${artifacts.length} release artifacts in ${root} (source ${manifest.source.commit}${manifest.source.dirty ? ', working tree modified' : ''}).`);
