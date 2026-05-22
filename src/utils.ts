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
