# devicecloud-mcp

**Triage failing DeviceCloud runs so your agent can fix them, without opening the dashboard.**

The dashboard is no longer in your debug loop. When CI goes red, your agent pulls the failure straight into your editor (fail reasons, failure screenshots, logs, and flow history), finds the root cause, and you commit the fix. CI re-runs. You never open a browser tab.

## Who it's for

Mobile teams running Maestro flows on DeviceCloud through CI, who debug failures with an AI coding agent (Claude Code, Cursor) instead of the web dashboard.

## The problem

When a CI run fails, the only way to understand *why* lives in the DeviceCloud dashboard: open it, click into the run, read the fail reason, study the failure screenshot, cross-reference the logs, then switch back to your editor to fix the flow. The evidence you need to fix the test is stuck in a browser, away from the code and the agent that could act on it.

## The promise

The MCP delivers the triage; your agent does the fix. One invocation turns a red run into root cause plus the exact artifacts to act on, your agent edits the flow or app code, and you commit. The dashboard stays closed.

## Why it's different

- **vs. the DeviceCloud dashboard**: the dashboard *shows a human* why a run failed; this lets an *agent* read the same evidence and act on it: edit the flow, not just look at the screenshot.
- **vs. the official DeviceCloud MCP**: that ships a handful of thin endpoint wrappers built around *running* tests. This is triage-first: opinionated tools that hand the agent root cause and the right artifacts, not raw JSON to stitch together. Running isn't its job; CI owns that.
- **vs. the Maestro MCP**: that drives *local* devices to author and run tests. This is cloud-only and post-run: it works on the runs CI already executed.

## Scope boundaries (deliberate)

- Doesn't trigger or re-run tests; CI plus `git commit` owns that.
- No `dcd` CLI dependency; pure REST API, `npx`-and-go, read-only and safe (an agent can't burn credits).
- Not a local-device or test-authoring tool.
- Cancelling a run is dashboard-only and outside the triage loop this is built for.

## The capability that earns the pitch

`diagnose_run` turns an upload ID (or name) into a complete triage object in one call: which flows failed, why, the failure screenshots, and a passed/failed/flaky summary, assembled for the agent to act on. Backed by flaky-vs-broken analytics (`list_flow_analytics`, `get_flow_runs`) so the agent knows whether a failure is even worth fixing.

## Architecture notes

- The DeviceCloud REST API (`https://api.devicecloud.dev`, `x-app-api-key` header) is **read-only**: uploads, results, flows. The MCP wraps 100% of it. All write actions (run, retry, cancel) live only in the `dcd` CLI or the dashboard, and are intentionally out of scope.
- Auth is a single `DEVICE_CLOUD_API_KEY` env var.
- Pure logic (CRLF stripping, result filtering, triage synthesis) lives in `src/utils.ts` and is unit-tested; `src/index.ts` does the MCP wiring and I/O.
