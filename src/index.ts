#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { spawn } from "node:child_process";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";

const BASE_URL = process.env.DEVICE_CLOUD_BASE_URL ?? "https://api.devicecloud.dev";
const API_KEY = process.env.DEVICE_CLOUD_API_KEY;

if (!API_KEY) {
  console.error("[devicecloud-mcp] DEVICE_CLOUD_API_KEY env var is required");
  process.exit(1);
}

type FetchOpts = {
  path: string;
  query?: Record<string, string | number | undefined>;
  method?: "GET" | "POST";
  body?: unknown;
};

type TextResponse = { status: number; body: string; contentType: string };
type BinaryResponse = { status: number; body: Buffer; contentType: string };

async function dcFetch(opts: FetchOpts & { binary: true }): Promise<BinaryResponse>;
async function dcFetch(opts: FetchOpts & { binary?: false }): Promise<TextResponse>;
async function dcFetch(opts: FetchOpts & { binary?: boolean }): Promise<TextResponse | BinaryResponse> {
  const url = new URL(opts.path, BASE_URL);
  if (opts.query) {
    for (const [k, v] of Object.entries(opts.query)) {
      if (v !== undefined && v !== null && v !== "") {
        url.searchParams.set(k, String(v));
      }
    }
  }
  const headers: Record<string, string> = { "x-app-api-key": API_KEY! };
  let reqBody: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    reqBody = JSON.stringify(opts.body);
  }
  const res = await fetch(url, { method: opts.method ?? "GET", headers, body: reqBody });
  const contentType = res.headers.get("content-type") ?? "";
  if (opts.binary) {
    return { status: res.status, body: Buffer.from(await res.arrayBuffer()), contentType };
  }
  return { status: res.status, body: await res.text(), contentType };
}

// DeviceCloud upload `name` fields come back with trailing \r\n from CI; strip on every string field.
function stripCRLF(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\r\n+$/g, "").replace(/\r\n/g, "\n");
  if (Array.isArray(value)) return value.map(stripCRLF);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripCRLF(v);
    return out;
  }
  return value;
}

type ToolResponse = { content: Array<{ type: "text"; text: string }>; isError?: boolean };

function asResult(res: { status: number; body: string; contentType: string }): ToolResponse {
  const isJson = res.contentType.includes("application/json");
  let payload = res.body;
  if (isJson) {
    try {
      payload = JSON.stringify(stripCRLF(JSON.parse(res.body)), null, 2);
    } catch {
      // keep raw text
    }
  }
  if (res.status >= 400) {
    return {
      isError: true,
      content: [{ type: "text", text: `HTTP ${res.status}\n${payload}` }],
    };
  }
  return { content: [{ type: "text", text: payload }] };
}

function filterResults(
  json: Record<string, unknown> & { results?: Array<Record<string, unknown>> },
  status: string,
): string {
  const filtered = (json.results ?? []).filter((r) => r["status"] === status);
  return JSON.stringify({ ...json, results: filtered, filteredBy: status }, null, 2);
}

async function unzipTo(zipPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await new Promise<void>((resolve, reject) => {
    const proc = spawn("unzip", ["-o", "-q", zipPath, "-d", destDir], { stdio: "ignore" });
    proc.on("error", reject);
    proc.on("exit", (code, signal) =>
      code === 0 ? resolve() : reject(new Error(signal ? `unzip killed by signal ${signal}` : `unzip exited with code ${code}`)),
    );
  });
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) files.push(...(await listFilesRecursive(p)));
    else files.push(p);
  }
  return files;
}

type Tool = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  execute: (args: Record<string, unknown>) => Promise<ToolResponse>;
};

const tools: Tool[] = [
  {
    name: "list_uploads",
    description:
      "List Maestro uploads from DeviceCloud. Filter by name (supports * wildcard), date range, and pagination. Returns id, name, created_at, consoleUrl per upload.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string", description: "Filter by upload name. Supports * as wildcard." },
        from: { type: "string", description: "ISO 8601 timestamp — uploads on or after this date." },
        to: { type: "string", description: "ISO 8601 timestamp — uploads on or before this date." },
        limit: { type: "integer", minimum: 1, maximum: 200, description: "Default 20." },
        offset: { type: "integer", minimum: 0, description: "Default 0." },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      asResult(await dcFetch({ path: "/uploads/list", query: args as Record<string, string | number | undefined> })),
  },
  {
    name: "get_upload_status",
    description:
      "Get status summary for one upload. Returns overall status plus per-test name, status, durationSeconds, failReason. Provide either uploadId or name (most recent matching name wins).",
    inputSchema: {
      type: "object",
      properties: {
        uploadId: { type: "string" },
        name: { type: "string" },
      },
      additionalProperties: false,
    },
    execute: async (args) => {
      if (!args.uploadId && !args.name) {
        return { isError: true, content: [{ type: "text", text: "Provide uploadId or name." }] };
      }
      return asResult(await dcFetch({ path: "/uploads/status", query: args as Record<string, string> }));
    },
  },
  {
    name: "get_results",
    description:
      "List individual flow results for an upload. Each result includes id, test_file_name, status, fail_reason, duration_seconds, retry_of. Optional client-side status filter.",
    inputSchema: {
      type: "object",
      properties: {
        uploadId: { type: "string" },
        status: {
          type: "string",
          enum: ["PENDING", "QUEUED", "RUNNING", "PASSED", "FAILED", "CANCELLED"],
          description: "Filter results client-side by status.",
        },
      },
      required: ["uploadId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const uploadId = String(args.uploadId);
      const res = await dcFetch({ path: `/results/${uploadId}` });
      const statusFilter = args.status as string | undefined;
      if (res.status >= 400 || !statusFilter) return asResult(res);
      try {
        const json = stripCRLF(JSON.parse(res.body)) as Record<string, unknown> & { results?: Array<Record<string, unknown>> };
        return { content: [{ type: "text", text: filterResults(json, statusFilter) }] };
      } catch {
        return asResult(res);
      }
    },
  },
  {
    name: "get_junit_report",
    description: "Fetch the JUnit XML report for an upload. Returns raw XML.",
    inputSchema: {
      type: "object",
      properties: { uploadId: { type: "string" } },
      required: ["uploadId"],
      additionalProperties: false,
    },
    execute: async (args) =>
      asResult(await dcFetch({ path: `/results/${String(args.uploadId)}/report` })),
  },
  {
    name: "get_html_report",
    description:
      "Download AND auto-unzip the HTML report (HTML + screenshots + logs) for an upload. Returns the local extraction directory and an inventory of files, with failure screenshots highlighted at the top — those are typically the highest-signal artifact for debugging.",
    inputSchema: {
      type: "object",
      properties: {
        uploadId: { type: "string" },
        outputDir: {
          type: "string",
          description: "Parent directory for the extracted report. Defaults to /tmp.",
        },
      },
      required: ["uploadId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const uploadId = String(args.uploadId);
      if (/[/\\]|\.\./.test(uploadId)) {
        return { isError: true, content: [{ type: "text", text: "Invalid uploadId." }] };
      }
      const res = await dcFetch({ path: `/results/${uploadId}/html-report`, binary: true });
      if (res.status >= 400) {
        return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}\n${res.body.toString()}` }] };
      }
      const parent = resolvePath((args.outputDir as string | undefined) ?? "/tmp");
      const reportDir = join(parent, `devicecloud-${uploadId}-html-report`);
      const zipPath = `${reportDir}.zip`;
      try {
        await writeFile(zipPath, res.body);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Failed to write ${zipPath}: ${(err as Error).message}` }] };
      }
      try {
        await unzipTo(zipPath, reportDir);
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: `Saved zip to ${zipPath} but unzip failed: ${(err as Error).message}`,
            },
          ],
        };
      }
      const files = await listFilesRecursive(reportDir);
      const failureScreenshots = files.filter((f) => /failure-screenshot.*\.png$/i.test(f));
      const allScreenshots = files.filter((f) => /\.(png|jpg|jpeg)$/i.test(f));
      const html = files.filter((f) => /\.html$/i.test(f));
      const logs = files.filter((f) => /\.(log|txt|json)$/i.test(f));
      const summary = {
        extractedTo: reportDir,
        zip: zipPath,
        fileCount: files.length,
        failureScreenshots,
        screenshots: allScreenshots,
        htmlFiles: html,
        logs,
      };
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    },
  },
  {
    name: "download_artifacts",
    description:
      "Download raw run artifacts (logs, screenshots, videos) as a ZIP. Use when the HTML report doesn't contain enough detail (e.g. need full logcat, video recording, or non-failure screenshots).",
    inputSchema: {
      type: "object",
      properties: {
        uploadId: { type: "string" },
        results: {
          type: "string",
          enum: ["FAILED", "ALL"],
          description: "Whether to download only failed flows' artifacts or all.",
          default: "FAILED",
        },
        outputDir: { type: "string", description: "Directory for the zip. Defaults to /tmp." },
      },
      required: ["uploadId"],
      additionalProperties: false,
    },
    execute: async (args) => {
      const uploadId = String(args.uploadId);
      if (/[/\\]|\.\./.test(uploadId)) {
        return { isError: true, content: [{ type: "text", text: "Invalid uploadId." }] };
      }
      const results = (args.results as string | undefined) ?? "FAILED";
      const res = await dcFetch({ path: `/results/${uploadId}/download`, method: "POST", body: { results }, binary: true });
      if (res.status >= 400) {
        return { isError: true, content: [{ type: "text", text: `HTTP ${res.status}\n${res.body.toString()}` }] };
      }
      const parent = resolvePath((args.outputDir as string | undefined) ?? "/tmp");
      const filePath = join(parent, `devicecloud-${uploadId}-artifacts-${results.toLowerCase()}.zip`);
      try {
        await writeFile(filePath, res.body);
      } catch (err) {
        return { isError: true, content: [{ type: "text", text: `Failed to write ${filePath}: ${(err as Error).message}` }] };
      }
      return {
        content: [
          {
            type: "text",
            text: `Saved ${res.body.byteLength} bytes to ${filePath} (${results} artifacts). Unzip locally to inspect logs, screenshots, and videos.`,
          },
        ],
      };
    },
  },
  {
    name: "list_flow_analytics",
    description:
      "Aggregated pass-rate and run-count analytics per Maestro flow file over a lookback window. Use to identify flaky flows (low pass_rate but many passed_runs) vs. genuinely broken flows. Returns flow_name, file_name, pass_rate, passed_runs, failed_runs, total_runs, avg_duration, last_run_at, tags, daily_data per flow.",
    inputSchema: {
      type: "object",
      properties: {
        platform: { type: "string", enum: ["android", "ios"], description: "Filter by platform." },
        appId: { type: "string", description: "Filter by app bundle id, e.g. com.datacamp." },
        days: { type: "integer", minimum: 1, description: "Lookback window. Default 14." },
        startDate: { type: "string", description: "ISO 8601 — overrides days." },
        endDate: { type: "string", description: "ISO 8601 — defaults to now." },
        tags: { type: "string", description: "Comma-separated tag filter (e.g. smoke,critical)." },
      },
      additionalProperties: false,
    },
    execute: async (args) =>
      asResult(await dcFetch({ path: "/flows", query: args as Record<string, string | number | undefined> })),
  },
  {
    name: "get_flow_runs",
    description:
      "List individual runs for a specific Maestro flow file. Returns id, status, createdAt, durationSeconds, failReason, testUploadId, uploadName per run. Use to drill into the history of one flow — e.g. after list_flow_analytics surfaces a flaky or broken flow.",
    inputSchema: {
      type: "object",
      properties: {
        fileName: { type: "string", description: "Flow file name to look up (e.g. login.yaml)." },
        platform: { type: "string", enum: ["android", "ios"], description: "Filter by platform." },
        appId: { type: "string", description: "Filter by app bundle id." },
        limit: { type: "integer", minimum: 1, description: "Max runs to return." },
        startDate: { type: "string", description: "ISO 8601 start of range." },
        endDate: { type: "string", description: "ISO 8601 end of range." },
      },
      required: ["fileName"],
      additionalProperties: false,
    },
    execute: async (args) =>
      asResult(await dcFetch({ path: "/flows/runs", query: args as Record<string, string | number | undefined> })),
  },
];

const server = new Server(
  { name: "devicecloud-mcp", version: "0.2.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
}));

server.setRequestHandler(CallToolRequestSchema, async (req): Promise<ToolResponse> => {
  const { name, arguments: rawArgs } = req.params;
  const args = (rawArgs ?? {}) as Record<string, unknown>;
  const tool = tools.find((t) => t.name === name);
  if (!tool) return { isError: true, content: [{ type: "text", text: `Unknown tool: ${name}` }] };
  return tool.execute(args);
});

const transport = new StdioServerTransport();
await server.connect(transport);
