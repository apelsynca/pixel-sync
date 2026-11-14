import type { Frame } from '../core/document';

/** Uses total elapsed time, preserving residual time even after delayed paints. */
export function playbackFrame(frames: Frame[], ids: string[], loop: boolean, elapsed: number): { frameId: string; finished: boolean } {
  const durations = new Map(frames.map(frame => [frame.id, frame.duration]));
  const total = ids.reduce((sum, id) => sum + durations.get(id)!, 0);
  if (!loop && elapsed >= total) return { frameId: ids.at(-1)!, finished: true };
  let remaining = loop ? elapsed % total : Math.max(0, elapsed);
  for (const id of ids) { const duration = durations.get(id)!; if (remaining < duration) return { frameId: id, finished: false }; remaining -= duration; }
  return { frameId: ids[0], finished: false };
}

export function pixelPosition(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, width: number, height: number) {
  return { x: Math.max(-4096, Math.min(4096, Math.floor((clientX - rect.left) * width / rect.width))), y: Math.max(-4096, Math.min(4096, Math.floor((clientY - rect.top) * height / rect.height))) };
}
