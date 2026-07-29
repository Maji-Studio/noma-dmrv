import { describe, expect, it } from "vitest";
import type { RemovalCompilationView } from "@/fn/certification";
import type {
  MemberCreditBatch,
  RemovalCertifyContext,
} from "@/fn/certification/certify-context";
import type {
  RemovalReadiness,
  RemovalRequirementCheck,
} from "@/lib/certification/readiness";
import {
  actionableSubmissionChecks,
  buildSubmissionFacts,
  isRemovalCompilationReady,
  type SubmissionFactsInput,
} from "./submission-facts";

const BATCH = {
  id: "batch-1",
  code: "CB-26-001",
  startDate: "2026-07-01",
  endDate: "2026-07-31",
  appliedWeightTons: 10,
  appliedDryWeightTons: 8.5,
  durabilityOption: "1000_year",
  sampling: "sampled",
  productionRunCount: 1,
  applicationCount: 1,
} as MemberCreditBatch;

const SECOND_BATCH = {
  ...BATCH,
  id: "batch-2",
  code: "CB-26-002",
  startDate: "2026-06-05",
  endDate: "2026-08-20",
  appliedDryWeightTons: 1.5,
  durabilityOption: "200_year",
  sampling: "unsampled",
  productionRunCount: 2,
  applicationCount: 3,
} as MemberCreditBatch;

// Midday UTC so the rendered range does not shift a day under a negative
// local offset.
const REPORTING_WINDOW = {
  startedOn: "2026-06-05T12:00:00.000Z",
  completedOn: "2026-08-20T12:00:00.000Z",
};

const READY_COMPILATION = {
  review: { pendingSourceCount: 2, reportingWindow: REPORTING_WINDOW },
  blockers: [],
  warnings: [],
  snapshot: {},
  compilationHash: "compilation-hash",
} as unknown as RemovalCompilationView;

const BLOCKED_COMPILATION = {
  review: { pendingSourceCount: 0 },
  blockers: ["Latest production run ends at 2028-01-02T15:00:00.000Z."],
  warnings: [],
  snapshot: null,
  compilationHash: null,
} as unknown as RemovalCompilationView;

const CONTEXT = {
  memberBatches: [BATCH],
  project: { name: "Biochar project" },
  mapping: null,
  isProduction: false,
  submissionWarnings: [],
  supportingDocuments: { total: 5, mirrored: 2 },
} as unknown as RemovalCertifyContext;

function check(
  key: RemovalRequirementCheck["key"],
  status: RemovalRequirementCheck["status"],
): RemovalRequirementCheck {
  return { key, label: key, requirementLabel: key, status };
}

function readiness(
  state: RemovalReadiness["state"],
  reasons: string[] = [],
): RemovalReadiness {
  return { state, reasons, advisories: [] };
}

function facts(overrides: Partial<SubmissionFactsInput> = {}) {
  return buildSubmissionFacts({
    ctx: CONTEXT,
    compilation: READY_COMPILATION,
    isCompilationLoading: false,
    compilationError: null,
    checks: [check("mapping", "met")],
    readiness: readiness("ready"),
    rejectionMessage: null,
    ...overrides,
  });
}

describe("isRemovalCompilationReady", () => {
  it("requires no blockers and a compiled artifact", () => {
    expect(isRemovalCompilationReady(READY_COMPILATION)).toBe(true);
    expect(isRemovalCompilationReady(BLOCKED_COMPILATION)).toBe(false);
    expect(isRemovalCompilationReady(null)).toBe(false);
    expect(
      isRemovalCompilationReady({
        ...READY_COMPILATION,
        compilationHash: null,
      } as unknown as RemovalCompilationView),
    ).toBe(false);
  });
});

describe("actionableSubmissionChecks", () => {
  it("keeps automatic evidence upload out of the action checklist", () => {
    const checks = [
      check("mapping", "met"),
      check("measurementDates", "unmet"),
      check("evidence", "warning"),
    ];

    expect(actionableSubmissionChecks(checks).map(({ key }) => key)).toEqual([
      "mapping",
      "measurementDates",
    ]);
  });
});

describe("buildSubmissionFacts verdict precedence", () => {
  it("reports loading ahead of everything else", () => {
    expect(
      facts({
        isCompilationLoading: true,
        compilation: null,
        checks: [check("mapping", "unmet")],
      }),
    ).toMatchObject({
      state: "loading",
      headline: "Preparing the submission",
      detail: "This takes a moment.",
    });
  });

  it("puts unmet checks ahead of compiler blockers in the verdict", () => {
    expect(
      facts({
        compilation: BLOCKED_COMPILATION,
        checks: [check("mapping", "met"), check("measurementDates", "unmet")],
      }),
    ).toMatchObject({
      state: "blocked",
      headline: "1 issue blocks submission",
      detail: "Review the issue below.",
    });
  });

  it("keeps compiler blockers when a checklist issue also needs attention", () => {
    expect(
      facts({
        compilation: BLOCKED_COMPILATION,
        checks: [check("measurementDates", "unmet")],
      }).blockers,
    ).toEqual(BLOCKED_COMPILATION.blockers);
  });

  it("pluralises the blocking issue count", () => {
    expect(
      facts({
        checks: [check("mapping", "unmet"), check("template", "unmet")],
      }).headline,
    ).toBe("2 issues block submission");
  });

  it("reports a failed build when compilation is absent or errored", () => {
    const expected = {
      state: "blocked",
      headline: "Cannot submit yet",
      detail:
        "Open Technical details below to retry. It shows why the build failed.",
    };

    expect(facts({ compilation: null })).toMatchObject(expected);
    expect(
      facts({ compilationError: new Error("boom") }),
    ).toMatchObject(expected);
  });

  it("points at the blocker list when compilation is not ready", () => {
    expect(facts({ compilation: BLOCKED_COMPILATION })).toMatchObject({
      state: "blocked",
      headline: "Cannot submit yet",
      detail: "Clear the blockers below.",
      blockers: BLOCKED_COMPILATION.blockers,
    });
  });

  it("points at Technical details when compilation is incomplete without blockers", () => {
    expect(
      facts({
        compilation: {
          ...BLOCKED_COMPILATION,
          blockers: [],
        } as unknown as RemovalCompilationView,
      }),
    ).toMatchObject({
      state: "blocked",
      headline: "Cannot submit yet",
      detail:
        "The submission is incomplete. Open Technical details below to see what is missing.",
    });
  });

  it("reports a live submission lock, which no checklist row carries", () => {
    expect(facts({ readiness: readiness("inProgress") })).toMatchObject({
      state: "blocked",
      headline: "Submission in progress",
      detail: "Another submission for this removal is still running.",
    });
  });

  it("never reads ready when the submit gate still refuses", () => {
    expect(
      facts({
        readiness: readiness("blocked", ["Facility not linked"]),
      }),
    ).toMatchObject({
      state: "blocked",
      headline: "Cannot submit yet",
      blockers: ["Facility not linked"],
    });
  });

  it("stays ready for a resubmittable removal", () => {
    expect(facts({ readiness: readiness("submitted") })).toMatchObject({
      state: "ready",
      headline: "Ready to submit",
    });
  });

  it("carries a registry rejection in the verdict, ahead of the checks", () => {
    expect(
      facts({
        rejectionMessage: "This removal was rejected in Isometric.",
        checks: [check("mapping", "unmet")],
      }),
    ).toMatchObject({
      state: "blocked",
      headline: "Cannot submit yet",
      detail: "This removal was rejected in Isometric.",
    });
  });

  it("counts only actionable checks in the ready verdict", () => {
    expect(
      facts({
        checks: [
          check("mapping", "met"),
          check("template", "met"),
          check("evidence", "warning"),
        ],
      }),
    ).toMatchObject({
      state: "ready",
      headline: "Ready to submit",
      detail: "2 checks passed. Nothing left to fix.",
      checksPassed: 2,
      checksTotal: 2,
      checksAttention: 0,
    });
  });

  it("counts only checks that passed, not ones left unevaluable", () => {
    expect(
      facts({
        checks: [
          check("mapping", "met"),
          check("template", "met"),
          check("durability", "skipped"),
        ],
      }),
    ).toMatchObject({
      state: "ready",
      headline: "Ready to submit",
      detail: "2 checks passed. Nothing left to fix.",
      checksPassed: 2,
      checksTotal: 3,
      checksAttention: 0,
    });
  });
});

describe("buildSubmissionFacts panel data", () => {
  it("totals dry mass and reports the compiled reporting window", () => {
    expect(
      facts({
        ctx: {
          ...CONTEXT,
          memberBatches: [BATCH, SECOND_BATCH],
        } as unknown as RemovalCertifyContext,
      }),
    ).toMatchObject({
      dryTons: "10.0 t",
      batchCount: 2,
      runCount: 3,
      applicationCount: 4,
      reportingWindowLabel: "Jun 5 to Aug 20, 2026",
      durabilityLabel: "1000-year (R₀ reflectance), 200-year (H:Corg)",
      samplingLabel: "Sampled, Not sampled",
    });
  });

  it("has no reporting window until the submission compiles", () => {
    expect(facts({ compilation: null })).toMatchObject({
      reportingWindowLabel: null,
    });
  });

  it("still counts pending files when the submission did not compile", () => {
    expect(facts({ compilation: null })).toMatchObject({
      pendingDocuments: 3,
    });
  });

  it("names the destination and environment, and counts pending files", () => {
    expect(facts()).toMatchObject({
      projectLabel: "Biochar project",
      environmentLabel: "Sandbox",
      isProduction: false,
      pendingDocuments: 2,
    });

    expect(
      facts({
        ctx: {
          ...CONTEXT,
          project: null,
          mapping: { externalProjectId: "prj_123" },
          isProduction: true,
        } as unknown as RemovalCertifyContext,
      }),
    ).toMatchObject({
      projectLabel: "prj_123",
      environmentLabel: "Production",
      isProduction: true,
    });
  });

  it("merges compiler warnings with the context's submission warnings", () => {
    expect(
      facts({
        compilation: {
          ...READY_COMPILATION,
          warnings: ["Ash content was recorded but is not included."],
        } as unknown as RemovalCompilationView,
        ctx: {
          ...CONTEXT,
          submissionWarnings: ["Moisture reading was not included."],
        } as unknown as RemovalCertifyContext,
      }).warnings,
    ).toEqual([
      "Ash content was recorded but is not included.",
      "Moisture reading was not included.",
    ]);
  });
});
