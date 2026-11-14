import { z } from 'zod';

export const LIMITS = Object.freeze({ dimension: 512, layers: 16, frames: 64, clips: 64, pixels: 128 * 1024 * 1024, staging: 128 * 1024 * 1024, history: 64 * 1024 * 1024, operations: 256, suppliedPixels: 65_536 });
const id = z.string().min(1).max(128);
const name = z.string().trim().min(1).max(128);
const coordinate = z.number().int().min(-4096).max(4096);
const duration = z.number().int().min(10).max(60_000);
const color = z.string().regex(/^#[\da-fA-F]{8}$/);
const target = { frameId: id, layerId: id };
export const operationSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('set_pixels'), ...target, pixels: z.array(z.strictObject({ x: coordinate, y: coordinate, color })).max(LIMITS.suppliedPixels) }),
  z.strictObject({ type: z.literal('draw_line'), ...target, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, color }),
  z.strictObject({ type: z.literal('draw_rectangle'), ...target, x1: coordinate, y1: coordinate, x2: coordinate, y2: coordinate, color, filled: z.boolean() }),
  z.strictObject({ type: z.literal('fill'), ...target, x: coordinate, y: coordinate, color }),
  z.strictObject({ type: z.literal('clear_layer'), ...target }),
  z.strictObject({ type: z.literal('add_layer'), id: id.optional(), name }),
  z.strictObject({ type: z.literal('rename_layer'), layerId: id, name }),
  z.strictObject({ type: z.literal('move_layer'), layerId: id, index: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('set_layer_visibility'), layerId: id, visible: z.boolean() }),
  z.strictObject({ type: z.literal('delete_layer'), layerId: id }),
  z.strictObject({ type: z.literal('set_palette'), colors: z.array(color).max(256) }),
  z.strictObject({ type: z.literal('add_frame'), id: id.optional(), duration: duration.optional() }),
  z.strictObject({ type: z.literal('duplicate_frame'), frameId: id, id: id.optional() }),
  z.strictObject({ type: z.literal('delete_frame'), frameId: id }),
  z.strictObject({ type: z.literal('move_frame'), frameId: id, index: z.number().int().min(0) }),
  z.strictObject({ type: z.literal('set_frame_duration'), frameId: id, duration }),
  z.strictObject({ type: z.literal('set_clip'), name, frameIds: z.array(id).min(1).max(LIMITS.frames), loop: z.boolean() }),
  z.strictObject({ type: z.literal('delete_clip'), name }),
]);
export type Operation = z.infer<typeof operationSchema>;
export const guardSchema = z.strictObject({ documentId: id, expectedRevision: z.number().int().nonnegative() });
export type Guard = z.infer<typeof guardSchema>;
export const batchSchema = guardSchema.extend({ operations: z.array(operationSchema).min(1).max(LIMITS.operations) });
export const newDocumentSchema = z.strictObject({ width: z.number().int().min(1).max(LIMITS.dimension).default(32), height: z.number().int().min(1).max(LIMITS.dimension).default(32), current: guardSchema.optional(), discardUnsaved: z.boolean().default(false) });
export const pixelReadSchema = z.strictObject({ frameId: id, layerId: id.optional(), x: z.number().int().nonnegative(), y: z.number().int().nonnegative(), width: z.number().int().positive(), height: z.number().int().positive() });
export type PixelRead = z.infer<typeof pixelReadSchema>;

export type ErrorCode = 'invalid_arguments' | 'stale_revision' | 'missing_document' | 'missing_layer' | 'missing_frame' | 'size_limit' | 'unsaved_document' | 'empty_history';
export class DocumentError extends Error {
  constructor(public readonly code: ErrorCode, message: string) { super(message); this.name = 'DocumentError'; }
}
export function fail(code: ErrorCode, message: string): never { throw new DocumentError(code, message); }
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) fail('invalid_arguments', result.error.message);
  return result.data;
}
