// @vitest-environment jsdom
vi.mock("@/hooks/use-emission-entries", () => ({ useBatchEmissionLines: () => ({ data: [], isLoading: false, error: null }) }));
import type { ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { EntitySideSheetSections } from "@/components/ui/entity-side-sheet";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  CreditBatchProductionRunOption,
  CreditBatchWithRelations,
} from "@/data-access/credit-batches";
import { creditBatchSheetSections } from "./credit-batch-view";

vi.mock("next/link", () => ({ default: ({ children, href, ...props }: { children: ReactNode; href: string }) => <a href={href} {...props}>{children}</a> }));
// The pinned template block reads live queries; its own suite covers it.
vi.mock("./credit-batch-removal-template", () => ({ CreditBatchRemovalTemplate: () => <div>Removal template block</div> }));

afterEach(cleanup);

function makeRun(
  status: CreditBatchProductionRunOption["status"],
  index: number,
): CreditBatchProductionRunOption {
  return {
    id: `run-${index}`,
    code: `PR-26-00${index}`,
    date: `2026-05-${12 + index}`,
    status,
    biocharStorageName: "Moshi Raw Biochar Curing Pad",
    biocharOutputKg: status === "complete" ? 950 : null,
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
    componentKey: null,
    moduleVersion: null,
    formulaVersion: null,
    applicationResults: [],
    missingInputs,
    warnings: [],
  };
}

function carbonEstimateMarkup(
  options: Parameters<typeof creditBatchSheetSections>[0],
): string {
  const content = creditBatchSheetSections(options).find(
    (section) => section.title === "Production runs",
  )?.content;
  return renderToStaticMarkup(<>{content}</>);
}

/** The carbon estimate with its (i) panel open: the production inputs live there. */
async function openedCarbonEstimate(options: Parameters<typeof creditBatchSheetSections>[0]): Promise<HTMLElement> {
  const content = creditBatchSheetSections(options).find((section) => section.title === "Production runs")?.content;
  render(<>{content}</>);
  fireEvent.click(screen.getByRole("button", { name: /^About Carbon estimate/ }));
  return screen.findByRole("dialog");
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
  it("omits the field until a numeric preview is available", () => {
    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch(),
      }),
    ).not.toContain("t CO₂e");

    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch({
          co2eStoredPreview: makePreview(null, ["organicCarbonPercent"]),
        }),
      }),
    ).not.toContain("t CO₂e");
  });

  it("renders the figure once the preview resolves", () => {
    expect(
      carbonEstimateMarkup({
        ...baseOptions,
        creditBatch: makeBatch({
          co2eStoredPreview: makePreview(12.5, []),
        }),
      }),
    ).toContain("≈ 12.50 t CO₂e");
  });

  it("keeps loading production-run data distinct from missing inputs", async () => {
    const panel = await openedCarbonEstimate({
      ...baseOptions,
      creditBatch: makeBatch(),
      isLoadingRuns: true,
    });

    expect(panel.textContent).toContain("Production inputs");
    expect(panel.textContent).toContain("Loading…");
    expect(panel.innerHTML).toContain('aria-busy="true"');
    expect(panel.textContent).not.toContain("Feedstock dry mass");
  });

  it("explains when production-run data is unavailable", async () => {
    const panel = await openedCarbonEstimate({
      ...baseOptions,
      creditBatch: makeBatch(),
      runsError: new Error("request failed"),
    });

    expect(panel.textContent).toContain("Could not load. Reload the page.");
    expect(panel.textContent).not.toContain("Feedstock dry mass");
  });

  it("discloses the raw and capped 1000-year durability calculation", () => {
    const preview = makePreview(12.5, []);
    preview.componentKey = "biochar_sequestration_1000_year_f_durable_max";
    preview.formulaVersion = "organic-carbon-cap-v1";
    preview.applicationResults = [{
      applicationId: "application-1",
      applicationCode: "APP-001",
      co2eStoredTonnes: 12.5,
      rawFDurable: 0.97,
      fDurable: 0.95,
      durabilityCapped: true,
      organicCarbonPercent: 79,
      effectiveSoilTemperatureC: null,
      missingInputs: [],
      warnings: [],
    }];
    const section = creditBatchSheetSections({
      ...baseOptions,
      creditBatch: makeBatch({ co2eStoredPreview: preview }),
    }).find((entry) => entry.title === "Batch definition");

    // The result is a field; how it was reached is explanation behind an (i).
    const field = section?.fields.find((entry) => entry.label === "Durability estimate (capped)");
    expect(field).toEqual(expect.objectContaining({ value: "95.0%", explanationTitle: "Durability estimate" }));
    const explanation = renderToStaticMarkup(<>{field?.explanation}</>);
    expect(explanation).toContain("Raw durability estimate");
    expect(explanation).toContain("97.0%");
    expect(explanation).toContain("Durability cap applied");
    expect(explanation).toContain("organic-carbon-cap-v1");
  });
});

describe("credit batch sheet applied biochar", () => {
  const applied = (appliedDryKg?: number | null) => creditBatchSheetSections({ ...baseOptions, creditBatch: makeBatch({}), appliedDryKg })
    .find((entry) => entry.title === "Batch definition")?.fields.find((field) => field.label === "Applied biochar (dry)");

  it("reads dry applied biochar from the page model, as the batch page does", () => {
    expect(applied(320)).toMatchObject({ value: "0.32 t", pending: false });
  });

  it("waits while the page model loads and says when it failed", () => {
    expect(applied(undefined)).toMatchObject({ value: null, pending: true });
    expect(applied(null)).toMatchObject({ value: "Could not load", pending: false, valuePresent: false });
  });
});

describe("credit batch production-run preview", () => {
  it("labels running previews without labeling completed members", () => {
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

    expect(html).not.toContain("PR-26-001");
    expect(html).not.toContain("PR-26-002");
    expect(html).not.toContain("PR-26-003");
    expect(html).toContain("May 14, 2026");
    expect(html).toContain("Moshi Raw Biochar Curing Pad");
    expect(html).toContain("Running");
    expect(html).not.toContain('data-status="complete"');
  });
});

it("shows saved fields, the durability result and the carbon estimate figure inline, and the calculation rows behind (i)s", async () => {
  const preview = { ...makePreview(12.5, []), formulaVersion: "v1" };
  preview.applicationResults = [{ applicationId: "app", applicationCode: "APP-001", co2eStoredTonnes: 12.5, rawFDurable: 0.97, fDurable: 0.95, durabilityCapped: true, organicCarbonPercent: 79, effectiveSoilTemperatureC: null, missingInputs: [], warnings: [] }];
  const sections = creditBatchSheetSections({ ...baseOptions, creditBatch: makeBatch({ co2eStoredPreview: preview, productionEmissionsClaimedByRemovalId: "removal-1" }) });
  const { container } = render(<EntitySideSheetSections sections={sections} />);
  const shown = container.textContent ?? "";
  for (const label of ["Carbon ledger", "Show calculation", "Feedstock dry mass", "Raw durability estimate", "Preview formula"]) expect(shown).not.toContain(label);
  expect(shown).toContain("Applied biochar");
  expect(shown).toContain("Durability estimate (capped)95.0%");
  // The estimate closes the Production runs section and shows its figure.
  expect(shown).toContain("Carbon estimate, before project emissions");
  expect(shown).toContain("≈ 12.50 t CO₂e");
  expect(shown.indexOf("Production runs")).toBeLessThan(shown.indexOf("≈ 12.50 t CO₂e"));
  expect(sections.map(section => section.title)).not.toContain("Carbon ledger");
  expect(shown).toContain("Wood chips");
  expect(shown).toContain("Production emissions included in a Removal");
  // The durability basis opens from the (i) beside its figure.
  fireEvent.click(screen.getByRole("button", { name: "About Durability estimate" }));
  expect(await screen.findByText("Raw durability estimate")).toBeTruthy();
  expect(screen.getByText(/Preview formula/)).toBeTruthy();
  // A provenance row the preview does not carry is left out, not a placeholder.
  expect(screen.queryByText("Preview component")).toBeNull();
  expect(screen.queryByText("Preview authority")).toBeNull();
});

it("leads the carbon estimate with the figure and keeps the input quantities behind its (i)", async () => {
  const content = creditBatchSheetSections({
    ...baseOptions,
    creditBatch: makeBatch({ co2eStoredPreview: makePreview(12.5, []) }),
    productionRuns: [makeRun("complete", 1)],
  }).find((section) => section.title === "Production runs")?.content;
  const { container } = render(<>{content}</>);
  const shown = container.textContent ?? "";
  // The caption names the figure, and the one headline figure follows it.
  expect(shown).toContain("Carbon estimate, before project emissions");
  expect(shown).toContain("≈ 12.50 t CO₂e");
  // The runs are listed right above, so the block repeats no source-run links.
  expect(shown).not.toContain("Source runs");
  // The per-input quantities are the arithmetic behind the figure, not a
  // second list competing with it.
  expect(shown).not.toContain("Feedstock dry mass");
  expect(screen.queryByText("These inputs are not in the estimate.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /^About Carbon estimate/ }));
  expect(await screen.findByText("Feedstock dry mass")).toBeTruthy();
  expect(screen.getByText("Grid electricity")).toBeTruthy();
  expect(screen.getByText(/These inputs are not in the estimate\./)).toBeTruthy();
  expect(screen.getByText(/The registry result is authoritative\./)).toBeTruthy();
});

it.each([
  [["facilityCertifierProject"], "No certifier project is linked to this facility."],
  [["applicationIds", "thousandYearReplicates"], "No applications recorded for this batch yet."],
  [["organicCarbonPercent", "soilTemperatureC"], "Missing: Organic carbon content, Soil temperature."],
])("says why the carbon estimate is not available (%j)", (missingInputs, reason) => {
  const markup = carbonEstimateMarkup({
    ...baseOptions,
    creditBatch: makeBatch({ co2eStoredPreview: makePreview(null, missingInputs) }),
  });
  expect(markup).toContain(reason);
});
