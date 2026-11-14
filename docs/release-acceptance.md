# Windows release acceptance

Milestone 6 is in progress. The Bevy sample and repeatable automated checks are implemented. Native Windows 11 installation, client-driven acceptance and graphical Bevy acceptance remain pending. Linux checks and cross-packaging do not establish these results. Release artifacts are unsigned; public distribution and signing are separate decisions.

## Record each acceptance run

Record the commit or working-tree description, artifact filename and SHA-256, Windows version, CPU/RAM/GPU, display scales, Codex/Claude Code versions and Bevy/Rust versions. For each item below record pass/fail, date and evidence, including any failure output. Do not copy credentials or private client configuration into the report.

| Verification | Current evidence |
| --- | --- |
| Editor type checking, lint, production build, 67 tests | Passed on Linux, 2026-11-14 |
| Electron drawing/MCP at 100% and 150%; native menu actions | Passed on Linux, 2026-11-14 |
| Electron files/workspace/crash-restart recovery | Passed on Linux, 2026-11-14; native dialog results supplied by test automation |
| Packaged HTTP/stdio editing, files, executable path with spaces and bridge cleanup | Passed on Linux, 2026-11-14; Windows x64 package rebuilt, Windows execution pending |
| Packaged playback pause/completion and immediate editing at 100%/150% | Passed on refreshed Linux package, 2026-11-14; Windows execution pending |
| Artifact SHA-256 and source/build manifest generation | Verified on Linux, including checksum verification, repeated generation and paths with spaces; Windows CI configured |
| Linux release ZIP from tested runtime | Created 2026-11-14; ZIP integrity and SHA-256 passed; executable/app archive match tested package. Artifacts and manifest under `out/make/` |
| Windows GUI launch | User verified an earlier foundation build only |
| Windows CI build/test/package/installer jobs | Configured; observed run pending |
| Installed Windows editor and both native assistant integrations | Pending |
| Bevy 0.20.1 metadata/timing/PNG asset loading and viewer compile | See sample commands below; local run recorded in PLAN.md |
| Bevy graphical appearance and Windows runtime | Pending |

## Build and install

On Windows with Bun 1.4.4 and Node.js 24+:

```powershell
bun install --frozen-lockfile
bun run check
bun run smoke:editor
bun run smoke:playback
bun run smoke:files
bun run package:win
bun run smoke:packaged
node scripts/smoke-editor.mjs out/PixelSync-win32-x64/PixelSync.exe
node scripts/smoke-playback.mjs out/PixelSync-win32-x64/PixelSync.exe
node scripts/smoke-files.mjs out/PixelSync-win32-x64/PixelSync.exe
bun run make:verified
bun run release:manifest
```

The Squirrel installer and ZIP are under `out/make/`, alongside generated `SHA256SUMS` and `release-manifest.json`. `make:verified` uses the existing packaged app, so the installer contains the runtime just tested. Generate artifacts in a clean `out/make/` directory to avoid including older builds. The manifest records artifact paths, sizes and SHA-256 hashes, source commit/dirty state, Bun lockfile hash, and build platform/architecture/Node version. The package manager field records the project's pinned version. A dirty flag does not identify uncommitted source: archive that source separately. Hashes establish file integrity, not code signing or successful installation. Archive the full artifact, checksum, manifest and corresponding source revision. `out/PixelSync-win32-x64/PixelSync.exe` needs its whole runtime folder. Source examples and Rust build output are excluded from Electron packages.

On Windows, compare a downloaded artifact's `Get-FileHash -Algorithm SHA256` with its manifest entry. On Linux, run `sha256sum --check SHA256SUMS` from the artifact directory. `bun run release:manifest <directory>` also supports an alternate artifact directory and refuses empty directories, empty files or linked artifact entries.

- [ ] Install the unsigned installer in a clean Windows 11 VM without Node, Bun or Rust. Launch it through the installed shortcut.
- [ ] Test the packaged stdio bridge from a path containing spaces. Copy the **entire** unpacked app directory into a folder such as `C:\PixelSync acceptance\PixelSync-win32-x64`, then run `node scripts/smoke-packaged.mjs "C:\PixelSync acceptance\PixelSync-win32-x64\PixelSync.exe"` from a development checkout. This automated step needs Node on the test harness; normal installed use does not.
- [ ] Confirm the installed executable's `--mcp-stdio` works without a separately installed Node runtime. Close the client/transport and confirm its bridge exits; verify no second GUI opens.
- [ ] Test app closed, MCP disabled and occupied port diagnostics; restart and confirm saved settings persist.
- [ ] Verify actual Windows Save/Open/Import/Export dialogs, appended-extension overwrite confirmation, Save/Discard/Cancel, recovery after forced termination, and normal-close recovery cleanup.
- [ ] Verify MCP workspace rules on NTFS, including junction/symlink/hard-link rejection. Use a disposable folder and confirm denied requests leave files intact.
- [ ] Verify drawing, menu shortcuts, text-field undo and display scales at Windows 100%/150% (and the user's actual scale).
- [ ] Install a newer version over this build once one exists; verify shortcuts, launch, saved client/workspace settings and project compatibility. Reinstalling the same version does not establish upgrade acceptance.
- [ ] Uninstall; verify application binaries/shortcuts and bridge processes are removed. Record whether user settings/projects are retained and whether that matches the intended release policy.

## Native Codex and Claude Code

Use the installed Windows app with each native client, not an SDK substitute. Follow [client setup](mcp-setup.md) and the app's separate guides; record actual versions and results.

- [ ] Use **Connect to Codex** and **Connect to Claude Code** without manually finding tokens/executable paths. Restart each client and use `/mcp`; ask `Use pixel-sync to get its status.` Check the received status call in PixelSync.
- [ ] Restart clients and app, then repeat the call to prove persistence.
- [ ] Select a disposable MCP workspace in PixelSync. Ask each client to create a 32×32, two-layer sprite, draw/fill it, return a PNG preview, add frames with unequal durations and define `idle`/`walk` clips.
- [ ] Compare the preview to the visible canvas, make a manual stroke, then read it through MCP. Play clips and inspect onion skin.
- [ ] Undo manual and MCP operations in the UI; redo through MCP. Include frame deletion/restoration and clip changes.
- [ ] Send a stale revision and an invalid atomic batch; verify unchanged document state.
- [ ] Save/open `.pixel.json`, export/import a static PNG, export a sheet, and verify pixel equality and project layer/timing/clip preservation. Check denied paths and oversized calls.
- [ ] Measure ordinary 32×32–128×128 strokes and local MCP drawing on the recorded machine against the 250 ms target. Record maximum-size operation behavior separately.

## Bevy handoff

Follow the [sample README](../examples/bevy/README.md). Rust is required only to develop/run this example, not to use PixelSync.

```sh
bun run fixtures:bevy
bun run smoke:bevy
bun run check:bevy
cargo run --manifest-path examples/bevy/Cargo.toml --locked
```

- [ ] Visually verify the included static sprite and every animation clip, transparency/checkerboard, crisp integer scaling and fixed alignment. Confirm `once` holds its final frame; pause/restart and switch clips.
- [ ] Repeat using an animation created through native MCP, manually adjusted, saved/reopened, and exported by the installed Windows app. Compare frame order, unequal timing and looping with PixelSync.
- [ ] Record the graphical run's OS/GPU, Bevy and Rust versions and any driver-specific failures.
