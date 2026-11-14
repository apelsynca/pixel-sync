import { contextBridge, ipcRenderer } from 'electron';
import type { EditorApi } from '../shared/api';
const api: EditorApi = {
  getStatus: () => ipcRenderer.invoke('editor:status'), setMcpEnabled: enabled => ipcRenderer.invoke('editor:mcp-enable', enabled),
  getDocument: () => ipcRenderer.invoke('editor:document'), edit: input => ipcRenderer.invoke('editor:edit', input),
  undo: input => ipcRenderer.invoke('editor:undo', input), redo: input => ipcRenderer.invoke('editor:redo', input),
  newDocument: input => ipcRenderer.invoke('editor:new', input), getFrame: input => ipcRenderer.invoke('editor:frame', input),
  beginGesture: input => ipcRenderer.invoke('editor:gesture-begin', input), commitGesture: input => ipcRenderer.invoke('editor:gesture-commit', input), cancelGesture: id => ipcRenderer.invoke('editor:gesture-cancel', id),
  onDocument: listener => { const receive = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload); ipcRenderer.on('editor:changed', receive); return () => { ipcRenderer.removeListener('editor:changed', receive); }; },
  getClients: () => ipcRenderer.invoke('editor:clients'), connectClient: client => ipcRenderer.invoke('editor:client-connect', client),
  copyClientSetup: client => ipcRenderer.invoke('editor:client-copy', client), copyStatusPrompt: () => ipcRenderer.invoke('editor:prompt-copy'),
  openClientDocs: client => ipcRenderer.invoke('editor:client-docs', client),
  copyDrawingPrompt: () => ipcRenderer.invoke('editor:drawing-prompt-copy'), getRecentOperations: () => ipcRenderer.invoke('editor:operations'),
  onMcpOperation: listener => { const receive = (_event: Electron.IpcRendererEvent, payload: Parameters<typeof listener>[0]) => listener(payload); ipcRenderer.on('editor:operation', receive); return () => { ipcRenderer.removeListener('editor:operation', receive); }; },
};
contextBridge.exposeInMainWorld('editor', api);
