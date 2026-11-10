import { describe, expect, it } from "vitest";
import { aggregateBatchStatements, batchStatementStatus } from "./credit-batch-statements";
import { deriveStatementStatus, type DerivedStatusKind } from "./status";

const NEWER = new Date("2026-07-02T12:00:00Z");
const OLDER = new Date("2026-07-01T12:00:00Z");
const PERIOD = { reportingPeriodStartOn: "2026-01-01", reportingPeriodEndOn: "2026-06-30" };

function holder(id: string, statementId: string | null, kind: DerivedStatusKind = "draft", dryKg = 100, createdAt: Date | null = OLDER) {
  return {
    id, createdAt, ghgStatementId: statementId, dryKg,
    ghgStatementStatus: statementId ? { ...deriveStatementStatus({ local: null, lockInFlight: false, remoteStatus: null }), kind } : null,
  };
}

describe("batch statements", () => {
  it.each([
    {
      name: "newest draft without a statement keeps the older issued one",
      holders: [holder("new", null, "draft", 50, NEWER), holder("old", "issued", "issued")],
      decidedBy: "issued", kind: "issued", masses: [["issued", 100]],
    },
    {
      name: "issued leads a newer statement in verification",
      holders: [holder("new", "waiting", "in-verification", 50, NEWER), holder("old", "issued", "issued")],
      decidedBy: "issued", kind: "issued", masses: [["waiting", 50], ["issued", 100]],
    },
    {
      name: "failure leads issued",
      holders: [holder("new", "issued", "issued", 50, NEWER), holder("old", "failed", "verification-failed")],
      decidedBy: "failed", kind: "verification-failed", masses: [["issued", 50], ["failed", 100]],
    },
    {
      name: "two holders share one statement with both masses counted once",
      holders: [holder("new", "shared", "verified", 0.1, NEWER), holder("old", "shared", "verified", 0.2)],
      decidedBy: "shared", kind: "verified", masses: [["shared", 0.3]],
    },
    {
      name: "no statements",
      holders: [holder("new", null, "draft", 50, NEWER), holder("old", null)],
      decidedBy: null, kind: null, masses: [],
    },
    {
      name: "verified leads newer pending changes",
      holders: [holder("new", "pending", "pending-changes", 50, NEWER), holder("old", "verified", "verified")],
      decidedBy: "verified", kind: "verified", masses: [["verified", 100], ["pending", 50]],
    },
  ])("$name", ({ holders, decidedBy, kind, masses }) => {
    const result = batchStatementStatus(holders);
    expect(result?.id ?? null).toBe(decidedBy);
    expect(result?.status.kind ?? null).toBe(kind);
    const statements = holders.flatMap(row => row.ghgStatementId ? [{ id: row.ghgStatementId, ...PERIOD }] : []);
    expect(aggregateBatchStatements(holders, statements).map(row => [row.id, row.dryKg])).toEqual(masses);
  });

  it("falls back to the newest linked holder, with null dates last and descending id ties", () => {
    const holders = [
      holder("z", "undated", "pending-changes", 50, null),
      holder("a", "older", "in-verification"),
      holder("b", "newer", "draft"),
      holder("new", null, "draft", 50, NEWER),
    ];
    expect(batchStatementStatus(holders)?.id).toBe("newer");
    expect(batchStatementStatus([...holders].reverse())?.id).toBe("newer");
    expect(batchStatementStatus([])).toBeNull();
  });

  it.each(["issued", "verified", "verification-failed"] as const)("breaks %s ties by holder date then id", kind => {
    expect(batchStatementStatus([
      holder("z", "undated", kind, 50, null),
      holder("a", "older", kind),
      holder("a", "newer-a", kind, 50, NEWER),
      holder("b", "newer-b", kind, 50, NEWER),
    ])?.id).toBe("newer-b");
  });

  it("orders effective ends, starts, and ids descending with null periods last", () => {
    const statements = [
      { id: "none", reportingPeriodEndOn: null, reportingPeriodStartOn: null },
      { id: "no-start", reportingPeriodEndOn: "2026-06-30", reportingPeriodStartOn: null },
      { id: "a", ...PERIOD },
      { id: "b", ...PERIOD },
      { id: "later-start", ...PERIOD, reportingPeriodStartOn: "2026-02-01" },
      { id: "latest", ...PERIOD, reportingPeriodEndOn: "2026-07-31" },
      { id: "unlinked", ...PERIOD },
    ];
    const holders = statements.filter(row => row.id !== "unlinked").map(row => holder(row.id, row.id));
    const original = [...statements];
    expect(aggregateBatchStatements(holders, statements).map(row => row.id))
      .toEqual(["latest", "later-start", "b", "a", "no-start", "none"]);
    expect(statements).toEqual(original);
  });
});
