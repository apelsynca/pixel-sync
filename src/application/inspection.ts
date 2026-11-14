import { z } from 'zod';
import type { DocumentInfo } from '../core/document';
import { DocumentEngine } from '../core/document';
import { fail, pixelReadSchema } from '../core/schema';

const id = z.string().min(1).max(128);
export const readIdentitySchema = z.strictObject({ documentId: id, expectedRevision: z.number().int().nonnegative().optional() });
export const inspectPixelsSchema = readIdentitySchema.extend(pixelReadSchema.shape);
const cropSchema = z.strictObject({ x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512) });
const previewFields = { crop: cropSchema.optional(), scale: z.number().int().min(1).max(32).default(1) };
export const previewSchema = readIdentitySchema.extend({ frameId: id, ...previewFields });
export const animationPreviewSchema = readIdentitySchema.extend({ frameIds: z.array(id).min(1).max(16), columns: z.number().int().min(1).max(16).optional(), ...previewFields });
export const PREVIEW_LIMITS = Object.freeze({ dimension: 1024, frames: 16, bytes: 4 * 1024 * 1024 });
export interface RenderedPreview {
  documentId: string; revision: number; width: number; height: number; pixels: Uint8Array;
  crop: { x: number; y: number; width: number; height: number }; scale: number; columns: number; rows: number;
  frames: { frameId: string; duration: number; x: number; y: number; width: number; height: number }[];
}
export function inspectDocument(engine: DocumentEngine, identity: z.infer<typeof readIdentitySchema>): DocumentInfo {
  const document = engine.getDocument() ?? fail('missing_document', 'Create a document first');
  engine.assertRevision({ documentId: identity.documentId, expectedRevision: identity.expectedRevision ?? document.revision });
  return document;
}
/** Called inside one command-queue action. No authoritative buffers escape. */
export function renderPreview(engine: DocumentEngine, args: z.infer<typeof animationPreviewSchema>): RenderedPreview {
  const document = inspectDocument(engine, args);
  if (new Set(args.frameIds).size !== args.frameIds.length) fail('invalid_arguments', 'Preview frame IDs must be distinct');
  const frames = args.frameIds.map(id => document.frames.find(frame => frame.id === id) ?? fail('missing_frame', `Unknown frame: ${id}`));
  const crop = args.crop ?? { x: 0, y: 0, width: document.width, height: document.height };
  if (crop.x + crop.width > document.width || crop.y + crop.height > document.height) fail('invalid_arguments', 'Preview crop must lie inside the canvas');
  const columns = args.columns ?? Math.ceil(Math.sqrt(frames.length)), rows = Math.ceil(frames.length / columns);
  if (columns > frames.length) fail('invalid_arguments', 'Columns must not exceed the requested frame count');
  const cellWidth = crop.width * args.scale, cellHeight = crop.height * args.scale;
  const width = columns * cellWidth, height = rows * cellHeight;
  if (width > PREVIEW_LIMITS.dimension || height > PREVIEW_LIMITS.dimension || width * height * 4 > PREVIEW_LIMITS.bytes) fail('size_limit', 'Preview exceeds 1024×1024; reduce scale, change columns, crop, or request fewer frames');
  const pixels = new Uint8Array(width * height * 4);
  const placements = frames.map((frame, index) => ({ frameId: frame.id, duration: frame.duration, x: index % columns * cellWidth, y: Math.floor(index / columns) * cellHeight, width: cellWidth, height: cellHeight }));
  for (const placement of placements) {
    const bandHeight = Math.floor(65_536 / crop.width);
    for (let row = 0; row < crop.height; row += bandHeight) {
      const count = Math.min(bandHeight, crop.height - row);
      const band = engine.getPixels({ frameId: placement.frameId, x: crop.x, y: crop.y + row, width: crop.width, height: count });
      for (let y = 0; y < count; y++) for (let x = 0; x < crop.width; x++) {
        const color = band.subarray((y * crop.width + x) * 4, (y * crop.width + x + 1) * 4);
        for (let dy = 0; dy < args.scale; dy++) for (let dx = 0; dx < args.scale; dx++) {
          pixels.set(color, ((placement.y + (row + y) * args.scale + dy) * width + placement.x + x * args.scale + dx) * 4);
        }
      }
    }
  }
  return { documentId: document.documentId, revision: document.revision, width, height, pixels, crop, scale: args.scale, columns, rows, frames: placements };
}
