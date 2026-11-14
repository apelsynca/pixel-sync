export interface EditorStatus {
  instanceId: string;
  milestone: 'foundation';
  document: null;
  mcp: { enabled: boolean; endpoint: string | null; error: string | null };
}
export interface EditorApi {
  getStatus(): Promise<EditorStatus>;
  setMcpEnabled(enabled: boolean): Promise<EditorStatus>;
}
declare global { interface Window { editor: EditorApi } }
