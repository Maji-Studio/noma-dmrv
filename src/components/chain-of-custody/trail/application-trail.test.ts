import { describe, expect, it, vi } from "vitest";
import type { ChainOfCustodyData } from "@/data-access/chain-of-custody";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import { ApplicationTrail, buildTrailSteps } from "./application-trail";

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
      proofOfDeliveryCount: 1,
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

  it("shows feedstock lineage allocation on a wet basis", () => {
    const data = lineage();
    data.feedstocks = [
      {
        id: "feedstock-1",
        code: "FS-1",
        status: "complete",
        deliveryDate: new Date("2026-05-16T00:00:00Z"),
        massDryKg: 1_950,
        wetMassUsedKg: 3_000,
        supplierName: "Supplier",
        feedstockTypeName: "Wood chips",
        ownsTransport: true,
        href: "/feedstock-intake",
      },
    ];

    expect(buildTrailSteps(data)[0]?.massLine).toBe(
      "Wet allocation: 3,000 kg",
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

vi.mock("@/hooks/use-facility-context", () => ({ useFacilityClock: () => ({ timeZone: "Africa/Dar_es_Salaam", hint: "" }) }));
vi.mock("@/hooks/use-chain-of-custody", () => ({ useApplicationTrail: () => ({
  isLoading: false, isError: false,
  data: { totalCount: 1, byNodeId: { "production-run:run-1": {
    documents: [], transportLegs: [], samples: [{ id: "measurement-1", timestamp: new Date("2026-10-21T21:30:00Z") }],
  } } },
}) }));

it("shows trail measurements on the facility clock", () => {
  expect(renderToStaticMarkup(createElement(ApplicationTrail, { applicationId: "application-1", chainData: lineage() }))).toContain("Oct 22, 2026, 00:30");
});
