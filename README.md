# PixelSync

Windows 11 desktop pixel art editor for Bevy assets, with a local MCP server. The manual editor is implemented: drawing tools, RGBA colors, editable palette, layers, animation frames/timing, named clips, playback, onion skin, and shared undo/redo. MCP can draw, manage layers/animation, inspect pixels and PNG previews, and use the same undo/redo as the UI. Editable project saving/loading, PNG import/export, sprite-sheet exports with clip metadata, MCP workspace file tools, and crash recovery are implemented. A Bevy 0.20.1 sample is included; Windows release acceptance and graphical Bevy verification remain pending.

Use Bun 1.4.4 and Node.js 24 LTS or newer (for Electron tooling):

```sh
bun install --frozen-lockfile
bun run start
```

For development on Arch Linux, install Electron's system libraries first:

```sh
sudo pacman -Syu --needed nspr nss gtk3 mesa alsa-lib libxkbcommon
```

`gtk3` supplies GTK and its X11/accessibility dependencies. A normal GUI launch needs a graphical session. Electron libraries and headless UI startup have now been verified on the Linux development host.

## Connect an assistant

Click **Connect AI client**, choose **Connect to Codex** or **Connect to Claude Code**, then follow the instructions inside the app. It configures authenticated local HTTP for you. Restart the client, use `/mcp`, and ask **Use pixel-sync to get its status.** Click **Check connection** in PixelSync to see the received status call.

Upgrading from Pixel Editor: with both apps closed, copy the contents of the old `Pixel Editor` app-data folder into the new `PixelSync` folder to retain settings, workspace access, and recovery data. The development override is now `PIXEL_SYNC_DATA_DIR`. Connect your assistant again to register `pixel-sync`, then remove its old `pixel-editor` registration. Existing `.pixel.json` projects remain compatible.

MCP defaults to disabled; Connect enables it. No manual executable path, token lookup, or environment variables are required. Keep both apps on the same computer. Use **Show instructions → Copy first drawing prompt** to try an animation. Changes appear live, and the connection panel shows recent tool calls. Restart existing clients after updating the app so they rediscover the tools.

## Editing

- Tools: pencil **B**, eraser **E**, fill **F**, line **L**, rectangle **R**, color picker **I**, pan **H**. Rectangles can be filled or outlined.
- **Ctrl+Z** undoes a whole stroke or operation; **Ctrl+Shift+Z / Ctrl+Y** redoes. **Escape** cancels an active stroke. Right click a palette swatch to replace it; use Add swatch to extend the palette.
- Zoom with **Ctrl + mouse wheel** over the canvas or **+ / −**, use **Fit**, or pan with a middle-button drag. **G** toggles the pixel grid (visible from 400% zoom); **O** toggles onion skin while paused.
- The timeline adds/duplicates/deletes/reorders frames and edits their durations. **Space** plays/pauses; **← / →** navigate frames. Named clips support explicit frame order and looping. Stopping with **Space** or **Pause**, or reaching the end of a non-looping clip, selects the visible frame so you can draw immediately.
- **Ctrl+N** creates a new canvas. **Ctrl+S / Ctrl+Shift+S** save / save as `.pixel.json`; **Ctrl+O** opens a project. New/Open/Import and closing offer Save / Discard / Cancel.
- Use **File → Import PNG…**, **Export frame PNG…**, or **Export sprite sheet…**. **Ctrl+I** imports, **Ctrl+E** exports a frame, and **Ctrl+Shift+E** opens sprite-sheet export. Sheets go into a new folder with `sheet.png` and `sheet.json`; projects preserve layers, animation, palette and clips.
- **Connect AI client → MCP file workspace → Choose workspace…** authorizes one folder for MCP project/PNG/sheet tools. Native dialogs may select other files. The workspace persists between launches.
- Dirty edits receive debounced recovery snapshots. After a crash, the app offers to recover the artwork as an unsaved project; normal close removes the snapshot after resolving Save/Discard/Cancel.

## Build and checks

```sh
bun run check           # TypeScript, ESLint, 67 tests, production build
bun run smoke:editor    # Real Electron UI checks at 100% and 150% display scales
bun run smoke:files     # Native file flows, workspace MCP, crash/restart recovery
bun run smoke:playback  # Immediate editing after Space/Pause/clip completion
bun run package         # Unpacked application for the current platform
bun run smoke:packaged  # Packaged GUI + HTTP + executable stdio checks
bun run package:win     # Build Windows x64 from Linux or Windows
bun run make            # Windows Squirrel installer and ZIP, on Windows
bun run make:verified   # Make artifacts from an already packaged/tested app
bun run release:manifest # Hash out/make artifacts and record source/build provenance
bun run smoke:bevy      # Headless Bevy export/timing tests (requires Rust 1.97.1+)
bun run check:bevy      # Compile-check the Bevy graphical viewer
```

The Windows build is `out/PixelSync-win32-x64/PixelSync.exe`. Copy the **entire** `PixelSync-win32-x64` folder to Windows; the executable needs its accompanying runtime files. `package:win` supplies `--platform=win32 --arch=x64` automatically. Installer creation and installation require Windows; artifacts are unsigned.

Linux `make:verified` creates a ZIP for the existing Linux package and requires the `zip` command (`sudo pacman -S --needed zip` on Arch).

The packaged smoke check copies the runtime into a temporary path containing spaces and verifies executable stdio bridge cleanup. The smoke scripts use isolated temporary application/client configuration, never your real MCP registrations. They cover manual and MCP drawing, bidirectional undo/redo, PNG/contact-sheet previews, live canvas updates, operation history, file round trips and crash recovery. On headless Linux they use Electron's headless Ozone platform; desktop runs retain Electron's normal sandbox settings. Pass a packaged executable to `node scripts/smoke-editor.mjs "<path>"`, `node scripts/smoke-playback.mjs "<path>"`, or `node scripts/smoke-files.mjs "<path>"` to exercise that build.

For a release, package once, run the packaged checks, then use `make:verified` to archive the tested application. `release:manifest` writes `out/make/SHA256SUMS` and `release-manifest.json` with artifact sizes/hashes, source commit, working-tree dirty flag, lockfile hash and build environment. Keep the manifest and checksums beside the artifacts; archive the source separately when the working tree is modified. Windows CI follows this sequence, including packaged drawing, playback and recovery checks.

Local checks and headless Electron UI tests pass. Generated configurations were parsed by codex-cli 0.168.0 and Claude Code 2.1.325 in isolated client homes; native assistant-driven calls from those clients and updated Windows editor acceptance remain unverified. Windows CI includes build/tests, UI smoke checks, packaging, packaged MCP smoke, and unsigned installer artifacts.

Run `cargo run --manifest-path examples/bevy/Cargo.toml --locked` to try the included static PNG and animation. The [Bevy sample guide](examples/bevy/README.md) explains clip controls, custom exports and headless checks. Track remaining Windows installation/client and graphical checks in [release acceptance](docs/release-acceptance.md).

See [client setup](docs/mcp-setup.md), [MCP tools and examples](docs/mcp-tools.md), [project format, exports and recovery](docs/project-format.md), [document engine](docs/document-engine.md), and [implementation plan](PLAN.md).
