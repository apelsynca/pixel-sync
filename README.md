# Pixel Editor

Windows 11 desktop pixel art editor for Bevy assets, with a local MCP server. Milestone 2's shared document engine is implemented and tested. The current window is still the connection foundation; manual editing and MCP editing tools are upcoming milestones.

Use Bun 1.4.4 and Node.js 24 LTS or newer (for Electron tooling):

```sh
bun install --frozen-lockfile
bun run start
```

For development on Arch Linux, install Electron's system libraries first:

```sh
sudo pacman -Syu --needed nspr nss gtk3 mesa alsa-lib libxkbcommon
```

`gtk3` pulls in the GTK, accessibility, printing, Cairo/Pango, and X11 dependencies. These are operating-system packages; `bun install` supplies the JavaScript dependencies and Electron binary. See the Arch package dependencies for [GTK3](https://archlinux.org/packages/extra/x86_64/gtk3/) and [NSPR](https://archlinux.org/packages/core/x86_64/nspr/).

If startup reports a missing `.so` library, inspect the binary with `ldd node_modules/electron/dist/electron`. After installing the packages, that output should contain no `not found` entries. Run `bun run start` from a graphical desktop session; a remote/headless shell also needs access to an X11 or Wayland display. Linux GUI startup has not yet been verified on this development host.

The window shows a transparent canvas placeholder and an MCP enable/disable panel. MCP defaults to disabled. Enabling it starts an authenticated endpoint bound to `127.0.0.1:47831`. A port collision is shown in the panel.

```sh
bun run check           # TypeScript, ESLint, integration tests, production build
bun run package         # Unpacked desktop application for the current platform
bun run smoke:packaged  # Run packaged GUI + HTTP + executable stdio proof
bun run make            # Windows Squirrel installer and ZIP, on Windows
```

Build the Windows 11 x64 executable from Linux with:

```sh
bun run package:win
```

The result is `out/Pixel Editor-win32-x64/PixelEditor.exe`. Copy the **entire** `Pixel Editor-win32-x64` folder to Windows, then run that executable. The accompanying files are required. This command packages the Windows app without launching Electron on Linux, so it does not require the Linux GUI libraries above.

For an installer, run `bun run make` on Windows or use the Windows CI artifact. Windows packaging requires `x64`; `x6` is invalid. The `package:win` script supplies the platform and architecture automatically.

The integration suite launches a real stdio bridge process and official SDK clients. Engine tests cover drawing, compositing, animation structure, atomic batches, revisions, shared history, gesture serialization, and memory limits. The packaged smoke script requires a graphical session. Windows CI packages the app, runs both connection paths against the executable, and builds unsigned artifacts. Running that workflow and testing installation with an actual desktop MCP client on Windows 11 remain outstanding acceptance work.

See [client setup](docs/mcp-setup.md), [document engine](docs/document-engine.md), and [implementation plan](PLAN.md). The usable manual editor is the next milestone.

Local verification: type checking, linting, production build, and all 24 engine/application/connection tests pass. Linux/Windows x64 packaging passed during milestone 1; the existing Windows unpacked build at `out/Pixel Editor-win32-x64/` predates milestone 2. The user reports successful app execution on Windows 11. Installer and actual desktop MCP-client acceptance remain unverified.
