# Changelog

All notable changes to this project are documented here.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-06-30

### Added
- `suite_health`: classify every flow over a lookback window as healthy, flaky,
  broken, or regression, ranked worst-first, so you can tell whether a failure is
  worth fixing before diving in. Regressions (a flow that was passing and recently
  started failing) are surfaced first. Filters mirror `list_flow_analytics`.

### Changed
- Sharpened the README around the triage value the server delivers, and renamed
  the DeviceCloud web UI from "console" to "dashboard" in prose for clarity.

## [0.2.1] - 2026-06-30

### Changed
- Removed em-dashes from the README and docs.

## [0.2.0] - 2026-06-30

### Added
- `diagnose_run`: single-call triage of a DeviceCloud run (by `uploadId` or
  `name`). Returns the failed flows with their fail reasons and durations,
  auto-downloaded failure-screenshot paths, and a passed/failed/flaky summary
  with suggested next steps. Per-flow retries are folded in: a flow that failed
  then passed is reported as flaky-recovered, not a failure.

### Changed
- Repositioned the project around triaging failing DeviceCloud CI runs from your
  editor — find the root cause and fix the flow or app code without opening the
  web console. README and the package description were rewritten to match.

## [0.1.5] - 2026-06-07

### Changed
- Maintenance: standardized MIT license and dependency/tooling updates.

## [0.1.3] - 2026-05-26

Initial public release.

### Added
- MCP server exposing DeviceCloud as tools: list uploads, check flow status,
  fetch flow runs, and pull reports and artifacts.
- Configuration for Claude Desktop, Cursor, and Windsurf.
