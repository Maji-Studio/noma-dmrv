import { describe, expect, it } from "vitest";
import { batchKpis } from "./batch-emissions";
import { makeEntry, makeLine } from "./emission-line-test-fixtures";

describe("batchKpis in an archived facility's zone", () => {
  // Sep 30 22:30 UTC is already Oct 1 in Dar es Salaam (UTC+3).
  const lines = [makeLine({ state: "filled", entries: [makeEntry({ createdAt: new Date("2026-09-30T22:30:00Z") })] })];
  it("counts the entry in October in the facility zone and in September in UTC", () => {
    expect(batchKpis(lines, "Africa/Dar_es_Salaam", "2026-10-01").entriesThisMonth).toBe(1);
    expect(batchKpis(lines, "UTC", "2026-10-01").entriesThisMonth).toBe(0);
  });
});
