import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
const settingsSchema = z.object({ port: z.number().int().min(1024).max(65535), token: z.string().regex(/^[a-f0-9]{64}$/), enabled: z.boolean() });
export type Settings = z.infer<typeof settingsSchema>;
export const connectionPath = (directory: string) => join(directory, 'mcp-connection.json');
export async function loadSettings(directory: string): Promise<Settings> {
  try { return settingsSchema.parse(JSON.parse(await readFile(connectionPath(directory), 'utf8'))); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw new Error('Cannot read MCP settings. Restore or remove mcp-connection.json.', { cause: error });
    const settings = { port: 47831, token: randomBytes(32).toString('hex'), enabled: false };
    await saveSettings(directory, settings);
    return settings;
  }
}
export async function saveSettings(directory: string, settings: Settings): Promise<void> {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = connectionPath(directory) + '.tmp';
  await writeFile(temporary, JSON.stringify(settingsSchema.parse(settings)), { mode: 0o600 });
  await rename(temporary, connectionPath(directory));
}
export async function readConnection(directory: string): Promise<Settings> {
  const settings = settingsSchema.parse(JSON.parse(await readFile(connectionPath(directory), 'utf8')));
  if (!settings.enabled) throw new Error('MCP is disabled. Enable it in PixelSync.');
  return settings;
}
