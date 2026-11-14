import { app, BrowserWindow, ipcMain } from 'electron';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runBridge } from '../mcp/bridge';
import { loadSettings, saveSettings, type Settings } from '../mcp/settings';
import { startMcp, type RunningMcp } from '../mcp/server';
import type { EditorStatus } from '../shared/api';

// Use the same per-user directory in GUI and bridge mode, including before ready.
app.setName('Pixel Editor');
const dataDirectory = process.env.PIXEL_EDITOR_DATA_DIR ?? join(app.getPath('appData'), 'Pixel Editor');
if (process.argv.includes('--mcp-stdio')) {
  // Deliberately bypass ready, window creation, and the GUI single-instance lock.
  runBridge(dataDirectory).catch(error => { process.stderr.write(`${error.message}\n`); app.exit(1); });
  process.stdin.once('end', () => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const instanceId = randomUUID();
  let running: RunningMcp | undefined;
  let settings: Settings;
  let error: string | null = null;
  let window: BrowserWindow | undefined;
  let queue = Promise.resolve();
  const status = (): EditorStatus => ({ instanceId, milestone: 'foundation', document: null, mcp: { enabled: !!running, endpoint: running ? `http://127.0.0.1:${running.port}/mcp` : null, error } });
  const setEnabled = async (enabled: boolean) => {
    error = null;
    if (running) { await running.close(); running = undefined; }
    settings.enabled = enabled;
    if (enabled) {
      try { running = await startMcp({ port: settings.port, token: settings.token, getStatus: status }); }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    }
    await saveSettings(dataDirectory, settings);
    return status();
  };
  const rendererUrl = pathToFileURL(join(__dirname, 'renderer/index.html')).href;
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    settings = await loadSettings(dataDirectory);
    await setEnabled(settings.enabled);
    ipcMain.handle('editor:status', event => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== rendererUrl) throw new Error('Invalid IPC sender');
      return status();
    });
    ipcMain.handle('editor:mcp-enable', (event, enabled: unknown) => {
      if (event.sender !== window?.webContents || event.senderFrame?.url !== rendererUrl || typeof enabled !== 'boolean') throw new Error('Invalid IPC request');
      const result = queue.then(() => setEnabled(enabled));
      queue = result.then(() => undefined, () => undefined);
      return result;
    });
    window = new BrowserWindow({ width: 1080, height: 760, minWidth: 740, minHeight: 500, backgroundColor: '#171a20', webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    await window.loadURL(rendererUrl);
  }).catch(cause => { process.stderr.write(`${cause instanceof Error ? cause.message : cause}\n`); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('before-quit', event => {
    if (quitting) return;
    event.preventDefault(); quitting = true;
    void queue.finally(async () => { await running?.close(); app.quit(); });
  });
}
