// DeviceCloud upload `name` fields come back with trailing \r\n from CI; strip on every string field.
export function stripCRLF(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\r\n+$/g, "").replace(/\r\n/g, "\n");
  if (Array.isArray(value)) return value.map(stripCRLF);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value)) out[k] = stripCRLF(v);
    return out;
  }
  return value;
}

export function filterResults(
  json: Record<string, unknown> & { results?: Array<Record<string, unknown>> },
  status: string,
): string {
  const filtered = (json.results ?? []).filter((r) => r["status"] === status);
  return JSON.stringify({ ...json, results: filtered, filteredBy: status }, null, 2);
}

// --- diagnose_run triage synthesis ---

type StatusTest = {
  name?: string;
  status?: string;
  durationSeconds?: number | null;
  failReason?: string | null;
};

export type StatusJson = {
  uploadId?: string;
  name?: string;
  status?: string;
  consoleUrl?: string;
  tests?: StatusTest[];
};

type ResultRow = {
  test_file_name?: string;
  status?: string;
  fail_reason?: string | null;
  duration_seconds?: number | null;
  retry_of?: number | string | null;
};

export type ResultsJson = { results?: ResultRow[] };

export type Diagnosis = {
  uploadId?: string;
  name?: string;
  overallStatus?: string;
  consoleUrl?: string;
  summary: { totalFlows: number; passed: number; failed: number; cancelled: number; flakyRecovered: number };
  failures: Array<{
    flow: string;
    failReason: string | null;
    durationSeconds: number | null;
    retried: boolean;
    failureScreenshots: string[];
  }>;
  reportDir?: string;
  allFailureScreenshots: string[];
  next: string[];
};

// Reduce a flow path like "./login-test/onboarding.yaml" to "onboarding" for screenshot matching.
function flowKey(path: string): string {
  return (path.split("/").pop() ?? path).replace(/\.ya?ml$/i, "").toLowerCase();
}

// Match a flow key as a whole word within a screenshot filename, not a loose substring —
// e.g. flow "login" must not match "relogin-failure-screenshot-1.png".
function matchesFlowKey(screenshot: string, key: string): boolean {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, "i").test(screenshot.toLowerCase());
}

// Fold a run's status + per-flow results into one triage object an agent can act on.
// Retries are collapsed per flow: a flow that failed then passed counts as flaky-recovered, not a failure.
export function buildDiagnosis(
  statusJson: StatusJson,
  resultsJson: ResultsJson | null,
  opts: { failureScreenshots?: string[]; reportDir?: string } = {},
): Diagnosis {
  const screenshots = opts.failureScreenshots ?? [];

  // Prefer the richer /results payload; fall back to status.tests if results are unavailable.
  const rows =
    resultsJson?.results && resultsJson.results.length
      ? resultsJson.results.map((r) => ({
          flow: r.test_file_name ?? "(unknown)",
          status: r.status ?? "UNKNOWN",
          failReason: r.fail_reason ?? null,
          durationSeconds: r.duration_seconds ?? null,
        }))
      : (statusJson.tests ?? []).map((t) => ({
          flow: t.name ?? "(unknown)",
          status: t.status ?? "UNKNOWN",
          failReason: t.failReason ?? null,
          durationSeconds: t.durationSeconds ?? null,
        }));

  const byFlow = new Map<string, typeof rows>();
  for (const r of rows) {
    const group = byFlow.get(r.flow);
    if (group) group.push(r);
    else byFlow.set(r.flow, [r]);
  }

  let passed = 0;
  let failed = 0;
  let cancelled = 0;
  let flakyRecovered = 0;
  const failures: Diagnosis["failures"] = [];

  for (const [flow, attempts] of byFlow) {
    const hasPass = attempts.some((a) => a.status === "PASSED");
    const failedAttempts = attempts.filter((a) => a.status === "FAILED");

    if (hasPass) {
      passed++;
      if (failedAttempts.length) flakyRecovered++;
      continue;
    }
    if (failedAttempts.length) {
      failed++;
      const last = failedAttempts[failedAttempts.length - 1];
      const key = flowKey(flow);
      failures.push({
        flow,
        failReason: last.failReason,
        durationSeconds: last.durationSeconds,
        retried: attempts.length > 1,
        failureScreenshots: key ? screenshots.filter((s) => matchesFlowKey(s, key)) : [],
      });
      continue;
    }
    if (attempts.some((a) => a.status === "CANCELLED")) cancelled++;
  }

  const next: string[] = [];
  if (failures.length) {
    next.push(
      "Read each failure's failReason and failureScreenshots to find the root cause, then fix the flow YAML or app code.",
    );
    next.push("Commit the fix to re-trigger CI — this server does not run tests.");
  } else {
    next.push("No outstanding failures to fix.");
  }
  if (flakyRecovered) {
    next.push(`${flakyRecovered} flow(s) failed then passed on retry — likely flaky; may not need a code fix.`);
  }

  return {
    uploadId: statusJson.uploadId,
    name: statusJson.name,
    overallStatus: statusJson.status,
    consoleUrl: statusJson.consoleUrl,
    summary: { totalFlows: byFlow.size, passed, failed, cancelled, flakyRecovered },
    failures,
    reportDir: opts.reportDir,
    allFailureScreenshots: screenshots,
    next,
  };
}

// --- suite_health classification ---

type FlowSummary = {
  flow_name?: string;
  file_name?: string;
  pass_rate?: number;
  passed_runs?: number;
  failed_runs?: number;
  last_run_at?: string;
  daily_data?: Record<string, string | null>;
};

export type FlowsJson = { flows?: FlowSummary[] };

type FlowCategory = "healthy" | "flaky" | "broken" | "regression";

type FlowHealth = {
  flow: string;
  file: string;
  category: FlowCategory;
  passRate: number;
  passedRuns: number;
  failedRuns: number;
  lastRunAt: string | null;
};

export type SuiteHealth = {
  totalFlows: number;
  summary: { healthy: number; flaky: number; broken: number; regression: number };
  regressions: FlowHealth[];
  broken: FlowHealth[];
  flaky: FlowHealth[];
  healthyCount: number;
  next: string[];
};

// A flow at or above this pass rate is healthy; below BROKEN_MAX it's broken; in between it's flaky.
const HEALTHY_MIN_PASS_RATE = 95;
const BROKEN_MAX_PASS_RATE = 50;

// Regression: the flow had a green day earlier in the window and its most recent day with data is
// failing (or mixed). A chronically-broken flow never passed, so it has no green day and stays "broken".
function recentlyRegressed(daily: Record<string, string | null> | undefined): boolean {
  if (!daily) return false;
  const days = Object.entries(daily)
    .filter(([, s]) => s != null)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  if (days.length < 2) return false;
  const latest = days[days.length - 1][1];
  if (latest !== "failed" && latest !== "mixed") return false; // currently passing or recovered
  return days.slice(0, -1).some(([, s]) => s === "passed");
}

function classify(f: FlowSummary): FlowCategory {
  const passRate = f.pass_rate ?? 100;
  const failed = f.failed_runs ?? 0;
  if (recentlyRegressed(f.daily_data)) return "regression";
  if (failed === 0 || passRate >= HEALTHY_MIN_PASS_RATE) return "healthy";
  if (passRate < BROKEN_MAX_PASS_RATE) return "broken";
  return "flaky";
}

// Classify every flow in a /flows analytics payload so an agent can prioritize: which failures are
// fresh regressions worth fixing now, which are chronically broken, and which are just flaky.
export function buildSuiteHealth(flowsJson: FlowsJson): SuiteHealth {
  const all: FlowHealth[] = (flowsJson.flows ?? []).map((f) => ({
    flow: f.flow_name ?? f.file_name ?? "(unknown)",
    file: f.file_name ?? "(unknown)",
    category: classify(f),
    passRate: f.pass_rate ?? 0,
    passedRuns: f.passed_runs ?? 0,
    failedRuns: f.failed_runs ?? 0,
    lastRunAt: f.last_run_at ?? null,
  }));

  // Worst first: lowest pass rate, then most failures.
  const byWorst = (a: FlowHealth, b: FlowHealth) => a.passRate - b.passRate || b.failedRuns - a.failedRuns;
  const regressions = all.filter((f) => f.category === "regression").sort(byWorst);
  const broken = all.filter((f) => f.category === "broken").sort(byWorst);
  const flaky = all.filter((f) => f.category === "flaky").sort(byWorst);
  const healthyCount = all.filter((f) => f.category === "healthy").length;

  const next: string[] = [];
  if (regressions.length) {
    next.push(
      `${regressions.length} flow(s) recently regressed (were passing, now failing); fix these first, a recent change likely broke them.`,
    );
  }
  if (broken.length) {
    next.push(`${broken.length} flow(s) are consistently broken; likely a real, persistent failure.`);
  }
  if (flaky.length) {
    next.push(`${flaky.length} flaky flow(s) pass and fail inconsistently; may be test-stability issues, not product bugs.`);
  }
  if (!next.length) next.push("Suite is healthy; all flows passing consistently.");

  return {
    totalFlows: all.length,
    summary: { healthy: healthyCount, flaky: flaky.length, broken: broken.length, regression: regressions.length },
    regressions,
    broken,
    flaky,
    healthyCount,
    next,
  };
}
