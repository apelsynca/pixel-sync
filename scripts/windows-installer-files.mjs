import { readdir } from 'node:fs/promises';
import { join, win32 } from 'node:path';

// Treat filesystem names as data in generated NSIS source, including dollars.
export function nsisLiteral(value) {
  if (/[\r\n\0]/.test(value)) throw new Error('Unsupported control character in installer path');
  if (value.includes('${')) throw new Error('NSIS preprocessor expressions are unsupported in installer paths');
  return value.replaceAll('$', () => '$$').replaceAll('"', '$\\"');
}

// Compile-time paths (File source, OutFile and !include) do not expand runtime dollars.
export function nsisSourcePath(value) {
  nsisLiteral(value);
  if (value.includes('"')) throw new Error('Quotes are unsupported in installer source paths');
  return value;
}

export async function installerFileLists(root) {
  const files = [], directories = [];
  async function visit(relative) {
    const entries = await readdir(join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (/[<>:"\\|?*]/.test(entry.name) || /[. ]$/.test(entry.name) || [...entry.name].some(character => character.charCodeAt(0) < 32)) throw new Error(`Invalid Windows payload filename: ${entry.name}`);
      const path = join(relative, entry.name);
      if (entry.isDirectory()) { directories.push(path); await visit(path); }
      else if (entry.isFile()) files.push(path);
      else throw new Error(`Installer payload must contain regular files: ${path}`);
    }
  }
  await visit('');
  if (!files.includes('PixelSync.exe') || !files.includes(join('resources', 'app.asar'))) throw new Error('Missing Windows application payload');
  const windowsPath = path => path.replaceAll('\\', '/').split('/').join('\\');
  const install = files.map(file => {
    const target = windowsPath(file);
    const directory = win32.dirname(target);
    return `SetOutPath "$INSTDIR${directory === '.' ? '' : '\\' + nsisLiteral(directory)}"\nFile "/oname=${nsisLiteral(win32.basename(target))}" "${nsisSourcePath(join(root, file))}"`;
  }).join('\n') + '\n';
  // Remove only files shipped in this version, preserving user-created files.
  const uninstall = [
    ...files.map(file => `Delete "$INSTDIR\\${nsisLiteral(windowsPath(file))}"`),
    ...directories.reverse().map(directory => `RMDir "$INSTDIR\\${nsisLiteral(windowsPath(directory))}"`),
  ].join('\n') + '\n';
  return { install, uninstall };
}
