import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripCRLF, filterResults, buildDiagnosis } from "./utils.js";

describe("stripCRLF", () => {
  it("strips trailing CRLF from a string", () => {
    assert.equal(stripCRLF("hello\r\n"), "hello");
  });

  it("converts mid-string CRLF to LF", () => {
    assert.equal(stripCRLF("hello\r\nworld"), "hello\nworld");
  });

  it("recurses into arrays", () => {
    assert.deepEqual(stripCRLF(["a\r\n", "b\r\n"]), ["a", "b"]);
  });

  it("recurses into objects", () => {
    assert.deepEqual(stripCRLF({ name: "foo\r\n", count: 1 }), { name: "foo", count: 1 });
  });

  it("passes through non-string primitives unchanged", () => {
    assert.equal(stripCRLF(42), 42);
    assert.equal(stripCRLF(null), null);
    assert.equal(stripCRLF(true), true);
  });
});

describe("filterResults", () => {
  it("filters results to matching status", () => {
    const json = {
      statusCode: 200,
      results: [
        { id: "1", status: "PASSED" },
        { id: "2", status: "FAILED" },
        { id: "3", status: "PASSED" },
      ],
    };
    const out = JSON.parse(filterResults(json, "PASSED"));
    assert.equal(out.results.length, 2);
    assert.ok(out.results.every((r: { status: string }) => r.status === "PASSED"));
    assert.equal(out.filteredBy, "PASSED");
    assert.equal(out.statusCode, 200);
  });

  it("returns empty results array when nothing matches", () => {
    const json = { results: [{ id: "1", status: "PASSED" }] };
    const out = JSON.parse(filterResults(json, "FAILED"));
    assert.equal(out.results.length, 0);
    assert.equal(out.filteredBy, "FAILED");
  });

  it("handles missing results field gracefully", () => {
    const json: Record<string, unknown> = { statusCode: 200 };
    const out = JSON.parse(filterResults(json, "PASSED"));
    assert.deepEqual(out.results, []);
    assert.equal(out.statusCode, 200);
  });

  it("preserves all other fields from the original json", () => {
    const json = { results: [], uploadId: "abc123", extra: "data" };
    const out = JSON.parse(filterResults(json, "PASSED"));
    assert.equal(out.uploadId, "abc123");
    assert.equal(out.extra, "data");
  });
});

describe("buildDiagnosis", () => {
  const status = {
    uploadId: "u1",
    name: "Nightly",
    status: "FAILED",
    consoleUrl: "https://console/x",
  };

  it("surfaces a failed flow with its reason, duration, and matched screenshots", () => {
    const results = {
      results: [
        { test_file_name: "./flows/login.yaml", status: "FAILED", fail_reason: "Element not found", duration_seconds: 32, retry_of: null },
        { test_file_name: "./flows/home.yaml", status: "PASSED", fail_reason: null, duration_seconds: 10, retry_of: null },
      ],
    };
    const d = buildDiagnosis(status, results, {
      failureScreenshots: ["/tmp/r/login-failure-screenshot-1.png", "/tmp/r/home.png"],
      reportDir: "/tmp/r",
    });
    assert.equal(d.summary.totalFlows, 2);
    assert.equal(d.summary.passed, 1);
    assert.equal(d.summary.failed, 1);
    assert.equal(d.failures.length, 1);
    assert.equal(d.failures[0].flow, "./flows/login.yaml");
    assert.equal(d.failures[0].failReason, "Element not found");
    assert.equal(d.failures[0].durationSeconds, 32);
    assert.deepEqual(d.failures[0].failureScreenshots, ["/tmp/r/login-failure-screenshot-1.png"]);
    assert.equal(d.uploadId, "u1");
    assert.equal(d.reportDir, "/tmp/r");
  });

  it("folds a fail-then-pass retry into flakyRecovered, not a failure", () => {
    const results = {
      results: [
        { test_file_name: "./flows/flaky.yaml", status: "FAILED", fail_reason: "timeout", duration_seconds: 20, retry_of: null },
        { test_file_name: "./flows/flaky.yaml", status: "PASSED", fail_reason: null, duration_seconds: 18, retry_of: 1 },
      ],
    };
    const d = buildDiagnosis(status, results);
    assert.equal(d.summary.totalFlows, 1);
    assert.equal(d.summary.passed, 1);
    assert.equal(d.summary.failed, 0);
    assert.equal(d.summary.flakyRecovered, 1);
    assert.equal(d.failures.length, 0);
    assert.ok(d.next.some((n) => n.includes("flaky")));
  });

  it("falls back to status.tests when results are unavailable", () => {
    const d = buildDiagnosis(
      { ...status, tests: [{ name: "./flows/login.yaml", status: "FAILED", durationSeconds: 5, failReason: "boom" }] },
      null,
    );
    assert.equal(d.summary.failed, 1);
    assert.equal(d.failures[0].flow, "./flows/login.yaml");
    assert.equal(d.failures[0].failReason, "boom");
  });

  it("reports no outstanding failures when everything passed", () => {
    const d = buildDiagnosis(
      { ...status, status: "PASSED" },
      { results: [{ test_file_name: "./flows/login.yaml", status: "PASSED", fail_reason: null, duration_seconds: 9, retry_of: null }] },
    );
    assert.equal(d.summary.failed, 0);
    assert.deepEqual(d.failures, []);
    assert.ok(d.next.some((n) => n.includes("No outstanding failures")));
  });
});
