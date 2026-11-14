import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { EditorStatus } from '../shared/api';
import './style.css';
function Editor() {
  const [status, setStatus] = useState<EditorStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { window.editor.getStatus().then(setStatus).catch(cause => setError(String(cause))); }, []);
  async function toggle() {
    setBusy(true);
    try { setStatus(await window.editor.setMcpEnabled(!status?.mcp.enabled)); setError(''); }
    catch (cause) { setError(String(cause)); }
    finally { setBusy(false); }
  }
  return <main><header><span className="logo">▦</span><h1>Pixel Editor</h1><span className="badge">Foundation preview</span></header><div className="workspace"><section className="stage"><div className="canvas" aria-label="Transparent canvas placeholder" /><p>32 × 32 · canvas preview</p><small>Drawing tools arrive with the document engine.</small></section><aside><h2>Local MCP connection</h2><p>Connect your desktop assistant to this running editor.</p><button disabled={!status || busy} onClick={toggle}>{busy ? 'Updating…' : status?.mcp.enabled ? 'Disable MCP' : 'Enable MCP'}</button><p className="status">{status?.mcp.enabled ? '● Listening locally' : '○ Disabled'}</p>{status?.mcp.endpoint && <code>{status.mcp.endpoint}</code>}<p className="error" role="alert">{error || status?.mcp.error}</p><h3>Client setup</h3><p>Launch the installed executable with <code>--mcp-stdio</code>. Keep this window open. The bridge reads credentials automatically.</p><p>The initial <code>get_status</code> tool confirms both connections reach this instance.</p></aside></div><footer>Local desktop workspace · Windows 11 target</footer></main>;
}
createRoot(document.getElementById('root')!).render(<Editor />);
