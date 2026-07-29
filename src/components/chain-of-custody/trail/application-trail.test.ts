import { describe, expect, it } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { buildTrailSteps } from "./application-trail";

function lineage(): ChainOfCustodyData {
  return {
    facility: { id: "facility-1", code: "FAC-1", name: "Moshi" },
    application: {
      id: "application-1",
      code: "AP-1",
      status: "applied",
      applicationDate: new Date("2026-05-20T00:00:00Z"),
      fieldIdentifier: "North field",
      evidenceMethod: "visual",
      gisBoundary: null,
      biocharAppliedTons: 0.85,
      biocharAppliedDryTons: 0.82,
      soilTemperatureC: null,
      href: "/applications",
    },
    delivery: {
      id: "delivery-1",
      code: "DL-1",
      status: "delivered",
      deliveryDate: new Date("2026-05-19T00:00:00Z"),
      deliveredWetMassKg: 850,
      massDryKg: 820,
      href: "/deliveries",
    },
    order: null,
    biocharProduct: null,
    productionRun: {
      id: "run-1",
      code: "PR-1",
      status: "complete",
      date: "2026-05-17",
      biocharStorageName: "Moshi Raw Biochar Curing Pad",
      biocharOutputKg: 850,
      biocharDryMassKg: 820,
      feedstockMassDryKg: 1_500,
      href: "/production-runs",
    },
    reactor: null,
    feedstocks: [],
    warnings: [],
  };
}

describe("buildTrailSteps", () => {
  it("shows wet and dry biochar mass together through custody", () => {
    const steps = buildTrailSteps(lineage());

    expect(
      steps.find((step) => step.kind === "productionRun")?.massLine,
    ).toBe("Wet: 850 kg · Dry: 820 kg");
    expect(steps.find((step) => step.kind === "productionRun")?.code).toBe(
      "Moshi Raw Biochar Curing Pad",
    );
    expect(steps.find((step) => step.kind === "delivery")?.massLine).toBe(
      "Wet: 850 kg · Dry: 820 kg",
    );
    expect(steps.find((step) => step.kind === "application")?.massLine).toBe(
      "Wet: 850 kg · Dry: 820 kg",
    );
  });

  it("includes every production run contributing to a mixed-bin product", () => {
    const data = lineage();
    const firstRun = data.productionRun!;
    data.productionRun = null;
    data.sources = [
      {
        productionRun: firstRun,
        reactor: null,
        feedstocks: [],
        allocatedWetMassKg: 500,
        allocatedDryMassKg: 490,
      },
      {
        productionRun: {
          ...firstRun,
          id: "run-2",
          code: "PR-2",
          date: "2026-05-18",
          biocharOutputKg: 600,
          biocharDryMassKg: 588,
        },
        reactor: null,
        feedstocks: [],
        allocatedWetMassKg: 350,
        allocatedDryMassKg: 343,
      },
    ];

    expect(
      buildTrailSteps(data)
        .filter((step) => step.kind === "productionRun")
        .map((step) => step.nodeId),
    ).toEqual(["production-run:run-1", "production-run:run-2"]);
  });
});
