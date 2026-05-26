# devicecloud-mcp

A small MCP server that exposes [DeviceCloud](https://console.devicecloud.dev) as tools that any MCP-aware assistant — Claude Code, Cursor, Claude Desktop, etc. — can call directly. DeviceCloud is a platform for running Maestro flows on real devices.

It lets the assistant:

- list recent Maestro uploads, filter by name (commit message + short SHA) or date
- read the per-flow status and `failReason` for any upload
- pull the JUnit XML report
- download and auto-unzip the HTML report (with failure screenshots highlighted)
- download raw artifacts (logs, screenshots, video) as a zip
- query per-flow pass-rate analytics over a lookback window
- drill into run history for a specific flow file

The server is read-only against the DeviceCloud API.

## Prerequisites

- **Node.js 24 LTS** — use `nvm install 24 && nvm use 24`, or `nvm use` if you already have it
- **pnpm** — `npm i -g pnpm` or `corepack enable pnpm`
- **A DeviceCloud API key** — generate one at [console.devicecloud.dev/settings](https://console.devicecloud.dev/settings).

## Install

```sh
git clone https://github.com/RubenGlez/devicecloud-mcp
cd devicecloud-mcp
nvm use           # picks up .nvmrc (Node 24)
pnpm install      # also runs the build — dist/ is created automatically
```

## Quickest setup (no clone required)

If you just want to use the server without cloning the repo, point your client at `npx`:

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

This works for Claude Code (`.mcp.json`), Claude Desktop, Cursor, and Windsurf — wherever you put the config, `npx` fetches and runs the latest published version automatically.

## Configure your assistant

Pick the section that matches your tool. In every case you need to:

1. Point the assistant at this folder.
2. Pass `DEVICE_CLOUD_API_KEY` through to the spawned process.

Replace `/ABSOLUTE/PATH/TO/devicecloud-mcp` with wherever you put this folder.

### Claude Code (project-scoped, `.mcp.json`)

Add this entry to a `.mcp.json` at the root of any project where you want the tools available:

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/devicecloud-mcp/dist/index.js"],
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

> Setting it only in an interactive shell isn't enough — Claude Code spawns the MCP from its own environment, so the variable needs to be in the profile.

### Claude Code (user-scoped, `~/.claude.json`)

If you want it available everywhere instead of per-project, add the same `devicecloud` block under `mcpServers` in `~/.claude.json`.

### Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/devicecloud-mcp/dist/index.js"],
      "env": {
        "DEVICE_CLOUD_API_KEY": "<your-key>"
      }
    }
  }
}
```

Restart Claude Desktop after saving. A tools icon appears in the chat input once the server connects.

### Cursor

Add to `~/.cursor/mcp.json` (global) or `.cursor/mcp.json` at the project root (project-scoped):

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/devicecloud-mcp/dist/index.js"],
      "env": {
        "DEVICE_CLOUD_API_KEY": "<your-key>"
      }
    }
  }
}
```

### Windsurf

Edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "devicecloud": {
      "command": "node",
      "args": ["/ABSOLUTE/PATH/TO/devicecloud-mcp/dist/index.js"],
      "env": {
        "DEVICE_CLOUD_API_KEY": "<your-key>"
      }
    }
  }
}
```

### Other MCP-compatible clients

Any client that supports stdio MCP servers uses the same `{ command, args, env }` shape. Consult the client's docs for the config file location.

> **Note:** OpenAI products (ChatGPT, Codex, the Assistants API) use their own tool protocol and do not support MCP servers.

## Verify

After restarting your assistant:

```
List recent DeviceCloud uploads, limit 3.
```

You should see a JSON-shaped response with an `uploads` array. If instead you get `DEVICE_CLOUD_API_KEY env var is required`, the variable isn't reaching the spawned process — re-check that it's exported from your shell profile (not just the current shell).

## Available tools

| Tool | Purpose |
|------|---------|
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

DeviceCloud uploads are created when you trigger a run — via the CLI, a CI step, the GitHub Action, or the API directly. Whether a given commit has an upload depends entirely on your CI setup. If `list_uploads` returns nothing for a SHA you expect, the run probably wasn't triggered for that commit.

## Troubleshooting

- **`DEVICE_CLOUD_API_KEY env var is required`** — the variable isn't visible to the spawned MCP. Export it from `~/.zshrc` / `~/.bashrc`, restart your assistant.
- **`unzip failed`** (from `get_html_report`) — the `unzip` binary is missing or crashed. Install with `brew install unzip` (macOS ships with it; Linux usually does too).
- **HTTP 401 / 403** — the API key is wrong or revoked. Regenerate it at [console.devicecloud.dev/settings](https://console.devicecloud.dev/settings).
- **Empty `list_uploads` for your SHA** — a run probably wasn't triggered for that commit. See "When uploads do and don't exist" above.

## Files

```
devicecloud-mcp/
├── src/
│   ├── index.ts          # server entry point
│   ├── utils.ts          # pure functions (stripCRLF, filterResults)
│   └── index.test.ts     # unit tests
├── dist/                 # compiled output (built by pnpm install)
├── .github/workflows/
│   ├── ci.yml            # type-check, build, test on every push and PR
│   └── publish.yml       # publishes to npm when a v* tag is pushed
├── package.json
├── tsconfig.json
├── pnpm-lock.yaml
├── .nvmrc
├── .npmrc
├── pnpm-workspace.yaml
├── LICENSE
├── .gitignore
└── README.md
```

`pnpm install` compiles `src/` to `dist/` automatically via the `prepare` script. The repo uses pnpm — `pnpm-lock.yaml` is the lockfile.
