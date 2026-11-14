# Pixel Editor

Windows 11 desktop pixel art editor for Bevy assets, with a local MCP server. The manual editor is implemented: drawing tools, RGBA colors, editable palette, layers, animation frames/timing, named clips, playback, onion skin, and shared undo/redo. MCP can draw, manage layers/animation, inspect pixels and PNG previews, and use the same undo/redo as the UI. Project saving and file exports are the next milestone.

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

Click **Connect AI client**, choose **Connect to Codex** or **Connect to Claude Code**, then follow the instructions inside the app. It configures authenticated local HTTP for you. Restart the client, use `/mcp`, and ask **Use pixel-editor to get its status.** Click **Check connection** in Pixel Editor to see the received status call.

MCP defaults to disabled; Connect enables it. No manual executable path, token lookup, or environment variables are required. Keep both apps on the same computer. Use **Show instructions → Copy first drawing prompt** to try an animation. Changes appear live, and the connection panel shows recent tool calls. Restart existing clients after updating the app so they rediscover the tools.

## Editing

- Tools: pencil **B**, eraser **E**, fill **F**, line **L**, rectangle **R**, color picker **I**, pan **H**. Rectangles can be filled or outlined.
- **Ctrl+Z** undoes a whole stroke or operation; **Ctrl+Shift+Z / Ctrl+Y** redoes. **Escape** cancels an active stroke. Right click a palette swatch to replace it; use Add swatch to extend the palette.
- Zoom with **+ / −**, use **Fit**, or pan with a middle-button drag. **G** toggles the pixel grid (visible from 400% zoom); **O** toggles onion skin while paused.
- The timeline adds/duplicates/deletes/reorders frames and edits their durations. **Space** plays/pauses; **← / →** navigate frames. Named clips support explicit frame order and looping. Playback preserves the selected edit frame; after previewing another frame, choose **Return to edit frame** or click a timeline frame to resume drawing.
- **Ctrl+N** creates a new canvas. Replacement and quitting prompt before discarding edited artwork. **Saving is not implemented yet**; artwork currently lasts only for the running app session.

## Build and checks

```sh
bun run check           # TypeScript, ESLint, 45 tests, production build
bun run smoke:editor    # Real Electron UI checks at 100% and 150% display scales
bun run package         # Unpacked application for the current platform
bun run smoke:packaged  # Packaged GUI + HTTP + executable stdio checks
bun run package:win     # Build Windows x64 from Linux or Windows
bun run make            # Windows Squirrel installer and ZIP, on Windows
```

The Windows build is `out/Pixel Editor-win32-x64/PixelEditor.exe`. Copy the **entire** `Pixel Editor-win32-x64` folder to Windows; the executable needs its accompanying runtime files. `package:win` supplies `--platform=win32 --arch=x64` automatically. Installer creation and installation require Windows; artifacts are unsigned.

The smoke scripts use isolated temporary application/client configuration, never your real MCP registrations. They cover manual and MCP drawing, bidirectional undo/redo, PNG/contact-sheet previews, live canvas updates, and operation history. On headless Linux they use Electron's headless Ozone platform; desktop runs retain Electron's normal sandbox settings. Pass a packaged executable to `node scripts/smoke-editor.mjs "<path>"` to exercise that build.

Local checks and headless Electron UI tests pass. Generated configurations were parsed by codex-cli 0.168.0 and Claude Code 2.1.325 in isolated client homes; native assistant-driven calls from those clients and updated Windows editor acceptance remain unverified. Windows CI includes build/tests, UI smoke checks, packaging, packaged MCP smoke, and unsigned installer artifacts.

See [client setup](docs/mcp-setup.md), [MCP tools and examples](docs/mcp-tools.md), [document engine](docs/document-engine.md), and [implementation plan](PLAN.md).
