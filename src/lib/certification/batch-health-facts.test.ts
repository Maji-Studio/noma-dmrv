import { describe, expect, it } from "vitest";
import type { RemovalCertifyContext } from "@/fn/certification/certify-context";
import { deriveBatchHealth } from "./batch-health";
import { carbonGapLabels, toBatchHealthFacts } from "./batch-health-facts";
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
