import { contextBridge, ipcRenderer } from 'electron';
import type { EditorApi } from '../shared/api';
const api: EditorApi = { getStatus: () => ipcRenderer.invoke('editor:status'), setMcpEnabled: enabled => ipcRenderer.invoke('editor:mcp-enable', enabled) };
contextBridge.exposeInMainWorld('editor', api);
