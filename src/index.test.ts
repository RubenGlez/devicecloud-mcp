import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripCRLF, filterResults, buildDiagnosis, buildSuiteHealth } from "./utils.js";

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

describe("buildSuiteHealth", () => {
  it("classifies healthy, flaky, broken, and regression flows", () => {
    const h = buildSuiteHealth({
      flows: [
        { flow_name: "Healthy", file_name: "ok.yaml", pass_rate: 100, passed_runs: 50, failed_runs: 0, daily_data: { "2026-06-28": "passed", "2026-06-29": "passed" } },
        { flow_name: "Flaky", file_name: "flaky.yaml", pass_rate: 70, passed_runs: 35, failed_runs: 15, daily_data: { "2026-06-28": "mixed", "2026-06-29": "passed" } },
        { flow_name: "Broken", file_name: "broken.yaml", pass_rate: 10, passed_runs: 5, failed_runs: 45, daily_data: { "2026-06-28": "failed", "2026-06-29": "failed" } },
        { flow_name: "Regressed", file_name: "reg.yaml", pass_rate: 80, passed_runs: 40, failed_runs: 10, daily_data: { "2026-06-27": "passed", "2026-06-28": "passed", "2026-06-29": "failed" } },
      ],
    });
    assert.equal(h.totalFlows, 4);
    assert.deepEqual(h.summary, { healthy: 1, flaky: 1, broken: 1, regression: 1 });
    assert.equal(h.regressions[0].file, "reg.yaml");
    assert.equal(h.broken[0].file, "broken.yaml");
    assert.equal(h.flaky[0].file, "flaky.yaml");
    assert.ok(h.next.some((n) => n.includes("regressed")));
  });

  it("does not flag a chronically-broken flow (never passed) as a regression", () => {
    const h = buildSuiteHealth({
      flows: [{ flow_name: "Broken", file_name: "broken.yaml", pass_rate: 0, passed_runs: 0, failed_runs: 30, daily_data: { "2026-06-28": "failed", "2026-06-29": "failed" } }],
    });
    assert.equal(h.summary.regression, 0);
    assert.equal(h.summary.broken, 1);
  });

  it("does not flag a recovered flow (latest day passed) as a regression", () => {
    const h = buildSuiteHealth({
      flows: [{ flow_name: "Recovered", file_name: "rec.yaml", pass_rate: 90, passed_runs: 45, failed_runs: 5, daily_data: { "2026-06-27": "passed", "2026-06-28": "failed", "2026-06-29": "passed" } }],
    });
    assert.equal(h.summary.regression, 0);
    assert.equal(h.summary.flaky, 1);
  });

  it("reports a healthy suite when there are no problems", () => {
    const h = buildSuiteHealth({ flows: [{ flow_name: "A", file_name: "a.yaml", pass_rate: 100, passed_runs: 10, failed_runs: 0 }] });
    assert.deepEqual(h.regressions, []);
    assert.deepEqual(h.broken, []);
    assert.deepEqual(h.flaky, []);
    assert.ok(h.next.some((n) => n.includes("healthy")));
  });

  it("handles an empty flows payload", () => {
    const h = buildSuiteHealth({});
    assert.equal(h.totalFlows, 0);
    assert.deepEqual(h.summary, { healthy: 0, flaky: 0, broken: 0, regression: 0 });
  });
});
