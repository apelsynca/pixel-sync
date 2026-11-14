# Windows installer

`bun run make:win` builds the Windows x64 runtime and compiles a native NSIS installer. It runs on Linux, macOS or Windows with Node.js 24+, Bun and `tar`, without Wine, Mono, administrator access or an externally installed NSIS compiler. The first run downloads the portable compiler from the [immutable NSIS toolset release](https://github.com/electron-userland/electron-builder-binaries/releases/tag/nsis%401.2.1), verifies its pinned SHA-256 and caches it under `out/tools/nsis-3.12/`. Later builds reuse and reverify the cached archive.

The setup EXE, `SHA256SUMS` and `release-manifest.json` are placed under `out/make/windows/x64/<version>/`. Only the setup EXE is needed to install; it contains the complete runtime and uninstaller. Version is read from `package.json`. `bun run make:win:verified` wraps the existing `out/PixelSync-win32-x64` runtime without rebuilding it; verify that runtime first, since matching version metadata does not prove its source matches the checkout. These commands do not publish or sign artifacts.

## Installation behavior

- Installs for the current user at `%LOCALAPPDATA%\Programs\PixelSync`, with no elevation or installation directory selector.
- Creates desktop and Start menu shortcuts with the same app identity as the Electron window, and registers an uninstall entry in Windows Settings.
- Offers to launch PixelSync after successful installation.
- Refuses to replace/remove binaries while any `PixelSync.exe` editor or MCP bridge is running. Interactive installation offers Retry/Cancel; silent operation fails without killing processes or discarding artwork.
- Reinstall/upgrade runs the previous uninstaller silently before installing the new runtime, so files removed in newer versions do not accumulate.
- Uninstall removes only files listed in that release's payload, the uninstaller, shortcuts and uninstall registration. It preserves `%APPDATA%\PixelSync`, project files, other files added to the installation folder, and external Codex/Claude configuration. Retained client entries will report the app unavailable until it is reinstalled and running.
- No automatic update service or Windows file associations are registered. Install a newer setup EXE to upgrade.

The NSIS source is `installer/windows.nsi`. `scripts/windows-installer-files.mjs` enumerates the packaged runtime and generates explicit install and uninstall file lists, escaping filenames as NSIS literals and rejecting linked payload entries. The compiler treats warnings as errors. `scripts/make-windows.mjs` keeps the downloaded compiler and generated source outside release artifacts.

## Verification

Run `bun run check` and the packaged application smoke checks. Compile with `bun run make:win`, then verify checksums from the versioned artifact directory with `sha256sum --check SHA256SUMS` on Linux or `Get-FileHash -Algorithm SHA256` on Windows.

Native compilation and payload inspection on Linux do not establish installation success. On a disposable Windows 11 machine, record:

1. Install using a standard user account without Node/Bun; verify shortcuts, taskbar grouping, icon and Installed apps entry.
2. Launch from each shortcut; draw, save/reopen a project, connect an AI client and restart the app to verify settings persist.
3. Run setup/uninstall with the editor or a bridge running; verify it asks to close the process without terminating it.
4. Reinstall; then install a genuinely newer version. Verify old runtime files are removed and projects/settings survive. Same-version reinstall alone does not prove upgrade acceptance.
5. Uninstall through Windows Settings; verify binaries/shortcuts/registration are removed and projects/settings retained. Reinstall and verify retained settings load.
6. Repeat with a Windows user profile path containing spaces and non-ASCII characters.

`/S` supports silent installation/uninstall; the install directory is fixed even if `/D` is passed. There are no Squirrel maintenance events. Artifacts are unsigned, so Windows may show an unknown-publisher warning.

The initial artifact's Linux compilation, payload inspection and optional Wine execution results are recorded in [installer verification](windows-installer-verification.md). Wine is an optional test tool and is not a build dependency.
