# Pixel Art Editor — Implementation Plan

Status: milestone 5 is implemented: editable projects, PNG import/export, sprite sheets/metadata, workspace-bound MCP file tools, and crash recovery. Automated Linux checks cover real Electron file workflows and forced-crash/restart recovery in addition to drawing at two display scales and HTTP/stdio editing. Updated Windows runtime and native assistant-driven acceptance remain unverified. Milestone 6 (release acceptance and Bevy sample) has not started. The user's earlier Windows launch verification covered the foundation build.

Implemented onboarding: **Connect AI client → Connect to Codex / Connect to Claude Code** configures authenticated local HTTP and provides instructions inside the app. Basic setup requires no executable path, token lookup, environment variables, or manual configuration editing. Each guide includes a first drawing prompt, shared undo/playback instructions, a recent-operation list, and native selection of an MCP file workspace.

## Implementation progress — 2026-11-14

### Completed

- [x] Scaffold TypeScript, Electron, React, Vite/esbuild, ESLint, and Vitest with pinned dependencies.
- [x] Switch package management, scripts, documentation, and CI to Bun 1.4.4; commit-ready `bun.lock` replaces `package-lock.json`. Node.js remains required for build/Electron tooling.
- [x] Add the milestone 1 foundation window and MCP settings. Milestone 3 replaces the placeholder with the writable editor.
- [x] Configure isolated, sandboxed renderer/preload IPC with sender and payload validation, blocked navigation, and disabled renderer Node integration.
- [x] Implement the official SDK Streamable HTTP endpoint bound to `127.0.0.1`, bearer-token authentication, Host/Origin checks, a 4 MiB request limit, and a read-only `get_status` tool.
- [x] Persist a generated token, enabled setting, and configurable port in the per-user `mcp-connection.json`; start disabled by default and report port collisions.
- [x] Implement `PixelSync.exe --mcp-stdio` branching before GUI startup/single-instance locking, forwarding protocol messages to the running app. Also provide the compiled development bridge at `dist/bridge.cjs`.
- [x] Add five integration tests covering HTTP/compiled-stdio instance identity and tool errors, request validation, port collisions, persistent settings, and disabled/app-closed diagnostics.
- [x] Add Electron Forge Windows Squirrel/ZIP configuration and Windows CI for checks, packaging, packaged executable smoke testing, and unsigned installer artifacts. CI is configured; its Windows results have not been observed.
- [x] Add README development/build instructions and MCP setup/troubleshooting documentation. Milestone 3 adds in-app guides and verifies configuration parsing with installed Codex and Claude Code binaries; native tool calls remain acceptance work.
- [x] Add and verify `bun run package:win`, which supplies `--platform=win32 --arch=x64` automatically and avoids the invalid `x6` architecture argument.
- [x] Diagnose the initial missing Electron shared libraries and document Arch Linux dependency installation. The libraries are now present; real Electron UI tests pass using Linux's headless Ozone platform.

### Verification recorded

- `bun install --frozen-lockfile`: passed.
- `bun run check`: TypeScript, ESLint, production build, and all five integration tests passed on the Linux development host. Tests launch the compiled stdio bridge with Node.js and official SDK clients, rather than the packaged Windows executable.
- Linux x64 packaging: passed.
- `bun run package:win`: passed on Linux and produced `out/PixelSync-win32-x64/PixelSync.exe` with its runtime files. Copy the entire output folder to Windows; the executable is not standalone.
- The packaged executable smoke script exists at `scripts/smoke-packaged.mjs`; it has not been run successfully on Windows. Building a Windows package does not establish Windows runtime or client compatibility.
- The user reports successfully running the app on Windows 11. This verifies app launch; installer, automated packaged smoke, and actual desktop MCP-client connections were not reported.

### Outstanding Windows connection/release checks

- [ ] Run the packaged GUI/HTTP/stdio smoke test on Windows, including executable paths containing spaces and bridge cleanup.
- [ ] Build and install the unsigned Windows installer; verify it runs on Windows 11 without a separately installed Node.js runtime.
- [ ] Connect at least one actual local desktop MCP client to the installed app, and record tested client configuration.
- [ ] Verify packaged app-closed, MCP-disabled, and port-collision behavior on Windows.
- [x] Proceed to milestone 2 at the user's direction following their successful Windows 11 launch.

### Milestone 2 — completed 2026-11-14

- [x] Add the UI-independent document engine with transparent canvases, stable layer/frame IDs, frame durations, shared layer metadata, palettes, and named clips.
- [x] Implement exact RGBA painting/erasure, inclusive Bresenham lines, outlined/filled rectangles, four-connected flood fill, and shared source-over compositing.
- [x] Validate strict command schemas and document/revision guards; stage copy-on-write cels and commit ordered batches atomically after validating final clip references.
- [x] Add the application command queue, revisioned commit notifications, and gesture reservations that hold competing commands until commit or cancellation.
- [x] Implement pixel-patch undo/redo, saved-version dirty tracking, redo branch invalidation, byte-budget eviction, and a bounded history entry count.
- [x] Enforce frame/layer/clip, supplied/read pixel, decoded document, staging, operation count, and undo-memory limits; reject oversized edits before publication.
- [x] Verify `bun run check`: TypeScript, ESLint, production build, 19 new engine/application tests and the five existing real-transport integration tests passed (24 total).

The engine and command service now drive both the manual editor and MCP editing. See `docs/document-engine.md` for engine semantics and `docs/mcp-tools.md` for transport tools and examples.

### Milestone 3 — implemented 2026-11-14; Windows/client acceptance pending

- [x] Connect the authoritative command service to validated, main-frame-only IPC; publish document revisions and bounded frame snapshots. Keep the renderer sandboxed with Node integration disabled and web permissions denied.
- [x] Add pencil, eraser, fill, line, outlined/filled rectangle, composite color picker, RGBA/alpha controls, editable swatches, and shared undo/redo. Interpolate pointer movement and group a gesture into one commit; cancellation/blur releases its reservation.
- [x] Add layer selection, naming, order, visibility, additions/deletions, integer zoom, fit, pan, pixel grid, coordinates, tool shortcuts, and unsaved replacement/close prompts. Project saving is still milestone 5.
- [x] Add frame thumbnails, selection, add/duplicate/delete/reorder, duration editing, previous/next navigation, clip creation/editing/order/looping, elapsed-time playback, and paused onion skin. Playback retains the selected edit frame and non-looping clips stop on their final preview frame.
- [x] Add separate Codex and Claude Code cards with Connect/Update, in-app instructions, installation-guide links, a copyable first prompt, optional populated private configuration, server availability, and actual status-call timestamps. Write persistent authenticated HTTP configuration without a shell or a token environment variable.
- [x] Preserve unrelated client configuration, back up existing nonempty files, atomically replace configuration, detect concurrent changes, and leave invalid/unsupported layouts untouched. Keep credentials out of routine UI, IPC results, parser diagnostics, and logs.
- [x] Verify generated configuration with installed codex-cli 0.168.0 and Claude Code 2.1.325 using isolated client homes. This verifies their config parsers, not assistant-driven tool calls.
- [x] Pass `bun run check`: TypeScript, ESLint, production build, and 36 engine/application/configuration/transport tests.
- [x] Pass real Electron UI smoke tests at 100% and 150% display scaling, exercising drawing, history, cancellation, layers, timing, clips, playback, both connection buttons, authenticated named-route status calls, and unsaved replacement/close handling. SDK test clients supply the status calls.
- [x] Add Windows CI execution of the editor smoke script and update packaged status assertions for the new document metadata.
- [x] Package the Linux app and pass packaged HTTP/stdio plus editor smoke checks at both display scales. Rebuild the Windows x64 folder with milestone 3 at `out/PixelSync-win32-x64/`; Windows execution of this updated build remains unverified.
- [ ] Verify the updated manual editor on Windows 11 at actual Windows display scales.
- [ ] Follow the in-app guides in native Codex and Claude Code, call `get_status`, restart both clients/app, and verify persistence. Do not infer these results from SDK tests or CLI configuration parsing.

### Milestone 4 — implemented 2026-11-14; native Windows/client acceptance pending

- [x] Expose `get_status`, `get_document`, `get_pixels`, `get_preview`, `get_animation_preview`, `new_document`, `edit_document`, `undo`, and `redo` through the official SDK and the existing authenticated HTTP/stdio paths. Advertise strict object schemas, bounded capabilities/limits, safe read/write annotations, and agent workflow instructions.
- [x] Route mutations through the same serialized command service as manual gestures. Preserve atomic batches, identity/revision checks, unsaved replacement guards, and shared undo/redo. Validate read identity and optional expected revisions inside the queue.
- [x] Return exact base64 RGBA regions and transparent PNG image content. Render cropped/integer-scaled previews and row-major contact sheets of 1–16 explicit frames from one revision; include frame positions/durations and enforce 1024×1024 / 4 MiB decoded output. Exclude editor overlays.
- [x] Return stable structured errors for schema failures, missing targets, stale revisions, history/replacement/size limits, cancellation, and unexpected internal failures. Bound error text and cancel queued work when its transport closes or the server stops.
- [x] Display the last 50 MCP operations in the connection panel, with route, tool, outcome, revision, elapsed time, and summary. Do not retain arguments, credentials, pixels, or preview images.
- [x] Update both in-app client guides with a copyable drawing prompt, live editing/preview capabilities, playback directions, and shared undo/redo instructions.
- [x] Pass `bun run check`: type checking, linting, production build, and 45 tests, including nine real HTTP/compiled-stdio editing tests covering schemas, animation/pixels/PNG layout, rollback, concurrent stale edits, shared history, replacement, limits, gesture conflicts, and pending cancellation.
- [x] Pass the expanded Electron smoke checks at 100%/150% scaling: MCP art appears in the canvas; UI Undo/MCP Redo and MCP Undo/manual strokes share history; a remote clip plays; remote mutations pause playback without retargeting the edit frame; PNGs exclude onion skin; operation history stays bounded. Both configured endpoints discover all editing tools with SDK test clients.
- [x] Expand the packaged smoke script to edit through the executable stdio bridge, read through HTTP, compare PNG responses, and move through shared history across both transports.
- [x] Pass the expanded packaged Linux HTTP/stdio and UI smoke checks, then rebuild the Windows x64 folder at `out/PixelSync-win32-x64/`. The updated Windows executable has not been run on this Linux host.
- [ ] Perform native Codex and Claude Code drawing/preview/playback/undo acceptance on Windows 11 and record the tested runtime versions. Existing configuration-parser checks and SDK clients do not establish this acceptance.

MCP save/open/import/export tools are now implemented with persistence/workspace enforcement in milestone 5.

### Milestone 5 — implemented 2026-11-14; Windows acceptance pending

- [x] Implement version-1 `.pixel.json` projects with exact RGBA, shared layer order/visibility, frame IDs/timing, palette and clips. Validate versions, structures, unique IDs/references, canonical base64/lengths, collection counts, 192 MiB serialized input and 128 MiB decoded pixels. Loading has a new document identity and no persisted history.
- [x] Serialize file reads/writes through the command service, hold consistent revisions across asynchronous I/O, and mark a project clean only after successful publication. Stage sibling files, flush and publish atomically, require explicit overwrite for MCP, and preserve old files and dirty/history state on pre-publication failures.
- [x] Add native Save/Save as/Open/PNG import/export and sprite-sheet dialogs, file shortcuts, associated filenames, and Save/Discard/Cancel replacement/close prompts. Cancelling Save retains the artwork; automatically appended extensions cannot bypass overwrite confirmation.
- [x] Import bounded static PNGs with exact RGBA and no palette quantization; preflight signatures/dimensions/chunks and inflation size, including interlaced PNG. Reject unsupported APNG/16-bit channels. Export flattened PNG through the same compositor as previews.
- [x] Export every timeline frame once into a regular-grid PNG and version-1 JSON sidecar with cell layout, frame count/IDs/indices/durations, clip order/looping, source revision and explicit units. Enforce 4096×4096 / 64 MiB and publish both files in a new directory; refuse existing export directories.
- [x] Expose five MCP file tools through real HTTP/stdio. Require one user-selected persistent workspace; reject traversal, absolute/drive/UNC paths, ADS, unsafe names, linked parents/files, root redirection and detected folder swaps. Recheck paths during access/publication; native dialogs remain user-selected access outside the MCP workspace.
- [x] Add debounced, atomic recovery snapshots; offer recovery in-app after abnormal exit, preserve pending/corrupt snapshots until an explicit choice, restore as unsaved artwork without reusing an old path, and clear snapshots after successful save or normal closing. Report recovery write failures in the UI.
- [x] Pass 67 tests, including animated project/PNG round trips, exact sprite-sheet cells/clip metadata, async revision consistency, failed saves/exports, overwrite races, bounded decoding, workspace escapes/links, staged cancellation, recovery, and four actual HTTP/compiled-stdio file-tool tests.
- [x] Pass real Electron file workflow tests: native Save/Open/import/export, Save shortcut, explicit appended-extension overwrite, UI workspace selection and MCP save, forced process kill/restart, recovery, close Cancel/Save, and normal-close cleanup. Existing 100%/150% drawing/zoom/MCP smoke checks remain covered.
- [x] Add the file/recovery smoke script to Windows CI and document native format, sprite metadata, path rules, error categories and recovery behavior in `docs/project-format.md`.
- [x] Pass the expanded packaged Linux HTTP/executable-stdio save/open/export smoke and packaged file/crash-recovery UI checks. Refresh the Windows x64 folder at `out/PixelSync-win32-x64/`.
- [ ] Verify native Windows 11 file dialogs, NTFS/junction behavior, installation, and native assistant file calls in the updated packaged application. Linux and mocked-dialog automated results do not establish these checks.

## 1. Goal and decisions

Build a simple Windows 11 desktop pixel art editor for making assets for **Bevy games**, whose main feature is an MCP server. A local MCP client must be able to inspect the current artwork, draw into it, and save it while the user sees changes in the editor. Prioritize game sprites, transparent textures, exact pixel dimensions, and a straightforward export-to-Bevy workflow.

Confirmed requirements:

- Target Windows 11.
- The editor is intended for creating pixel art for Bevy games.
- Plan animation as part of the initial delivery, including manual editing, MCP control, and Bevy sprite-sheet export.
- Choose the implementation language from Python, TypeScript/JavaScript, or Rust.
- Support Codex and Claude Code as the first supported local MCP clients, with dedicated in-app connection instructions. Other clients, including Claude Desktop, may use the documented generic MCP connection but are not substitutes for testing these two integrations.
- Planning is complete; implementation is now underway, with progress tracked above.

Chosen approach: **TypeScript + Electron**, with React for the editor UI and Canvas 2D for pixel rendering. Use the official MCP TypeScript SDK, Zod for boundary validation, a pure JavaScript PNG codec, Vitest for core/integration tests, and Electron Forge for packaging. Select supported stable versions and pin dependencies when implementation starts.

This keeps the editor and MCP server in one language, provides desktop file dialogs and a bundled runtime, and avoids requiring users to install Node.js. Electron's larger installation size is an accepted tradeoff for implementation simplicity. No Python or Rust component is needed.

## 2. First release scope

### Editor

- One open document at a time; static sprites and animations with 1–64 frames.
- New transparent canvas, with 32×32 as the default and dimensions from 1 to 512 pixels per axis.
- Up to 16 layers: add, rename, reorder, show/hide, and delete; retain at least one layer.
- Straight RGBA pixel storage, transparent background, and normal source-over layer compositing. No blend modes or layer opacity controls initially.
- Pencil, eraser, four-connected flood fill, line, rectangle, and color picker.
- One-pixel pencil/eraser; outlined or filled rectangles; transparent erasure.
- Foreground color, alpha input, and a small editable swatch palette.
- Zoom, pan, optional pixel grid, checkerboard transparency, and visible coordinates.
- Timeline with add/duplicate/delete/reorder frame actions, per-frame durations, play/pause, looping, and previous/next-frame navigation.
- Optional onion skin of the previous and next frame, plus named clips such as `idle` and `walk`.
- Undo/redo shared between manual actions and MCP edits. One gesture or MCP batch is one undo step.
- Native project save/open, single-frame PNG import/export, animated sprite-sheet PNG plus JSON export, dirty-document indicator, and unsaved-change prompts.
- Keyboard shortcuts for tools, undo/redo, new/open/save/export, and zoom.
- A compact MCP settings/status panel with enable/disable, **Connect to Codex / Connect to Claude Code**, guided setup and connection verification, advanced connection details, credential reset, and a recent-operation list. Basic setup must not require manual executable paths, token-file lookup, environment variables, or configuration editing.

### MCP

- Inspect the open document, layers, frames, and animation clips.
- Read pixels from a bounded region and obtain a rendered PNG preview.
- Create a document, manage layers/frames/clips, set timing, draw, erase, fill, and undo/redo.
- Save/open projects and import/export PNG within a user-selected workspace folder.
- Export sprite sheets and clip metadata; inspect animation frames using bounded contact-sheet previews.
- Return clear validation errors without partial edits.
- Make successful mutations visible immediately in the desktop UI.

### Deferred

Selections, clipboard operations, text, brushes, tilesets, rotation/resizing, indexed-color mode, blend modes, multi-document tabs, collaboration, plugins, cloud storage, and remote internet access. Advanced animation features such as tweening, linked cels, GIF/video export, and sprite-sheet import are also deferred. No built-in model, chat UI, API keys, or image generation: the external MCP client supplies the agent.

### Bevy asset workflow

- First release: export transparent PNG sprites directly into a user-selected Bevy project's asset directory, through a dialog or the configured MCP workspace. Keep logical pixel dimensions and avoid resampling or automatic trimming that changes sprite alignment.
- Include a short Bevy loading example and nearest-neighbor sampling setup, checked against the Bevy version used for verification. Confirm appearance at integer display scales in a small Bevy sample.
- First release also exports regular-grid PNG sprite sheets with explicit frame dimensions, ordering, and timing metadata. Bevy's [official sprite-sheet example](https://bevy.org/examples/2d-rendering/sprite-sheet/) demonstrates loading a sheet with a texture atlas and advancing its frame index.
- Keep project files editor-specific and exports ordinary PNG files. Any animation JSON sidecar is our documented format, with an accompanying Bevy example; do not assume Bevy loads custom timing metadata automatically. No Bevy plugin or Rust code generation is required for the first release.

## 3. Architecture and state ownership

```text
Local MCP client
  ├─ stdio → packaged bridge ─┐
  └─ Streamable HTTP ────────┴→ Electron main: MCP adapter
                                             │
Editor renderer → validated preload IPC ──────┤
                                             ▼
                                  Application command service
                                             │
                                Document engine + undo history
                                             │
                                Revisioned updates → renderer
```

- **Document engine:** UI-independent TypeScript for layers, pixels, compositing, geometry, flood fill, validation, and reversible edits.
- **Command service:** owns the authoritative document in Electron's main process. All UI and MCP mutations go through the same serialized command queue.
- **Renderer:** React controls and Canvas 2D display; it has no independent writable document model. It receives initial snapshots and revisioned dirty-region updates. A missed revision triggers a fresh snapshot.
- **Preload:** exposes a small typed IPC API; renderer Node integration is disabled, context isolation and sandboxing are enabled, and IPC senders/payloads are validated. Follow the [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security).
- **MCP adapter:** translates validated tool arguments into commands and returns structured results. It cannot bypass engine constraints.
- **Persistence:** native dialogs for user actions; a separate workspace-bound file service for MCP operations.

Use nearest-neighbor display scaling, integer document coordinates, and explicit conversions between screen, canvas, and pixel coordinates. Share the compositing implementation between the UI's backing image and PNG previews/exports so transparency and layer ordering agree.

The document owns dimensions, ordered layer metadata, ordered frames, and named clips. Each frame has a stable ID, a duration in milliseconds, and RGBA buffers keyed by layer ID. Drawing, compositing, and history identify their target frame explicitly. Frame order and pixel data are document state; selected frame, playback position, and onion-skin settings are view state. See section 10 for animation semantics and export contracts.

Keep expensive work bounded. Transfer small pixel regions for strokes, coalesce repaint notifications, and avoid serializing the whole document on pointer movement. Start with the engine in the main process; introduce a worker only if measured latency requires it.

Suggested layout:

```text
src/core/          document, drawing, compositing, history
src/application/   command queue, revisions, document lifecycle
src/main/          Electron lifecycle, IPC, files, settings
src/preload/       narrow renderer API
src/renderer/      editor controls, canvas, input handling
src/mcp/           tool schemas, handlers, HTTP transport, stdio bridge
tests/             engine, transport, persistence integration tests
docs/              client setup and project format
```

## 4. Local MCP connection

The desktop app hosts a Streamable HTTP endpoint on `127.0.0.1` while MCP access is enabled. Use a configurable saved port, detect collisions, and show actionable errors in the UI. Never bind to all network interfaces.

Provide a packaged **stdio bridge** for clients that launch a server executable. It connects to the running app over the same local endpoint using the official SDK, preserving request/response content and errors. It must not create a second editor document or maintain its own state. Keep protocol messages on stdout and diagnostics on stderr.

The bridge entry point is a non-GUI mode of the installed application, for example `PixelSync.exe --mcp-stdio`. Packaging must prove this mode works with the Windows executable before substantial UI work. Its initialization must bypass GUI startup and the GUI single-instance lock. If the app is closed or MCP is disabled, return a useful connection error; automatic app launching is deferred.

The app generates a bearer token and stores connection metadata in its per-user application-data directory with user-scoped access. The bridge reads it automatically; the guided HTTP setup configures authentication for the selected client automatically. Manual token configuration is an advanced fallback. Validate Host and Origin as appropriate, reject invalid origins, and require authorization for endpoint access. Follow the official [MCP transport specification](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/transports/streamable-http.mdx). Use the SDK's supported negotiated protocol versions instead of hand-writing JSON-RPC.

Client setup documentation must include tested command/argument examples for the packaged stdio mode and an HTTP example for a compatible client. Confirm exact client configuration syntax during implementation. The [official TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/) documents the available transports.

### Simple in-app connection setup

The primary user flow is **open PixelSync → choose Codex or Claude Code → click Connect → follow any client restart instruction → verify the connection**. Keep the instructions inside the app, available before and after setup. The existing manual commands remain an advanced option.

- Add a **Connect an AI client** panel with separate Codex and Claude Code cards. Each card explains what the client can currently do, shows its setup state, and provides **Connect**, **Show instructions**, and **Check connection** actions. During milestone 3, explain that only `get_status` is exposed; update the text when milestone 4 adds editing tools.
- Prefer direct local HTTP so users do not have to choose or maintain an executable path. The app supplies the current endpoint and authentication through the client's supported persistent configuration. Detect the selected client's available setup mechanism and use its documented configuration format or CLI. Verify both clients' current official documentation during implementation; do not assume they use identical settings or authentication mechanisms.
- Clicking **Connect** explicitly authorizes registering this app with the selected client and enabling MCP. Detect the supported per-user configuration, preserve unrelated servers/settings, and retain a recoverable backup before changing existing configuration. Update only PixelSync's entry. Avoid shell startup-file changes and avoid requiring a token environment variable on every launch. Keep credential handling in the main process; do not expose tokens in routine UI, logs, or copyable instructions.
- If automatic configuration is unavailable, explain the specific reason and show the shortest tested client-specific fallback inside the app. Provide a **Copy setup command** or **Copy configuration** action with machine-specific values already filled in; do not ask the user to find paths or read JSON files. An automatically populated stdio bridge setup may be offered as a fallback, clearly labeled; it must not be the only documented path. Any deliberate credential-bearing configuration copy must be clearly identified and excluded from logs.
- Each client's in-app instructions cover installation/detection, connecting, any required restart or new session, how to inspect available MCP tools in that client, and a ready-to-copy first prompt: **Use pixel-sync to get its status.** Show the actual app capabilities and next steps after a successful check.
- Distinguish **configured**, **server available**, and **client connection verified**. A successful config write or app-side HTTP probe alone must not claim the client connected. Record a real MCP initialization/tool call and guide the user to run the status prompt in the selected client. Do not promise a client identity that the protocol cannot establish.
- Handle missing clients, disabled MCP, occupied ports, stale credentials, and unsupported client versions with an actionable message in the same panel. After a port change or credential reset, offer **Update client connection** using the same setup flow. Explicitly state that the app must remain open and the client must reach the same localhost endpoint; Windows/WSL or remote-host connections need separately verified instructions.
- Exit criterion: on Windows 11, a user connects both Codex and Claude Code using the in-app instructions, without manually entering an executable path, inspecting token files, setting environment variables, or editing config files. Each client successfully calls `get_status`, and setup survives an app/client restart.

## 5. MCP tool contract

Keep a small tool set with explicit schemas and descriptions. IDs are stable opaque strings; coordinates start at the top-left, with x increasing right and y increasing down. Colors use `#RRGGBBAA` at API boundaries.

| Tool | Purpose |
| --- | --- |
| `get_document` | Return document ID, revision, dimensions, dirty state, palette, layers, ordered frame IDs/durations, clips, and capabilities/limits. |
| `get_pixels` | Read an explicit layer or flattened composite region; return row-major RGBA data with encoding and dimensions. |
| `get_preview` | Return a PNG as MCP image content, optionally cropped and integer-scaled. |
| `get_animation_preview` | Return a bounded PNG contact sheet of explicit frame IDs with durations and ordering metadata; exclude editor overlays. |
| `new_document` | Create a transparent document with validated dimensions. |
| `edit_document` | Apply an atomic ordered batch of typed drawing, palette, layer, frame, or clip operations. |
| `undo` / `redo` | Move through shared history for the specified document and expected revision. |
| `open_project` / `save_project` | Read/write the native project format within the configured MCP workspace. |
| `import_png` / `export_png` | Import a PNG as a new one-layer document or export the flattened image. |
| `export_sprite_sheet` | Export all frames in document order as a regular-grid PNG with versioned JSON layout/clip metadata. |

`edit_document` operations: `set_pixels`, `draw_line`, `draw_rectangle`, `fill`, `clear_layer`, `add_layer`, `rename_layer`, `move_layer`, `set_layer_visibility`, `delete_layer`, and `set_palette`. `set_pixels` also covers erasure with transparent RGBA. Define dimensions, coordinate inclusivity, clipping, alpha replacement, and layer ordering in schemas and docs. Use exact pixel replacement for painting; use source-over only when compositing layers.

Add animation operations to `edit_document`: `add_frame`, `duplicate_frame`, `delete_frame`, `move_frame`, `set_frame_duration`, `set_clip`, and `delete_clip`. Clients may supply unique IDs for newly created frames/layers so subsequent operations in the same batch can refer to them; omitted IDs are generated and returned. Validate operations sequentially against staged state, then commit the whole batch once.

Pixel reads, single-frame previews, PNG export, and drawing operations carry an explicit `frameId`. Clients obtain it from `get_document`; do not rely on a UI-selected or currently playing frame for MCP behavior. No MCP playback control is required: the client edits animation data and inspects contact sheets, while the desktop UI handles live playback.

Mutation rules:

- Require `documentId` and `expectedRevision` for edits and undo/redo. New/open/import also check the current document identity/revision before replacement when a document exists.
- Serialize commands; a user stroke is a transaction. Other mutations wait until it commits or cancels. A conflicting MCP mutation returns a stale-revision error so the client can reread and retry.
- Validate every operation before committing. A failed batch leaves pixels, layers, revision, dirty state, and history unchanged.
- Return the resulting document ID/revision, changed bounds/layers, and a concise operation summary.
- Bound requests: initially 256 operations per batch, 65,536 supplied/read pixels per call, 4 MiB request bodies, and 1024×1024 preview output. Contact sheets accept at most 16 frames and must fit that output limit; clients can page through frames. Also enforce the document/export memory limits in section 10 before allocating staged edits. Refine limits only with evidence.
- Return stable error categories for invalid arguments, stale revision, missing document/layer, path denial, unsupported format, size limits, and I/O failure.
- Never silently replace an unsaved document. New/open/import requires an explicit `discardUnsaved: true` or a prior save. Manual replacement uses a dialog.
- Saving/exporting must serialize a consistent revision. Require explicit overwrite for an existing destination. Cancel queued mutations before execution where supported; a committed atomic mutation is reversed with undo.

Do not require resource subscriptions, prompts, or custom MCP extensions for first-release operation. Standard tool calls and image results are sufficient.

## 6. Persistence, files, and recovery

- Native `.pixel.json` project: versioned JSON containing dimensions, ordered layer IDs/names/visibility, palette, ordered frames with IDs/durations/base64 RGBA buffers keyed by layer ID, and named clips referencing stable frame IDs. Static projects use the same format with one frame. Do not persist undo history.
- Validate format version, IDs/references, dimensions, layer/frame counts, durations, total decoded bytes, exact buffer lengths, and file size before accepting a document. Unsupported versions fail clearly. Start with a 192 MiB serialized project-file limit and a 128 MiB total decoded pixel limit; use bounded decoding and avoid unnecessary full-document copies.
- PNG import preserves RGBA without palette quantization; validate image dimensions before expensive decoding and reject images above the canvas limit. Export produces transparent flattened RGBA PNG.
- Save projects via a temporary file in the destination directory followed by replacement, and retain the old file if writing fails.
- Keep an application-data recovery snapshot after committed changes using a debounce. Offer recovery on next launch after an abnormal exit. Normal close prompts for unsaved work.
- Cap history memory, initially at 64 MiB; evict oldest undo entries and release redo entries after a new edit. Store pixel patches where practical rather than full snapshots per stroke.
- MCP file tools accept paths relative to one user-selected workspace root. Resolve and validate paths, including Windows drive/UNC paths, traversal, symlinks/junctions, and destination parents. Recheck when accessing files; do not expose arbitrary shell commands or filesystem browsing.
- Without a workspace configured, MCP drawing and previews still work; file tools return a setup error. GUI dialogs may access files outside that workspace because the user selects them directly.

## 7. Implementation milestones

### 1 — Foundation and Windows connection proof

- Scaffold TypeScript, Electron/React, build scripts, linting, and core tests.
- Package a minimal Windows app with a canvas placeholder and a read-only MCP status tool.
- Prove direct local HTTP and packaged stdio bridge connections reach the same running app; cover app-closed and port-collision behavior.
- Exit criterion: the installed application connects from one real local MCP client without a separately installed Node.js runtime.

### 2 — Shared document engine

- Implement frames, durations, shared layers, clips, deterministic drawing, flood fill, compositing, serialized commands, revisions, atomic batches, and bounded undo/redo.
- Exit criterion: engine tests establish exact pixel results, frame/layer/clip lifecycle rules, rollback on failure, stale-revision rejection, memory limits, and undo/redo correctness.

### 3 — Usable manual editor

- Implement the simple in-app MCP connection panel from section 4 early in this milestone, including dedicated Codex and Claude Code instructions, automatic authenticated setup, a populated fallback, and honest connection verification. This can be tested against the existing `get_status` tool before MCP editing is implemented.
- Build the toolbar, palette, layers panel, canvas input, zoom/pan/grid, shortcuts, and history controls.
- Route all gestures through the command service; group strokes into single history entries.
- Add the timeline, frame actions, timing controls, clip editor, playback, and onion skin according to section 10.
- Exit criterion: manually create and play a layered animation, edit timing/clips, and undo/redo pixel and frame changes at different zoom levels and Windows display scales. Connect both Codex and Claude Code through the in-app setup and verify `get_status` without manual credential or path configuration.

### 4 — Complete MCP editing

- Implement the complete tool contract including frame/clip operations, frame/contact-sheet previews, limits, authentication, and recent-operation display.
- Test real transport calls rather than only calling handlers directly.
- Update the in-app Codex and Claude Code guides with a tested first drawing prompt and shared undo/redo instructions; verify both clients can discover and call the editing tools.
- Exit criterion: a client creates an animation with layers and named clips, edits timing, inspects a contact sheet, and the user can play it and undo the client's pixel/frame changes in the UI.

### 5 — Files and recovery

- Implement animated project round trips, PNG import/export, sprite-sheet/JSON export, dialogs, workspace enforcement, overwrite protection, and recovery snapshots.
- Exit criterion: projects preserve frames, layers, pixels, timings, and clips; exported cells match previews; failed saves preserve existing projects; export failures do not publish an incomplete new export directory.

### 6 — Windows release and handoff

- Produce an x64 Windows installer and verify installation, upgrade/uninstall behavior, stdio launch paths containing spaces, and cleanup of bridge processes/connections.
- Run the end-to-end acceptance scenario below on Windows 11, ideally a clean VM without development tools.
- Document development commands, client setup, tool usage, file format, limits, and troubleshooting. Verify the in-app Codex and Claude Code instructions against recorded client versions and the installed Windows app; keep external setup docs consistent. Configure Windows CI for build/tests/package smoke checks where available.
- Document and smoke-test static PNG and animated sprite-sheet workflows in a small Bevy sample, including metadata loading, clip playback, and nearest-neighbor sampling; record the tested Bevy version.
- Exit criterion: an installable release artifact and repeatable client setup instructions. Public distribution/signing is a separate decision; record the artifact's signing status.

## 8. Verification and release acceptance

Focus automated tests on meaningful behavior: drawing boundaries and alpha, flood fill connectivity, layer compositing, frame/clip references and timing, playback time accumulation, atomic rollback, history, document/revision conflicts, animated save/load integrity, sprite-sheet cell order/metadata, memory limits, path escapes, invalid authentication, and real MCP transport/bridge behavior. Use MCP Inspector for protocol inspection. Avoid tests that only mirror UI markup.

Release scenario:

1. Install and launch on Windows 11. Use **Connect to Codex** and **Connect to Claude Code** inside the app and follow each in-app guide; verify `get_status` from both clients without finding an executable, reading token files, setting environment variables, or manually editing configuration. Restart the app/clients and confirm the setup persists. Choose a workspace for file operations.
2. Through MCP, create a 32×32 document, add two layers, draw an outlined sprite, flood-fill it, and request a preview.
3. Verify that the preview matches the editor and that a manual edit is visible in the next MCP read.
4. Undo a manual edit and an MCP batch from the UI, then redo them through MCP.
5. Submit a stale revision and an invalid batch; verify both leave the document unchanged.
6. Save the project and export PNG through MCP. Reopen both and compare pixels; verify project layers survive.
7. Verify unsaved replacement, denied paths, oversized requests, app shutdown/restart, and crash recovery behave as documented.
8. Load an exported transparent sprite in the Bevy sample and verify its dimensions, transparency, and crisp integer-scaled appearance.
9. Through MCP, duplicate/edit frames, set unequal durations, and define `idle` and `walk` clips. Verify timeline playback, onion skin, and shared undo/redo, including frame deletion and restoration.
10. Save/reopen the animated project, export its sprite sheet/JSON, and play both clips in the Bevy sample with matching frame order, timing, looping, transparency, and alignment.

Initial responsiveness target: on a recorded Windows 11 test machine, ordinary 32×32–128×128 strokes remain interactive and local MCP drawing calls generally finish within 250 ms, excluding file dialogs and connection setup. Measure maximum-size operations separately and document limits if they need adjustment.

## 9. Assumptions to revisit only if needed

- The first release is Windows 11 x64 and local-only; ARM64 and remote connectivity are deferred.
- The initial delivery includes static and animated Bevy assets. Basic frame animation, clips, and sprite-sheet export are required; advanced animation tooling remains deferred.
- The app must be open for MCP use; headless operation is deferred.
- Test actual Codex and Claude Code clients before claiming either integration is supported. Record the tested versions, Windows setup, authentication/configuration mechanism, and restart behavior. Neither integration is verified yet; generic Claude Desktop examples do not establish Claude Code compatibility.
- Electron footprint and unsigned development installers are acceptable for the first implementation; signing is revisited before wider distribution.

Implementation should proceed milestone by milestone, starting with the packaged MCP connection proof so the central integration is validated early.

## 10. Animation behavior and Bevy export contract

Animation is part of the initial delivery and is implemented across milestones 2–6.

### Frames, layers, and clips

- A new document contains one frame with a default duration of 100 ms. Accept integer durations from 10 to 60,000 ms. Always retain at least one frame.
- Adding a frame creates transparent buffers for every layer; duplication deep-copies pixels and duration with a new ID. Editing a duplicate must not change its source.
- Layer names/order/visibility apply to every frame. Adding a layer creates a transparent buffer in every frame; deleting it removes its buffers everywhere. Pixel edits and clearing a layer affect only the explicit target frame.
- Clips have unique nonempty names, a nonempty ordered list of distinct frame IDs, and a loop boolean. Clip playback order is independent of timeline order; reordering frames preserves clip references. Duplicating a frame does not silently add it to clips.
- Reject deletion of a frame referenced by a clip unless the same atomic batch updates or removes that clip so the final state is valid. Undo restores frame pixels, order, timing, and clip references together.
- Limit documents to 64 frames, 16 layers, 64 clips, and 128 MiB total decoded RGBA pixels. The byte limit takes precedence over individual count limits. Account separately for staged patches, undo history, preview/export buffers, and decoded input; avoid cloning entire documents for small batches.

### Timeline and playback

- Provide frame thumbnails, selection, previous/next navigation, duration editing, and clip selection. Selecting no clip previews the timeline order with looping enabled.
- Playback uses elapsed time and accumulated per-frame durations, including residual time after frame changes. Delayed render callbacks must not slow the intended animation clock. Non-looping clips stop on their final frame.
- Play/pause, playback position, frame selection, and onion-skin settings do not modify the document revision or history. A mutation pauses playback and preserves the manually selected edit frame; MCP changes do not retarget it unless that frame was deleted, in which case select the nearest surviving timeline frame.
- Onion skin shows the adjacent timeline frames at reduced opacity only while paused. It is a view overlay and never appears in saved pixels, MCP previews, or exports.

### Sprite-sheet and metadata export

- Export every frame once in timeline order, flattened using shared layer visibility. Use equal-sized cells, top-left row-major ordering, zero padding/offset, and no trimming, rotation, or resampling. Unused cells in the final row are transparent.
- Allow a column count from 1 to the frame count; choose a near-square grid by default. Limit the resulting sheet to 4096×4096 pixels and 64 MiB decoded RGBA; reject oversized layouts with an actionable error.
- Export a versioned JSON sidecar containing the relative PNG filename, image dimensions, cell dimensions, rows/columns, zero padding/offset, ordered frame IDs with atlas indices and durations, and named clips with ordered atlas indices and loop flags. Document units as pixels and milliseconds. Include an explicit frame count so unused cells cannot become animation frames.
- Export PNG and JSON from one immutable document revision. The first release writes them into a new, named subdirectory under the selected destination: stage both in a temporary sibling directory, then rename it into place. Refuse an existing export directory and offer a new name; replacing existing multi-file exports is deferred. Clean up failed staging directories without altering existing exports.
- Provide a small Bevy example that loads the metadata, constructs the regular-grid texture atlas, uses nearest-neighbor sampling, and advances each clip with elapsed-time accumulation. Verify its API against the selected Bevy version during implementation. The example must handle unequal durations, looped/non-looped clips, and transparent frames.
- Acceptance: create an animated sprite through MCP, adjust it manually, undo pixel/frame/clip edits, save/reopen it, export the sheet/metadata, and play the intended clips in Bevy with matching timing and stable alignment.
