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
        failureScreenshots: key ? screenshots.filter((s) => s.toLowerCase().includes(key)) : [],
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
