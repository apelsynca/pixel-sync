import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult, type Tool } from '@modelcontextprotocol/sdk/types.js';
import { CommandService } from '../application/commands';
import { animationPreviewSchema, inspectPixelsSchema, PREVIEW_LIMITS, previewSchema, type RenderedPreview } from '../application/inspection';
import { batchSchema, DocumentError, guardSchema, newDocumentSchema } from '../core/schema';
import type { ClientId, EditorStatus, McpOperation } from '../shared/api';
import { FileService, openProjectSchema, saveProjectSchema, exportPngSchema, exportSheetSchema, type FileAction } from '../persistence/files';
import { encodePng } from '../persistence/images';

export interface ToolOptions {
  getStatus: () => EditorStatus;
  commands?: CommandService;
  files?: FileService;
  client?: ClientId;
  onStatusCall?: (client: ClientId) => void;
  onOperation?: (operation: McpOperation) => void;
}
interface Definition {
  description: string; schema: z.ZodType; readOnly: boolean;
  run: (input: unknown, signal: AbortSignal) => Promise<CallToolResult>;
}
export const MCP_INSTRUCTIONS = 'Call get_document first. Use its documentId, current revision, frame IDs and layer IDs. Edit through edit_document with expectedRevision; a batch is atomic and one undo step shared with the user. Reread after stale_revision; never blindly replay an edit. Painting replaces RGBA; layers composite source-over. Frames are explicit, independent of UI selection. Preserve unsaved work; replacement requires its current guard and explicit discardUnsaved when dirty. PNG previews exclude grid/onion skin. File paths are relative to the workspace selected in the app. Existing files require explicit overwrite; sprite sheets need a new directory. Project saving marks the exact revision clean; exports do not.';
function result(value: Record<string, unknown>): CallToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
}
function pngResult(preview: RenderedPreview): CallToolResult {
  const { pixels, ...metadata } = preview;
  const bytes = encodePng(preview.width, preview.height, pixels);
  return { ...result({ ...metadata, encoding: 'png', mimeType: 'image/png' }), content: [
    { type: 'text', text: JSON.stringify(metadata) }, { type: 'image', mimeType: 'image/png', data: bytes.toString('base64') },
  ] };
}
function errorResult(error: unknown): CallToolResult {
  const detail = error instanceof DocumentError ? { code: error.code, message: error.message.slice(0, 1024) }
    : error instanceof z.ZodError ? { code: 'invalid_arguments', message: error.issues.slice(0, 3).map(issue => `${issue.path.join('.').slice(0, 120)}: ${issue.message}`).join('; ').slice(0, 1024) }
    : { code: 'internal_error', message: 'Pixel Editor could not complete this operation' };
  return { ...result({ error: detail }), isError: true };
}
function definitions(options: ToolOptions): Record<string, Definition> {
  const tools: Record<string, Definition> = {
    get_status: { description: 'Inspect the running editor, MCP availability, and current document metadata.', schema: z.strictObject({}), readOnly: true, run: async () => {
      if (options.client) options.onStatusCall?.(options.client);
      return result({ ...options.getStatus() });
    } },
  };
  const commands = options.commands;
  if (!commands) return tools;
  return { ...tools, ...fileDefinitions(options.files),
    get_document: { description: 'Read document ID, revision, dimensions, dirty state, shared layers (bottom to top), ordered frames/durations, named clips, palette, history, limits, and supported capabilities. Read before edits; explicit frame IDs do not follow UI selection.', schema: z.strictObject({}), readOnly: true, run: async (_input, signal) => {
      const document = await commands.getDocument(signal);
      if (!document) throw new DocumentError('missing_document', 'Create a document first');
      return result({ ...document, capabilities: { drawing: true, animation: true, sharedHistory: true, pngPreviews: true, files: !!options.files, workspaceConfigured: options.files?.hasWorkspace() ?? false }, previewLimits: PREVIEW_LIMITS });
    } },
    get_pixels: { description: 'Read a fully in-bounds region from an explicit frame and optional layer. Omit layerId for the visible flattened composite. Returns row-major straight RGBA8 as base64, at most 65,536 pixels, with source document/revision. Optional expectedRevision pins a read.', schema: inspectPixelsSchema, readOnly: true, run: async (input, signal) => {
      const { pixels, ...metadata } = await commands.inspectPixels(input, signal);
      return result({ ...metadata, encoding: 'rgba8-base64', data: Buffer.from(pixels).toString('base64') });
    } },
    get_preview: { description: 'Return a flattened transparent PNG image for an explicit frame, plus revision and layout metadata. Optional in-bounds crop and integer nearest-neighbor scale (1–32). Output must fit 1024×1024. No grid, selection, or onion skin.', schema: previewSchema, readOnly: true, run: async (input, signal) => pngResult(await commands.getPreview(input, signal)) },
    get_animation_preview: { description: 'Return one PNG contact sheet of 1–16 distinct explicit frames in supplied order, with source revision, durations (ms), and cell coordinates (px). Choose columns (default near-square), optional shared crop and integer scale. Row-major cells; unused cells transparent; output at most 1024×1024. Page large animations with fewer frame IDs.', schema: animationPreviewSchema, readOnly: true, run: async (input, signal) => pngResult(await commands.getAnimationPreview(input, signal)) },
    new_document: { description: 'Create a transparent canvas (default 32×32; 1–512 per axis), one layer and one 100 ms frame. When replacing a document, supply current: {documentId, expectedRevision}; dirty replacement also requires explicit discardUnsaved: true. Returns new metadata; resets history.', schema: newDocumentSchema, readOnly: false, run: async (input, signal) => result({ ...await commands.newDocument(input, signal) }) },
    edit_document: { description: 'Apply 1–256 ordered operations atomically; requires documentId and expectedRevision. One batch is one shared undo step. set_pixels replaces exact #RRGGBBAA (transparent erasure); lines use inclusive Bresenham; rectangle endpoints inclusive/normalized with filled flag; fill is four-connected exact RGBA. Coordinates -4096..4096 clip to canvas; at most 65,536 supplied pixels total. Add/move/delete/rename/show layers, edit palette, add/duplicate/move/delete frames, change durations (10–60000 ms), and set/delete clips. IDs can be supplied on additions for later batch references; generated IDs returned. Layer index 0 is bottom; move destinations are zero-based. Layers apply to every frame; pixel edits target one frame. Clips use distinct ordered frame IDs; frame deletion must leave final clip references valid. Failure changes nothing.', schema: batchSchema, readOnly: false, run: async (input, signal) => result({ ...await commands.edit(input, signal) }) },
    undo: { description: 'Undo one complete user gesture or MCP batch in shared history. Requires current documentId and expectedRevision; returns resulting metadata and changed bounds. Revision increases even when restoring earlier content.', schema: guardSchema, readOnly: false, run: async (input, signal) => result({ ...await commands.undo(input, signal) }) },
    redo: { description: 'Redo one shared history entry. Requires current documentId and expectedRevision. A new edit clears redo; empty history returns empty_history.', schema: guardSchema, readOnly: false, run: async (input, signal) => result({ ...await commands.redo(input, signal) }) },
  };
}
function fileDefinitions(files?: FileService): Record<string, Definition> {
  if (!files) return {};
  const contracts = {
    open_project: { schema: openProjectSchema, description: 'Open a version-1 .pixel.json project from a workspace-relative path. Requires current document guard and discardUnsaved: true if dirty; invalid files leave the existing document unchanged. Preserves layers, frame IDs/timing, clips and exact RGBA. New document identity, clean state, empty history.' },
    save_project: { schema: saveProjectSchema, description: 'Save the exact guarded document revision as a .pixel.json project at a workspace-relative path. Atomic file replacement; existing file requires overwrite: true. Successful save marks that revision clean. No undo history is stored.' },
    import_png: { schema: openProjectSchema, description: 'Import a workspace-relative .png as a new unsaved, one-layer/one-frame document. Requires current identity/revision guard and explicit discardUnsaved if dirty. Input at most 16 MiB and 512×512; supported static RGBA/RGB/grayscale/indexed PNGs up to 8-bit channels. Interlaced data is bounded before decoding. APNG and 16-bit channels are rejected.' },
    export_png: { schema: exportPngSchema, description: 'Export the explicit frame flattened through shared layer visibility as transparent PNG. Requires documentId, expectedRevision, frameId, and workspace-relative .png path; existing destination requires overwrite: true. Exact dimensions, no resampling or view overlays. Does not mark the project saved.' },
    export_sprite_sheet: { schema: exportSheetSchema, description: 'Export every frame once in timeline order into a NEW workspace-relative directory path. Stage sheet.png and version-1 sheet.json together, then publish the directory. Refuse any existing export directory. Optional columns defaults near-square; output at most 4096×4096 / 64 MiB decoded RGBA. Metadata includes cell layout, frame count/IDs/durations, clip atlas indices/loop flags, source document/revision and units. No padding, trimming, rotation or resampling; unused cells transparent. Does not mark the project saved.' },
  };
  return Object.fromEntries(Object.entries(contracts).map(([name, contract]) => [name, { ...contract, readOnly: false, run: async (input: unknown, signal: AbortSignal) => result({ ...await files.execute(name as FileAction, input, signal) }) }]));
}

/** SDK handles protocol negotiation/transport. Tool validation here provides one
 * stable structured error contract for schema failures and engine rejections. */
export function createToolServer(options: ToolOptions): Server {
  const tools = definitions(options);
  const list: Tool[] = Object.entries(tools).map(([name, definition]) => {
    const schema = z.toJSONSchema(definition.schema, { io: 'input', target: 'draft-7' });
    if (schema.type !== 'object') throw new Error('Tool schema must be an object');
    return { name, description: definition.description, inputSchema: schema as Tool['inputSchema'],
      annotations: { readOnlyHint: definition.readOnly, destructiveHint: !definition.readOnly, openWorldHint: false, idempotentHint: definition.readOnly } };
  });
  const server = new Server({ name: 'pixel-editor', version: '0.1.0' }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: list }));
  server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
    const started = performance.now(), definition = tools[request.params.name];
    let response: CallToolResult;
    try {
      if (!Object.hasOwn(tools, request.params.name)) throw new DocumentError('invalid_arguments', 'Unknown Pixel Editor tool');
      // Preflight aggregate pixels before schema validation clones supplied objects.
      if (request.params.name === 'edit_document') {
        const input = request.params.arguments;
        if (input && Array.isArray(input.operations) && input.operations.length <= 256) {
          let count = 0;
          for (const operation of input.operations) if (operation && typeof operation === 'object' && operation.type === 'set_pixels' && Array.isArray(operation.pixels)) count += operation.pixels.length;
          if (count > 65_536) throw new DocumentError('size_limit', 'Batch supplied pixel limit exceeded');
        }
      }
      const args = definition.schema.parse(request.params.arguments ?? {});
      response = await definition.run(args, extra.signal);
    } catch (error) { response = errorResult(error); }
    const data = response.structuredContent;
    const document = data && typeof data.document === 'object' && data.document ? data.document as Record<string, unknown> : data;
    const detail = data?.error as { code: string } | undefined;
    const operation: McpOperation = { id: randomUUID(), at: new Date().toISOString(), client: options.client ?? 'generic',
      tool: Object.hasOwn(tools, request.params.name) ? request.params.name : 'unknown_tool', outcome: response.isError ? 'error' : 'success',
      summary: response.isError ? detail?.code ?? 'internal_error' : typeof data?.summary === 'string' ? data.summary : 'Completed', durationMs: Math.round(performance.now() - started),
      documentId: typeof document?.documentId === 'string' ? document.documentId : undefined, revision: typeof document?.revision === 'number' ? document.revision : undefined };
    try { options.onOperation?.(operation); } catch { /* Presentation must not fail a completed tool call. */ }
    return response;
  });
  return server;
}
