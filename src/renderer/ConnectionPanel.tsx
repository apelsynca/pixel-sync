import { useEffect, useState } from 'react';
import type { ClientId, ClientSetup, EditorStatus, McpOperation } from '../shared/api';

export function ConnectionPanel({ close }: { close: () => void }) {
  const [clients, setClients] = useState<ClientSetup[]>([]);
  const [status, setStatus] = useState<EditorStatus>();
  const [operations, setOperations] = useState<McpOperation[]>([]);
  const [instructions, setInstructions] = useState<ClientId | null>(null);
  const [busy, setBusy] = useState(false), [message, setMessage] = useState(''), [error, setError] = useState('');
  async function refresh() { const [nextClients, nextStatus] = await Promise.all([window.editor.getClients(), window.editor.getStatus()]); setClients(nextClients); setStatus(nextStatus); }
  useEffect(() => { void refresh().catch(cause => setError(String(cause))); }, []);
  useEffect(() => {
    const unsubscribe = window.editor.onMcpOperation(operation => setOperations(current => [operation, ...current].slice(0, 50)));
    void window.editor.getRecentOperations().then(snapshot => setOperations(current => [...current, ...snapshot].filter((operation, index, all) => all.findIndex(item => item.id === operation.id) === index).slice(0, 50))).catch(cause => setError(String(cause)));
    return unsubscribe;
  }, []);
  async function perform(action: () => Promise<unknown>, success: string) {
    setBusy(true); setError('');
    try { await action(); await refresh(); setMessage(success); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  return <div className="modal-backdrop"><section className="connection-panel" role="dialog" aria-modal="true" aria-label="Connect an AI client">
    <div className="section-heading"><div><span className="eyebrow">LOCAL ASSISTANTS</span><h2>Connect your AI client</h2></div><button onClick={close} aria-label="Close connections">✕</button></div>
    <p>Choose a client. Pixel Editor configures the connection and authentication for you.</p>
    <p className="connection-status">{status?.mcp.enabled ? '● Server available on this computer' : '○ Server disabled · Connect will enable it'}</p>
    <div className="client-cards">{clients.map(client => {
      const name = client.client === 'codex' ? 'Codex' : 'Claude Code';
      return <article key={client.client} className="client-card"><h3>{name}</h3><p>{client.lastStatusCall ? `Status call received · ${new Date(client.lastStatusCall).toLocaleTimeString()}` : client.configured ? 'Configured · waiting for a status call' : client.detected ? 'Client or configuration found · ready to connect' : 'Client not detected · you can configure it before installing'}</p>
        {client.issue && <p className="error">{client.issue}</p>}
        <button className="primary" disabled={busy} onClick={() => void perform(async () => { await window.editor.connectClient(client.client); setInstructions(client.client); }, `${name} configured. Restart the client and run the status prompt below.`)}>{client.configured ? 'Update connection' : `Connect to ${name}`}</button>
        <button onClick={() => setInstructions(client.client)}>Show instructions</button>
        <button disabled={busy} onClick={() => void perform(refresh, 'Connection states refreshed. Run the status prompt in your client to verify it.')}>Check connection</button>
      </article>;
    })}</div>
    {instructions && <div className="instructions"><h3>{instructions === 'codex' ? 'Codex' : 'Claude Code'} · connection guide</h3>
      <ol><li>Install {instructions === 'codex' ? 'Codex from the official OpenAI download or CLI instructions' : 'Claude Code from the official Anthropic installation instructions'} on this computer if needed.</li><li>Click <strong>Connect to {instructions === 'codex' ? 'Codex' : 'Claude Code'}</strong> above. If already configured, click <strong>Update connection</strong>.</li><li>Restart {instructions === 'codex' ? 'your Codex client' : 'Claude Code'} and open a new session. Use <code>/mcp</code> to inspect available servers. Confirm <code>pixel-editor</code> is enabled; client policies or project settings may override the user configuration.</li><li>Ask your assistant: <strong>Use pixel-editor to get its status.</strong></li><li>Click <strong>Check connection</strong> here. A received status call confirms this connection was used.</li></ol>
      <button onClick={() => void perform(() => window.editor.copyStatusPrompt(), 'Status prompt copied.')}>Copy first prompt</button>
      <button onClick={() => void perform(() => window.editor.openClientDocs(instructions), 'Official installation guide opened in your browser.')}>Open installation guide</button>
      <p>Keep Pixel Editor open. Both apps must reach this computer’s localhost endpoint. Windows/WSL and remote sessions need separate network setup.</p>
      <p><strong>Try drawing next:</strong> ask your assistant to inspect the document, add a new layer, and create a two-frame animation. It can draw, edit layers/frames/clips, read pixels, request PNG previews, and undo/redo. Changes appear live in this editor.</p>
      <button onClick={() => void perform(() => window.editor.copyDrawingPrompt(), 'Drawing prompt copied.')}>Copy first drawing prompt</button>
      <p>Choose the new clip in the timeline and press Play. Undo reverses the assistant’s last batch; your assistant can also undo or redo manual strokes. After another edit, it must read the current revision before retrying. Saving and file exports arrive in milestone 5.</p>
      <details><summary>Advanced setup and troubleshooting</summary><p>Configuration: <code>{clients.find(client => client.client === instructions)?.configPath}</code>. Connect preserves unrelated settings and makes a private backup of an existing file.</p><p>If automatic setup fails, close the client and retry. Check any reported permissions or configuration error. A different port or token needs Update connection. If local server startup fails, check the error below and close another app using its port.</p><p>The fallback below copies a configuration fragment containing a private credential. Merge its pixel-editor entry into the client configuration shown above; keep it private. This is optional when Connect succeeds.</p><button onClick={() => void perform(() => window.editor.copyClientSetup(instructions), 'Private configuration copied. It contains a credential; keep it private.')}>Copy private configuration</button></details>
    </div>}
    <div className="connection-controls"><button disabled={busy} onClick={() => void perform(() => window.editor.setMcpEnabled(!status?.mcp.enabled), 'Server setting updated.')}>{status?.mcp.enabled ? 'Disable MCP' : 'Enable MCP'}</button><code>{status?.mcp.endpoint}</code></div>
    <section className="recent-operations" aria-label="Recent MCP operations"><h3>Recent MCP operations <small>Last 50 · this session</small></h3>{operations.length ? <ol>{operations.map(operation => <li key={operation.id}><span className={operation.outcome === 'error' ? 'error' : ''}>{operation.tool}</span><small>{operation.client} · {operation.revision === undefined ? operation.summary : `r${operation.revision} · ${operation.summary}`} · {operation.durationMs} ms</small></li>)}</ol> : <p>No tool calls yet. Run the first prompt in your client.</p>}</section>
    <p role="status">{message}</p><p className="error" role="alert">{error || status?.mcp.error}</p>
  </section></div>;
}
