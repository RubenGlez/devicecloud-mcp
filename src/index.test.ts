import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { stripCRLF, filterResults } from "./utils.js";

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
