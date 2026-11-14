# Foundation MCP setup

Open Pixel Editor and enable MCP. There is currently one read-only tool, `get_status`; it returns the app instance ID and connection status. It explicitly reports no open document. `get_document` and editing tools will arrive with the engine.

## Packaged stdio

Configure a desktop MCP client to launch the absolute path of the installed `PixelEditor.exe` with one argument, `--mcp-stdio`. For example, in a client that accepts `mcpServers` JSON:

```json
{
  "mcpServers": {
    "pixel-editor": {
      "command": "C:\\Users\\YOUR_NAME\\AppData\\Local\\PixelEditor\\PixelEditor.exe",
      "args": ["--mcp-stdio"]
    }
  }
}
```

Use the actual executable path on your machine. This illustrates the command/arguments contract; client-specific configuration and installer paths have not been verified with a desktop client yet. The bridge must connect to an already running app with MCP enabled. It bypasses window creation and the GUI single-instance lock and reads the same connection file automatically. Protocol traffic goes to stdout; diagnostics go to stderr. Closing the client input closes the bridge connection.

For development, after `bun run build`, launch `node dist/bridge.cjs "<application-data-directory>"` instead. This is a development convenience; installed users do not need Node.js.

## Direct HTTP

Use `http://127.0.0.1:47831/mcp` with Streamable HTTP and an `Authorization: Bearer <token>` header. The official TypeScript SDK client is exercised in `tests/connection.test.ts`:

```ts
const client = new Client({ name: 'my-client', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(
  new URL('http://127.0.0.1:47831/mcp'),
  { requestInit: { headers: { Authorization: `Bearer ${token}` } } },
));
await client.callTool({ name: 'get_status', arguments: {} });
await client.close();
```

Read the token from `mcp-connection.json` in the `Pixel Editor` directory beneath Electron's per-user app-data directory (`%APPDATA%` on Windows). Do not put this file in a repository. A random 256-bit token is created on first launch. On Unix the directory/file creation modes are 0700/0600; Windows relies on the user's inherited app-data ACL. Browser Origin requests are rejected; this endpoint is for local desktop clients. The token is never exposed to the renderer or status tool.

## Troubleshooting and current limits

- **App closed / MCP disabled:** open the editor, enable MCP, then reconnect the client. The bridge exits with a diagnostic instead of creating a separate editor.
- **Port in use:** close the conflicting service, or exit Pixel Editor and change the integer `port` field in `mcp-connection.json` (1024–65535). Restart and reconnect. Port editing UI is pending.
- **Credential reset:** close the app and remove `mcp-connection.json`; restart, enable MCP, and update direct HTTP clients. A reset button is pending.
- **Invalid settings:** startup fails with a diagnostic rather than silently overwriting credentials. Restore valid settings or remove the file.
- **Unauthorized / invalid origin:** use the bearer token and a desktop client that does not send a browser Origin header.
- Maximum HTTP body: 4 MiB. The server is stateless and uses JSON responses; no resources, prompts, subscriptions, or custom extensions.
- The pinned official SDK negotiates its supported protocol versions. Do not assume support for draft revisions based on the plan's specification link.

Connection tests run with official SDK clients on the development host. A real desktop-client test and Windows 11 installer validation are still required before claiming compatibility. See the Windows workflow for the packaged executable smoke test.

Implementation references: [official MCP SDK server guide](https://ts.sdk.modelcontextprotocol.io/server), [Electron security guidance](https://www.electronjs.org/docs/latest/tutorial/security), and [Electron Forge configuration](https://www.electronforge.io/config/configuration).
