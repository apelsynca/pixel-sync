import { app, BrowserWindow, clipboard, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { runBridge } from '../mcp/bridge';
import { loadSettings, saveSettings, type Settings } from '../mcp/settings';
import { startMcp, type RunningMcp } from '../mcp/server';
import { CommandService, type Gesture } from '../application/commands';
import { guardSchema, operationSchema, parse } from '../core/schema';
import type { ClientId, EditorStatus, McpOperation } from '../shared/api';
import { connectClient, inspectClient, setupSnippet } from './client-setup';

app.setName('Pixel Editor');
const dataDirectory = process.env.PIXEL_EDITOR_DATA_DIR ?? join(app.getPath('appData'), 'Pixel Editor');
app.setPath('userData', dataDirectory);
if (process.argv.includes('--mcp-stdio')) {
  runBridge(dataDirectory).catch(error => { process.stderr.write(`${error.message}\n`); app.exit(1); });
  process.stdin.once('end', () => app.exit(0));
} else if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  const commands = new CommandService();
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
  const status = (): EditorStatus => ({ instanceId, milestone: 'mcp-editor', document, mcp: { enabled: !!running, endpoint: running ? `http://127.0.0.1:${running.port}/mcp` : null, error } });
  const setEnabled = async (enabled: boolean) => {
    error = null;
    if (running) { await running.close(); running = undefined; }
    settings.enabled = enabled;
    if (enabled) {
      try { running = await startMcp({ port: settings.port, token: settings.token, getStatus: status, commands,
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
    await commands.newDocument({});
    await setEnabled(settings.enabled);
    handle('editor:status', status);
    handle('editor:mcp-enable', input => serial(() => setEnabled(parse(z.boolean(), input))));
    handle('editor:document', () => commands.getDocument());
    handle('editor:frame', input => commands.getFrame(input));
    handle('editor:edit', async input => { await commands.edit(input); });
    handle('editor:undo', async input => { await commands.undo(input); });
    handle('editor:redo', async input => { await commands.redo(input); });
    handle('editor:new', async input => {
      const dimensions = parse(z.strictObject({ width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512) }), input);
      cancelGesture();
      const current = await commands.getDocument();
      if (current?.dirty && current.revision > 0) {
        const answer = await dialog.showMessageBox(window!, { type: 'question', message: 'Discard this artwork and create a new canvas?', detail: 'Project saving arrives in a later milestone. This will discard the current pixels and animation.', buttons: ['Keep editing', 'Discard and create'], defaultId: 0, cancelId: 0 });
        if (answer.response !== 1) return current;
      }
      return commands.newDocument({ ...dimensions, current: current ? { documentId: current.documentId, expectedRevision: current.revision } : undefined, discardUnsaved: true });
    });
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
    handle('editor:prompt-copy', () => { clipboard.writeText('Use pixel-editor to get its status.'); });
    handle('editor:drawing-prompt-copy', () => { clipboard.writeText('Use pixel-editor: call get_document first, then create a tiny two-frame sprite animation on a new layer without replacing the current document or changing existing artwork. Use unique names for the new layer and a looping animation clip. Use the current revision for each atomic batch, request get_animation_preview for the two frames, and explain how I can play the clip and undo your edits in Pixel Editor.'); });
    handle('editor:operations', () => structuredClone(recentOperations));
    handle('editor:client-docs', async input => { const client = parse(clientSchema, input); await shell.openExternal(client === 'codex' ? 'https://developers.openai.com/codex/quickstart/' : 'https://code.claude.com/docs/en/setup'); });
    window = new BrowserWindow({ width: 1360, height: 920, minWidth: 1000, minHeight: 720, backgroundColor: '#11151b', webPreferences: { preload: join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true } });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.session.setPermissionRequestHandler((_contents, _permission, respond) => respond(false));
    window.webContents.session.setPermissionCheckHandler(() => false);
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('render-process-gone', cancelGesture);
    window.on('closed', cancelGesture);
    let closing = false;
    window.on('close', event => {
      cancelGesture();
      if (closing || !document?.dirty || document.revision === 0) return;
      event.preventDefault();
      void dialog.showMessageBox(window!, { type: 'question', message: 'Discard unsaved artwork and quit?', detail: 'Project saving arrives in a later milestone.', buttons: ['Keep editing', 'Discard and quit'], defaultId: 0, cancelId: 0 }).then(answer => { if (answer.response === 1) { closing = true; window?.close(); } });
    });
    await window.loadURL(rendererUrl);
  }).catch(cause => { process.stderr.write(`${cause instanceof Error ? cause.message : cause}\n`); app.exit(1); });
  app.on('window-all-closed', () => app.quit());
  let quitting = false;
  app.on('will-quit', event => {
    if (quitting) return;
    event.preventDefault(); cancelGesture(); quitting = true;
    void queue.then(async () => { try { await running?.close(); } finally { app.exit(0); } });
  });
}
