import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import type { DocumentInfo } from '../core/document';
import type { Operation } from '../core/schema';
import { ConnectionPanel } from './ConnectionPanel';
import { documentGuard, DrawingCanvas, Thumbnail, type Tool } from './Canvas';
import { playbackFrame } from './playback';
import type { EditorMenuCommand, FileStatus } from '../shared/api';
import './style.css';

const tools: { id: Tool; icon: string; name: string; key: string }[] = [
  { id: 'pencil', icon: '✎', name: 'Pencil', key: 'B' }, { id: 'eraser', icon: '▱', name: 'Eraser', key: 'E' },
  { id: 'fill', icon: '◩', name: 'Fill', key: 'F' }, { id: 'line', icon: '╱', name: 'Line', key: 'L' },
  { id: 'rectangle', icon: '□', name: 'Rectangle', key: 'R' }, { id: 'picker', icon: '⌖', name: 'Picker', key: 'I' }, { id: 'hand', icon: '✥', name: 'Pan', key: 'H' },
];
const defaultPalette = ['#F4F1DEFF', '#E9C46AFF', '#F4A261FF', '#E76F51FF', '#B83B5EFF', '#6A2C70FF', '#355C7DFF', '#264653FF', '#2A9D8FFF', '#8AB17DFF', '#A8DADCFF', '#457B9DFF', '#1D3557FF', '#141B23FF', '#7F8C9AFF', '#FFFFFFFF'];
function Editor() {
  const [document, setDocument] = useState<DocumentInfo>();
  const documentRef = useRef<DocumentInfo | undefined>(undefined);
  const [selectedFrame, setFrame] = useState(''), [layerId, setLayer] = useState('');
  const [tool, setTool] = useState<Tool>('pencil'), [color, setColor] = useState('#E9C46AFF');
  const [zoom, setZoom] = useState(12), [grid, setGrid] = useState(false), [onion, setOnion] = useState(false), [filled, setFilled] = useState(false);
  const [fitRequest, setFitRequest] = useState(0);
  const [editingText, setEditingText] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [coordinates, setCoordinates] = useState('—');
  const [connections, setConnections] = useState(false), [newCanvas, setNewCanvas] = useState(false), [newWidth, setNewWidth] = useState(32), [newHeight, setNewHeight] = useState(32);
  const [playing, setPlaying] = useState(false), [displayFrame, setDisplayFrame] = useState(''), [selectedClip, setSelectedClip] = useState('');
  const playbackClock = useRef({ key: '', elapsed: 0 });
  const [clipEditor, setClipEditor] = useState(false), [clipName, setClipName] = useState(''), [clipFrames, setClipFrames] = useState<string[]>([]), [clipLoop, setClipLoop] = useState(true);
  const [fileStatus, setFileStatus] = useState<FileStatus>();
  const [sheetDialog, setSheetDialog] = useState(false), [sheetName, setSheetName] = useState('sprite-sheet'), [sheetColumns, setSheetColumns] = useState(1);
  useEffect(() => { const unsubscribe = window.editor.onFileState(setFileStatus); void window.editor.getFileState().then(setFileStatus).catch(cause => setError(String(cause))); return unsubscribe; }, []);
  useEffect(() => {
    function receive(next: DocumentInfo) {
      const before = documentRef.current;
      documentRef.current = next; setDocument(next); setPlaying(false); setDisplayFrame(''); playbackClock.current.key = '';
      setFrame(current => next.frames.some(frame => frame.id === current) ? current : next.frames[Math.min(Math.max(0, before?.frames.findIndex(frame => frame.id === current) ?? 0), next.frames.length - 1)].id);
      setLayer(current => next.layers.some(layer => layer.id === current) ? current : next.layers.at(-1)!.id);
      setSelectedClip(current => next.clips.some(clip => clip.name === current) ? current : '');
    }
    const unsubscribe = window.editor.onDocument(event => receive(event.document));
    void window.editor.getDocument().then(next => { if (next && (!documentRef.current || documentRef.current.documentId !== next.documentId || documentRef.current.revision <= next.revision)) receive(next); }).catch(cause => setError(String(cause)));
    return unsubscribe;
  }, []);
  async function perform(action: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true); setPlaying(false); setDisplayFrame(''); playbackClock.current.key = ''; setError('');
    try { await action(); } catch (cause) { setError(String(cause)); } finally { setBusy(false); }
  }
  function edit(...operations: Operation[]) { if (document) void perform(() => window.editor.edit({ ...documentGuard(document), operations })); }
  function showSheetDialog() { if (document) { setError(''); setSheetColumns(Math.ceil(Math.sqrt(document.frames.length))); setSheetDialog(true); } }
  const changeZoom = useCallback((delta: number) => { setZoom(current => Math.max(1, Math.min(32, current + delta))); }, []);
  function navigate(delta: number) {
    if (!document) return; setPlaying(false); setDisplayFrame(''); playbackClock.current.key = '';
    const index = document.frames.findIndex(frame => frame.id === selectedFrame);
    setFrame(document.frames[(index + delta + document.frames.length) % document.frames.length].id);
  }
  function pausePlayback(frameId = displayFrame || selectedFrame) {
    setPlaying(false); setFrame(frameId); setDisplayFrame('');
    // Keep the elapsed clock when the visible frame becomes the edit selection.
    if (document) playbackClock.current.key = `${document.documentId}:${document.revision}:${selectedClip}:${frameId}`;
  }
  function togglePlayback() { if (playing) pausePlayback(); else setPlaying(true); }
  useEffect(() => {
    if (!playing || !document) return;
    const clip = document.clips.find(item => item.name === selectedClip), ids = clip?.frameIds ?? document.frames.map(frame => frame.id);
    const start = performance.now();
    const startIndex = ids.indexOf(selectedFrame);
    const offset = startIndex < 0 ? 0 : ids.slice(0, startIndex).reduce((sum, id) => sum + document.frames.find(frame => frame.id === id)!.duration, 0);
    const key = `${document.documentId}:${document.revision}:${selectedClip}:${selectedFrame}`;
    const total = ids.reduce((sum, id) => sum + document.frames.find(frame => frame.id === id)!.duration, 0);
    if (playbackClock.current.key !== key || (clip?.loop === false && playbackClock.current.elapsed >= total)) playbackClock.current = { key, elapsed: offset };
    const base = playbackClock.current.elapsed;
    let request: number;
    const tick = () => {
      playbackClock.current.elapsed = performance.now() - start + base;
      const result = playbackFrame(document.frames, ids, clip?.loop ?? true, playbackClock.current.elapsed);
      setDisplayFrame(result.frameId);
      if (result.finished) pausePlayback(result.frameId); else request = requestAnimationFrame(tick);
    };
    tick(); return () => { cancelAnimationFrame(request); if (playbackClock.current.key === key) playbackClock.current.elapsed = performance.now() - start + base; };
  }, [playing, document, selectedClip, selectedFrame]);
  useEffect(() => {
    const update = () => setEditingText(!!window.document.activeElement?.matches('input,textarea,[contenteditable]'));
    window.addEventListener('focusin', update); window.addEventListener('focusout', update);
    return () => { window.removeEventListener('focusin', update); window.removeEventListener('focusout', update); };
  }, []);
  const menuEnabled = !!document && !busy && !connections && !newCanvas && !clipEditor && !sheetDialog && !fileStatus?.recoveryAvailable;
  useEffect(() => {
    void window.editor.setMenuState({ enabled: menuEnabled, canUndo: editingText || (menuEnabled && !!document?.history.undo), canRedo: editingText || (menuEnabled && !!document?.history.redo) }).catch(cause => setError(String(cause)));
  }, [menuEnabled, editingText, document?.history.undo, document?.history.redo]);
  function handleMenuCommand(command: EditorMenuCommand) {
    if ((command === 'undo' || command === 'redo') && window.document.activeElement?.matches('input,textarea,[contenteditable]')) {
      window.document.execCommand(command); return;
    }
    if (!menuEnabled || !document) return;
    switch (command) {
      case 'new': setNewCanvas(true); break;
      case 'open': void perform(() => window.editor.openProject()); break;
      case 'save': void perform(() => window.editor.saveProject()); break;
      case 'save-as': void perform(() => window.editor.saveProject(true)); break;
      case 'import': void perform(() => window.editor.importPng()); break;
      case 'export-png': void perform(() => window.editor.exportPng(selectedFrame)); break;
      case 'export-gif': void perform(() => window.editor.exportGif({ clip: selectedClip || undefined })); break;
      case 'export-sheet': showSheetDialog(); break;
      case 'undo': if (document.history.undo) void perform(() => window.editor.undo(documentGuard(document))); break;
      case 'redo': if (document.history.redo) void perform(() => window.editor.redo(documentGuard(document))); break;
    }
  }
  useLayoutEffect(() => window.editor.onMenuCommand(handleMenuCommand));
  useLayoutEffect(() => {
    const keydown = (event: KeyboardEvent) => {
      const element = event.target as HTMLElement;
      if (element.closest('input,textarea,select,[contenteditable]') || connections || newCanvas || clipEditor || sheetDialog || fileStatus?.recoveryAvailable || busy || !document) return;
      const key = event.key.toLowerCase(), control = event.ctrlKey || event.metaKey;
      if (control && event.altKey && key === 'e') {
        event.preventDefault(); handleMenuCommand('export-gif');
      } else if (control && !event.altKey) {
        const shortcuts: Record<string, EditorMenuCommand> = { n: 'new', o: 'open', s: event.shiftKey ? 'save-as' : 'save', i: 'import', e: event.shiftKey ? 'export-sheet' : 'export-png', z: event.shiftKey ? 'redo' : 'undo', y: 'redo' };
        const command = shortcuts[key];
        if (command) { event.preventDefault(); handleMenuCommand(command); }
      } else if (!control) {
        const chosen = tools.find(tool => tool.key.toLowerCase() === key);
        if (chosen) { event.preventDefault(); setTool(chosen.id); }
        else if (key === 'g') setGrid(value => !value);
        else if (key === 'o') setOnion(value => !value);
        else if (key === ' ') { event.preventDefault(); togglePlayback(); }
        else if (key === 'arrowleft') { event.preventDefault(); navigate(-1); }
        else if (key === 'arrowright') { event.preventDefault(); navigate(1); }
        else if (key === '+' || key === '=') changeZoom(1);
        else if (key === '-') changeZoom(-1);
      }
    };
    window.addEventListener('keydown', keydown); return () => window.removeEventListener('keydown', keydown);
  });
  if (!document) return <main className="loading">{error || 'Opening your pixel workspace…'}</main>;
  const frameIndex = document.frames.findIndex(frame => frame.id === selectedFrame), frame = document.frames[frameIndex];
  const selectedLayer = document.layers.find(layer => layer.id === layerId);
  const activeFrame = displayFrame && document.frames.some(frame => frame.id === displayFrame) ? displayFrame : selectedFrame;
  const palette = document.palette.length ? document.palette : defaultPalette;
  function deleteFrame() {
    if (!frame || !document) return;
    const references = document.clips.filter(clip => clip.frameIds.includes(frame.id));
    if (references.length && !window.confirm(`Remove this frame from ${references.length} animation clip(s) as well? Empty clips will be removed. You can undo this.`)) return;
    const operations: Operation[] = references.map(clip => clip.frameIds.length === 1 ? { type: 'delete_clip', name: clip.name } : { type: 'set_clip', ...clip, frameIds: clip.frameIds.filter(id => id !== frame.id) });
    edit(...operations, { type: 'delete_frame', frameId: frame.id });
  }
  function openClip() {
    const clip = document!.clips.find(clip => clip.name === selectedClip);
    setClipName(clip?.name ?? 'walk'); setClipFrames(clip?.frameIds ?? document!.frames.map(frame => frame.id)); setClipLoop(clip?.loop ?? true); setClipEditor(true);
  }
  return <main className="editor-shell">
    <header><div className="brand"><span className="logo">▦</span><div><h1>PixelSync</h1><span className="eyebrow">A LITTLE PIXEL, A BIG IDEA</span></div></div><div className="document-title">{fileStatus?.documentId === document.documentId && fileStatus.projectPath ? fileStatus.projectPath.split(/[\\/]/).at(-1) : 'Untitled sprite'} {document.dirty && <span title="Unsaved changes">●</span>}<small>{document.width} × {document.height} px</small></div><button className="primary" disabled={busy} onClick={() => setConnections(true)}>Connect AI client ↗</button></header>
    <div className="document-toolbar"><span className="spacer" /><button aria-pressed={grid} onClick={() => setGrid(value => !value)} title="Pixel grid · G">▦ Grid</button><button aria-pressed={onion} onClick={() => setOnion(value => !value)} title="Onion skin · O">◉ Onion skin</button><span className="divider" /><button onClick={() => changeZoom(-1)} aria-label="Zoom out">−</button><button onClick={() => setFitRequest(value => value + 1)}>Fit</button><span className="zoom-value">{zoom * 100}%</span><button onClick={() => changeZoom(1)} aria-label="Zoom in">＋</button></div>
    {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Dismiss error">✕</button></div>}
    {!fileStatus?.recoveryAvailable && fileStatus?.recoveryError && <div className="error-banner" role="alert"><span>{fileStatus.recoveryError}</span><button onClick={() => void perform(() => window.editor.saveProject())}>Save project…</button></div>}
    <div className="workspace"><nav className="tools" aria-label="Drawing tools">{tools.map(item => <button key={item.id} disabled={busy} aria-label={item.name} aria-pressed={tool === item.id} title={`${item.name} · ${item.key}`} onClick={() => setTool(item.id)}><span>{item.icon}</span><small>{item.key}</small></button>)}<div className="tool-color" style={{ backgroundColor: color.slice(0, 7) }} title={color} /></nav>
      <section className="center"><div className="stage-label"><span>{playing ? 'PLAYING' : tools.find(item => item.id === tool)?.name.toUpperCase()}</span><span>{tool === 'rectangle' ? <label><input type="checkbox" checked={filled} disabled={busy} onChange={event => setFilled(event.target.checked)} /> Filled rectangle</label> : 'One pixel at a time.'}</span></div>
        <DrawingCanvas document={document} frameId={activeFrame} layerId={layerId} tool={tool} color={color} zoom={zoom} grid={grid} onion={onion} filled={filled} playing={playing} busy={busy} fitZoom={setZoom} fitRequest={fitRequest} changeZoom={changeZoom} pick={setColor} coordinates={setCoordinates} setBusy={setBusy} error={setError} />
        <section className="timeline" aria-label="Animation timeline"><div className="timeline-heading"><h2>Timeline <span>{document.frames.length} frames</span></h2><div className="timeline-actions"><button disabled={busy} onClick={() => navigate(-1)} aria-label="Previous frame">‹</button><button disabled={busy} onClick={togglePlayback} title="Play or pause · Space">{playing ? 'Ⅱ Pause' : '▷ Play'}</button><button disabled={busy} onClick={() => navigate(1)} aria-label="Next frame">›</button><select aria-label="Playback clip" disabled={busy} value={selectedClip} onChange={event => { setSelectedClip(event.target.value); setPlaying(false); setDisplayFrame(''); playbackClock.current.key = ''; }}><option value="">All frames · loop</option>{document.clips.map(clip => <option key={clip.name} value={clip.name}>{clip.name}{clip.loop ? ' · loop' : ''}</option>)}</select><button disabled={busy} title="Export the selected clip or all frames as GIF" onClick={() => handleMenuCommand('export-gif')}>Export GIF…</button></div></div>
          <div className="frame-strip">{document.frames.map((item, index) => <button className={`frame ${activeFrame === item.id ? 'selected' : ''}`} key={item.id} disabled={busy} aria-label={`Frame ${index + 1}`} onClick={() => { setPlaying(false); setDisplayFrame(''); playbackClock.current.key = ''; setFrame(item.id); }}><Thumbnail document={document} frameId={item.id} /><span>{String(index + 1).padStart(2, '0')}<small>{item.duration} ms</small></span></button>)}<button disabled={busy || document.frames.length >= 64} className="add-frame" title="Add transparent frame" onClick={() => edit({ type: 'add_frame' })}>＋</button></div>
          <div className="frame-controls"><button disabled={busy || !frame || document.frames.length >= 64} onClick={() => edit({ type: 'duplicate_frame', frameId: selectedFrame })}>Duplicate</button><button disabled={busy || document.frames.length === 1} onClick={deleteFrame}>Delete</button><button disabled={busy || frameIndex < 1} onClick={() => edit({ type: 'move_frame', frameId: selectedFrame, index: frameIndex - 1 })}>← Move</button><button disabled={busy || frameIndex >= document.frames.length - 1} onClick={() => edit({ type: 'move_frame', frameId: selectedFrame, index: frameIndex + 1 })}>Move →</button><label>Duration <input aria-label="Frame duration" key={`${selectedFrame}:${frame?.duration}`} type="number" min={10} max={60000} defaultValue={frame?.duration ?? 100} disabled={busy} onBlur={event => { const duration = Number(event.target.value); if (frame && duration !== frame.duration) edit({ type: 'set_frame_duration', frameId: frame.id, duration }); }} /> ms</label></div>
        </section>
      </section>
      <aside><section className="inspector-section"><h2>Color <span>RGBA</span></h2><div className="color-input"><input aria-label="Foreground color" type="color" value={color.slice(0, 7)} onChange={event => setColor(event.target.value.toUpperCase() + color.slice(7))} /><input aria-label="RGBA hex" key={color} defaultValue={color} maxLength={9} onBlur={event => { if (/^#[\da-f]{8}$/i.test(event.target.value)) setColor(event.target.value.toUpperCase()); else { event.target.value = color; setError("Use an RGBA color such as #E9C46AFF."); } }} onKeyDown={event => { if (event.key === "Enter") event.currentTarget.blur(); }} onFocus={event => event.target.select()} /></div><label className="alpha-label">Alpha <input type="range" min={0} max={255} value={parseInt(color.slice(7), 16)} onChange={event => setColor(color.slice(0, 7) + Number(event.target.value).toString(16).padStart(2, '0').toUpperCase())} /><span>{parseInt(color.slice(7), 16)}</span></label><div className="palette">{palette.map((swatch, index) => <button key={index} aria-label={`Swatch ${index + 1}`} style={{ backgroundColor: swatch.slice(0, 7) }} title={`${swatch} · right click to replace`} onClick={() => setColor(swatch)} onContextMenu={event => { event.preventDefault(); if (!busy) edit({ type: 'set_palette', colors: palette.map((value, i) => i === index ? color : value) }); }} />)}</div><button disabled={busy || palette.length >= 256} onClick={() => edit({ type: 'set_palette', colors: [...palette, color] })}>＋ Add swatch</button><small>Right click a swatch to replace it.</small></section>
        <section className="inspector-section"><div className="section-heading"><h2>Layers <span>{document.layers.length} / 16</span></h2><button aria-label="Add layer" disabled={busy || document.layers.length >= 16} onClick={() => edit({ type: 'add_layer', name: `Layer ${document.layers.length + 1}` })}>＋</button></div><div className="layer-list">{[...document.layers].reverse().map(item => <div className={`layer-row ${layerId === item.id ? 'selected' : ''}`} key={item.id}><button disabled={busy} aria-label={`${item.visible ? 'Hide' : 'Show'} ${item.name}`} onClick={() => edit({ type: 'set_layer_visibility', layerId: item.id, visible: !item.visible })}>{item.visible ? '◉' : '○'}</button><button className="layer-select" disabled={busy} onClick={() => setLayer(item.id)}>{item.name}</button></div>)}</div>{selectedLayer && <input aria-label="Layer name" key={`${selectedLayer.id}:${selectedLayer.name}`} defaultValue={selectedLayer.name} maxLength={128} disabled={busy} onBlur={event => { if (event.target.value !== selectedLayer.name) edit({ type: 'rename_layer', layerId, name: event.target.value }); }} />}<div className="row"><button disabled={busy || document.layers.findIndex(layer => layer.id === layerId) === document.layers.length - 1} onClick={() => edit({ type: 'move_layer', layerId, index: document.layers.findIndex(layer => layer.id === layerId) + 1 })}>↑ Raise</button><button disabled={busy || document.layers.findIndex(layer => layer.id === layerId) === 0} onClick={() => edit({ type: 'move_layer', layerId, index: document.layers.findIndex(layer => layer.id === layerId) - 1 })}>↓ Lower</button><button aria-label="Delete layer" disabled={busy || document.layers.length === 1} onClick={() => edit({ type: 'delete_layer', layerId })}>−</button></div></section>
        <section className="inspector-section"><div className="section-heading"><h2>Animation clips</h2><button disabled={busy} onClick={() => { setSelectedClip(''); setClipName('walk'); setClipFrames(document.frames.map(frame => frame.id)); setClipLoop(true); setClipEditor(true); }} aria-label="Add clip">＋</button></div>{document.clips.length === 0 ? <p className="muted">Give your animation a name.<br />Try idle, walk, or jump.</p> : document.clips.map(clip => <button className="clip-row" aria-pressed={selectedClip === clip.name} key={clip.name} onClick={() => { setSelectedClip(clip.name); setPlaying(false); setDisplayFrame(''); playbackClock.current.key = ''; }}>{clip.name}<small>{clip.frameIds.length} frames {clip.loop ? '↻' : '→'}</small></button>)}<button disabled={busy || !selectedClip} onClick={openClip}>Edit selected clip</button><button disabled={busy || !selectedClip} onClick={() => edit({ type: 'delete_clip', name: selectedClip })}>Delete clip</button></section>
      </aside>
    </div>
    <footer><span><i className="status-dot" /> LOCAL WORKSPACE</span><span>{coordinates} px</span><span>Frame {frameIndex + 1} / {document.frames.length}</span><span>Revision {document.revision}</span><span className="spacer" /><span>Ctrl + wheel to zoom · Middle drag to pan · Space to play</span></footer>
    {connections && <ConnectionPanel close={() => setConnections(false)} />}
    {fileStatus?.recoveryAvailable && <div className="modal-backdrop"><section className="small-dialog" role="dialog" aria-modal="true" aria-label="Recover artwork"><h2>Recover your artwork?</h2><p>A recovery snapshot from the previous session is available. Recover it as an unsaved project, or discard it and start fresh. Closing the app keeps this offer for next time.</p>{(fileStatus.recoveryError || error) && <p className="error" role="alert">{fileStatus.recoveryError || error}</p>}<div className="row"><button disabled={busy} onClick={() => void perform(() => window.editor.discardRecovery())}>Discard recovery</button><button className="primary" disabled={busy || !!fileStatus.recoveryError} onClick={() => void perform(() => window.editor.recoverArtwork())}>Recover artwork</button></div></section></div>}
    {sheetDialog && <div className="modal-backdrop"><form className="small-dialog" role="dialog" aria-label="Export sprite sheet" onSubmit={event => { event.preventDefault(); const width = document.width * sheetColumns, height = document.height * Math.ceil(document.frames.length / sheetColumns); if (width > 4096 || height > 4096) { setError('Sheet exceeds 4096×4096. Choose a more compact column count.'); return; } void perform(async () => { await window.editor.exportSpriteSheet({ name: sheetName, columns: sheetColumns }); setSheetDialog(false); }); }}><h2>Export sprite sheet</h2>{error && <p className="error" role="alert">{error}</p>}<p>Choose a new folder name. The next dialog selects its parent folder. Existing export folders are preserved.</p><label>Folder name <input required value={sheetName} maxLength={128} onChange={event => setSheetName(event.target.value)} /></label><label>Columns <input required type="number" min={1} max={document.frames.length} value={sheetColumns} onChange={event => setSheetColumns(Number(event.target.value))} /></label><p>{document.frames.length} frames · {document.width * sheetColumns} × {document.height * Math.ceil(document.frames.length / Math.max(1, sheetColumns))} px. Includes sheet.png and sheet.json with frame timing and clips.</p><div className="row"><button type="button" onClick={() => setSheetDialog(false)}>Cancel</button><button className="primary" disabled={busy}>Choose parent folder…</button></div></form></div>}

    {newCanvas && <div className="modal-backdrop"><form className="small-dialog" role="dialog" aria-label="New canvas" onSubmit={event => { event.preventDefault(); void perform(async () => { await window.editor.newDocument({ width: newWidth, height: newHeight }); setNewCanvas(false); }); }}><h2>A fresh canvas</h2><p>Start with transparent pixels and one animation frame.</p><label>Width <input type="number" min={1} max={512} required value={newWidth} onChange={event => setNewWidth(Number(event.target.value))} /></label><label>Height <input type="number" min={1} max={512} required value={newHeight} onChange={event => setNewHeight(Number(event.target.value))} /></label><div className="row"><button type="button" onClick={() => setNewCanvas(false)}>Cancel</button><button className="primary" disabled={busy}>Create canvas</button></div></form></div>}
    {clipEditor && <div className="modal-backdrop"><form className="small-dialog" role="dialog" aria-label="Edit animation clip" onSubmit={event => { event.preventDefault(); const name = clipName.trim(); if (name !== selectedClip && document.clips.some(clip => clip.name === name)) { setError('A clip already uses that name. Choose a different name.'); return; } void perform(async () => { const operations: Operation[] = selectedClip && selectedClip !== name ? [{ type: 'delete_clip', name: selectedClip }] : []; operations.push({ type: 'set_clip', name, frameIds: clipFrames, loop: clipLoop }); await window.editor.edit({ ...documentGuard(document), operations }); setSelectedClip(name); setClipEditor(false); }); }}><h2>Animation clip</h2><label>Name <input required maxLength={128} value={clipName} onChange={event => setClipName(event.target.value)} /></label><label><input type="checkbox" checked={clipLoop} onChange={event => setClipLoop(event.target.checked)} /> Loop playback</label><p>Select frames, then arrange their playback order.</p><div className="clip-frame-options">{document.frames.map((frame, index) => <label key={frame.id}><input type="checkbox" checked={clipFrames.includes(frame.id)} onChange={event => setClipFrames(current => event.target.checked ? [...current, frame.id] : current.filter(id => id !== frame.id))} />{index + 1}</label>)}</div><ol className="clip-order">{clipFrames.map((id, index) => <li key={id}>Frame {document.frames.findIndex(frame => frame.id === id) + 1}<button type="button" disabled={index === 0} aria-label={`Move clip frame ${index + 1} earlier`} onClick={() => setClipFrames(current => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; })}>↑</button><button type="button" disabled={index === clipFrames.length - 1} aria-label={`Move clip frame ${index + 1} later`} onClick={() => setClipFrames(current => { const next = [...current]; [next[index + 1], next[index]] = [next[index], next[index + 1]]; return next; })}>↓</button></li>)}</ol><div className="row"><button type="button" onClick={() => setClipEditor(false)}>Cancel</button><button className="primary" disabled={busy || clipFrames.length === 0}>Save clip</button></div></form></div>}
  </main>;
}
createRoot(globalThis.document.getElementById('root')!).render(<Editor />);
