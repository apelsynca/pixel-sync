import type { DocumentInfo } from '../core/document';
import type { Guard, Operation } from '../core/schema';
import type { DocumentEvent } from '../application/commands';
import type { FileState } from '../persistence/files';
export interface FileStatus extends FileState { recoveryAvailable: boolean; recoveryError: string | null }
export type ClientId = 'codex' | 'claude-code';
export interface McpOperation { id: string; at: string; client: ClientId | 'generic'; tool: string; outcome: 'success' | 'error'; summary: string; durationMs: number; documentId?: string; revision?: number }
export interface ClientSetup { client: ClientId; detected: boolean; configured: boolean; configPath: string; issue: string | null; lastStatusCall: string | null }
export interface FramePixels { documentId: string; revision: number; frameId: string; width: number; height: number; layers: { id: string; visible: boolean; pixels: Uint8Array }[] }
export interface EditorStatus {
  instanceId: string;
  milestone: 'foundation' | 'manual-editor' | 'mcp-editor' | 'files';
  document: DocumentInfo | null;
  mcp: { enabled: boolean; endpoint: string | null; error: string | null };
}
export interface EditorApi {
  getStatus(): Promise<EditorStatus>;
  setMcpEnabled(enabled: boolean): Promise<EditorStatus>;
  getDocument(): Promise<DocumentInfo | null>;
  edit(input: Guard & { operations: Operation[] }): Promise<void>;
  undo(input: Guard): Promise<void>;
  redo(input: Guard): Promise<void>;
  newDocument(input: { width: number; height: number }): Promise<DocumentInfo | null>;
  getFrame(input: Guard & { frameId: string; allLayers?: boolean }): Promise<FramePixels>;
  beginGesture(input: Guard): Promise<string>;
  commitGesture(input: { id: string; operations: Operation[] }): Promise<void>;
  cancelGesture(id: string): Promise<void>;
  onDocument(listener: (event: DocumentEvent) => void): () => void;
  getClients(): Promise<ClientSetup[]>;
  connectClient(client: ClientId): Promise<ClientSetup[]>;
  copyClientSetup(client: ClientId): Promise<void>;
  copyStatusPrompt(): Promise<void>;
  openClientDocs(client: ClientId): Promise<void>;
  copyDrawingPrompt(): Promise<void>;
  getRecentOperations(): Promise<McpOperation[]>;
  onMcpOperation(listener: (operation: McpOperation) => void): () => void;
  getFileState(): Promise<FileStatus>;
  onFileState(listener: (state: FileStatus) => void): () => void;
  saveProject(saveAs?: boolean): Promise<boolean>;
  openProject(): Promise<void>;
  importPng(): Promise<void>;
  exportPng(frameId: string): Promise<void>;
  exportSpriteSheet(input: { name: string; columns: number }): Promise<void>;
  chooseWorkspace(): Promise<void>;
  clearWorkspace(): Promise<void>;
  recoverArtwork(): Promise<void>;
  discardRecovery(): Promise<void>;
}
declare global { interface Window { editor: EditorApi } }
