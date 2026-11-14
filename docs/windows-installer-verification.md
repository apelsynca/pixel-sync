# Installer verification — 2026-11-14

Artifact: `out/make/windows/x64/0.1.0/PixelSync-0.1.0-Setup.exe` (116,788,212 bytes).

SHA-256: `b375e87acb2834747f9be8cd1c8c70c8680075a7968ca90f0201f98b962e0a1d`.

Source: working tree based on `b7239e1`, including the uncommitted native NSIS installer changes. The artifact manifest records the source revision and dirty flag. Build host: Arch Linux x64; NSIS 3.12 from the pinned, verified toolset. Wine/Mono were absent for the initial setup EXE compilation; Wine 11.22 was subsequently installed by the user and used for execution checks in a disposable prefix outside the repository.

Passed:

- TypeScript, ESLint, production build and all 71 tests.
- Real Electron editor smoke checks at 100% and 150% scale on Linux.
- Native Windows x64 packaging and NSIS compilation with warnings treated as errors, without Wine or Mono.
- Native compiler fixture with spaces and literal dollar signs in source/output/payload paths.
- 7-Zip extraction/integrity check of the setup EXE; all 73 embedded runtime files matched the packaged Windows runtime byte for byte. A Windows uninstaller is embedded.
- Silent installation and same-version reinstallation under Wine.
- Upgrade under Wine from the real installed 0.1.0 package to a small 0.1.1 test-only payload compiled with the same NSIS source. The displayed version updated, old runtime files were removed, and settings, an external project and a user-added installation-folder file were preserved. This fixture tests installer upgrade mechanics; it is not an application release or Windows 11 acceptance result.
- Silent uninstall under Wine removed application binaries, desktop/Start menu shortcuts and uninstall registration while retaining settings, the external project and the user-added file.
- With a long-running helper named `PixelSync.exe` under Wine, silent setup returned exit code 1, did not install the new payload and did not terminate the helper.

The test fixtures and extracted payload are under ignored `out/installer-verification/`; the Wine prefix is disposable and outside the repository. Vitest is scoped to `tests/` so generated artifacts and Wine filesystem links cannot expand test discovery beyond this project's tests.

Pending: interactive installation on Windows 11, actual shortcut launch/taskbar appearance, native AI client use from the installed app, an upgrade between real application releases, Windows user profiles with spaces/non-ASCII characters, and code signing. Use the checklist in [Windows release acceptance](release-acceptance.md).
