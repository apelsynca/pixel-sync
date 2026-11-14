# Shared document engine

Milestone 2 provides `src/core/document.ts` and `src/application/commands.ts`. The engine owns the authoritative buffers; the command service is the shared serialization boundary for the manual editor and MCP adapters. Milestone 3 connects the manual editor through validated preload IPC. Milestone 4 connects the same service to MCP drawing/history tools and revisioned pixel/PNG/contact-sheet reads. See [the MCP tool contract](mcp-tools.md).

## Command contract

Create a `CommandService`, then call `newDocument({ width: 32, height: 32 })`. It returns document identity, revision, dimensions, dirty state, ordered layer/frame metadata, clips, palette, history statistics, and limits. A new document has one transparent layer, one 100 ms frame, and unsaved changes. Dimensions default to 32×32.

`edit({ documentId, expectedRevision, operations })` validates the complete request against the strict schemas in `src/core/schema.ts`. Operations execute sequentially against staged state. New layer/frame IDs can be supplied for later operations in the batch; otherwise generated IDs are returned in `createdIds`. IDs must be distinct across current layers and frames. Add operations append at the top of the layer stack or end of the timeline; move operations use zero-based destination indices in the resulting list.

Each successful change advances the revision once and returns current document metadata, conservative changed pixel bounds per cel, created IDs, and a summary. No-op batches preserve the revision and history. Metadata changes are present in the returned document even when no pixel bounds changed. Subscribers receive a defensive copy of each committed event; a failing subscriber does not fail the command. Adapters can detect missed revisions and request current metadata and bounded pixel regions.

`undo` and `redo` require the same identity/revision guard and each advance the revision once. One batch is one history entry, including its layer/frame/clip changes. A new edit discards redo. Dirty state tracks the saved content version across undo/redo and divergent branches. `markSaved(guard)` is reserved for a persistence adapter after a successful save of that exact revision.

Replacement requires `newDocument({ current: { documentId, expectedRevision }, ... })` when a document is already open. Unsaved replacement also requires `discardUnsaved: true`. Each replacement receives a new document ID and resets revision and history.

All command service reads and mutations share one queue. MCP read/preview actions inspect one immutable document revision, and optional cancellation signals are checked immediately before queued work starts. Closing the transport aborts its pending actions; committed atomic edits require Undo. Inputs are copied when submitted so callers cannot alter pending commands. Engine errors use `DocumentError.code`: `invalid_arguments`, `stale_revision`, `missing_document`, `missing_layer`, `missing_frame`, `size_limit`, `unsaved_document`, or `empty_history`. Cancelled queued commands use `cancelled`. Rejected commands leave committed state and history unchanged and do not poison subsequent queue work.

`getFrame({ documentId, expectedRevision, frameId, allLayers? })` is the manual editor's snapshot adapter. It reads cels in bounded bands within one queue action, returning either defensive layer buffers for gesture presentation or the flattened visible frame. It requires the exact revision and is bounded by the canvas/layer limits. This internal snapshot adapter does not increase the MCP pixel-read limit. The view rebuilds from current revision snapshots after notifications, including when revisions were skipped.

## Gestures

On pointer-down, call `beginGesture(guard)` and await its reservation. Keep temporary stroke presentation in the view; no staged engine pixels are published. On pointer-up, call the returned handle's `commit(operations)` to apply the entire stroke as one atomic history entry. Competing commands and reads wait until the gesture commits or cancels. Commands submitted against the old revision then receive a stale-revision error.

Call `cancel()` on pointer cancellation or view/window teardown. Cancellation and failed commits release the reservation without changing the document. A handle can commit only once. For an action already collected into one batch, call `edit` directly.

## Pixels and animation

- Coordinates are integer pixels with the origin at the top-left. Drawing coordinates accept −4096 through 4096 and clip to the canvas. Lines use inclusive integer Bresenham rasterization before clipping. Rectangle endpoints are inclusive and normalized; clipping an outline does not invent a border at the canvas edge.
- Colors are `#RRGGBBAA`. Painting replaces all four channels exactly; it does not blend with existing pixels. Transparent RGBA is valid erasure. Fill compares all four channels and uses four-connected neighbors. Out-of-canvas painting/fill has no effect.
- Layers are ordered bottom to top. Compositing uses normal source-over with straight RGBA storage, floating premultiplied intermediates, and rounding at the output boundary. Fully transparent composites normalize to zero RGBA. Hidden layers are excluded. Raw layer reads preserve all stored channels.
- `getPixels({ frameId, layerId?, x, y, width, height })` returns a defensive `Uint8Array` of row-major RGBA. Omit `layerId` to read the flattened visible composite. Read regions must lie completely within the canvas. There is no dependence on UI selection or playback position.
- Layer additions create transparent cels in every frame; deletion removes them everywhere. New frames are transparent. Duplicate frames deep-copy every cel and retain duration. Clearing or painting always targets an explicit layer and frame.
- Durations are integer milliseconds from 10 to 60,000. Retain at least one layer and frame. Shared layer names/order/visibility apply to all frames. Clip names are unique, trimmed, nonempty strings; setting an existing name replaces its definition. A clip has an ordered, nonempty list of distinct frame IDs and a loop flag. Clip references are checked against the final staged state so frame deletion and clip repair can occur in either order in one batch. Timeline reordering preserves clip references; duplication does not extend clips.

Playback, selection, onion skin, and rendering overlays belong to the milestone 3 view and do not form document mutations. Gesture previews copy the active layer's snapshot and share the engine's drawing/compositing routines; only a committed command changes authoritative pixels.

## Memory and request limits

The engine enforces 1–512 pixels per axis, 16 layers, 64 frames, 64 clips, and 128 MiB of decoded document RGBA. The byte limit takes precedence over count limits. A batch accepts at most 256 operations and 65,536 supplied pixels in total. Reads are limited to 65,536 pixels. Names/IDs are bounded to 128 characters; palettes to 256 colors. The MCP transport separately enforces its existing 4 MiB body limit.

Staging copies only touched cels and allocates transparent/new duplicate cels as needed. It permits at most 128 MiB of cumulative new RGBA allocations per batch, including cels subsequently removed in that batch. Untouched buffers are shared internally and never exposed. Flood-fill scratch space is bounded by canvas area; bounded region reads composite only that region.

History stores metadata plus the changed byte interval of each touched cel, or full cel bytes for additions/deletions. Single-pixel edits on a 512×512 canvas therefore retain a few bytes rather than a full canvas snapshot. Retained undo and redo together are capped at 64 MiB and 1,024 entries; oldest undo entries are evicted. Accounting includes buffer bytes and conservative metadata/bookkeeping costs. A pending entry also has a 64 MiB cap, checked before allocating each patch. An edit whose inverse cannot fit is rejected atomically. The document, staged cels, retained history, and pending history have separate budgets; these limits are not a total process-RAM cap.
