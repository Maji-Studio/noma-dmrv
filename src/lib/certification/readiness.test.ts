import { describe, expect, it } from "vitest";
import {
  buildRemovalPreflightChecklist,
  buildRemovalRequirementsChecklist,
  canRegroupRemoval,
  deriveRemovalReadiness,
  type PreflightCheck,
  type RemovalRequirementCheck,
  type RemovalRequirementKey,
  type RemovalReadinessFacts,
  type TransportCoverageFact,
} from "./readiness";

function checkFor(
  checks: PreflightCheck[],
  key: PreflightCheck["key"],
): PreflightCheck {
  const found = checks.find((c) => c.key === key);
  if (!found) throw new Error(`no preflight check for ${key}`);
  return found;
}

// A fully-ready removal: linked, template clean, runs present, all required
// transport covered. Individual tests override one axis at a time.
function ready(
  overrides: Partial<RemovalReadinessFacts> = {},
): RemovalReadinessFacts {
  return {
    local: null,
    lockInFlight: false,
    hasMapping: true,
    hasDefaultTemplate: true,
    missingDefaultTemplateId: null,
    unresolvedBlueprintKeys: [],
    hasSubmittableRuns: true,
    requiredTransport: [
      { category: "feedstock", count: 2, hasAggregationWarning: false },
      { category: "biochar", count: 1, hasAggregationWarning: false },
    ],
    ...overrides,
  };
}

describe("deriveRemovalReadiness — precedence", () => {
  it("reports inProgress above everything when a lock is live", () => {
    // Even with blockers present, the live lock wins.
    const r = deriveRemovalReadiness(
      ready({ lockInFlight: true, hasMapping: false }),
    );
    expect(r.state).toBe("inProgress");
    expect(r.reasons).toEqual([]);
  });

  it("reports submitted (terminal) for a submitted removal", () => {
    const r = deriveRemovalReadiness(ready({ local: "submitted" }));
    expect(r.state).toBe("submitted");
    expect(r.reasons).toEqual([]);
  });

  it("reports submitted for a superseded removal", () => {
    const r = deriveRemovalReadiness(ready({ local: "superseded" }));
    expect(r.state).toBe("submitted");
  });

  it("treats accepted defensively as submitted (unreachable for removals)", () => {
    const r = deriveRemovalReadiness(ready({ local: "accepted" }));
    expect(r.state).toBe("submitted");
  });
});

describe("deriveRemovalReadiness — ready", () => {
  it("is ready when never submitted and all preconditions met", () => {
    const r = deriveRemovalReadiness(ready());
    expect(r.state).toBe("ready");
    expect(r.reasons).toEqual([]);
  });

  it("is ready from a draft row with no live lock", () => {
    const r = deriveRemovalReadiness(ready({ local: "draft" }));
    expect(r.state).toBe("ready");
  });

  it("re-evaluates a rejected removal for resubmit (ready when clean)", () => {
    const r = deriveRemovalReadiness(ready({ local: "rejected" }));
    expect(r.state).toBe("ready");
  });

  it("is ready when the template requires no transport at all", () => {
    const r = deriveRemovalReadiness(ready({ requiredTransport: [] }));
    expect(r.state).toBe("ready");
  });
});

describe("deriveRemovalReadiness — blocked: linkage & template", () => {
  it("blocks with a single reason when the facility is not linked", () => {
    const r = deriveRemovalReadiness(
      ready({ hasMapping: false, hasDefaultTemplate: false }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toEqual(["Facility not linked to an Isometric project"]);
  });

  it("does not pile linkage reasons on top of missing template", () => {
    // No mapping short-circuits — template/transport reasons are suppressed.
    const r = deriveRemovalReadiness(
      ready({
        hasMapping: false,
        hasDefaultTemplate: false,
        hasSubmittableRuns: false,
      }),
    );
    expect(r.reasons).toHaveLength(1);
  });

  it("blocks when no default template is selected", () => {
    const r = deriveRemovalReadiness(ready({ hasDefaultTemplate: false }));
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(
      "No default removal template selected for this facility",
    );
  });

  it("blocks when the configured template went missing on Isometric", () => {
    const r = deriveRemovalReadiness(
      ready({ hasDefaultTemplate: false, missingDefaultTemplateId: "tmpl_9" }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons[0]).toContain("tmpl_9");
    expect(r.reasons[0]).toContain("no longer available");
  });

  it("blocks on unresolved blueprint keys with correct pluralisation", () => {
    const one = deriveRemovalReadiness(
      ready({ unresolvedBlueprintKeys: ["k1"] }),
    );
    expect(one.reasons).toContain("Template references 1 unresolved blueprint");

    const many = deriveRemovalReadiness(
      ready({ unresolvedBlueprintKeys: ["k1", "k2"] }),
    );
    expect(many.reasons).toContain("Template references 2 unresolved blueprints");
  });

  it("suppresses transport judgement while the template is unresolved", () => {
    // Template not clean ⇒ required transport unknown ⇒ no transport reasons,
    // even though coverage is empty.
    const empty: TransportCoverageFact[] = [
      { category: "feedstock", count: 0, hasAggregationWarning: false },
    ];
    const r = deriveRemovalReadiness(
      ready({ hasDefaultTemplate: false, requiredTransport: empty }),
    );
    expect(r.reasons.some((m) => m.includes("transport"))).toBe(false);
  });
});

describe("deriveRemovalReadiness — blocked: transport coverage", () => {
  it("blocks on a missing required transport category", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
          { category: "biochar", count: 1, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Missing feedstock transport legs");
  });

  it("blocks on incomplete (aggregation-warning) coverage", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "biochar", count: 3, hasAggregationWarning: true },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Incomplete biochar transport legs");
  });

  it("lists missing and incomplete separately across categories", () => {
    const r = deriveRemovalReadiness(
      ready({
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
          { category: "biochar", count: 2, hasAggregationWarning: true },
          { category: "sample", count: 1, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.reasons).toContain("Missing feedstock transport legs");
    expect(r.reasons).toContain("Incomplete biochar transport legs");
  });
});

describe("deriveRemovalReadiness — blocked: no data", () => {
  it("blocks when there is no production data to submit", () => {
    const r = deriveRemovalReadiness(ready({ hasSubmittableRuns: false }));
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(
      "No production data linked yet — nothing to submit",
    );
  });

  it("uses the specific production-lineage blocker when one is known", () => {
    const r = deriveRemovalReadiness(
      ready({
        hasSubmittableRuns: false,
        productionReadinessGap: {
          kind: "noApplications",
          detail: "No applications linked to this batch",
          fixTarget: "batchDetails",
        },
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("No applications linked to this batch");
    expect(r.reasons).not.toContain(
      "No production data linked yet — nothing to submit",
    );
  });

  it("blocks when entity certifier fields are incomplete", () => {
    const r = deriveRemovalReadiness(
      ready({ entityReadinessGaps: ["Production run PR-1: Electricity"] }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(
      "Incomplete entity certifier data: Production run PR-1: Electricity",
    );
  });

  it("accumulates template + transport + no-data reasons together", () => {
    const r = deriveRemovalReadiness(
      ready({
        hasSubmittableRuns: false,
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
        ],
      }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain("Missing feedstock transport legs");
    expect(r.reasons).toContain(
      "No production data linked yet — nothing to submit",
    );
  });
});

describe("buildRemovalPreflightChecklist", () => {
  it("returns the five checks in a stable order", () => {
    const checks = buildRemovalPreflightChecklist(ready());
    expect(checks.map((c) => c.key)).toEqual([
      "mapping",
      "template",
      "transport",
      "production",
      "entityReadiness",
    ]);
  });

  it("marks every check met for a fully-ready removal", () => {
    const checks = buildRemovalPreflightChecklist(ready());
    expect(checks.every((c) => c.status === "met")).toBe(true);
    expect(checkFor(checks, "mapping").detail).toBeUndefined();
  });

  it("skips downstream checks when the facility is not linked", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ hasMapping: false, hasDefaultTemplate: false }),
    );
    expect(checkFor(checks, "mapping").status).toBe("unmet");
    expect(checkFor(checks, "mapping").detail).toBe(
      "Facility not linked to an Isometric project",
    );
    // Template/transport are not yet evaluable without a link.
    expect(checkFor(checks, "template").status).toBe("skipped");
    expect(checkFor(checks, "transport").status).toBe("skipped");
    // Production data is independent of the link, so it is still judged.
    expect(checkFor(checks, "production").status).toBe("met");
  });

  it("skips transport while the template is unresolved", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({
        hasDefaultTemplate: false,
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
        ],
      }),
    );
    expect(checkFor(checks, "template").status).toBe("unmet");
    expect(checkFor(checks, "transport").status).toBe("skipped");
  });

  it("surfaces the missing-template detail using the shared phrasing", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ hasDefaultTemplate: false, missingDefaultTemplateId: "tmpl_9" }),
    );
    expect(checkFor(checks, "template").detail).toBe(
      "Default removal template tmpl_9 is no longer available",
    );
  });

  it("marks transport met-with-context when the template needs no legs", () => {
    const checks = buildRemovalPreflightChecklist(ready({ requiredTransport: [] }));
    const transport = checkFor(checks, "transport");
    expect(transport.status).toBe("met");
    expect(transport.detail).toBe("This template requires no transport legs.");
  });

  it("joins missing + incomplete transport gaps into one detail", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({
        requiredTransport: [
          { category: "feedstock", count: 0, hasAggregationWarning: false },
          { category: "biochar", count: 2, hasAggregationWarning: true },
        ],
      }),
    );
    const transport = checkFor(checks, "transport");
    expect(transport.status).toBe("unmet");
    expect(transport.detail).toBe(
      "Missing feedstock transport legs · Incomplete biochar transport legs",
    );
  });

  it("flags missing production data", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ hasSubmittableRuns: false }),
    );
    expect(checkFor(checks, "production").status).toBe("unmet");
    expect(checkFor(checks, "production").detail).toContain("nothing to submit");
  });

  it("shows the specific production-lineage blocker in preflight", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({
        hasSubmittableRuns: false,
        productionReadinessGap: {
          kind: "biocharProductMissingRun",
          detail: "Biochar product BP-1 is not linked to a production run",
          fixTarget: "biocharProducts",
        },
      }),
    );
    expect(checkFor(checks, "production").detail).toBe(
      "Biochar product BP-1 is not linked to a production run",
    );
  });

  it("flags entity-level certifier gaps", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ entityReadinessGaps: ["Production run PR-1: Electricity"] }),
    );
    expect(checkFor(checks, "entityReadiness").status).toBe("unmet");
    expect(checkFor(checks, "entityReadiness").detail).toContain("Electricity");
  });

  it("skips entity readiness when there is nothing to submit", () => {
    // No runs ⇒ no entities to evaluate ⇒ empty gaps means "not evaluated",
    // not "complete", so the check is skipped rather than met.
    const checks = buildRemovalPreflightChecklist(
      ready({ hasSubmittableRuns: false, entityReadinessGaps: [] }),
    );
    expect(checkFor(checks, "entityReadiness").status).toBe("skipped");
  });
});

describe("buildRemovalRequirementsChecklist — wizard facility-level subset", () => {
  function reqFor(
    checks: RemovalRequirementCheck[],
    key: RemovalRequirementKey,
  ): RemovalRequirementCheck {
    const found = checks.find((c) => c.key === key);
    if (!found) throw new Error(`no requirement check for ${key}`);
    return found;
  }

  it("surfaces wizard-level keys (never batch-level production/presence)", () => {
    const checks = buildRemovalRequirementsChecklist(ready());
    expect(checks.map((c) => c.key)).toEqual([
      "mapping",
      "template",
      "transportUniformity",
      "entityReadiness",
    ]);
  });

  it("is all-met for a fully-ready, uniform removal", () => {
    const checks = buildRemovalRequirementsChecklist(ready());
    expect(checks.every((c) => c.status === "met")).toBe(true);
  });

  it("flags an unlinked facility and skips downstream checks", () => {
    const checks = buildRemovalRequirementsChecklist(
      ready({ hasMapping: false }),
    );
    expect(reqFor(checks, "mapping").status).toBe("unmet");
    expect(reqFor(checks, "template").status).toBe("skipped");
    expect(reqFor(checks, "transportUniformity").status).toBe("skipped");
  });

  it("flags an unresolved template and skips transport uniformity", () => {
    const checks = buildRemovalRequirementsChecklist(
      ready({ hasDefaultTemplate: false }),
    );
    expect(reqFor(checks, "template").status).toBe("unmet");
    expect(reqFor(checks, "transportUniformity").status).toBe("skipped");
  });

  it("flags cross-batch transport non-uniformity (present but mixed)", () => {
    const checks = buildRemovalRequirementsChecklist(
      ready({
        requiredTransport: [
          { category: "biochar", count: 2, hasAggregationWarning: true },
        ],
      }),
    );
    const uniformity = reqFor(checks, "transportUniformity");
    expect(uniformity.status).toBe("unmet");
    expect(uniformity.detail).toContain("biochar");
  });

  it("does NOT flag uniformity for a missing leg — that's the batch's concern", () => {
    // count === 0 is a batch-level presence gap, excluded from this step even
    // though the full pre-flight would mark transport unmet.
    const checks = buildRemovalRequirementsChecklist(
      ready({
        requiredTransport: [
          { category: "biochar", count: 0, hasAggregationWarning: false },
        ],
      }),
    );
    expect(reqFor(checks, "transportUniformity").status).toBe("met");
  });

  it("flags entity-readiness gaps so submit is never disabled without a visible reason", () => {
    const checks = buildRemovalRequirementsChecklist(
      ready({
        entityReadinessGaps: ["Production run PR-1: Electricity reading"],
      }),
    );
    const entityReadiness = reqFor(checks, "entityReadiness");
    expect(entityReadiness.status).toBe("unmet");
    expect(entityReadiness.detail).toContain("Electricity reading");
  });
});

describe("canRegroupRemoval", () => {
  it("allows regrouping a removal with no submission yet", () => {
    expect(canRegroupRemoval({ local: null, lockInFlight: false })).toBe(true);
  });

  it("blocks regrouping while a submission lock is live", () => {
    expect(canRegroupRemoval({ local: "draft", lockInFlight: true })).toBe(false);
  });

  it("blocks regrouping for live ledger statuses (draft/submitted/accepted)", () => {
    for (const local of ["draft", "submitted", "accepted"] as const) {
      expect(canRegroupRemoval({ local, lockInFlight: false })).toBe(false);
    }
  });

  it("allows regrouping once terminal-but-non-blocking (rejected/superseded)", () => {
    for (const local of ["rejected", "superseded"] as const) {
      expect(canRegroupRemoval({ local, lockInFlight: false })).toBe(true);
    }
  });
});
