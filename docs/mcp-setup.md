# Connect Pixel Editor to your assistant

## Inside the app

1. Open Pixel Editor and click **Connect AI client** in the top-right corner.
2. Choose **Connect to Codex** or **Connect to Claude Code**. This enables MCP and registers the local HTTP connection, including authentication, in that client's per-user configuration. No executable path, token lookup, environment variables, or terminal command is required.
3. Restart the selected client and open a new session. Use `/mcp` to check that `pixel-editor` is available and enabled.
4. Ask it: **Use pixel-editor to get its status.** The app provides a **Copy first prompt** button.
5. Click **Check connection** in Pixel Editor. The selected card shows when a status call was received through that connection.

Both cards include **Show instructions**, an installation-guide link, and troubleshooting. You can configure a client before installing it; installation itself is not performed by Pixel Editor. Keep Pixel Editor open while using its MCP tools.

**Available now:** `get_status`, `get_document`, `get_pixels`, `get_preview`, `get_animation_preview`, `new_document`, `edit_document`, `undo`, `redo`, `open_project`, `save_project`, `import_png`, `export_png`, and `export_sprite_sheet`. Drawing and animation edits appear live in the manual editor and share its undo history. Choose an MCP workspace in the connection panel before using file tools; drawing and previews work without one. See [the tool contract and drawing example](mcp-tools.md).

After connecting, open **Show instructions** and choose **Copy first drawing prompt** to ask for a tiny animation on a new layer. Choose its clip in the timeline and press Play; UI Undo reverses an MCP batch, and the assistant can undo a manual stroke. The connection panel displays the most recent 50 tool calls without their arguments or image payloads. Restart existing clients after updating Pixel Editor so they reload the expanded tool list.

A configuration write is shown as **Configured**, separately from whether the server is available and a status call was received. The named endpoint identifies which configured connection was used; it does not cryptographically identify the caller's application. The app does not mark a connection verified just because its own HTTP probe succeeded.

## Where setup is stored

- Codex: `~/.codex/config.toml`, or `config.toml` beneath the client's inherited `CODEX_HOME` override. The entry is `mcp_servers.pixel-editor`, with a Streamable HTTP URL and a persistent authorization header.
- Claude Code: `~/.claude.json`, or `.claude.json` beneath the inherited `CLAUDE_CONFIG_DIR` override. The user-scope entry is `mcpServers.pixel-editor`, with `type: "http"`, a URL, and an authorization header. This is Claude Code configuration, not Claude Desktop configuration.

The app changes only Pixel Editor's server entry, preserves unrelated preferences/servers, and makes a private `.pixel-editor-backup-<id>` copy of a nonempty existing configuration before replacement. Codex's conventional table layout also retains unrelated comments and text. Unsupported TOML layouts and invalid configurations are left untouched. Writes use a temporary sibling file and detect concurrent changes before replacing the original.

The server binds only to `127.0.0.1`. Each client uses a named local route (`/mcp/codex` or `/mcp/claude-code`) for connection feedback. Authentication stays enabled. Private credentials remain in app/client configuration and are not displayed in normal setup or status results. On Unix, generated files use mode 0600; Windows uses the user's inherited application-data/home ACLs.

Client versions and project/administrator policies may affect availability. A project-scoped entry with the same name can override the per-user registration. The app's **Instructions** panel explains how to inspect the client's `/mcp` status.

## Troubleshooting

- **App closed or MCP disabled:** open Pixel Editor and choose Connect, or enable MCP in the connection panel. Reconnect/restart the assistant as needed.
- **Configured but no call received:** restart the client, check `/mcp`, run the first prompt, then click Check connection. Initialization alone does not count as a status call. Call timestamps are kept for the current app run and cleared when MCP is disabled.
- **Client not detected:** use **Show instructions → Open installation guide** to install the client on this computer. Registration can happen before installation.
- **Wrong computer or WSL:** `127.0.0.1` refers to the MCP client's host. A Windows app is not automatically available to a separate Linux/WSL/remote Codex host. These configurations require separate networking instructions and have not been verified. Do not change the server to listen on public interfaces.
- **Invalid or unwritable client configuration:** the app reports the error without changing that file. Close the client and retry after correcting permissions/configuration. A stale `.pixel-editor.lock` from an interrupted setup may be removed after confirming no setup is running.
- **Unsupported configuration layout:** **Instructions → Advanced setup → Copy private configuration** provides a fully populated fragment for the current client and endpoint. Merge the `pixel-editor` entry at the location shown in the panel. The clipboard content includes a private credential; this fallback is unnecessary if Connect succeeds.
- **Port in use:** close the conflicting service, or close Pixel Editor and edit the integer `port` in its `mcp-connection.json` (1024–65535). Restart the app, then choose **Update connection** for both clients. A port-editing UI is pending.
- **Credential reset:** close Pixel Editor, remove its `mcp-connection.json`, restart, and use **Update connection** for each client. A reset button is pending. The file is beneath `%APPDATA%\Pixel Editor` on Windows, or Electron's per-user app-data directory on other platforms; development can override it with `PIXEL_EDITOR_DATA_DIR`.

## Advanced: generic MCP clients

The original generic endpoint remains `http://127.0.0.1:47831/mcp` (or the configured port), using Streamable HTTP with `Authorization: Bearer <token>`. The token is stored in the app's `mcp-connection.json`. Browser Origin requests are rejected; use a local MCP client.

Clients that require stdio can launch the installed `PixelEditor.exe` with `--mcp-stdio`. The bridge reads the app's connection file automatically, bypasses GUI creation/single-instance locking, and connects to the already running editor. For development, after `bun run build`, use `node dist/bridge.cjs "<application-data-directory>"`. No separately installed Node.js is needed for packaged users.

Maximum HTTP body size is 4 MiB. The server uses stateless JSON responses and does not expose resources, prompts, subscriptions, or custom extensions. The pinned official SDK negotiates supported protocol versions.

## Verification

On the Linux development host, configuration generated by the app was successfully parsed by **codex-cli 0.168.0** (`codex mcp get pixel-editor --json`) and **Claude Code 2.1.325** (`claude mcp get pixel-editor`) using isolated temporary client homes. This verifies their configuration formats, not an assistant-driven tool call from those clients.

`bun run smoke:editor` launches real Electron and exercises the UI at 100% and 150% display scaling, including both setup buttons. It then uses official SDK clients to verify authenticated named routes, live drawing/animation changes, cross-interface undo/redo, PNG exclusion of onion skin, and bounded recent-operation display. The 67 tests cover configuration preservation/backups, invalid files, lock handling, exact pixels/compositing, animation structure, playback timing, coordinates, and real HTTP/stdio editing, preview encoding, rollback, stale revisions, limits, and pending cancellation. Windows CI includes the editor smoke, native-file/crash-recovery smoke, and packaged HTTP/stdio tests. See [file formats, path rules and recovery](project-format.md).

Windows 11 installation, the updated manual editor on Windows, and native Codex/Claude Code status calls after client restart remain acceptance checks; the user's earlier successful Windows launch covered the foundation build.

Configuration references checked during implementation: [Codex MCP configuration](https://developers.openai.com/codex/mcp/) and [Claude Code MCP configuration](https://code.claude.com/docs/en/mcp).
