import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("the built server initializes and lists its tools", async () => {
  const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf8")) as { version: string };
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [resolve("dist/index.js")],
    env: { DEVICE_CLOUD_API_KEY: "startup-test-key" },
    stderr: "pipe",
  });
  const client = new Client({ name: "startup-test", version: "1.0.0" });

  try {
    await client.connect(transport);
    assert.equal(client.getServerVersion()?.version, packageJson.version);

    const { tools } = await client.listTools();
    assert.deepEqual(
      tools.map(({ name }) => name).sort(),
      [
        "diagnose_run",
        "download_artifacts",
        "get_flow_runs",
        "get_html_report",
        "get_junit_report",
        "get_results",
        "get_upload_status",
        "list_flow_analytics",
        "list_uploads",
        "suite_health",
      ],
    );
  } finally {
    await client.close();
  }
});
