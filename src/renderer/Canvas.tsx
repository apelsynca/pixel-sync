import { useCallback, useEffect, useRef, useState, type PointerEvent } from 'react';
import type { DocumentInfo } from '../core/document';
import type { Operation } from '../core/schema';
import type { FramePixels } from '../shared/api';
import { composite, flood, line, paint, rgba } from '../core/drawing';
import { pixelPosition } from './playback';

export type Tool = 'pencil' | 'eraser' | 'fill' | 'line' | 'rectangle' | 'picker' | 'hand';
export const documentGuard = (document: DocumentInfo) => ({ documentId: document.documentId, expectedRevision: document.revision });
export function useFrame(document: DocumentInfo, frameId: string | undefined, allLayers = false) {
  const [snapshot, setSnapshot] = useState<FramePixels>();
  useEffect(() => {
    let cancelled = false;
    if (!frameId) { setSnapshot(undefined); return; }
    void window.editor.getFrame({ ...documentGuard(document), frameId, allLayers }).then(value => { if (!cancelled) setSnapshot(value); }).catch(() => { /* A newer revision schedules a replacement read. */ });
    return () => { cancelled = true; };
  }, [document.documentId, document.revision, frameId, allLayers]);
  return snapshot?.documentId === document.documentId && snapshot.frameId === frameId && snapshot.revision === document.revision ? snapshot : undefined;
}
function image(pixels: Uint8Array, width: number, height: number) {
  const canvas = globalThis.document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0); return canvas;
}
export function Thumbnail({ document, frameId }: { document: DocumentInfo; frameId: string }) {
  const ref = useRef<HTMLCanvasElement>(null), snapshot = useFrame(document, frameId);
  useEffect(() => { const context = ref.current?.getContext('2d'); if (!context || !snapshot) return; context.clearRect(0, 0, 40, 40); context.imageSmoothingEnabled = false; const scale = Math.min(40 / snapshot.width, 40 / snapshot.height); const w = snapshot.width * scale, h = snapshot.height * scale; context.drawImage(image(snapshot.layers[0].pixels, snapshot.width, snapshot.height), (40 - w) / 2, (40 - h) / 2, w, h); }, [snapshot]);
  return <canvas width={40} height={40} ref={ref} aria-hidden="true" className="thumbnail" />;
}
interface Stroke {
  id: Promise<string>; start: { x: number; y: number }; end: { x: number; y: number };
  pixels: Map<number, { x: number; y: number; color: string }>; tool: Tool; color: string; cancelled: boolean; overflow: boolean;
}
interface Props {
  document: DocumentInfo; frameId: string; layerId: string; tool: Tool; color: string; zoom: number; grid: boolean; filled: boolean; onion: boolean; playing: boolean; busy: boolean;
  pick: (color: string) => void; coordinates: (text: string) => void; setBusy: (busy: boolean) => void; error: (message: string) => void;
  fitZoom: (zoom: number) => void; fitRequest: number;
}
export function DrawingCanvas(props: Props) {
  const { document, frameId, layerId, tool, zoom, grid, filled } = props;
  const snapshot = useFrame(document, frameId, true);
  const index = document.frames.findIndex(frame => frame.id === frameId);
  const previous = useFrame(document, props.onion && !props.playing ? document.frames[index - 1]?.id : undefined);
  const next = useFrame(document, props.onion && !props.playing ? document.frames[index + 1]?.id : undefined);
  const canvas = useRef<HTMLCanvasElement>(null), viewport = useRef<HTMLDivElement>(null), stroke = useRef<Stroke | null>(null);
  const panning = useRef<{ x: number; y: number; left: number; top: number } | null>(null);
  const [preview, setPreview] = useState(0);
  const tick = useRef<number | null>(null);
  useEffect(() => {
    const area = viewport.current;
    if (area) props.fitZoom(Math.max(1, Math.min(32, Math.floor(Math.min((area.clientWidth - 144) / document.width, (area.clientHeight - 144) / document.height)))));
  }, [document.documentId, document.width, document.height, props.fitRequest, props.fitZoom]);
  const requestPaint = () => { if (tick.current === null) tick.current = requestAnimationFrame(() => { tick.current = null; setPreview(value => value + 1); }); };
  const cancel = useCallback(() => {
    const active = stroke.current; stroke.current = null;
    if (active) { active.cancelled = true; void active.id.then(id => window.editor.cancelGesture(id)).catch(() => undefined); props.setBusy(false); setPreview(value => value + 1); }
  }, [props.setBusy]);
  useEffect(() => { window.addEventListener('blur', cancel); const key = (event: KeyboardEvent) => { if (event.key === 'Escape') cancel(); }; window.addEventListener('keydown', key); return () => { window.removeEventListener('blur', cancel); window.removeEventListener('keydown', key); cancel(); if (tick.current !== null) cancelAnimationFrame(tick.current); }; }, [cancel]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !snapshot) return;
    const { width, height } = snapshot;
    context.clearRect(0, 0, width, height);
    for (const [neighbor, tint] of [[previous, [255, 90, 100]], [next, [90, 190, 255]]] as const) {
      if (!neighbor) continue;
      const pixels = neighbor.layers[0].pixels.slice();
      for (let i = 0; i < pixels.length; i += 4) { pixels[i] = tint[0]; pixels[i + 1] = tint[1]; pixels[i + 2] = tint[2]; pixels[i + 3] = Math.round(pixels[i + 3] * 0.22); }
      context.drawImage(image(pixels, width, height), 0, 0);
    }
    const active = stroke.current;
    const layers = snapshot.layers.filter(layer => layer.visible).map(layer => {
      if (!active || layer.id !== layerId) return layer.pixels;
      const pixels = layer.pixels.slice(), color = rgba(active.color);
      const put = (x: number, y: number) => paint(pixels, width, height, x, y, color);
      if (active.tool === 'pencil' || active.tool === 'eraser') for (const pixel of active.pixels.values()) put(pixel.x, pixel.y);
      if (active.tool === 'line') line(active.start.x, active.start.y, active.end.x, active.end.y, put);
      if (active.tool === 'fill') flood(pixels, width, height, active.start.x, active.start.y, color);
      if (active.tool === 'rectangle') {
        const left = Math.min(active.start.x, active.end.x), right = Math.max(active.start.x, active.end.x), top = Math.min(active.start.y, active.end.y), bottom = Math.max(active.start.y, active.end.y);
        for (let y = Math.max(0, top); y <= Math.min(height - 1, bottom); y++) for (let x = Math.max(0, left); x <= Math.min(width - 1, right); x++) if (filled || x === left || x === right || y === top || y === bottom) put(x, y);
      }
      return pixels;
    });
    context.drawImage(image(composite(width, height, layers), width, height), 0, 0);
  }, [snapshot, previous, next, layerId, filled, preview]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => pixelPosition(event.clientX, event.clientY, event.currentTarget.getBoundingClientRect(), document.width, document.height);
  const addPixels = (active: Stroke, from: { x: number; y: number }, to: { x: number; y: number }) => {
    line(from.x, from.y, to.x, to.y, (x, y) => {
      if (x >= 0 && y >= 0 && x < document.width && y < document.height) {
        const key = y * document.width + x;
        if (active.pixels.size < 65_536 || active.pixels.has(key)) active.pixels.set(key, { x, y, color: active.color });
        else active.overflow = true;
      }
    });
  };
  function down(event: PointerEvent<HTMLCanvasElement>) {
    if (event.button !== 0 || tool === 'hand' || props.busy || props.playing || !snapshot) return;
    event.preventDefault();
    const position = point(event);
    if (tool === 'picker') {
      const pixels = composite(document.width, document.height, snapshot.layers.filter(layer => layer.visible).map(layer => layer.pixels));
      const offset = (position.y * document.width + position.x) * 4;
      props.pick('#' + [...pixels.slice(offset, offset + 4)].map(value => value.toString(16).padStart(2, '0')).join('').toUpperCase()); return;
    }
    if (!document.layers.find(layer => layer.id === layerId)?.visible) { props.error('Show the selected layer before drawing.'); return; }
    event.currentTarget.setPointerCapture(event.pointerId); props.setBusy(true);
    const active: Stroke = { id: window.editor.beginGesture(documentGuard(document)), start: position, end: position, pixels: new Map(), tool, color: tool === 'eraser' ? '#00000000' : props.color, cancelled: false, overflow: false };
    stroke.current = active; addPixels(active, position, position); requestPaint();
    void active.id.catch(cause => { if (stroke.current === active) { stroke.current = null; props.setBusy(false); props.error(String(cause)); requestPaint(); } });
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const position = point(event); props.coordinates(`${position.x}, ${position.y}`);
    const active = stroke.current;
    if (!active) return;
    if (active.tool === 'pencil' || active.tool === 'eraser') addPixels(active, active.end, position);
    active.end = position; requestPaint();
  }
  async function up(event: PointerEvent<HTMLCanvasElement>) {
    const active = stroke.current;
    if (!active || event.button !== 0) return;
    const end = point(event);
    if (active.tool === 'pencil' || active.tool === 'eraser') addPixels(active, active.end, end);
    active.end = end;
    stroke.current = null;
    const target = { frameId, layerId };
    const operations: Operation[] = active.tool === 'pencil' || active.tool === 'eraser' ? [{ type: 'set_pixels', ...target, pixels: [...active.pixels.values()] }]
      : active.tool === 'fill' ? [{ type: 'fill', ...target, ...active.start, color: active.color }]
      : active.tool === 'rectangle' ? [{ type: 'draw_rectangle', ...target, x1: active.start.x, y1: active.start.y, x2: active.end.x, y2: active.end.y, color: active.color, filled }]
      : [{ type: 'draw_line', ...target, x1: active.start.x, y1: active.start.y, x2: active.end.x, y2: active.end.y, color: active.color }];
    try {
      const id = await active.id;
      if (active.overflow) { await window.editor.cancelGesture(id); props.error('This stroke exceeds 65,536 pixels. Use shorter strokes; no pixels were changed.'); }
      else if (!active.cancelled) await window.editor.commitGesture({ id, operations });
    }
    catch (cause) { props.error(String(cause)); } finally { props.setBusy(false); requestPaint(); }
  }
  return <div ref={viewport} className="canvas-viewport" onPointerDown={event => {
    if (event.button !== 1 && !(event.button === 0 && tool === 'hand')) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); panning.current = { x: event.clientX, y: event.clientY, left: event.currentTarget.scrollLeft, top: event.currentTarget.scrollTop };
  }} onPointerMove={event => { const pan = panning.current; if (pan) { event.currentTarget.scrollLeft = pan.left - event.clientX + pan.x; event.currentTarget.scrollTop = pan.top - event.clientY + pan.y; } }} onPointerUp={() => { panning.current = null; }} onPointerCancel={() => { panning.current = null; cancel(); }}>
    <div className="canvas-space"><div className="artboard" style={{ width: document.width * zoom, height: document.height * zoom }}>
      <canvas ref={canvas} width={document.width} height={document.height} aria-label="Pixel canvas" aria-busy={!snapshot} data-revision={snapshot?.revision ?? -1} style={{ cursor: tool === 'hand' ? 'grab' : 'crosshair' }} onPointerDown={down} onPointerMove={move} onPointerUp={event => void up(event)} onPointerCancel={cancel} onLostPointerCapture={cancel} />
      {grid && zoom >= 4 && <div className="pixel-grid" style={{ backgroundSize: `${zoom}px ${zoom}px` }} />}
    </div></div>
  </div>;
}
