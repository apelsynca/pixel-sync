import { Menu, type BrowserWindow, type MenuItemConstructorOptions } from 'electron';
import type { EditorMenuCommand, EditorMenuState } from '../shared/api';

export function installEditorMenu(window: BrowserWindow) {
  const action = (id: EditorMenuCommand, label: string, accelerator: string): MenuItemConstructorOptions => ({
    id, label, accelerator, registerAccelerator: false, enabled: false,
    click: () => { if (!window.isDestroyed()) window.webContents.send('editor:menu-command', id); },
  });
  const menu = Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' as const }] : []),
    { label: 'File', submenu: [
      action('new', 'New canvas…', 'CmdOrCtrl+N'),
      action('open', 'Open project…', 'CmdOrCtrl+O'),
      { type: 'separator' },
      action('save', 'Save', 'CmdOrCtrl+S'),
      action('save-as', 'Save as…', 'CmdOrCtrl+Shift+S'),
      { type: 'separator' },
      action('import', 'Import PNG…', 'CmdOrCtrl+I'),
      action('export-png', 'Export frame PNG…', 'CmdOrCtrl+E'),
      action('export-sheet', 'Export sprite sheet…', 'CmdOrCtrl+Shift+E'),
      { type: 'separator' },
      { role: process.platform === 'darwin' ? 'close' : 'quit' },
    ] },
    { label: 'Edit', submenu: [
      action('undo', 'Undo', 'CmdOrCtrl+Z'),
      action('redo', 'Redo', 'CmdOrCtrl+Shift+Z'),
      { type: 'separator' }, { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
    ] },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ]);
  Menu.setApplicationMenu(menu);
  return (state: EditorMenuState) => {
    for (const id of ['new', 'open', 'save', 'save-as', 'import', 'export-png', 'export-sheet', 'undo', 'redo']) {
      const item = menu.getMenuItemById(id);
      if (item) item.enabled = id === 'undo' ? state.canUndo : id.startsWith('redo') ? state.canRedo : state.enabled;
    }
  };
}
