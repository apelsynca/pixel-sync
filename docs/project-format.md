# Projects, PNG and GIF exports, sprite sheets, and recovery

Use **Save** or **File → Save as…** to keep editable artwork. Use **File → Open project…** to restore it. **Ctrl+S** saves, **Ctrl+Shift+S** saves as a new file, **Ctrl+O** opens, **Ctrl+I** imports PNG, **Ctrl+E** exports the selected frame, and **Ctrl+Shift+E** opens the sprite-sheet export dialog. Replacement and closing offer **Save / Discard / Cancel**. Cancelling a save dialog keeps the current artwork open.

Native dialogs can select files outside the MCP workspace. MCP file calls can only access the folder chosen under **Connect AI client → MCP file workspace**. No workspace is needed for drawing or previews. Clear workspace to disable MCP file access while retaining drawing access. Its canonical root is persisted in the app-data `workspace.json`.

## Native project version 1

A `.pixel.json` file is UTF-8 JSON containing dimensions, shared layers in bottom-to-top order, frames in timeline order, per-frame durations, RGBA cels keyed by layer ID, palette, and clips. Example for a single red pixel:

```json
{
  "version": 1,
  "width": 1,
  "height": 1,
  "layers": [{ "id": "layer-1", "name": "Body", "visible": true }],
  "frames": [{ "id": "frame-1", "duration": 100, "cels": { "layer-1": "/wAA/w==" } }],
  "palette": ["#FF0000FF"],
  "clips": [{ "name": "idle", "frameIds": ["frame-1"], "loop": true }]
}
```

Each cel is canonical padded base64 of exactly `width × height × 4` bytes, row-major straight RGBA8. Hidden layer pixels and RGB beneath zero alpha survive project saves. Each frame has exactly one cel per layer. Layer/frame IDs must be globally unique within the project. Clip names are unique and references are nonempty, distinct, ordered frame IDs. Frame durations are integer milliseconds, 10–60,000.

The loader validates version, dimensions (1–512), counts (16 layers, 64 frames, 64 clips, 256 swatches), references, base64 lengths/encoding, and the 128 MiB decoded RGBA limit before accepting a replacement. Collection and byte limits are checked before decoded cel allocation. Serialized input is limited to 192 MiB. Unsupported versions and malformed/truncated input leave the current document and history untouched.

Document session identity, revision, undo history, selection, zoom, playback, and onion skin are not saved. Opening gives the document a new session ID, revision zero, empty history, and clean state. Stable layer/frame IDs, clips, visibility and timing are preserved. PNG imports and recovery restores start as unsaved documents.

## Consistent and atomic file operations

File reads, writes, and exports hold the same command queue as editing. A save/export therefore represents one exact revision. A successful project save marks that content version clean; PNG, GIF and sprite-sheet exports do not. Edits queued after a save execute afterward and make the project dirty again.

Project/PNG writes stage a temporary sibling file, flush it, close it, recheck the destination, then publish it. An overwrite uses file replacement; failure before publication retains the existing file. No-overwrite publication uses an exclusive hard link so a concurrently created destination is preserved (a filesystem with hard-link support, such as Windows NTFS, is required for that mode). Temporary cleanup is attempted on every exit path; a cleanup error cannot misreport a successfully published file as an unsuccessful save.

MCP writes require explicit `overwrite: true` to replace an existing file. Native Save reuses the associated project path; Save as and PNG export use the OS overwrite confirmation. If the app adds a missing extension and that produces an existing destination, it asks before replacing that file too.

## PNG import and export

PNG import accepts static RGBA, RGB, grayscale and indexed PNGs with channel depths up to 8 bits, at most 512×512 and 16 MiB encoded. Signatures, dimensions, chunk bounds, and inflated scanline size are checked before decoding; interlaced Adam7 data also has an explicit inflation bound. The decoder checks CRCs. APNG and 16-bit channels are rejected rather than silently discarding animation or channel precision.

An imported image becomes a new unsaved document with one visible layer and one 100 ms frame. Exporting a frame flattens visible layers with the shared compositor, keeps exact logical dimensions and transparent RGBA, and excludes editor overlays. It does not trim, resample, rotate or palette-quantize the image. PNG import does not recreate the layers lost during flattening; use `.pixel.json` for editable projects.

## Animated GIF export

Choose a clip in the timeline (or **All frames · loop**), then click **Export GIF…**, use **File → Export animation GIF…**, or press **Ctrl+Alt+E**. Choose a `.gif` destination in the Save dialog. Cancelling leaves the document unchanged; existing files use the OS overwrite confirmation, including an extra confirmation when appending `.gif` would replace an existing file.

The GIF contains the selected clip's frames in clip order and honors its loop flag. Without a selected clip, every frame is exported in timeline order and loops forever. Visible layers are flattened at the original canvas dimensions without grid, onion skin or other editor overlays. Frame durations are rounded to the nearest 10 ms, the GIF time unit. Export does not mark the project saved or change history.

GIF supports binary transparency: composite alpha below 128 becomes fully transparent, and alpha of 128 or above becomes opaque. Each frame reserves one transparent palette entry and preserves exact RGB when it has at most 255 opaque colors; larger palettes are quantized to 255 opaque colors without dithering. Fully transparent frames clear the preceding image rather than leaving a trail. Keep the editable project or export PNG/sprite sheets when exact RGBA is needed.

MCP's `export_gif` uses the same exporter and atomic file writes, with a workspace-relative `.gif` path, document/revision guard, optional `clip` name and explicit `overwrite: true` for existing files.

## Sprite-sheet export version 1

Choose **File → Export sprite sheet…**, enter a new folder name and column count, then select the parent folder. The app creates that new directory containing `sheet.png` and `sheet.json`. Existing export directories are always refused. Both files are staged in a temporary sibling directory before the directory is renamed into place; a failed export never publishes a new directory containing only one file.

Every frame is exported once in timeline order. Cells have the document dimensions and start at the image's top-left in row-major order. Padding and offset are zero; unused cells in the last row are transparent. Default columns are `ceil(sqrt(frameCount))`; columns must be 1 through frame count. Layouts must fit 4096×4096 and 64 MiB decoded RGBA. Change the column count if a wide or tall layout exceeds the limit.

The JSON sidecar contains:

| Field | Meaning |
| --- | --- |
| `version` | `1` |
| `image` | Relative PNG filename: `sheet.png` |
| `imageWidth`, `imageHeight` | PNG dimensions in pixels |
| `frameWidth`, `frameHeight` | Cell dimensions in pixels |
| `frameCount`, `columns`, `rows` | Actual frame count and regular grid layout |
| `padding`, `offset` | `0` and `{ "x": 0, "y": 0 }` |
| `units` | Dimensions in `pixels`, duration in `milliseconds` |
| `documentId`, `revision` | Source session and exact revision used for both files |
| `frames` | Timeline-ordered `{ id, index, duration }` entries; index is the atlas index |
| `clips` | `{ name, indices, loop }` entries; ordered atlas indices may differ from timeline order |

Consumers must use `frameCount`/clip indices rather than treating unused grid cells as animation frames. Durations may differ per frame. The [Bevy 0.20.1 sample](../examples/bevy/README.md) loads this sidecar and advances clips with elapsed-time accumulation; Bevy does not automatically read this editor-specific JSON format.

## Crash recovery

After dirty document changes, a 500 ms debounce queues an atomic `recovery.pixel.json` snapshot in the per-user app-data directory. It stores the same version-1 project format, separate from a manually saved project, and uses the same validation limits. A successful save/open clears stale recovery; exports leave dirty-state recovery active. A recovery-write error appears in the editor with a Save action and clears after a later successful recovery operation.

After an abnormal exit, the next launch offers **Recover artwork / Discard recovery** inside the app. The saved snapshot is not overwritten by the initial blank canvas while that offer is pending. Closing the app without answering preserves the offer. An unreadable snapshot remains on disk until explicitly discarded. Recovering creates unsaved artwork with a new session ID and empty history; the old project path is not automatically reused, so the next Save asks for a destination.

Normal closing first resolves the Save/Discard/Cancel prompt and waits for pending file/recovery work, then removes the recovery snapshot. Cancelling close leaves the app, MCP server, and recovery active. Recovery is debounced: the most recent edits before a sudden crash may precede the last completed snapshot, so explicit project saves remain the durable checkpoint.

## Workspace path rules

MCP paths must be relative, for example `hero.pixel.json`, `sprites/hero.png`, or a new directory `animations/walk`. Existing parent folders are required; there is no filesystem-browsing or general mkdir/shell tool. Both slash styles are accepted. Absolute paths, drive-relative paths, UNC paths, traversal, NTFS alternate data streams, reserved device filenames, empty/unsafe components, and trailing dots/spaces are rejected.

The resolver checks the canonical root and every parent, rejects symlinks/junctions and hard-linked files, records parent identity, and rechecks paths during access and before publication. A workspace root redirected after selection or between app runs is rejected; choose it again explicitly if intentional. These checks are tested with linked parents and an injected folder swap during file creation.

## Verification

`bun run check` includes project/image round trips, exact pixels/metadata, decode and layout limits, overwrite races, staged cancellation, failed-write preservation, partial-export prevention, path/link rejection, and recovery tests, plus actual MCP HTTP/compiled-stdio file calls. `bun run smoke:files` launches real Electron, drives native-dialog results through the UI, exercises Save/Open/import/export and workspace setup, kills and restarts the app, recovers artwork, and verifies close Cancel/Save and snapshot cleanup. Its data and client configurations are isolated temporary folders. Run these checks locally. The user confirms the Windows package works; detailed native Windows file/recovery checks remain unrecorded.
