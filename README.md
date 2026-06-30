# devicecloud-mcp

**Triage failing DeviceCloud runs so your agent can fix them, without opening the console.**

An MCP server that pulls a red [DeviceCloud](https://console.devicecloud.dev) run straight into your editor (fail reasons, failure screenshots, logs, and flow history) so your AI assistant (Claude Code, Cursor, Claude Desktop, etc.) can find the root cause and fix the flow. You commit; CI re-runs. The console stays closed.

DeviceCloud is a platform for running Maestro flows on real devices. Your CI triggers the runs; this server is how you debug the ones that fail.

It lets the assistant:

- **diagnose a run in one call**: failed flows, fail reasons, failure-screenshot paths, and a passed/failed/flaky summary, ready to act on
- list recent uploads, filter by name (commit message + short SHA) or date
- read per-flow status and `failReason` for any upload
- pull the JUnit XML report
- download and auto-unzip the HTML report (with failure screenshots highlighted)
- download raw artifacts (logs, screenshots, video) as a zip
- spot flaky vs genuinely-broken flows with per-flow pass-rate analytics
- drill into run history for a specific flow file

The server is **read-only** against the DeviceCloud REST API: no `dcd` CLI dependency, and nothing an agent does can trigger billable runs. Triggering and re-running tests stay with your CI; cancelling a run stays in the console.

## Install

Add this to your MCP client config:

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "npx",
      "args": ["-y", "devicecloud-mcp"],
      "env": {
        "DEVICE_CLOUD_API_KEY": "<your-key>"
      }
    }
  }
}
```

Get your API key at [console.devicecloud.dev/settings](https://console.devicecloud.dev/settings).

## Configure your assistant

The config block above is the same for every client; only the file location differs.

### Claude Code (project-scoped, `.mcp.json`)

Add to a `.mcp.json` at the root of any project where you want the tools available:

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "npx",
      "args": ["-y", "devicecloud-mcp"],
      "env": {
        "DEVICE_CLOUD_API_KEY": "${DEVICE_CLOUD_API_KEY}"
      }
    }
  }
}
```

Then export the key from your shell profile so Claude Code's child process inherits it:

```sh
# ~/.zshrc or ~/.bashrc
export DEVICE_CLOUD_API_KEY="<your-key>"
```

> Setting it only in an interactive shell isn't enough; Claude Code spawns the MCP from its own environment, so the variable needs to be in the profile.

### Claude Code (user-scoped, `~/.claude.json`)

If you want it available everywhere instead of per-project, add the same `devicecloud` block under `mcpServers` in `~/.claude.json`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows). Restart Claude Desktop after saving; a tools icon appears in the chat input once the server connects.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` at the project root (project-scoped).

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`.

### Other MCP-compatible clients

Any client that supports stdio MCP servers uses the same `{ command, args, env }` shape. Consult the client's docs for the config file location.

> **Note:** OpenAI products (ChatGPT, Codex, the Assistants API) use their own tool protocol and do not support MCP servers.

## Verify

After restarting your assistant:

```
List recent DeviceCloud uploads, limit 3.
```

You should see a JSON-shaped response with an `uploads` array. If instead you get `DEVICE_CLOUD_API_KEY env var is required`, the variable isn't reaching the spawned process; re-check that it's exported from your shell profile (not just the current shell).

## Available tools

| Tool | Purpose |
|------|---------|
| `diagnose_run` | **Start here.** One-call triage of a run (`uploadId` or `name`): folds retries per flow and returns failed flows with fail reasons, durations, and auto-downloaded failure-screenshot paths, plus a passed/failed/flaky summary and suggested next steps. Set `includeReport: false` to skip the screenshot download; `outputDir` sets where the report extracts (default `/tmp`). |
| `list_uploads` | List recent uploads. Filter by `name` (`*` wildcard), `from`, `to`, `limit`, `offset`. |
| `get_upload_status` | Overall status + per-test status, duration, `failReason`. Provide `uploadId` or `name`. |
| `get_results` | Per-flow rows for one upload: `id`, `test_file_name`, `status`, `fail_reason`, `duration_seconds`, `retry_of`. Optional client-side `status` filter. |
| `get_junit_report` | Raw JUnit XML for an upload. |
| `get_html_report` | Downloads + auto-unzips the HTML report. Returns the extraction dir and an inventory with `failureScreenshots[]` highlighted (these are the highest-signal debugging artifact). |
| `download_artifacts` | Zip of raw artifacts (logs, screenshots, video). `results: "FAILED"` (default) or `"ALL"`. Saves to `/tmp` by default; not auto-unzipped. |
| `list_flow_analytics` | Per-flow pass rate, run counts, avg duration over a lookback window (default 14 days). Useful to tell flakes from genuinely-broken flows. |
| `get_flow_runs` | Individual run history for one flow file (`fileName` required). Returns status, duration, `failReason`, and the `uploadId` each run belongs to. Use to drill into a specific flow after `list_flow_analytics`. |

### Upload-naming convention

Uploads are typically named after the commit or build that triggered them. A common convention is to include the short SHA:

```
fix(login): handle expired session (a1b2c3d4)
```

Filter with `name = "*a1b2c3d4*"` to find every upload for a specific commit. The wildcard is `*`, not `%`.

### When uploads do and don't exist

DeviceCloud uploads are created when you trigger a run, via the CLI, a CI step, the GitHub Action, or the API directly. Whether a given commit has an upload depends entirely on your CI setup. If `list_uploads` returns nothing for a SHA you expect, the run probably wasn't triggered for that commit.

## Troubleshooting

- **`DEVICE_CLOUD_API_KEY env var is required`**: the variable isn't visible to the spawned MCP. Export it from `~/.zshrc` / `~/.bashrc`, restart your assistant.
- **`unzip failed`** (from `get_html_report`): the `unzip` binary is missing or crashed. Install with `brew install unzip` (macOS ships with it; Linux usually does too).
- **HTTP 401 / 403**: the API key is wrong or revoked. Regenerate it at [console.devicecloud.dev/settings](https://console.devicecloud.dev/settings).
- **Empty `list_uploads` for your SHA**: a run probably wasn't triggered for that commit. See "When uploads do and don't exist" above.
