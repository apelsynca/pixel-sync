import { z } from 'zod';
import { fail, LIMITS } from './schema';

const id = z.string().min(1).max(128), name = z.string().trim().min(1).max(128);
export const PROJECT_LIMIT = 192 * 1024 * 1024;
export const projectSchema = z.strictObject({
  version: z.literal(1), width: z.number().int().min(1).max(512), height: z.number().int().min(1).max(512),
  layers: z.array(z.strictObject({ id, name, visible: z.boolean() })).min(1).max(16),
  frames: z.array(z.strictObject({ id, duration: z.number().int().min(10).max(60_000), cels: z.record(id, z.string().max(1_398_104)) })).min(1).max(64),
  clips: z.array(z.strictObject({ name, frameIds: z.array(id).min(1).max(64), loop: z.boolean() })).max(64),
  palette: z.array(z.string().regex(/^#[\da-fA-F]{8}$/)).max(256),
});
export type ProjectFile = z.infer<typeof projectSchema>;
export function validateProject(input: unknown): ProjectFile {
  if (input && typeof input === 'object' && 'version' in input && input.version !== 1) fail('unsupported_format', 'Unsupported project version; this app reads version 1');
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>;
    for (const [key, limit] of [['layers', 16], ['frames', 64], ['clips', 64], ['palette', 256]] as const) {
      const values = record[key];
      if (Array.isArray(values) && values.length > limit) fail('size_limit', 'Project collection limit exceeded');
    }
    if ('frames' in input && Array.isArray(input.frames)) for (const frame of input.frames) {
      if (frame && typeof frame === 'object' && 'cels' in frame && frame.cels && typeof frame.cels === 'object' && Object.keys(frame.cels).length > 16) fail('size_limit', 'Project cel count limit exceeded');
    }
  }
  const result = projectSchema.safeParse(input);
  if (!result.success) fail('unsupported_format', 'Invalid pixel project structure');
  const project = result.data;
  const layerIds = project.layers.map(layer => layer.id), frameIds = project.frames.map(frame => frame.id);
  if (new Set([...layerIds, ...frameIds]).size !== layerIds.length + frameIds.length) fail('unsupported_format', 'Project IDs must be unique across layers and frames');
  const bytes = project.width * project.height * 4;
  if (bytes * layerIds.length * frameIds.length > LIMITS.pixels) fail('size_limit', 'Project exceeds 128 MiB decoded RGBA');
  if (new Set(project.clips.map(clip => clip.name)).size !== project.clips.length) fail('unsupported_format', 'Clip names must be unique');
  for (const clip of project.clips) if (new Set(clip.frameIds).size !== clip.frameIds.length || clip.frameIds.some(id => !frameIds.includes(id))) fail('unsupported_format', 'Invalid clip frame references');
  // Validate every buffer length/reference before allocating decoded pixels.
  for (const frame of project.frames) {
    if (Object.keys(frame.cels).length !== layerIds.length || layerIds.some(id => !Object.hasOwn(frame.cels, id))) fail('unsupported_format', 'Every frame must contain exactly one cel per layer');
    for (const value of Object.values(frame.cels)) {
      if (value.length !== 4 * Math.ceil(bytes / 3) || !/^[A-Za-z0-9+/]*={0,2}$/.test(value) || Buffer.byteLength(value, 'base64') !== bytes) fail('unsupported_format', 'Invalid RGBA base64 length or encoding');
    }
  }
  return project;
}
export function decodeProject(input: unknown) {
  const project = validateProject(input);
  const cels = new Map(project.frames.map(frame => [frame.id, new Map(project.layers.map(layer => {
    const encoded = frame.cels[layer.id], pixels = Buffer.from(encoded, 'base64');
    if (pixels.toString('base64') !== encoded) fail('unsupported_format', 'RGBA base64 must use canonical padding');
    return [layer.id, new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength)];
  }))]));
  return { width: project.width, height: project.height, layers: project.layers, frames: project.frames.map(({ id, duration }) => ({ id, duration })), clips: project.clips, palette: project.palette, cels };
}
