# devicecloud-mcp

A small MCP server that exposes [DeviceCloud](https://console.devicecloud.dev) (the platform we use to run Maestro flows on real devices) as tools that any MCP-aware assistant — Claude Code, Cursor, Claude Desktop, etc. — can call directly.

It lets the assistant:

- list recent Maestro uploads, filter by name (commit message + short SHA) or date
- read the per-flow status and `failReason` for any upload
- pull the JUnit XML report
- download and auto-unzip the HTML report (with failure screenshots highlighted)
- download raw artifacts (logs, screenshots, video) as a zip
- query per-flow pass-rate analytics over a lookback window

The server is read-only against the DeviceCloud API.

## Prerequisites

- **Node.js 24 LTS** — use `nvm install 24 && nvm use 24`, or `nvm use` if you already have it
- **pnpm** — `npm i -g pnpm` or `corepack enable pnpm`
- **A DeviceCloud API key** — ping the mobile team if you don't have one. It is the same key you'd put in `x-app-api-key` when calling the API directly.

## Install

```sh
cd /path/to/devicecloud-mcp
nvm use        # picks up .nvmrc (Node 22)
pnpm install
```

That's it — no build step needed. The server runs straight from TypeScript via `tsx`.

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
      "command": "/ABSOLUTE/PATH/TO/devicecloud-mcp/node_modules/.bin/tsx",
      "args": ["/ABSOLUTE/PATH/TO/devicecloud-mcp/src/index.ts"],
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

### Cursor / Claude Desktop / other MCP clients

Same idea — they all accept a stdio MCP server with `command`, `args`, and `env`. Use the same JSON shape as above; consult the client's docs for where to put it.

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

### Upload-naming convention

Uploads are created by CI with a `name` shaped like the commit message ending in `(<short-sha>)`:

```
fix(e2e): use password meeting complexity rule in register flow (53a3cdf1d)
```

Filter with `name = "*53a3cdf1d*"` to find every upload for a specific commit. The wildcard is `*`, not `%`.

### When uploads do and don't exist

DeviceCloud uploads are not produced for every push. They run on:

- merges to `master` (automatic), or
- manual CI triggers (re-running the Maestro workflow from CircleCI by hand).

A feature branch can have many commits with zero uploads — that's normal, not a bug.

## Troubleshooting

- **`DEVICE_CLOUD_API_KEY env var is required`** — the variable isn't visible to the spawned MCP. Export it from `~/.zshrc` / `~/.bashrc`, restart your assistant.
- **`unzip exited with code N`** (from `get_html_report`) — the `unzip` binary is missing. Install with `brew install unzip` (macOS ships with it; Linux usually does too).
- **HTTP 401 / 403** — the API key is wrong or revoked. Re-confirm the key with the mobile team.
- **Empty `list_uploads` for your SHA** — Maestro probably wasn't triggered on that commit. See "When uploads do and don't exist" above.

## Files

```
devicecloud-mcp/
├── src/index.ts        # the server (single file)
├── package.json
├── tsconfig.json
├── pnpm-lock.yaml
├── .nvmrc
├── .npmrc
├── .gitignore
└── README.md
```

No build artifacts are checked in; `tsx` runs the TypeScript source directly. The repo uses pnpm — `pnpm-lock.yaml` is the lockfile.
