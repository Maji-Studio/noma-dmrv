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
import { CERT_REQUIREMENT_META } from "./requirement-labels";

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
    hasOrgCredentials: true,
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

  it("blocks when organization Isometric credentials are absent", () => {
    const r = deriveRemovalReadiness(ready({ hasOrgCredentials: false }));
    expect(r).toEqual({
      state: "blocked",
      reasons: ["Organization Isometric credentials are not configured"],
      advisories: [],
    });
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

  it("blocks (verbatim) on durability sampling/eligibility gate blockers", () => {
    const blocker =
      "Run PR-1 (Method A) has no samples — every Method A run must be sampled before submission (§8.3).";
    const r = deriveRemovalReadiness(
      ready({ durabilityGateBlockers: [blocker] }),
    );
    expect(r.state).toBe("blocked");
    expect(r.reasons).toContain(blocker);
  });

  it("caps durability blockers with a +N more rollup", () => {
    const blockers = Array.from({ length: 5 }, (_, i) => `Run PR-${i} blocked.`);
    const r = deriveRemovalReadiness(ready({ durabilityGateBlockers: blockers }));
    expect(r.state).toBe("blocked");
    // First three verbatim, then a rollup for the remaining two.
    expect(r.reasons).toContain("Run PR-0 blocked.");
    expect(r.reasons).toContain("+2 more sampling/eligibility issue(s)");
    expect(r.reasons).not.toContain("Run PR-4 blocked.");
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

describe("evidence mirroring advisory", () => {
  it("shows 0 of M as a warning without blocking readiness", () => {
    const facts = ready({
      supportingDocumentCount: 4,
      mirroredDocumentCount: 0,
    });

    const readiness = deriveRemovalReadiness(facts);
    expect(readiness.state).toBe("ready");
    expect(readiness.reasons).toEqual([]);
    expect(readiness.advisories).toEqual([
      "0 of 4 supporting documents mirrored",
    ]);
    expect(checkFor(buildRemovalPreflightChecklist(facts), "evidence")).toMatchObject({
      status: "warning",
      detail: "0 of 4 supporting documents mirrored",
    });
  });

  it("shows a partially mirrored N of M count as an advisory", () => {
    const facts = ready({
      supportingDocumentCount: 9,
      mirroredDocumentCount: 3,
    });

    expect(deriveRemovalReadiness(facts)).toMatchObject({
      state: "ready",
      advisories: ["3 of 9 supporting documents mirrored"],
    });
    const wizardEvidence = buildRemovalRequirementsChecklist(facts).find(
      (check) => check.key === "evidence",
    );
    expect(wizardEvidence).toMatchObject({
      status: "warning",
      detail: "3 of 9 supporting documents mirrored",
    });
  });

  it("marks N of M met when every supporting document is mirrored", () => {
    const facts = ready({
      supportingDocumentCount: 3,
      mirroredDocumentCount: 3,
    });

    expect(deriveRemovalReadiness(facts).advisories).toEqual([]);
    expect(checkFor(buildRemovalPreflightChecklist(facts), "evidence")).toMatchObject({
      status: "met",
      detail: "3 of 3 supporting documents mirrored",
    });
  });

  it("omits the evidence row and advisory when M is zero", () => {
    const facts = ready({
      supportingDocumentCount: 0,
      mirroredDocumentCount: 0,
    });

    expect(deriveRemovalReadiness(facts)).toMatchObject({
      state: "ready",
      advisories: [],
    });
    expect(
      buildRemovalPreflightChecklist(facts).some(
        (check) => check.key === "evidence",
      ),
    ).toBe(false);
    expect(
      buildRemovalRequirementsChecklist(facts).some(
        (check) => check.key === "evidence",
      ),
    ).toBe(false);
  });

  it("never adds the evidence advisory to blocking reasons", () => {
    const readiness = deriveRemovalReadiness(
      ready({
        supportingDocumentCount: 2,
        mirroredDocumentCount: 0,
        hasSubmittableRuns: false,
      }),
    );

    expect(readiness.state).toBe("blocked");
    expect(readiness.reasons).not.toContain(
      "0 of 2 supporting documents mirrored",
    );
    expect(readiness.advisories).toContain(
      "0 of 2 supporting documents mirrored",
    );
  });
});

describe("buildRemovalPreflightChecklist", () => {
  it("returns the seven checks in a stable order", () => {
    const checks = buildRemovalPreflightChecklist(ready());
    expect(checks.map((c) => c.key)).toEqual([
      "mapping",
      "credentials",
      "template",
      "transport",
      "production",
      "entityReadiness",
      "durability",
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

  it("flags missing organization credentials and skips registry-dependent checks", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ hasOrgCredentials: false }),
    );
    expect(checkFor(checks, "credentials").status).toBe("unmet");
    expect(checkFor(checks, "template").status).toBe("skipped");
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

  it("flags durability sampling/eligibility blockers", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ durabilityGateBlockers: ["Run PR-1 has 2 replicate(s); ≥ 3 required."] }),
    );
    expect(checkFor(checks, "durability").status).toBe("unmet");
    expect(checkFor(checks, "durability").detail).toContain("≥ 3 required");
  });

  it("skips durability when there is nothing to submit", () => {
    const checks = buildRemovalPreflightChecklist(
      ready({ hasSubmittableRuns: false }),
    );
    expect(checkFor(checks, "durability").status).toBe("skipped");
  });

  it("marks durability met for a fully-sampled, eligible removal", () => {
    const checks = buildRemovalPreflightChecklist(ready());
    expect(checkFor(checks, "durability").status).toBe("met");
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

  it("surfaces wizard-level keys (incl. run-level durability not in batch health)", () => {
    const checks = buildRemovalRequirementsChecklist(ready());
    expect(checks.map((c) => c.key)).toEqual([
      "mapping",
      "credentials",
      "template",
      "transportUniformity",
      "entityReadiness",
      "durability",
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

describe("shared requirement metadata (Phase 0)", () => {
  it("attaches requirementLabel + why to every pre-flight check from the shared source", () => {
    for (const check of buildRemovalPreflightChecklist(ready())) {
      expect(check.requirementLabel).toBe(
        CERT_REQUIREMENT_META[check.key].requirementLabel,
      );
      expect(check.whyDetail).toBe(CERT_REQUIREMENT_META[check.key].whyDetail);
    }
  });

  it("attaches requirementLabel + why to every requirements check from the shared source", () => {
    for (const check of buildRemovalRequirementsChecklist(ready())) {
      expect(check.requirementLabel).toBe(
        CERT_REQUIREMENT_META[check.key].requirementLabel,
      );
      expect(check.whyDetail).toBe(CERT_REQUIREMENT_META[check.key].whyDetail);
    }
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
