import { renderToStaticMarkup } from "react-dom/server";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";
import type { CreditBatchProductionRunOption } from "@/data-access/credit-batches";
import { CreditBatchProductionRunsPreview } from "./credit-batch-production-runs-preview";

function makeRun(
  overrides: Partial<CreditBatchProductionRunOption> = {},
): CreditBatchProductionRunOption {
  return {
    id: "run-1",
    code: "PR-26-001",
    date: "2026-05-13",
    status: "complete",
    biocharStorageName: "Moshi Raw Biochar Curing Pad",
    biocharOutputKg: 950,
    biocharDryMassKg: 900,
    feedstockMassDryKg: null,
    dieselOperationLiters: null,
    dieselGensetLiters: null,
    preprocessingFuelLiters: null,
    electricityKwh: null,
    feedstockTypeIds: ["feedstock-type-1"],
    assignedCreditBatchId: null,
    assignedCreditBatchCode: null,
    ...overrides,
  };
}

function renderPreview(
  overrides: Partial<ComponentProps<typeof CreditBatchProductionRunsPreview>> = {},
) {
  return renderToStaticMarkup(
    <CreditBatchProductionRunsPreview
      matchingRuns={[]}
      retainedRuns={[]}
      isReady
      isLoading={false}
      isError={false}
      isRetrying={false}
      onRetry={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CreditBatchProductionRunsPreview", () => {
  it("renders the full cohort immediately as a read-only status preview", () => {
    const html = renderPreview({
      matchingRuns: [
        makeRun(),
        makeRun({
          id: "run-2",
          code: "PR-26-002",
          status: "running",
          biocharOutputKg: null,
          biocharDryMassKg: null,
        }),
      ],
    });

    expect(html).toContain("1 completed · 1 preview");
    expect(html).not.toContain("PR-26-001");
    expect(html).not.toContain("PR-26-002");
    expect(html).toContain("May 13, 2026");
    expect(html).toContain("Moshi Raw Biochar Curing Pad");
    expect(html).toContain("Wet: 950 kg · Dry: 900 kg");
    expect(html).toContain('data-status="running"');
    expect(html).not.toContain('data-status="complete"');
    expect(html).not.toContain('type="checkbox"');
    expect(html).not.toContain('name="productionRunIds"');
    expect(html).not.toContain("Expand");
    expect(html).not.toContain("Collapse");
  });

  it("keeps assigned and fallback runs understandable without controls", () => {
    const html = renderPreview({
      matchingRuns: [
        makeRun({
          assignedCreditBatchId: "batch-elsewhere",
          assignedCreditBatchCode: "CB-26-099",
        }),
      ],
      retainedRuns: [{ id: "unavailable-run-id" }],
      currentCreditBatchId: "batch-current",
    });

    expect(html).toContain("Assigned to another credit batch");
    expect(html).not.toContain("CB-26-099");
    expect(html).toContain("unavailable-run-id");
    expect(html).toContain("Details unavailable");
    expect(html).toContain("1 completed · 0 previews · 1 retained");
    expect(html).not.toContain('type="checkbox"');
  });

  it("preserves prerequisite, loading, error, and empty states", () => {
    expect(renderPreview({ isReady: false })).toContain(
      "Select a feedstock type and set the production window to load runs.",
    );
    expect(renderPreview({ isLoading: true })).toContain(
      "Loading production runs",
    );
    expect(renderPreview({ isError: true })).toContain(
      "Couldn&#x27;t load production runs for this window.",
    );
    expect(renderPreview()).toContain("No matching production runs");
  });
});
