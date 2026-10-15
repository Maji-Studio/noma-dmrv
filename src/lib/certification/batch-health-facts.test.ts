import { describe, expect, it } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { deriveBatchHealth } from "./batch-health";
import { carbonGapLabels, toBatchHealthFacts } from "./batch-health-facts";
import { batchHealthFixLinkFor } from "./batch-health-links";
import { buildSubmissionLineageBlockers } from "@/fn/certification/certify-lineage-blockers";
import { buildRemovalRequirementsChecklist, deriveRemovalReadiness } from "./readiness";
import { toRemovalReadinessFacts } from "./readiness-facts";
import { collectFeedstockTypeMappingGaps } from "./feedstock-type-mapping";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "./preview-gaps";

describe("toBatchHealthFacts", () => {
  const readyContext = {
    submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
    memberBatches: [{ id: "batch-1", durabilityGateBlockers: [], facilityEmissionsGateBlockers: [] }],
    latestSubmission: null, hasOrgCredentials: true, supportingDocuments: { total: 0, mirrored: 0 },
    mapping: {}, removalTemplate: {},
    unresolvedBlueprintKeys: [], unbindableTemplateInputs: [],
    hasSubmittableRuns: true, entityReadinessGaps: [], entityReadinessIssues: [],
    requiredTransportCategories: ["feedstock"],
    transportCoverage: { feedstock: { count: 1, missingEntityIds: [], aggregationWarning: null, vehicleAdvisories: [] } },
  } as unknown as RemovalCertifyContext;

  it("carries only the selected batch's document warnings without blocking", () => {
    const context = { ...readyContext,
      memberBatches: ["batch-1", "batch-2"].map((id) => ({
        id, code: id, sampling: "sampled", hasLabReport: false, durabilityOption: "1000_year", hasReflectanceHistogram: false,
      })),
      submissionWarnings: ["Soil floor", "Startup diesel", "Run warning", "Sampling advisory", "Run warning"],
    } as unknown as RemovalCertifyContext;
    const health = deriveBatchHealth(toBatchHealthFacts(context, "batch-1"));
    const readiness = deriveRemovalReadiness(toRemovalReadinessFacts(context));
    expect(health.state).toBe("ready");
    expect(health.warnings).toEqual([
      "Credit batch batch-1 has no lab report document. Upload a lab report to one of its Samples. You can still submit the Removal.",
      "Credit batch batch-1 has no reflectance histogram document. Upload a reflectance histogram to one of its Samples. You can still submit the Removal.",
    ]);
    expect(toBatchHealthFacts(context, "absent").warnings).toEqual([]);
    expect(readiness.state).toBe("ready");
    expect(readiness.advisories).toEqual([]);
  });

  it("includes durability configuration blockers in batch health", () => {
    const health = deriveBatchHealth(toBatchHealthFacts({ ...readyContext, durabilityConfigurationBlockers: ["Resolve this submission blocker."] }, "batch-1"));
    expect(health.state).toBe("incomplete");
    expect(health.checks.some((check) => check.detail?.includes("Resolve this submission blocker."))).toBe(true);
  });

  it.each([
    ["orders", "/orders?"],
    ["deliveries", "/deliveries?"],
    ["deliveryEvidence", "/deliveries?"],
    ["deliveryDistances", "/deliveries?"],
  ] as const)("routes %s blockers to the resolving workflow", (fixTarget, path) => {
    const health = deriveBatchHealth(toBatchHealthFacts({ ...readyContext, submissionLineageBlockers: [{
      detail: "Resolve this submission blocker.", fixTarget, record: { id: "record-1", code: "RE-1" },
    }] }, "batch-1"));
    const check = health.checks.find((check) => check.status === "unmet")!;
    expect(health.issueCount).toBe(1);
    expect(check.fixTarget).toBe(fixTarget);
    expect(batchHealthFixLinkFor(check, "facility-1").href).toContain(path);
    expect(buildRemovalRequirementsChecklist(toRemovalReadinessFacts({ ...readyContext,
      submissionLineageBlockers: [{ detail: "Resolve this submission blocker.", fixTarget, record: { id: "record-1", code: "RE-1" } }],
    }))).toContainEqual(expect.objectContaining({ key: "entityReadiness", lineageIssues: [
      expect.objectContaining({ fixTarget, record: { id: "record-1", code: "RE-1" } }),
    ] }));
  });

  it("does not let one feedstock leg cover a second feedstock", () => {
    const ctx = { ...readyContext,
      submissionLineageBlockers: buildSubmissionLineageBlockers([], ["fs-2"], { "fs-2": "FS-2" }, ["feedstock"]),
      transportCoverage: {
      ...readyContext.transportCoverage,
      feedstock: { ...readyContext.transportCoverage.feedstock, missingEntityIds: ["fs-2"] },
    } };
    expect(deriveBatchHealth(toBatchHealthFacts(readyContext, "batch-1")).state).toBe("ready");
    const health = deriveBatchHealth(toBatchHealthFacts(ctx, "batch-1"));
    expect(health.state).toBe("incomplete");
    expect(health.issueCount).toBe(1);
    const check = health.checks.find((check) => check.status === "unmet")!;
    expect(check.affectedRecords?.[0].id).toBe("fs-2");
    expect(batchHealthFixLinkFor(check, "facility-1").href).toContain("feedstock=fs-2");
    const removalFacts = toRemovalReadinessFacts(ctx);
    expect(deriveRemovalReadiness(removalFacts)).toMatchObject({ state: "blocked", reasons: ["Missing feedstock transport legs"] });
    const checklist = buildRemovalRequirementsChecklist(removalFacts);
    expect(checklist.filter((check) => check.status === "unmet")).toEqual([
      expect.objectContaining({ key: "transport", transportCategory: "feedstock" }),
    ]);
    expect(health.checks).toContainEqual(expect.objectContaining({ key: "transport", status: "unmet" }));
  });

  it("filters the lineage sentinel without suppressing independent sample evidence", () => {
    const ctx = {
      submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
      memberBatches: [
        {
          id: "batch-1",
          code: "CB-1",
          durabilityGateBlockers: [
            "Credit batch CB-1 has no replicates with complete H/C_org and O/C_org chemistry. Record at least 3 for each sampled batch (§8.3.1).",
          ],
          facilityEmissionsGateBlockers: [
            "Set the facility reference soil temperature.",
          ],
        },
      ],
      hasSubmittableRuns: false,
      productionReadinessGap: {
        kind: "noApplications",
        detail: "No applications fall in this batch's crediting period.",
        fixTarget: "applications",
      },
      entityReadinessGaps: [],
      entityReadinessIssues: [],
      mapping: {},
      removalTemplate: {},
      unbindableTemplateInputs: [],
      unresolvedBlueprintKeys: [],
      requiredTransportCategories: [],
      transportCoverage: {
        feedstock: { count: 0 },
        biochar: { count: 0 },
        sample: { count: 0 },
      },
    } as unknown as RemovalCertifyContext;

    const health = deriveBatchHealth(toBatchHealthFacts(ctx, "batch-1"));

    expect(health.issueCount).toBe(3);
    expect(
      health.checks.find((check) => check.key === "carbon")?.detail,
    ).toContain("complete H/C_org and O/C_org chemistry");
    expect(
      health.checks.find((check) => check.key === "carbon")?.detail,
    ).not.toContain("reference soil temperature");
    expect(
      health.checks.find((check) => check.key === "facilityEmissions"),
    ).toMatchObject({
      detail: "Set the facility reference soil temperature.",
      fixTarget: "certificationEmissions",
      status: "unmet",
    });
    expect(
      health.checks.find((check) => check.key === "production")?.status,
    ).toBe("unmet");
  });

  it("shares a missing pyrolysis registry mapping with batch and Removal gates", () => {
    const memberBatches = [
      {
        id: "batch-1",
        code: "CB-1",
        durabilityGateBlockers: [],
        facilityEmissionsGateBlockers: [],
        feedstockType: {
          id: "type-1",
          name: "Macadamia shells",
          usage: "pyrolysis" as const,
          isometricFeedstockTypeId: null,
        },
      },
    ];
    const ctx = {
      submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
      memberBatches,
      feedstockTypeMappingGaps:
        collectFeedstockTypeMappingGaps(memberBatches),
      latestSubmission: null,
      hasOrgCredentials: true,
      hasSubmittableRuns: true,
      productionReadinessGap: null,
      entityReadinessGaps: [],
      entityReadinessIssues: [],
      durabilityGateBlockers: [],
      futureDatedMeasurements: [],
      supportingDocuments: { total: 0, mirrored: 0 },
      mapping: {},
      removalTemplate: {},
      unbindableTemplateInputs: [],
      unresolvedBlueprintKeys: [],
      requiredTransportCategories: [],
      transportCoverage: {
        feedstock: { count: 0 },
        biochar: { count: 0 },
        sample: { count: 0 },
      },
    } as unknown as RemovalCertifyContext;

    const batchHealth = deriveBatchHealth(toBatchHealthFacts(ctx, "batch-1"));
    const removalReadiness = deriveRemovalReadiness(
      toRemovalReadinessFacts(ctx),
    );

    expect(batchHealth.state).toBe("incomplete");
    expect(removalReadiness).toMatchObject({
      state: "blocked",
      reasons: [expect.stringContaining("Credit batch CB-1")],
    });
    expect(removalReadiness.reasons[0]).toContain("Macadamia shells");
    expect(removalReadiness.reasons[0]).toContain("Feedstock types");
  });

  it("fails closed when a legacy blend feedstock type is unmapped", () => {
    const memberBatches = [
      {
        id: "batch-1",
        code: "CB-1",
        durabilityGateBlockers: [],
        facilityEmissionsGateBlockers: [],
        feedstockType: {
          id: "type-1",
          name: "Compost",
          usage: "blend" as const,
          isometricFeedstockTypeId: null,
        },
      },
    ];
    const ctx = {
      submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
      memberBatches,
      feedstockTypeMappingGaps:
        collectFeedstockTypeMappingGaps(memberBatches),
      entityReadinessGaps: [],
      entityReadinessIssues: [],
      hasSubmittableRuns: true,
      productionReadinessGap: null,
      mapping: {},
      removalTemplate: {},
      unbindableTemplateInputs: [],
      unresolvedBlueprintKeys: [],
      requiredTransportCategories: [],
      transportCoverage: {
        feedstock: { count: 0 },
        biochar: { count: 0 },
        sample: { count: 0 },
      },
    } as unknown as RemovalCertifyContext;

    expect(
      deriveBatchHealth(toBatchHealthFacts(ctx, "batch-1")).state,
    ).toBe("incomplete");
  });

  it("does not apply feedstock mapping gaps before a facility is linked", () => {
    const ctx = {
      submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
      memberBatches: [
        {
          id: "batch-1",
          code: "CB-1",
          durabilityGateBlockers: [],
          facilityEmissionsGateBlockers: [],
        },
      ],
      feedstockTypeMappingGaps: [
        {
          creditBatchId: "batch-1",
          creditBatchCode: "CB-1",
          feedstockTypeId: "type-1",
          feedstockTypeName: "Macadamia shells",
        },
      ],
      entityReadinessGaps: [],
      entityReadinessIssues: [],
      hasSubmittableRuns: true,
      productionReadinessGap: null,
      mapping: null,
      removalTemplate: null,
      unbindableTemplateInputs: [],
      unresolvedBlueprintKeys: [],
      requiredTransportCategories: [],
      transportCoverage: {
        feedstock: { count: 0 },
        biochar: { count: 0 },
        sample: { count: 0 },
      },
    } as unknown as RemovalCertifyContext;

    const facts = toBatchHealthFacts(ctx, "batch-1");

    expect(facts.feedstockTypeMappingGaps).toEqual([]);
    expect(deriveBatchHealth(facts).state).toBe("ready");
  });

  it("treats a fresh interrupted Removal lock as immediately reclaimable", () => {
    const ctx = {
      submissionLineageBlockers: [], durabilityConfigurationBlockers: [],
      latestSubmission: {
        status: "draft",
        lockedAt: new Date(),
        metadata: {
          lastAttemptOutcome: "interrupted",
          externalMutation: "confirmed",
        },
      },
      feedstockTypeMappingGaps: [],
      hasOrgCredentials: true,
      mapping: {},
      removalTemplate: {},
      unbindableTemplateInputs: [],
      unresolvedBlueprintKeys: [],
      hasSubmittableRuns: true,
      productionReadinessGap: null,
      entityReadinessGaps: [],
      durabilityGateBlockers: [],
      futureDatedMeasurements: [],
      supportingDocuments: { total: 0, mirrored: 0 },
      requiredTransportCategories: [],
      transportCoverage: {
        feedstock: { count: 0 },
        biochar: { count: 0 },
        sample: { count: 0 },
      },
    } as unknown as RemovalCertifyContext;

    const facts = toRemovalReadinessFacts(ctx);

    expect(facts.lockInFlight).toBe(false);
    expect(deriveRemovalReadiness(facts).state).toBe("ready");
  });
});

describe("carbonGapLabels", () => {
  it("labels genuine carbon gaps and drops the keys other checks own", () => {
    expect(
      carbonGapLabels([
        "organicCarbonPercent",
        "applicationIds",
        "isometricCertifier",
        STORED_CO2E_PREVIEW_REVERIFICATION_GAP,
      ]),
    ).toEqual(["Organic carbon content"]);
  });

  it("passes an unknown calc input through rather than dropping it silently", () => {
    expect(carbonGapLabels(["someNewInput", "someNewInput"])).toEqual([
      "someNewInput",
    ]);
  });
});
