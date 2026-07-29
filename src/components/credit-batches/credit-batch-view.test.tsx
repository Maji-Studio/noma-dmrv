import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { creditBatchSheetSections } from "./credit-batch-view";

function makeRun(
  status: CreditBatchProductionRunOption["status"],
  index: number,
): CreditBatchProductionRunOption {
  return {
    id: `run-${index}`,
    code: `PR-26-00${index}`,
    date: `2026-05-${12 + index}`,
    status,
    biocharDryMassKg: status === "complete" ? 900 : null,
    feedstockMassDryKg: null,
    dieselOperationLiters: null,
    dieselGensetLiters: null,
    preprocessingFuelLiters: null,
    electricityKwh: null,
    feedstockTypeIds: ["feedstock-type-1"],
    assignedCreditBatchId: status === "complete" ? "batch-1" : null,
    assignedCreditBatchCode: status === "complete" ? "CB-26-001" : null,
  };
}

function makeBatch(
  overrides: Partial<CreditBatchWithRelations> = {},
): CreditBatchWithRelations {
  return {
    id: "batch-1",
    code: "CB-26-001",
    facilityId: "facility-1",
    productionRunCount: 1,
    appliedWeightTons: 0,
    co2eStoredPreview: null,
    feedstockTypeName: "Wood chips",
    durabilityOption: "1000_year",
    startDate: "2026-05-01",
    endDate: "2026-05-31",
    siteManagementNotes: null,
    ...overrides,
  } as CreditBatchWithRelations;
}

function makePreview(
  co2eStoredTonnes: number | null,
  missingInputs: string[],
): NonNullable<CreditBatchWithRelations["co2eStoredPreview"]> {
  return {
    provider: null,
    co2eStoredTonnes,
    moduleVersion: null,
    applicationResults: [],
    missingInputs,
    warnings: [],
  };
}

function co2eStoredMarkup(
  options: Parameters<typeof creditBatchSheetSections>[0],
): string {
  const field = creditBatchSheetSections(options)
    .find((section) => section.title === "Batch definition")
    ?.fields.find((f) => f.label === "CO₂e stored");
  return renderToStaticMarkup(<>{field?.value}</>);
}

const baseOptions = {
  productionRuns: [],
  isLoadingRuns: false,
  runsError: null,
  isRetryingRuns: false,
  onRetryRuns: () => {},
  isHealthLoading: false,
};

describe("credit batch CO₂e stored", () => {
  it("distinguishes a preview still loading from one that cannot be computed", () => {
    expect(
      co2eStoredMarkup({
        ...baseOptions,
        creditBatch: makeBatch(),
        isCo2ePreviewLoading: true,
      }),
    ).toContain("Calculating");

    expect(
      co2eStoredMarkup({
        ...baseOptions,
        creditBatch: makeBatch(),
        co2ePreviewFailed: true,
      }),
    ).toContain("Not available");
  });

  it("states that a resolved-but-empty preview is not calculable, with an explanation", () => {
    const markup = co2eStoredMarkup({
      ...baseOptions,
      creditBatch: makeBatch({
        co2eStoredPreview: makePreview(null, ["organicCarbonPercent"]),
      }),
    });

    // The gap list itself lives in the tooltip popup, which only mounts on
    // hover/focus — the cell asserts the state and offers the trigger.
    expect(markup).toContain("Not calculable yet");
    expect(markup).toContain("Why there is no CO₂e figure");
  });

  it("renders the figure once the preview resolves", () => {
    expect(
      co2eStoredMarkup({
        ...baseOptions,
        creditBatch: makeBatch({
          co2eStoredPreview: makePreview(12.5, []),
        }),
        isCo2ePreviewLoading: true,
      }),
    ).toContain("12.50 t CO₂e");
  });
});

describe("credit batch production-run preview", () => {
  it("labels draft and running previews without labeling completed members", () => {
    const creditBatch = {
      id: "batch-1",
      code: "CB-26-001",
      facilityId: "facility-1",
      productionRunCount: 1,
      appliedWeightTons: 0,
      co2eStoredPreview: null,
      feedstockTypeName: "Wood chips",
      durabilityOption: "1000_year",
      startDate: "2026-05-01",
      endDate: "2026-05-31",
      siteManagementNotes: null,
    } as CreditBatchWithRelations;
    const sections = creditBatchSheetSections({
      creditBatch,
      productionRuns: [
        makeRun("draft", 1),
        makeRun("running", 2),
        makeRun("complete", 3),
      ],
      isLoadingRuns: false,
      runsError: null,
      isRetryingRuns: false,
      onRetryRuns: vi.fn(),
      isHealthLoading: false,
    });
    const runsSection = sections.find(
      (section) => section.title === "Production runs",
    );
    const html = renderToStaticMarkup(<>{runsSection?.content}</>);

    expect(html).toContain("PR-26-001");
    expect(html).toContain("PR-26-002");
    expect(html).toContain("PR-26-003");
    expect(html).toContain("Draft");
    expect(html).toContain("Running");
    expect(html).not.toContain('data-status="complete"');
  });
});
