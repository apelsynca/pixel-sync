# MCP drawing and animation tools

PixelSync must be open with MCP enabled. Connect using **Connect AI client** in the app; both client guides include a first drawing prompt. Edits appear in the same document that the user is editing, and share the same undo history. For file calls, choose a workspace in the app first; see [project formats, exports and recovery](project-format.md).

## Start with the document

Call `get_document` with `{}`. The result contains the current `documentId`, `revision`, width/height, dirty flag, ordered layers (bottom to top), frames with durations in milliseconds, clips, palette, history statistics, limits, and capabilities. It advertises `files: true` and a `workspaceConfigured` boolean; unconfigured file tools return `workspace_required`. `get_status` remains available for connection verification and document metadata.

Use the document's actual frame/layer IDs. MCP never depends on the UI's selected frame or playback position. IDs are opaque strings; additions accept optional unique IDs so later operations in the same batch can refer to new items. Omitted IDs are generated and returned in `createdIds`.

## Mutations and shared history

`edit_document` takes `{ documentId, expectedRevision, operations }`. Operations execute in order, then commit together once. The result contains `document` metadata, conservative `changed` bounds per frame/layer, `createdIds`, and a summary. A no-op leaves the revision/history unchanged. Failed batches preserve pixels, metadata, revision, dirty state, and history.

For a 32×32 document, this example creates a two-frame sprite on a new layer. Replace `DOCUMENT_ID`, `FIRST_FRAME_ID`, and revision `0` with the values you just read. Choose unique names/IDs if the document already contains this example.

```json
{
  "documentId": "DOCUMENT_ID",
  "expectedRevision": 0,
  "operations": [
    { "type": "add_layer", "id": "demo-layer", "name": "MCP demo" },
    { "type": "draw_rectangle", "frameId": "FIRST_FRAME_ID", "layerId": "demo-layer", "x1": 8, "y1": 8, "x2": 23, "y2": 23, "filled": false, "color": "#264653FF" },
    { "type": "fill", "frameId": "FIRST_FRAME_ID", "layerId": "demo-layer", "x": 12, "y": 12, "color": "#2A9D8FFF" },
    { "type": "duplicate_frame", "frameId": "FIRST_FRAME_ID", "id": "demo-frame" },
    { "type": "set_frame_duration", "frameId": "demo-frame", "duration": 180 },
    { "type": "set_pixels", "frameId": "demo-frame", "layerId": "demo-layer", "pixels": [{ "x": 12, "y": 12, "color": "#E9C46AFF" }] },
    { "type": "set_clip", "name": "mcp-demo", "frameIds": ["FIRST_FRAME_ID", "demo-frame"], "loop": true }
  ]
}
```

Supported operations:

| Operations | Semantics |
| --- | --- |
| `set_pixels` | Explicit `frameId`, `layerId`, and `pixels: [{x,y,color}]`; exact RGBA replacement, including transparent erasure. |
| `draw_line` | Explicit target, `x1,y1,x2,y2,color`; inclusive integer Bresenham rasterization, clipped after rasterization. |
| `draw_rectangle` | Explicit target, normalized inclusive endpoints, `color`, and required `filled` boolean. Clipping an outline does not invent a canvas-edge border. |
| `fill` | Explicit target, `x,y,color`; four-connected fill matching all four RGBA channels. |
| `clear_layer` | Transparent pixels in one explicit layer/frame only. |
| `add_layer`, `rename_layer`, `move_layer`, `set_layer_visibility`, `delete_layer` | Shared metadata across all frames; add creates transparent cels everywhere, delete removes them everywhere. Keep at least one layer. Move `index` is zero-based in the resulting list; zero is the bottom. |
| `set_palette` | Replace `colors` with up to 256 `#RRGGBBAA` swatches. |
| `add_frame`, `duplicate_frame`, `move_frame`, `delete_frame`, `set_frame_duration` | Add appends a transparent frame (100 ms by default); duplicate appends a deep pixel/timing copy; move uses zero-based timeline index. Durations 10–60,000 ms; keep at least one frame. |
| `set_clip`, `delete_clip` | Set uses `name`, a nonempty ordered list of distinct `frameIds`, and `loop`. Names are unique; setting an existing name updates it. Final references must remain valid. |

Painting uses `#RRGGBBAA` and replaces pixels rather than blending. Source-over blending is used only for visible layer compositing. Coordinates originate at the top-left, increase right/down, and accept integers from −4096 to 4096. Drawing clips outside the canvas; pixel reads/crops must be completely in bounds. Clips may order frames independently of the timeline. Duplication does not add a frame to clips. Frame deletion and clip repair/removal can appear in either order within one atomic batch.

`undo` and `redo` take `{ documentId, expectedRevision }`. They operate on both manual gestures and MCP batches and increase the revision once. UI Undo can reverse an MCP batch; MCP Undo can reverse a manual stroke. A new edit clears redo. After a `stale_revision` error, reread the document and decide whether the edit still applies; do not blindly replay it.

A manual stroke holds a queue reservation until commit or cancellation. Competing MCP edits wait, then check their supplied revision. Transport closure/server shutdown aborts waiting MCP work before execution. Stateless cancellation notifications are not a general per-client cancellation guarantee; closing the HTTP transport stops its pending requests. An already committed edit is reversed with Undo.

`new_document` accepts `width`/`height` (default 32, maximum 512). If replacing a current document, also supply `current: { documentId, expectedRevision }`; if dirty, explicitly supply `discardUnsaved: true`. It receives a new identity, one transparent layer, one 100 ms frame, and empty history. It does not silently discard work or open a GUI confirmation on the agent's behalf.

## Pixel and PNG reads

`get_pixels` requires `documentId`, `frameId`, `x`, `y`, `width`, and `height`. Optional `layerId` reads raw RGBA from that layer, including hidden layers; omit it for the visible flattened composite. Optional `expectedRevision` pins the read to a revision. It returns row-major straight RGBA8 bytes in base64 as `data`, with `encoding: "rgba8-base64"`, dimensions, coordinates, and document/revision identity. Fully transparent composites normalize to zero RGBA; raw layer reads preserve stored channels.

`get_preview` requires `documentId` and `frameId`. Optional fields are `expectedRevision`, `crop: {x,y,width,height}`, and integer `scale` from 1 to 32 (default 1). It returns standard MCP `image` content with `mimeType: "image/png"`, plus structured document/revision and image layout metadata. Scaling is nearest-neighbor and the output must fit 1024×1024. Preview pixels use the engine's compositor and exclude editor grid, onion skin, selection, and playback overlays.

`get_animation_preview` takes `documentId`, ordered distinct `frameIds` (1–16), optional `expectedRevision`, `columns`, `crop`, and `scale`. It returns one contact-sheet PNG from a single immutable revision, with frame IDs, durations in milliseconds, and cell coordinates/dimensions in pixels. Cells are top-left row-major, without padding; unused final-row cells are transparent. Columns default to a near-square layout. The same 1024×1024 cap applies. Request fewer frames, a smaller crop/scale, or a different column count when a layout is too large. Page larger animations by supplying different frame ID lists.

## Workspace file tools

All file paths are relative to the workspace chosen inside PixelSync. Existing parent folders are required. File operations serialize with drawing and refer to the exact requested revision. Native dialogs are separate user-selected destinations and do not expand MCP access.

| Tool | Arguments and behavior |
| --- | --- |
| `save_project` | `{documentId, expectedRevision, path, overwrite?}`. Use `.pixel.json`; `overwrite` defaults false. Atomic publication; a successful save marks that revision clean. |
| `open_project` | `{path, current?, discardUnsaved?}`. `.pixel.json`; requires `current: {documentId, expectedRevision}` if a document exists and explicit discard when dirty. Invalid input preserves the current document. New identity, clean state, revision zero, empty history. |
| `import_png` | Same replacement guard as open; `.png`. One visible layer/frame, unsaved state. Static PNG up to 512×512 / 16 MiB; channels up to 8 bits. APNG and 16-bit inputs are rejected. |
| `export_png` | `{documentId, expectedRevision, frameId, path, overwrite?}`. Visible flattened frame, exact dimensions and transparency, no overlays. Does not mark the project saved. |
| `export_sprite_sheet` | `{documentId, expectedRevision, path, columns?}`. `path` is a NEW directory containing `sheet.png` and version-1 `sheet.json`. Refuses any existing directory. All frames in timeline order, clip atlas indices/durations, unused cells transparent. At most 4096×4096 / 64 MiB decoded RGBA. Does not mark the project saved. |

Example save after reading the current identity/revision:

```json
{ "documentId": "DOCUMENT_ID", "expectedRevision": 1, "path": "hero.pixel.json" }
```

Use a new name or explicitly set `overwrite: true` for an existing project/PNG. Sprite-sheet directory replacement is deferred. A save is a durable checkpoint; exports alone leave editable changes dirty. Recovery writes are internal and are not a general filesystem tool.

## Limits and errors

The document supports 512×512 pixels, 16 layers, 64 frames, 64 clips, and at most 128 MiB decoded RGBA. A batch has at most 256 operations and 65,536 supplied pixels total. A pixel read has at most 65,536 pixels. Each HTTP request body is capped at 4 MiB before JSON parsing. Preview output is capped at 1024×1024 / 4 MiB decoded RGBA. Staging and history budgets from [the engine contract](document-engine.md) also apply, including rejecting an edit that cannot fit its inverse into history.

Tool failures return `isError: true` and `structuredContent.error: { code, message }`, also mirrored as text. Codes include `invalid_arguments`, `stale_revision`, `missing_document`, `missing_layer`, `missing_frame`, `size_limit`, `unsaved_document`, `empty_history`, `cancelled`, `workspace_required`, `path_denied`, `already_exists`, `unsupported_format`, `io_error`, and `internal_error`. Validation messages are bounded; unexpected internal errors do not expose stack traces or filesystem details. Invalid JSON/HTTP authentication and transport errors use the protocol/HTTP layer instead.

The connection panel shows the last 50 MCP calls for the current app run, with tool name, configured connection route, outcome, revision, elapsed time, and a short summary. It stores no arguments, pixel payloads, credentials, or preview images. The route label identifies the configured endpoint, not a cryptographically authenticated application identity.

## Verification

`tests/mcp-files.test.ts` additionally covers real HTTP/stdio save/open/import/export, setup, overwrite and denied paths. `tests/mcp-editing.test.ts` exercises actual HTTP and compiled stdio calls, published schemas/instructions, animation edits, pixel/composite bytes, PNG crop/scale/contact-sheet cells, timing, stale and invalid batch rollback, replacement guards, limits, shared history, gesture conflicts, and queued cancellation on connection/server closure.

The real Electron smoke script exercises MCP art appearing in the canvas, UI Undo/MCP Redo, a manual stroke read and undone through MCP, a client-created clip playing in the UI, playback pausing on a remote mutation, PNG exclusion of onion skin, and bounded recent-operation display at 100% and 150% display scaling. Both named client endpoints discover the editing tools. These use SDK test clients; native assistant-driven Codex/Claude Code calls and Windows runtime acceptance remain separate checks.
