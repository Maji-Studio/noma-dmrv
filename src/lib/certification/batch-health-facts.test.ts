import { describe, expect, it } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { deriveBatchHealth } from "./batch-health";
import { carbonGapLabels, toBatchHealthFacts } from "./batch-health-facts";
import { deriveRemovalReadiness } from "./readiness";
import { toRemovalReadinessFacts } from "./readiness-facts";
import { collectFeedstockTypeMappingGaps } from "./feedstock-type-mapping";
import { STORED_CO2E_PREVIEW_REVERIFICATION_GAP } from "./preview-gaps";

describe("toBatchHealthFacts", () => {
  it("filters the lineage sentinel without suppressing independent sample evidence", () => {
    const ctx = {
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
      defaultTemplate: {},
      missingDefaultTemplateId: null,
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
      defaultTemplate: {},
      missingDefaultTemplateId: null,
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

  it("does not require registry mapping for an internal blend feedstock type", () => {
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
      memberBatches,
      feedstockTypeMappingGaps:
        collectFeedstockTypeMappingGaps(memberBatches),
      entityReadinessGaps: [],
      entityReadinessIssues: [],
      hasSubmittableRuns: true,
      productionReadinessGap: null,
      mapping: {},
      defaultTemplate: {},
      missingDefaultTemplateId: null,
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
    ).toBe("ready");
  });

  it("does not apply feedstock mapping gaps before a facility is linked", () => {
    const ctx = {
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
      defaultTemplate: null,
      missingDefaultTemplateId: null,
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
      defaultTemplate: {},
      missingDefaultTemplateId: null,
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
