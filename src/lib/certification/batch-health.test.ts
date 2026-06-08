import { describe, expect, it } from "vitest";

import {
  deriveBatchHealth,
  type BatchHealth,
  type BatchHealthCheckKey,
  type BatchHealthFacts,
} from "./batch-health";

// A fully-healthy batch: no missing carbon inputs, production linked, facility
// set up, and every required transport category present.
const HEALTHY: BatchHealthFacts = {
  carbonMissingInputs: [],
  entityReadinessGaps: [],
  hasSubmittableRuns: true,
  facilitySetupComplete: true,
  requiredTransport: [
    { category: "feedstock", present: true },
    { category: "biochar", present: true },
  ],
};

function facts(overrides: Partial<BatchHealthFacts> = {}): BatchHealthFacts {
  return { ...HEALTHY, ...overrides };
}

function checkFor(result: BatchHealth, key: BatchHealthCheckKey) {
  const check = result.checks.find((c) => c.key === key);
  if (!check) throw new Error(`no ${key} check`);
  return check;
}

describe("deriveBatchHealth", () => {
  it("a fully-complete batch is ready with no issues", () => {
    const result = deriveBatchHealth(facts());
    expect(result.state).toBe("ready");
    expect(result.issueCount).toBe(0);
    expect(result.checks.map((c) => c.status)).toEqual([
      "met",
      "met",
      "met",
      "met",
    ]);
  });

  it("flags missing carbon/durability inputs and names them", () => {
    const result = deriveBatchHealth(
      facts({ carbonMissingInputs: ["sample carbon content", "H:Corg ratio"] }),
    );
    expect(result.state).toBe("incomplete");
    expect(result.issueCount).toBe(1);
    const carbon = checkFor(result, "carbon");
    expect(carbon.status).toBe("unmet");
    expect(carbon.detail).toContain("sample carbon content");
    expect(carbon.detail).toContain("H:Corg ratio");
  });

  it("flags missing production data", () => {
    const result = deriveBatchHealth(facts({ hasSubmittableRuns: false }));
    expect(result.state).toBe("incomplete");
    expect(checkFor(result, "production").status).toBe("unmet");
  });

  it("surfaces entity readiness separately without blocking grouping", () => {
    const result = deriveBatchHealth(
      facts({
        entityReadinessGaps: ["Production run PR-1: Electricity reading"],
      }),
    );
    expect(result.state).toBe("ready");
    expect(result.issueCount).toBe(0);
    expect(checkFor(result, "carbon").status).toBe("met");
    const entity = checkFor(result, "entityReadiness");
    expect(entity.status).toBe("skipped");
    expect(entity.detail).toContain("Electricity reading");
  });

  it("flags a missing transport category by name", () => {
    const result = deriveBatchHealth(
      facts({
        requiredTransport: [
          { category: "feedstock", present: true },
          { category: "biochar", present: false },
        ],
      }),
    );
    expect(result.state).toBe("incomplete");
    const transport = checkFor(result, "transport");
    expect(transport.status).toBe("unmet");
    expect(transport.detail).toContain("biochar");
    expect(transport.detail).not.toContain("feedstock");
  });

  it("transport is met when all required categories are present", () => {
    expect(checkFor(deriveBatchHealth(facts()), "transport").status).toBe(
      "met",
    );
  });

  it("transport is met (not unmet) when the template requires no legs", () => {
    const transport = checkFor(
      deriveBatchHealth(facts({ requiredTransport: [] })),
      "transport",
    );
    expect(transport.status).toBe("met");
  });

  it("skips transport when facility setup is incomplete and does not block readiness", () => {
    const result = deriveBatchHealth(
      facts({ facilitySetupComplete: false, requiredTransport: [] }),
    );
    // Carbon + production are met; transport is skipped, not unmet — so the
    // batch is still selectable. The facility-setup gap is the wizard's concern.
    expect(checkFor(result, "transport").status).toBe("skipped");
    expect(result.issueCount).toBe(0);
    expect(result.state).toBe("ready");
  });

  it("still reports batch-data issues even when facility setup is incomplete", () => {
    const result = deriveBatchHealth(
      facts({
        facilitySetupComplete: false,
        requiredTransport: [],
        carbonMissingInputs: ["sample carbon content"],
      }),
    );
    expect(checkFor(result, "transport").status).toBe("skipped");
    expect(checkFor(result, "carbon").status).toBe("unmet");
    expect(result.issueCount).toBe(1);
    expect(result.state).toBe("incomplete");
  });

  it("counts every unmet check toward issueCount", () => {
    const result = deriveBatchHealth(
      facts({
        carbonMissingInputs: ["sample carbon content"],
        hasSubmittableRuns: false,
        requiredTransport: [{ category: "feedstock", present: false }],
      }),
    );
    expect(result.issueCount).toBe(3);
    expect(result.state).toBe("incomplete");
  });
});
