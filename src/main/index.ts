import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { runBridge } from '../mcp/bridge';
import { loadSettings, saveSettings, type Settings } from '../mcp/settings';
import { startMcp, type RunningMcp } from '../mcp/server';
import { CommandService, type Gesture } from '../application/commands';
import { guardSchema, operationSchema, parse } from '../core/schema';
import type { ClientId, EditorStatus, McpOperation } from '../shared/api';
import { connectClient, inspectClient, setupSnippet } from './client-setup';
import { FileService } from '../persistence/files';
import { RecoveryManager } from '../persistence/recovery';
import { FileDialogs } from './file-dialogs';
import { installEditorMenu } from './menu';

app.setName('PixelSync');
const dataDirectory = process.env.PIXEL_SYNC_DATA_DIR ?? join(app.getPath('appData'), 'PixelSync');
app.setPath('userData', dataDirectory);
if (process.argv.includes('--mcp-stdio')) {
  runBridge(dataDirectory).catch(error => { process.stderr.write(`${error.message}\n`); app.exit(1); });
  process.stdin.once('end', () => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const commands = new CommandService();
  const files = new FileService(commands, dataDirectory);
  let recovery: RecoveryManager;
  let fileDialogs: FileDialogs;
  let shuttingDown = false;
  const instanceId = randomUUID();
  const paths = { home: homedir(), env: process.env, platform: process.platform };
  const calls = new Map<ClientId, string>();
  const recentOperations: McpOperation[] = [];
  let document: EditorStatus['document'] = null;
  let running: RunningMcp | undefined;
  let settings: Settings;
  let error: string | null = null;
  let window: BrowserWindow | undefined;
  let queue: Promise<unknown> = Promise.resolve();
  let gesture: { id: string; handle: Gesture } | undefined;
  let gesturePending = false;
  const cancelGesture = () => { gesture?.handle.cancel(); gesture = undefined; };
  const serial = <T,>(action: () => Promise<T>) => { const result = queue.then(action); queue = result.catch(() => undefined); return result; };
  commands.subscribe(event => { document = event.document; window?.webContents.send('editor:changed', event); });
  const fileState = () => ({ ...files.state(), ...(recovery?.state() ?? { recoveryAvailable: false, recoveryError: null }) });
  const filesChanged = () => { if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) { window.webContents.send('editor:files-changed', fileState()); window.setTitle(`${basename(files.state().projectPath ?? 'Untitled sprite')} — PixelSync`); } };
  files.subscribe(filesChanged);
  const status = (): EditorStatus => ({ instanceId, milestone: 'files', document, mcp: { enabled: !!running, endpoint: running ? `http://127.0.0.1:${running.port}/mcp` : null, error } });
  const setEnabled = async (enabled: boolean) => {
    if (enabled && shuttingDown) throw new Error('PixelSync is closing');
    error = null;
    if (running) { await running.close(); running = undefined; }
    settings.enabled = enabled;
    if (enabled) {
      try { running = await startMcp({ port: settings.port, token: settings.token, getStatus: status, commands, files,
        onStatusCall: client => { calls.set(client, new Date().toISOString()); },
        onOperation: operation => { recentOperations.unshift(operation); recentOperations.splice(50); if (window && !window.isDestroyed()) window.webContents.send('editor:operation', operation); },
      }); }
      catch (cause) { error = cause instanceof Error ? cause.message : String(cause); }
    } else calls.clear();
    await saveSettings(dataDirectory, settings);
    return status();
  };
  const clients = async () => Promise.all((['codex', 'claude-code'] as const).map(async client => ({ ...await inspectClient(client, paths, settings.port, settings.token), lastStatusCall: calls.get(client) ?? null })));
  const clientSchema = z.enum(['codex', 'claude-code']);
  const rendererUrl = pathToFileURL(join(__dirname, 'renderer/index.html')).href;
  const validateSender = (event: IpcMainInvokeEvent) => {
    if (event.sender !== window?.webContents || event.senderFrame?.url !== rendererUrl || event.senderFrame !== event.sender.mainFrame) throw new Error('Invalid IPC sender');
  };
  function handle(channel: string, action: (input: unknown) => unknown) {
    ipcMain.handle(channel, (event, input: unknown) => { validateSender(event); return action(input); });
  }
  app.on('second-instance', () => { window?.show(); window?.focus(); });
  app.whenReady().then(async () => {
    settings = await loadSettings(dataDirectory);
    await files.initialize();
    await commands.newDocument({});
    const initial = (await commands.getDocument())!;
    await commands.markSaved({ documentId: initial.documentId, expectedRevision: initial.revision });
    recovery = new RecoveryManager(commands, dataDirectory, filesChanged);
    await recovery.initialize();
    fileDialogs = new FileDialogs(commands, files, recovery, () => window!, cancelGesture);
    await setEnabled(settings.enabled);
    handle('editor:status', status);
    handle('editor:mcp-enable', input => serial(() => setEnabled(parse(z.boolean(), input))));
    handle('editor:document', () => commands.getDocument());
    handle('editor:frame', input => commands.getFrame(input));
    handle('editor:edit', async input => { await commands.edit(input); });
    handle('editor:undo', async input => { await commands.undo(input); });
    handle('editor:redo', async input => { await commands.redo(input); });
    handle('editor:new', input => fileDialogs.newDocument(input));
    handle('editor:files-state', fileState);
    handle('editor:file-save', input => fileDialogs.save(parse(z.boolean(), input)));
    handle('editor:file-open', () => fileDialogs.open()); handle('editor:file-import', () => fileDialogs.open(true));
    handle('editor:file-export-png', input => fileDialogs.exportPng(input)); handle('editor:file-export-sheet', input => fileDialogs.exportSheet(input));
    handle('editor:workspace-choose', () => fileDialogs.chooseWorkspace()); handle('editor:workspace-clear', async () => { await files.setWorkspace(null); });
    handle('editor:recovery-restore', () => fileDialogs.restore()); handle('editor:recovery-discard', () => recovery.discard());
    handle('editor:gesture-begin', async input => {
      if (gesture || gesturePending) throw new Error('A stroke is already active');
      gesturePending = true;
      try {
        const handle = await commands.beginGesture(parse(guardSchema, input));
        if (!window || window.isDestroyed()) { handle.cancel(); throw new Error('Editor closed'); }
        const id = randomUUID(); gesture = { id, handle }; return id;
      } finally { gesturePending = false; }
    });
    handle('editor:gesture-commit', async input => {
      const active = gesture;
      try {
        const args = parse(z.strictObject({ id: z.string().uuid(), operations: z.array(operationSchema).min(1).max(256) }), input);
        if (!active || active.id !== args.id) throw new Error('Stroke was cancelled');
        await active.handle.commit(args.operations);
      } finally { if (gesture === active) cancelGesture(); }
    });
    handle('editor:gesture-cancel', input => { if (gesture?.id === parse(z.string().uuid(), input)) cancelGesture(); });
    handle('editor:clients', clients);
    handle('editor:client-connect', input => serial(async () => {
      const client = parse(clientSchema, input);
      if (!running) { await setEnabled(true); if (!running) throw new Error(error ?? 'Cannot enable MCP'); }
      await connectClient(client, paths, settings.port, settings.token);
      return clients();
    }));
    handle('editor:client-copy', input => {
      const client = parse(clientSchema, input);
      clipboard.writeText(setupSnippet(client, settings.port, settings.token));
    });
    handle('editor:prompt-copy', () => { clipboard.writeText('Use pixel-sync to get its status.'); });
    handle('editor:drawing-prompt-copy', () => { clipboard.writeText('Use pixel-sync: call get_document first, then create a tiny two-frame sprite animation on a new layer without replacing the current document or changing existing artwork. Use unique names for the new layer and a looping animation clip. Use the current revision for each atomic batch, request get_animation_preview for the two frames, and explain how I can play the clip and undo your edits in PixelSync.'); });
    handle('editor:operations', () => structuredClone(recentOperations));
    handle('editor:client-docs', async input => { const client = parse(clientSchema, input); await shell.openExternal(client === 'codex' ? 'https://developers.openai.com/codex/quickstart/' : 'https://code.claude.com/docs/en/setup'); });
    window = new BrowserWindow({ width: 1360, height: 920, minWidth: 1000, minHeight: 720, backgroundColor: '#11151b', icon: join(app.getAppPath(), 'assets/icons', process.platform === 'win32' ? 'pixelsync-256.png' : 'pixelsync-512.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    const updateMenu = installEditorMenu(window);
    handle('editor:menu-state', input => updateMenu(parse(z.strictObject({ enabled: z.boolean(), canUndo: z.boolean(), canRedo: z.boolean() }), input)));
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', cancelGesture);
    window.on('closed', cancelGesture);
    let closing = false;
    let closePrompt = false;
    window.on('close', event => {
      cancelGesture();
      if (closing || !document?.dirty) return;
      event.preventDefault();
      if (closePrompt) return;
      closePrompt = true;
      void fileDialogs.confirmClose().then(confirmed => { if (confirmed) { closing = true; window?.close(); } }).catch(cause => { dialog.showErrorBox('Could not close safely', cause instanceof Error ? cause.message : String(cause)); }).finally(() => { closePrompt = false; });
    });
    await window.loadURL(rendererUrl);
  }).catch(cause => { process.stderr.write(`${cause instanceof Error ? cause.message : cause}\n`); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('will-quit', event => {
    if (quitting) return;
    event.preventDefault(); shuttingDown = true; quitting = true;
    const stopped = running?.close(); cancelGesture();
    void queue.then(async () => { try { await stopped; await commands.getDocument(); await recovery?.finish(); } finally { app.exit(0); } });
  });
}
