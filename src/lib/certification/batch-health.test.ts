import { describe, expect, it } from "vitest";

import {
  deriveBatchHealth,
  type BatchHealth,
  type BatchHealthCheckKey,
  type BatchHealthFacts,
} from "./batch-health";
import { CERT_REQUIREMENT_META } from "./requirement-labels";

// A fully-healthy batch: no missing carbon inputs, production linked, facility
// set up, and every required transport category present.
const HEALTHY: BatchHealthFacts = {
  carbonMissingInputs: [],
  facilityEmissionsBlockers: [],
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

  it("names no linked applications separately from missing production data", () => {
    const result = deriveBatchHealth(
      facts({
        hasSubmittableRuns: false,
        productionReadinessGap: {
          kind: "noApplications",
          detail:
            "No applications fall in this batch's crediting period. Record an application in the period or adjust the period.",
          fixTarget: "applications",
        },
      }),
    );
    const production = checkFor(result, "production");
    expect(production.status).toBe("unmet");
    expect(production.detail).toContain("crediting period");
    expect(production.fixTarget).toBe("applications");
  });

  it("points broken product-to-run lineage at the biochar product workflow", () => {
    const result = deriveBatchHealth(
      facts({
        hasSubmittableRuns: false,
        productionReadinessGap: {
          kind: "biocharProductMissingRun",
          detail: "Biochar product BP-1 is not linked to a production run",
          fixTarget: "biocharProducts",
        },
      }),
    );
    const production = checkFor(result, "production");
    expect(production.detail).toContain("BP-1");
    expect(production.fixTarget).toBe("biocharProducts");
  });

  it("blocks grouping when the batch's entity certifier fields are incomplete", () => {
    const result = deriveBatchHealth(
      facts({
        entityReadinessGaps: ["Production run PR-1: Electricity reading"],
      }),
    );
    // The gaps are on this batch's own lineage, so the batch genuinely can't be
    // certified — it must be non-selectable until they're resolved.
    expect(result.state).toBe("incomplete");
    expect(result.issueCount).toBe(1);
    expect(checkFor(result, "carbon").status).toBe("met");
    const entity = checkFor(result, "entityReadiness");
    expect(entity.status).toBe("unmet");
    expect(entity.detail).toContain("Electricity reading");
  });

  it("counts one actionable issue per resolution destination", () => {
    const result = deriveBatchHealth(
      facts({
        entityReadinessGaps: [
          "Production run PR-1: Electricity reading",
          "Production run PR-2: Meter evidence",
          "Sample S-1: Lab report",
        ],
        entityReadinessIssues: [
          {
            key: "production-runs",
            label: "Production-run evidence",
            fixTarget: "productionRuns",
            affectedRecords: [
              { id: "run-1", code: "PR-1", missing: ["Electricity reading"] },
              { id: "run-2", code: "PR-2", missing: ["Meter evidence"] },
            ],
          },
          {
            key: "lab-samples",
            label: "Sample evidence",
            fixTarget: "labSamples",
            affectedRecords: [
              { id: "sample-1", code: "S-1", missing: ["Lab report"] },
            ],
          },
        ],
      }),
    );

    const issues = result.checks.filter(
      (check) => check.key === "entityReadiness" && check.status === "unmet",
    );
    expect(result.issueCount).toBe(2);
    expect(issues.map((issue) => issue.fixTarget)).toEqual([
      "productionRuns",
      "labSamples",
    ]);
    expect(issues[0]?.affectedRecords?.map((record) => record.code)).toEqual([
      "PR-1",
      "PR-2",
    ]);
  });

  it("merges overlapping carbon and sample gaps into one lab action", () => {
    const result = deriveBatchHealth(
      facts({
        carbonMissingInputs: ["Organic carbon content"],
        entityReadinessGaps: ["Sample S-1: Organic carbon"],
        entityReadinessIssues: [
          {
            key: "lab-samples",
            label: "Sample evidence",
            fixTarget: "labSamples",
            affectedRecords: [
              { id: "sample-1", code: "S-1", missing: ["Organic carbon"] },
            ],
          },
        ],
      }),
    );

    const open = result.checks.filter((check) => check.status === "unmet");
    expect(result.issueCount).toBe(1);
    expect(open).toHaveLength(1);
    expect(open[0]?.fixTarget).toBe("labSamples");
    expect(open[0]?.affectedRecords?.[0]?.code).toBe("S-1");
    expect(open[0]?.label).toBe(
      "Carbon & durability inputs complete · Entity certifier fields complete",
    );
    expect(open[0]?.requirementLabel).toBe(
      "Lab chemistry results · Sample evidence",
    );
    expect(open[0]?.whyDetail).toContain(
      CERT_REQUIREMENT_META.carbon.whyDetail,
    );
    expect(open[0]?.whyDetail).toContain(
      CERT_REQUIREMENT_META.entityReadiness.whyDetail,
    );
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

  it("attaches the shared plain-language requirement label + why to every check", () => {
    // Phase 0: the removal wizard's gap row and the batch page's checklist both
    // render `requirementLabel`, so it must come from the single shared source
    // for every check — never drift per surface.
    const result = deriveBatchHealth(
      facts({ carbonMissingInputs: ["sample carbon content"] }),
    );
    for (const check of result.checks) {
      expect(check.requirementLabel).toBe(
        CERT_REQUIREMENT_META[check.key].requirementLabel,
      );
      expect(check.whyDetail).toBe(CERT_REQUIREMENT_META[check.key].whyDetail);
    }
    // The carbon gap now reads as its neutral requirement, so it never
    // contradicts the "Missing:" detail beside it with an affirmative label.
    const carbon = checkFor(result, "carbon");
    expect(carbon.requirementLabel).toBe("Lab chemistry results");
    expect(carbon.requirementLabel).not.toMatch(/complete/i);
  });

  it("does not surface transport until production lineage can be evaluated", () => {
    const result = deriveBatchHealth(
      facts({
        carbonMissingInputs: ["sample carbon content"],
        hasSubmittableRuns: false,
        requiredTransport: [{ category: "feedstock", present: false }],
      }),
    );
    expect(result.issueCount).toBe(2);
    expect(result.state).toBe("incomplete");
    expect(checkFor(result, "transport")).toMatchObject({
      status: "skipped",
      detail: "Link production data before reviewing transport coverage",
    });
  });

  it("keeps no-lineage and insufficient-sample gaps independent", () => {
    const result = deriveBatchHealth(
      facts({
        carbonMissingInputs: [
          "At least 3 usable 1000-year Samples",
          "At least 3 usable 1000-year Samples",
        ],
        hasSubmittableRuns: false,
        productionReadinessGap: {
          kind: "noApplications",
          detail: "No applications fall in this batch's crediting period.",
          fixTarget: "applications",
        },
      }),
    );

    const open = result.checks.filter((check) => check.status === "unmet");
    expect(result.issueCount).toBe(2);
    expect(open.map((check) => check.key)).toEqual(["carbon", "production"]);
    expect(checkFor(result, "carbon").detail).toBe(
      "Missing: At least 3 usable 1000-year Samples",
    );
  });
});
